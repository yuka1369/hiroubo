#!/usr/bin/env python3
"""tmark_web — ローカルWebアプリ版（自分のPCで動かす）。

公開アーティファクトは外部APIを叩けない（CSP/CORS/キー漏洩）ため、
「フォームにAPIキーを入れて実行→本物データでTOP出し」を実現するのは
この“手元で動くローカルサーバ”。キーはこのプロセス（あなたのPC）の中だけに
保持し、ブラウザや外部には出さない。X API 呼び出しはサーバ側で行う。

使い方:
  cd tsuihai-marketer
  export X_BEARER_TOKEN=...      # 事前に入れておけばフォーム入力不要
  export XAI_API_KEY=...         # 精度用（任意）
  python3 tmark_web.py           # → http://127.0.0.1:8787 を開く

依存パッケージ 0（標準ライブラリのみ）。ブラウザのフォームで
プロダクト・自分のhandle・人数・予算を指定して「実行」すると、
予算内でX APIから収集→ユーザー別TOP出しを表示する。
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from tsuihai_marketer.audience import build_audience  # noqa: E402
from tsuihai_marketer.budget import (  # noqa: E402
    Budget, estimate_run, load_ledger, month_spent_jpy,
    record_spend, remaining_run_cap_jpy,
)
from tsuihai_marketer.collect import run_collection  # noqa: E402
from tsuihai_marketer.config import load_config, read_json, write_json  # noqa: E402
from tsuihai_marketer.ingest import dedupe, load_posts_jsonl  # noqa: E402
from tsuihai_marketer.llm import LLMClient, LLMConfig  # noqa: E402
from tsuihai_marketer.targeting import build_targets  # noqa: E402
from tsuihai_marketer.value_extraction import extract_values  # noqa: E402
from tsuihai_marketer.xclient import XClient  # noqa: E402

HOST, PORT = "127.0.0.1", int(os.environ.get("TMARK_PORT", "8787"))


def _yen(n) -> str:
    return f"¥{n:,.0f}"


def run_pipeline(body: dict, log) -> dict:
    """フォーム入力から config を組み立て、収集→TOP出しまで実行。"""
    product = body.get("product") or {}
    if not product.get("name") or not product.get("description"):
        raise ValueError("プロダクト名と説明は必須です")

    # キー: フォーム優先、無ければ環境変数。プロセス内だけに保持。
    x_bearer = (body.get("x_bearer") or os.environ.get("X_BEARER_TOKEN") or "").strip()
    xai_key = (body.get("xai_key") or os.environ.get("XAI_API_KEY") or "").strip()
    anthropic_key = (body.get("anthropic_key") or os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    if not x_bearer:
        raise ValueError("X_BEARER_TOKEN が必要です（フォームか環境変数で指定）")

    llm_provider = body.get("llm_provider") or ("grok" if xai_key else
                                                ("anthropic" if anthropic_key else "none"))
    # LLMClient は環境変数から鍵を読むので、この実行のためだけに一時設定
    if xai_key:
        os.environ["XAI_API_KEY"] = xai_key
    if anthropic_key:
        os.environ["ANTHROPIC_API_KEY"] = anthropic_key

    sample_size = int(body.get("sample_size", 20))
    posts_per_user = int(body.get("posts_per_user", 10))
    per_run = body.get("per_run_limit_jpy", 1500)
    monthly = body.get("monthly_limit_jpy", 5000)
    usd_jpy = float(body.get("usd_jpy", 155))

    run_dir = Path(tempfile.mkdtemp(prefix="tmark_run_"))
    cfg_dict = {
        "product": product,
        "own_account": {"handle": body.get("own_handle", ""),
                        "timeline_file": "data/own_timeline.jsonl"},
        "audience": {"sample_size": sample_size, "language": body.get("language", "ja")},
        "collection": {"posts_per_user": posts_per_user},
        "budget": {"currency": "JPY", "usd_jpy": usd_jpy, "enforce": True,
                   "per_run_limit_jpy": per_run, "monthly_limit_jpy": monthly,
                   "prices_usd": {"post_read": 0.005, "user_read": 0.010}},
        "llm": {"provider": llm_provider, "model": body.get("model", "grok-3-latest")},
        "nob_kit": {"path": "../x-audience-research-kit", "data_dir": "data/processed"},
        "data_dir": "data", "reports_dir": "reports",
    }
    cfg_path = run_dir / "config.json"
    write_json(cfg_path, cfg_dict)
    # 月次台帳は作業ディレクトリ横断で共有したいので固定パスを使う
    ledger_path = Path(__file__).resolve().parent / "data" / "spend_ledger.json"

    cfg = load_config(str(cfg_path))
    llm = LLMClient(LLMConfig.from_dict(cfg.llm))
    budget = Budget.from_config(cfg.raw)

    log(f"価値要素を抽出中… (LLM={llm.config.provider}/{'ok' if llm.available else 'heuristic'})")
    values = extract_values(cfg, llm)
    write_json(cfg.path("value_elements.json"), values)

    log("オーディエンス層を設計中…")
    audience = build_audience(cfg, values, llm)
    write_json(cfg.path("audience.json"), audience)

    # 予算
    ledger = load_ledger(ledger_path)
    if budget.monthly_limit_jpy and month_spent_jpy(ledger) >= budget.monthly_limit_jpy:
        raise ValueError(f"今月の上限 {_yen(budget.monthly_limit_jpy)} に到達済み")
    cap_jpy = remaining_run_cap_jpy(budget, ledger)
    est = estimate_run(budget, sample_size, posts_per_user, len(audience.get("segments", [])) or 4)
    log(f"見積り {_yen(est['jpy'])}/回。上限 {_yen(cap_jpy) if cap_jpy else '無し'} を超えたら自動停止。")

    x = XClient(bearer_token=x_bearer, verbose=False)
    log("X API で収集中…（オーディエンスのサンプリング＋各TL＋自分のTL）")
    stats = run_collection(cfg, audience, x, posts_per_user, True, log,
                           budget=budget, cap_jpy=cap_jpy)

    spent_jpy = budget.reads_cost_jpy(x.post_reads, x.user_reads)
    record_spend(ledger_path, x.post_reads, x.user_reads, spent_jpy,
                 note=f"web sample={sample_size} ppu={posts_per_user}")
    log(f"実費 {_yen(spent_jpy)}（投稿{x.post_reads}+ユーザー{x.user_reads}読み取り）")

    audience_posts = load_posts_jsonl(cfg.path("audience_posts.jsonl"))
    own_posts = dedupe(load_posts_jsonl(cfg.resolve(cfg.own_timeline_file)))
    sampled = read_json(cfg.path("sampled_users.json")) \
        if cfg.path("sampled_users.json").exists() else None

    log("ユーザー別TOP出しを計算中…")
    targets = build_targets(cfg, own_posts, audience_posts, values, llm,
                            top_k=8, sampled_users=sampled, generate=llm.available)

    return {
        "ok": True,
        "cost": {"jpy": round(spent_jpy, 1), "post_reads": x.post_reads,
                 "user_reads": x.user_reads,
                 "month_total_jpy": round(month_spent_jpy(load_ledger(ledger_path)), 1),
                 "monthly_limit_jpy": budget.monthly_limit_jpy},
        "stats": stats,
        "targets": targets.get("targets", []),
        "n_users": targets.get("n_users", 0),
        "method": targets.get("method"),
    }


# --------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # 静かに
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        data = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self._send(200, PAGE, "text/html; charset=utf-8")
        elif self.path == "/health":
            env = {"X_BEARER_TOKEN": bool(os.environ.get("X_BEARER_TOKEN")),
                   "XAI_API_KEY": bool(os.environ.get("XAI_API_KEY")),
                   "ANTHROPIC_API_KEY": bool(os.environ.get("ANTHROPIC_API_KEY"))}
            self._send(200, json.dumps({"ok": True, "env": env}))
        else:
            self._send(404, json.dumps({"error": "not found"}))

    def do_POST(self):
        if self.path != "/api/run":
            self._send(404, json.dumps({"error": "not found"}))
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except Exception as e:
            self._send(400, json.dumps({"error": f"bad request: {e}"}))
            return
        logs = []
        try:
            result = run_pipeline(body, lambda m: logs.append(str(m)))
            result["logs"] = logs
            self._send(200, json.dumps(result, ensure_ascii=False))
        except Exception as e:
            traceback.print_exc()
            self._send(200, json.dumps({"ok": False, "error": str(e), "logs": logs},
                                       ensure_ascii=False))


def main():
    # 起動時に env の有無を表示
    have_x = bool(os.environ.get("X_BEARER_TOKEN"))
    have_llm = bool(os.environ.get("XAI_API_KEY") or os.environ.get("ANTHROPIC_API_KEY"))
    print(f"tmark_web → http://{HOST}:{PORT}")
    print(f"  X_BEARER_TOKEN: {'set' if have_x else 'NOT set（フォームで入力可）'}")
    print(f"  LLM key: {'set' if have_llm else 'NOT set（精度のため推奨）'}")
    print("  Ctrl+C で終了")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


PAGE = r"""<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>ツイ廃マーケター（ローカル実行）</title>
<style>
:root{--bg:#F5F7F9;--surface:#fff;--surface-2:#EDF1F5;--ink:#151A21;--muted:#5F6A79;--line:#DEE4EC;
--accent:#0A9BA8;--accent-strong:#06727C;--accent-soft:rgba(10,155,168,.12);--network:#D9733F;--good:#2E9E67;--r:13px}
@media(prefers-color-scheme:dark){:root{--bg:#0C0F13;--surface:#151A21;--surface-2:#1D242D;--ink:#E7EDF4;--muted:#93A0B1;
--line:#28303B;--accent:#26BECB;--accent-strong:#63D6DF;--accent-soft:rgba(38,190,203,.16);--network:#EE9366;--good:#4EBE85}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,"Hiragino Sans","Noto Sans JP",sans-serif;line-height:1.6}
.wrap{max-width:1100px;margin:0 auto;padding:24px 18px 60px}
h1{font-size:26px;margin:0 0 4px}.lede{color:var(--muted);font-size:14px;margin:0 0 18px}
.mono{font-family:ui-monospace,Menlo,monospace}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:16px 18px;margin-bottom:16px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:640px){.grid2{grid-template-columns:1fr}}
label{display:block;font-size:12px;color:var(--muted);margin:10px 0 4px;font-weight:600}
input,textarea,select{width:100%;font:inherit;background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:9px;padding:9px 11px}
textarea{min-height:64px;resize:vertical}
.key{border-color:var(--network)}
.hint{font-size:11.5px;color:var(--muted);margin-top:3px}
.btn{font:inherit;font-weight:700;font-size:14px;padding:11px 22px;border:none;border-radius:10px;background:var(--accent);color:#fff;cursor:pointer;margin-top:14px}
.btn:disabled{opacity:.5;cursor:not-allowed}
.warn{background:var(--accent-soft);border:1px solid var(--accent);border-radius:10px;padding:10px 13px;font-size:12.5px;margin-bottom:14px}
.log{font-family:ui-monospace,monospace;font-size:12px;background:var(--surface-2);border-radius:9px;padding:10px 12px;white-space:pre-wrap;max-height:200px;overflow:auto;margin-top:12px}
.err{color:#c0392b}.cost{font-weight:700;color:var(--accent-strong)}
.tgt{border:1px solid var(--line);border-radius:11px;padding:13px 15px;margin-top:12px}
.tgt.top{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.h{font-family:ui-monospace,monospace;font-weight:700;font-size:16px}
.reach{float:right;font-family:ui-monospace,monospace;color:var(--accent-strong)}
.chip{display:inline-block;font-size:12px;padding:3px 9px;border-radius:7px;background:var(--surface-2);margin:3px 4px 0 0}
.chip.net{background:rgba(217,115,63,.14);color:var(--network);font-family:ui-monospace,monospace}
.best{background:var(--accent-soft);border-radius:8px;padding:8px 10px;margin-top:8px;font-size:14px}
.small{font-size:12px;color:var(--muted)}
</style></head><body><div class="wrap">
<h1>🎯 ツイ廃マーケター <span class="small">ローカル実行</span></h1>
<p class="lede">このページはあなたのPC上のサーバが動かしています。APIキーはこのPC内だけに保持され、外部やブラウザには出ません。</p>

<div class="panel">
  <div class="warn">💡 キーは環境変数(<span class="mono">X_BEARER_TOKEN</span> / <span class="mono">XAI_API_KEY</span>)に入れておけば下の入力は空でOK。入れた場合もこのPCのサーバ内だけで使われます。</div>
  <div class="grid2">
    <div><label>プロダクト名</label><input id="pname" value="CallMe"></div>
    <div><label>自分のツイ廃アカウント handle</label><input id="handle" placeholder="@your_handle"></div>
  </div>
  <label>プロダクト説明（価値抽出の入力）</label>
  <textarea id="pdesc">予定の少し前に『電話がかかってくる』アラームアプリ。通知を見流してしまう人向けに、無視しづらく時間を知らせる。</textarea>
  <div class="grid2">
    <div><label>サンプル人数</label><input id="sample" type="number" value="20" min="5" max="200"></div>
    <div><label>1人あたり取得ツイート数</label><input id="ppu" type="number" value="10" min="3" max="50"></div>
  </div>
  <div class="grid2">
    <div><label>1回の上限（円）</label><input id="perrun" type="number" value="1500"></div>
    <div><label>月の上限（円）</label><input id="monthly" type="number" value="5000"></div>
  </div>
  <details style="margin-top:12px"><summary class="small" style="cursor:pointer">APIキーをこの画面で入れる（環境変数がある場合は不要）</summary>
    <label>X_BEARER_TOKEN</label><input id="xbearer" class="key mono" type="password" autocomplete="off" placeholder="環境変数にあれば空でOK">
    <label>XAI_API_KEY（Grok・精度用/任意）</label><input id="xai" class="key mono" type="password" autocomplete="off" placeholder="任意">
    <div class="hint">パスワード欄として扱われ、送信先はこのPCのローカルサーバのみです。</div>
  </details>
  <button class="btn" id="run">実行する（X APIで収集→TOP出し）</button>
  <div class="hint">初回テストは20人＝約¥900。予算上限を超える前に自動停止します。</div>
  <div class="log" id="log" style="display:none"></div>
</div>

<div id="results"></div>

<script>
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
$("run").addEventListener("click", async ()=>{
  const btn=$("run"); btn.disabled=true;
  const log=$("log"); log.style.display=""; log.textContent="実行中…（収集に1〜数分かかることがあります）";
  $("results").innerHTML="";
  const body={
    product:{name:$("pname").value, description:$("pdesc").value},
    own_handle:$("handle").value,
    sample_size:+$("sample").value, posts_per_user:+$("ppu").value,
    per_run_limit_jpy:+$("perrun").value, monthly_limit_jpy:+$("monthly").value,
    x_bearer:$("xbearer").value, xai_key:$("xai").value,
  };
  try{
    const r=await fetch("/api/run",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    const d=await r.json();
    log.textContent=(d.logs||[]).join("\n");
    if(!d.ok){ log.innerHTML+="\n<span class='err'>エラー: "+esc(d.error)+"</span>"; btn.disabled=false; return; }
    render(d);
  }catch(e){ log.innerHTML="<span class='err'>通信エラー: "+esc(e.message)+"</span>"; }
  btn.disabled=false;
});
function render(d){
  const c=d.cost||{};
  let html=`<div class="panel"><div class="cost">実費 ¥${(c.jpy||0).toLocaleString()} `+
    `<span class="small">（投稿${c.post_reads}+ユーザー${c.user_reads}読み取り`+
    (c.monthly_limit_jpy?` / 今月累計 ¥${(c.month_total_jpy||0).toLocaleString()} / 上限 ¥${c.monthly_limit_jpy.toLocaleString()}`:"")+`）</span></div>`+
    `<div class="small">対象 ${d.n_users} ユーザー / TOP出し ${d.targets.length} 件（method=${esc(d.method)}）</div></div>`;
  d.targets.slice(0,30).forEach((t,i)=>{
    const best=(t.best_tweet||{});
    const net=(t.network||[]).map(n=>`<span class="chip net">@${esc(n.handle)}</span>`).join("");
    const tops=(t.timeline_topics||[]).slice(0,8).map(x=>`<span class="chip">${esc(x)}</span>`).join("");
    html+=`<div class="tgt${i===0?' top':''}"><span class="reach">reach ${(t.reach_score||0).toFixed(3)}</span>`+
      `<span class="h">@${esc(t.user)}</span> <span class="small">${esc(t.segment_name||t.segment||'')}</span>`+
      `<div style="margin-top:6px">${tops}</div><div style="margin-top:4px">${net||'<span class="small">絡み先なし</span>'}</div>`+
      (best.text?`<div class="best">★TOP出し (sim ${(best.similarity||0).toFixed(3)}): ${esc(best.text)}</div>`:"")+
      (t.generated_tweet?`<div class="small" style="margin-top:6px">✍️ 生成案: ${esc(t.generated_tweet)}</div>`:"")+
      (t.network_action?`<div class="small">🕸 行動: ${esc(t.network_action)}</div>`:"")+
      `</div>`;
  });
  $("results").innerHTML=html;
}
</script></div></body></html>"""


if __name__ == "__main__":
    main()
