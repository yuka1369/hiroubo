#!/usr/bin/env python3
"""tmark — ツイ廃マーケター CLI。

依存パッケージ 0（Python 3.10+ 標準ライブラリのみ）。
ツイート収集は nob さんの x-audience-research-kit に委譲し、本ツールは
価値抽出→オーディエンス設計→タイムライン予測→自アカウント類似マッチ→
表示率アップのアクション予測 を担う。

使い方:
  python3 tmark.py doctor    --config config.json
  python3 tmark.py values    --config config.json
  python3 tmark.py audience  --config config.json     # research.generated.json も出力
  python3 tmark.py collect   --config config.json     # X API で自動収集（要 X_BEARER_TOKEN）
  python3 tmark.py ingest    --config config.json     # nob キット出力を取り込み（自動収集の代替）
  python3 tmark.py timeline  --config config.json
  python3 tmark.py match     --config config.json
  python3 tmark.py actions   --config config.json
  python3 tmark.py report    --config config.json
  python3 tmark.py run       --config config.json      # 全ステップ通し
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

# src/ をパスに追加（インストール不要で動かせるように）
sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from tsuihai_marketer import __version__  # noqa: E402
from tsuihai_marketer.actions import predict_actions  # noqa: E402
from tsuihai_marketer.audience import (  # noqa: E402
    build_audience, generate_nob_research_config,
)
from tsuihai_marketer.collect import run_collection  # noqa: E402
from tsuihai_marketer.config import (  # noqa: E402
    Config, load_config, read_json, write_json,
)
from tsuihai_marketer.ingest import (  # noqa: E402
    dedupe, load_nob_kit_output, load_posts_jsonl,
)
from tsuihai_marketer.llm import LLMClient, LLMConfig  # noqa: E402
from tsuihai_marketer.report import build_report  # noqa: E402
from tsuihai_marketer.similarity import match_own_posts  # noqa: E402
from tsuihai_marketer.targeting import build_targets  # noqa: E402
from tsuihai_marketer.timeline_predict import predict_timelines  # noqa: E402
from tsuihai_marketer.value_extraction import extract_values  # noqa: E402
from tsuihai_marketer.xclient import XClient  # noqa: E402

VALUES_F = "value_elements.json"
AUDIENCE_F = "audience.json"
RESEARCH_F = "research.generated.json"
POSTS_F = "audience_posts.jsonl"
TIMELINE_F = "timeline_prediction.json"
MATCHES_F = "matches.json"
TARGETS_F = "targets.json"
ACTIONS_F = "actions.json"
REPORT_F = "analysis.md"


def _client(cfg: Config) -> LLMClient:
    return LLMClient(LLMConfig.from_dict(cfg.llm))


def _log(msg: str) -> None:
    print(msg, file=sys.stderr)


# ---- commands ----------------------------------------------------------
def cmd_doctor(cfg: Config, args) -> int:
    llm = _client(cfg)
    print(f"tsuihai-marketer v{__version__}")
    print(f"  Python: {sys.version.split()[0]}")
    print(f"  product: {cfg.product.name}")
    print(f"  sample_size: {cfg.sample_size}  language: {cfg.language}")
    print(f"  LLM provider: {llm.config.provider}  model: {llm.config.model}  "
          f"available: {'YES' if llm.available else 'NO (heuristic fallback)'}")
    if llm.config.provider == "grok" and not llm.available:
        print("    → 環境変数 XAI_API_KEY を設定してください")
    if llm.config.provider == "anthropic" and not llm.available:
        print("    → 環境変数 ANTHROPIC_API_KEY を設定してください")

    nob_path = cfg.resolve(cfg.nob_kit_path)
    nob_data = cfg.resolve(cfg.nob_kit_path) / cfg.nob_data_dir
    print(f"  nob kit path: {nob_path}  exists: {nob_path.exists()}")
    print(f"  nob data dir: {nob_data}  exists: {nob_data.exists()}")
    if not nob_path.exists():
        print("    → git clone https://github.com/nobphotographr/x-audience-research-kit "
              "して config の nob_kit.path を合わせてください")

    own = cfg.resolve(cfg.own_timeline_file)
    print(f"  own timeline: {own}  exists: {own.exists()}")
    has_token = bool(os.environ.get("X_BEARER_TOKEN"))
    print(f"  X_BEARER_TOKEN: {'set' if has_token else 'NOT set'}")
    if has_token:
        print("    → 収集モード: X API 自動収集 (`collect` / `run`)")
    else:
        print("    → 収集モード: nob キット取り込み (`ingest`)。自動収集するなら X API を課金し "
              "X_BEARER_TOKEN を設定してください")
    return 0


def cmd_values(cfg: Config, args) -> int:
    llm = _client(cfg)
    _log("価値要素を抽出中...")
    result = extract_values(cfg, llm)
    out = cfg.path(VALUES_F)
    write_json(out, result)
    _log(f"→ {out} ({len(result.get('value_elements', []))} 要素, method={result.get('method')})")
    return 0


def cmd_audience(cfg: Config, args) -> int:
    llm = _client(cfg)
    values = read_json(cfg.path(VALUES_F)) if cfg.path(VALUES_F).exists() \
        else extract_values(cfg, llm)
    _log("オーディエンス層を設計中...")
    audience = build_audience(cfg, values, llm)
    write_json(cfg.path(AUDIENCE_F), audience)
    research = generate_nob_research_config(cfg, values, audience)
    write_json(cfg.path(RESEARCH_F), research)
    _log(f"→ {cfg.path(AUDIENCE_F)} ({len(audience.get('segments', []))} 層)")
    _log(f"→ {cfg.path(RESEARCH_F)} (nob キット用設定。x-audience-research-kit にコピーして実行)")
    return 0


def cmd_collect(cfg: Config, args) -> int:
    """X API から直接ツイートを自動収集（オーディエンス＋自TL）。"""
    x = XClient(verbose=True)
    if not x.available:
        _log("エラー: X_BEARER_TOKEN が未設定です。X API を課金して環境変数に設定してください。")
        _log("      （nob キット経由で収集する場合は `ingest` を使ってください）")
        return 1
    audience_path = cfg.path(AUDIENCE_F)
    if not audience_path.exists():
        _log("audience.json が無いので先に `audience` を実行します…")
        rc = cmd_audience(cfg, args)
        if rc:
            return rc
    audience = read_json(audience_path)
    posts_per_user = int(cfg.raw.get("nob_kit", {}).get("posts_per_user")
                         or cfg.raw.get("collection", {}).get("posts_per_user", 20))
    collect_own = not args.no_own
    stats = run_collection(cfg, audience, x, posts_per_user, collect_own, _log)
    _log(f"=== 収集完了: audience {stats['audience_posts']}ツイート / "
         f"{stats['sampled_users']}ユーザー / 自TL {stats['own_posts']}ツイート ===")
    return 0


def cmd_ingest(cfg: Config, args) -> int:
    nob_data = cfg.resolve(cfg.nob_kit_path) / cfg.nob_data_dir
    _log(f"nob キット出力を読み込み中: {nob_data}")
    posts = dedupe(load_nob_kit_output(nob_data))
    if not posts:
        _log("警告: nob キットの posts が見つかりません。先に x-audience-research-kit を実行してください。")
        _log("      （デモとして examples/sample_audience_posts.jsonl があれば使えます）")
        sample = cfg.root / "examples" / "sample_audience_posts.jsonl"
        if sample.exists() and args.allow_sample:
            posts = dedupe(load_posts_jsonl(sample))
            _log(f"      サンプルデータを使用: {len(posts)} 投稿")
    out = cfg.path(POSTS_F)
    with out.open("w", encoding="utf-8") as f:
        import json
        for p in posts:
            f.write(json.dumps(p.to_dict(), ensure_ascii=False) + "\n")
    _log(f"→ {out} ({len(posts)} 投稿)")
    return 0


def cmd_timeline(cfg: Config, args) -> int:
    llm = _client(cfg)
    posts = load_posts_jsonl(cfg.path(POSTS_F))
    if not posts:
        _log("エラー: audience_posts.jsonl が空です。先に `ingest` を実行してください。")
        return 1
    audience = read_json(cfg.path(AUDIENCE_F))
    _log(f"タイムライン予測中... ({len(posts)} 投稿 / {len(audience.get('segments', []))} 層)")
    result = predict_timelines(cfg, posts, audience, llm)
    write_json(cfg.path(TIMELINE_F), result)
    _log(f"→ {cfg.path(TIMELINE_F)}")
    return 0


def cmd_match(cfg: Config, args) -> int:
    own = cfg.resolve(cfg.own_timeline_file)
    own_posts = dedupe(load_posts_jsonl(own))
    timeline = read_json(cfg.path(TIMELINE_F))
    _log(f"自アカウント類似マッチ中... (自ツイート {len(own_posts)} 件)")
    result = match_own_posts(cfg, own_posts, timeline, top_k=args.top_k)
    write_json(cfg.path(MATCHES_F), result)
    _log(f"→ {cfg.path(MATCHES_F)} (カバー率 {result.get('coverage', {}).get('match_rate')})")
    return 0


def cmd_target(cfg: Config, args) -> int:
    """ユーザー1人単位で、自分のツイ廃履歴から刺さるツイートをTOP出し。"""
    llm = _client(cfg)
    own = cfg.resolve(cfg.own_timeline_file)
    own_posts = dedupe(load_posts_jsonl(own))
    audience_posts = load_posts_jsonl(cfg.path(POSTS_F))
    values = read_json(cfg.path(VALUES_F)) if cfg.path(VALUES_F).exists() else {}
    sampled = read_json(cfg.path("sampled_users.json")) \
        if cfg.path("sampled_users.json").exists() else None
    _log(f"ユーザー別TOP出しを計算中... (自ツイート {len(own_posts)} 件 / "
         f"オーディエンス {len(audience_posts)} 投稿)")
    result = build_targets(cfg, own_posts, audience_posts, values, llm,
                           top_k=args.top_k, sampled_users=sampled,
                           generate=not args.no_generate)
    write_json(cfg.path(TARGETS_F), result)
    _log(f"→ {cfg.path(TARGETS_F)} ({len(result.get('targets', []))} ユーザー / method={result.get('method')})")
    # 上位数件をコンソールにも
    for t in result.get("targets", [])[:3]:
        bt = (t.get("best_tweet") or {})
        _log(f"  @{t['user']} (reach {t['reach_score']}): {bt.get('text','')[:50]}")
    return 0


def cmd_actions(cfg: Config, args) -> int:
    llm = _client(cfg)
    own = cfg.resolve(cfg.own_timeline_file)
    own_posts = dedupe(load_posts_jsonl(own))
    matches = read_json(cfg.path(MATCHES_F))
    timeline = read_json(cfg.path(TIMELINE_F))
    values = read_json(cfg.path(VALUES_F))
    _log("表示率アップのアクションを予測中...")
    result = predict_actions(cfg, own_posts, matches, timeline, values, llm)
    write_json(cfg.path(ACTIONS_F), result)
    _log(f"→ {cfg.path(ACTIONS_F)} ({len(result.get('global_actions', []))} 全体アクション)")
    return 0


def cmd_report(cfg: Config, args) -> int:
    values = read_json(cfg.path(VALUES_F))
    audience = read_json(cfg.path(AUDIENCE_F))
    timeline = read_json(cfg.path(TIMELINE_F))
    matches = read_json(cfg.path(MATCHES_F))
    actions = read_json(cfg.path(ACTIONS_F))
    targets = read_json(cfg.path(TARGETS_F)) if cfg.path(TARGETS_F).exists() else None
    md = build_report(cfg.product.name, values, audience, timeline, matches, actions,
                      targets=targets)
    out = cfg.report_path(REPORT_F)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(md, encoding="utf-8")
    _log(f"→ {out}")
    print(md)
    return 0


def cmd_run(cfg: Config, args) -> int:
    _log("=== フルパイプライン実行 ===")
    for fn in (cmd_values, cmd_audience):
        rc = fn(cfg, args)
        if rc:
            return rc

    # 収集フェーズ: X_BEARER_TOKEN があれば自動収集、無ければ nob キット取り込み
    x_available = XClient(verbose=False).available
    if x_available and not args.no_collect:
        rc = cmd_collect(cfg, args)
        if rc:
            return rc
    else:
        cmd_ingest(cfg, args)

    if not load_posts_jsonl(cfg.path(POSTS_F)):
        _log("\nツイート収集データがまだありません。いずれかを実施してください:")
        _log("  A) 自動収集: X API を課金し X_BEARER_TOKEN を設定 → `python3 tmark.py run`")
        _log("  B) nob キット経由:")
        _log(f"     1) git clone https://github.com/nobphotographr/x-audience-research-kit")
        _log(f"     2) 生成した {cfg.path(RESEARCH_F).name} を kit にコピー")
        _log("     3) kit で grok-search → hydrate → timelines → prepare-analysis")
        _log("     4) config の nob_kit.path/data_dir を合わせて `python3 tmark.py run`")
        _log("\n（動作確認だけしたい場合は --allow-sample を付けて実行してください）")
        return 0
    for fn in (cmd_timeline, cmd_match, cmd_target, cmd_actions, cmd_report):
        rc = fn(cfg, args)
        if rc:
            return rc
    _log("=== 完了 ===")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="tmark", description="ツイ廃マーケター分析エンジン")
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    cmds = {
        "doctor": cmd_doctor, "values": cmd_values, "audience": cmd_audience,
        "collect": cmd_collect, "ingest": cmd_ingest, "timeline": cmd_timeline,
        "match": cmd_match, "target": cmd_target, "actions": cmd_actions,
        "report": cmd_report, "run": cmd_run,
    }
    for name in cmds:
        p = sub.add_parser(name)
        p.add_argument("--config", "-c", default="config.json", help="設定ファイル")
        p.add_argument("--top-k", type=int, default=10, help="match: 層ごとの上位件数")
        p.add_argument("--no-own", action="store_true",
                       help="collect: 自アカウントのタイムライン収集をスキップ")
        p.add_argument("--no-collect", action="store_true",
                       help="run: X API 自動収集を使わず nob キット取り込みにする")
        p.add_argument("--no-generate", action="store_true",
                       help="target: LLMによるツイート生成/アクション生成をスキップ")
        p.add_argument("--allow-sample", action="store_true",
                       help="ingest: nob データが無い時 examples のサンプルを使う")

    args = parser.parse_args(argv)
    try:
        cfg = load_config(args.config)
    except (FileNotFoundError, ValueError) as e:
        print(f"設定エラー: {e}", file=sys.stderr)
        return 2
    return cmds[args.command](cfg, args)


if __name__ == "__main__":
    raise SystemExit(main())
