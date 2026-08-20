"""ステップ6: ターゲット層への「表示率」を上げるアクションを予測する。

X が 2023 に公開したランキングアルゴリズム(the-algorithm)の既知シグナルを
ヒューリスティックとして用い、(a) 自ツイートの現状診断 と
(b) 各層に露出を増やす具体アクション を出力する。

主な重み付けシグナル（公開情報ベースの概算）:
  - リプライに本人が返信       : 約 +75x（会話の誘発が最強）
  - リツイート                 : 約 +20x
  - いいね                     : 約 +30 相当 / 予測確率
  - リンククリック+2秒滞在      : 加点
  - プロフィールクリック→反応   : 加点
  - 画像/動画（メディア）        : 加点（媒体リフト）
  - 外部リンク単体             : 減点（滞在を奪う）
  - ネガティブ(ミュート/ブロック/興味なし): 大幅減点(-74x等)
  - 発信からの経過時間          : 半減期あり（新しさ重視）
  - 会話が同言語・in-network    : 加点
"""

from __future__ import annotations

import statistics
from typing import Any, Dict, List

from .config import Config
from .ingest import Post
from .llm import LLMClient, LLMError


def diagnose_own_account(own_posts: List[Post]) -> Dict[str, Any]:
    if not own_posts:
        return {"note": "自アカウントのデータなし"}
    n = len(own_posts)
    media = sum(1 for p in own_posts if p.has_media)
    link = sum(1 for p in own_posts if p.has_link)
    reply = sum(1 for p in own_posts if p.is_reply)
    replies_recv = [p.replies for p in own_posts]
    eng = [p.engagements for p in own_posts]

    # 会話喚起力：リプライを受けた割合（本人返信が最強シグナルの入口）
    got_reply = sum(1 for p in own_posts if p.replies > 0)

    return {
        "n_posts": n,
        "media_ratio": round(media / n, 3),
        "link_ratio": round(link / n, 3),
        "reply_ratio": round(reply / n, 3),
        "conversation_starter_ratio": round(got_reply / n, 3),
        "avg_replies_received": round(statistics.mean(replies_recv), 2) if replies_recv else 0,
        "avg_engagement": round(statistics.mean(eng), 1) if eng else 0,
        "median_engagement": round(statistics.median(eng), 1) if eng else 0,
    }


# アルゴリズムシグナル → 診断ルール
def _rule_based_actions(diag: Dict[str, Any], cfg: Config) -> List[Dict[str, Any]]:
    actions: List[Dict[str, Any]] = []

    def add(title, why, how, impact, signal):
        actions.append({
            "action": title, "why": why, "how": how,
            "expected_impact": impact, "algo_signal": signal,
        })

    media_ratio = diag.get("media_ratio", 0)
    link_ratio = diag.get("link_ratio", 0)
    conv = diag.get("conversation_starter_ratio", 0)
    reply_ratio = diag.get("reply_ratio", 0)

    if media_ratio < 0.3:
        add("メディア添付を増やす",
            f"画像/動画つき投稿は現在 {int(media_ratio*100)}% のみ。メディアは表示ランキングで加点され、停止率(滞在)も伸びる。",
            "価値要素を1枚の図/ビフォーアフター/短尺動画にして週の投稿の半分以上に添付。",
            "中〜高", "media engagement lift")

    if link_ratio > 0.25:
        add("外部リンクは単体投稿を避ける",
            f"リンク含有 {int(link_ratio*100)}%。本文にURL単体があると滞在を奪い減点対象になりやすい。",
            "リンクは本文で完結させた後、最初のリプライ(ぶら下げ)に置く『リンクはリプ欄』運用へ。",
            "中", "external link penalty")

    if conv < 0.3:
        add("会話が生まれる投げかけを増やす",
            "リプライへの本人返信は最重要シグナル(約+75x)。まずリプライを誘発する必要がある。",
            "『あなたはどっち派?』『これ困ってる人いる?』等、答えたくなる問いを価値テーマで週数回。返信には必ず本人が返す。",
            "高", "reply -> author reply (~75x)")
    else:
        add("受けたリプに本人が全返信する",
            "本人返信の連鎖が会話クラスタを作り、フォロワー外への露出(For You)も広がる。",
            "リプは24h以内に本人アカウントで全返信。定型でなく一言添える。",
            "高", "reply -> author reply (~75x)")

    if reply_ratio < 0.2:
        add("ターゲット層への能動リプライで接点を作る",
            "in-network の関係性が強いほど相手のTLに載りやすい。まず相手の投稿に価値ある返信を。",
            "各セグメントの代表アカウントの投稿へ、宣伝でなく共感/補足のリプライを1日数件。",
            "中〜高", "in-network engagement / graph")

    add("投稿時間を層の活動ピークに合わせる",
        "新しさ(recency)が強い減衰要因。層が起きて見ている時間に出すと初速が付き二次拡散に乗る。",
        "収集データの投稿時刻分布から各層のピーク帯を割り出し予約投稿。",
        "中", "recency half-life")

    add("ネガティブシグナルを避ける",
        "ミュート/ブロック/『興味なし』は最大級の減点(-74x等)。押し売り・連投は逆効果。",
        "宣伝は価値提供10:宣伝1程度に薄める。同一文面の連投・過度なタグ乱用をしない。",
        "高(守り)", "negative feedback (mute/block)")

    return actions


def predict_actions(cfg: Config, own_posts: List[Post], matches: Dict[str, Any],
                    timeline_pred: Dict[str, Any], values: Dict[str, Any],
                    llm: LLMClient) -> Dict[str, Any]:
    diag = diagnose_own_account(own_posts)
    global_actions = _rule_based_actions(diag, cfg)

    # 層ごとの具体アクション（刺さっている自ツイートを起点に）
    per_segment: List[Dict[str, Any]] = []
    match_by_seg = {s.get("segment_id"): s for s in matches.get("segments", [])}
    for seg in timeline_pred.get("segments", []):
        sid = seg.get("segment_id")
        m = match_by_seg.get(sid, {})
        best = (m.get("matches") or [])[:3]
        per_segment.append({
            "segment_id": sid,
            "name": seg.get("name"),
            "peak_archetype": (seg.get("content_archetypes") or [{}])[0].get("archetype"),
            "hook_topics": [t["term"] for t in seg.get("top_topics", [])[:6]],
            "your_best_fit_posts": [{"text": b["text"], "similarity": b["similarity"]} for b in best],
            "recommended_angle": _angle(seg, values),
        })

    llm_actions = _llm_actions(cfg, diag, values, timeline_pred, matches, llm)

    return {
        "product": cfg.product.name,
        "own_diagnosis": diag,
        "global_actions": global_actions,
        "per_segment_actions": per_segment,
        "llm_strategy": llm_actions,
    }


def _angle(seg: Dict[str, Any], values: Dict[str, Any]) -> str:
    top = seg.get("content_archetypes") or []
    arche = top[0].get("archetype") if top else "共感"
    return f"この層は『{arche}』が伸びる。価値を{arche}の型に載せて語ると溶け込みやすい。"


def _llm_actions(cfg: Config, diag: Dict[str, Any], values: Dict[str, Any],
                 timeline_pred: Dict[str, Any], matches: Dict[str, Any],
                 llm: LLMClient) -> Any:
    if not llm.available:
        return {"note": "LLM 未設定のためヒューリスティックのみ"}
    try:
        segs = [{"name": s.get("name"),
                 "topics": [t["term"] for t in s.get("top_topics", [])[:8]],
                 "archetypes": [a["archetype"] for a in s.get("content_archetypes", [])[:3]]}
                for s in timeline_pred.get("segments", [])]
        system = ("あなたは X グロースの戦略家です。X のランキングアルゴリズム(会話喚起・"
                  "メディア・新しさ・in-network・ネガティブ回避)を踏まえ、ターゲット層への"
                  "表示率を上げる実行可能なアクションを設計します。")
        user = f"""プロダクト: {cfg.product.name} — {cfg.product.description}
価値要素: {[e.get('value') for e in values.get('value_elements', [])]}
自アカウント診断: {diag}
ターゲット層とTL: {segs}

次を JSON で:
{{
 "content_calendar": [{{"day":"月","segment":"層名","tweet_idea":"実際に投稿する下書き文","format":"画像/問いかけ/スレッド等"}}],
 "engagement_plays": ["露出を増やす具体行動1","行動2"],
 "kpi_to_watch": ["観測すべき指標"],
 "risks": ["やってはいけないこと"]
}}"""
        return llm.chat_json(system, user)
    except LLMError as e:
        return {"error": str(e)}
