"""ステップ4: ユーザーのタイムラインに流れる既存ツイートを予測する。

収集したオーディエンスのツイート群から、各セグメントについて
「TL を支配している話題・語彙・発話パターン・盛り上がる型」を統計的に推定する。
X のホームタイムラインは (a) フォロー内の高エンゲージ投稿 と
(b) おすすめ(For You)の out-of-network を混ぜて出す。ここでは収集データから
その両方の"型"を近似する。

出力 timeline_prediction.json:
{
  "segments": [
    {"segment_id","name","n_posts","top_topics":[{term,score}],
     "top_hashtags":[...], "engagement_baseline":{...},
     "content_archetypes":[{"archetype","example","avg_engagement","share"}],
     "predicted_timeline":[{"kind","theme","why_surfaces","example_style"}]}
  ]
}
"""

from __future__ import annotations

import statistics
from collections import Counter, defaultdict
from typing import Any, Dict, List, Optional

from .config import Config
from .ingest import Post
from .llm import LLMClient, LLMError
from .textutil import TfidfIndex, corpus_top_terms, hashtags, keywords


def _assign_segment(post: Post, audience: Dict[str, Any],
                    seg_index: Dict[str, TfidfIndex]) -> Optional[str]:
    """投稿を最も語彙が近いセグメントに割り当てる（signal_phrases ベース）。"""
    best_id, best_score = None, 0.0
    ptoks = TfidfIndex([post.text]).doc_vectors[0]
    for seg in audience.get("segments", []):
        idx = seg_index.get(seg["id"])
        if idx is None:
            continue
        score = TfidfIndex.cosine(ptoks, idx.doc_vectors[0])
        if score > best_score:
            best_id, best_score = seg["id"], score
    return best_id


def _content_archetypes(posts: List[Post]) -> List[Dict[str, Any]]:
    """投稿を型（質問/共感/情報/実況/宣伝など）に分類し集計。"""
    buckets: Dict[str, List[Post]] = defaultdict(list)
    for p in posts:
        t = p.text
        if p.is_reply:
            key = "会話・リプライ"
        elif "?" in t or "？" in t or "どう" in t or "教え" in t:
            key = "質問・投げかけ"
        elif p.has_media:
            key = "画像・動画つき"
        elif p.has_link:
            key = "リンク共有・告知"
        elif any(w in t for w in ("わかる", "しんどい", "つらい", "最高", "好き", "泣")):
            key = "共感・感情の吐露"
        elif len(t) > 120:
            key = "長文・思考の言語化"
        else:
            key = "短文つぶやき"
        buckets[key].append(p)

    total = len(posts) or 1
    archetypes = []
    for key, ps in sorted(buckets.items(), key=lambda kv: len(kv[1]), reverse=True):
        eng = [p.engagements for p in ps]
        example = max(ps, key=lambda p: p.engagements)
        archetypes.append({
            "archetype": key,
            "count": len(ps),
            "share": round(len(ps) / total, 3),
            "avg_engagement": round(statistics.mean(eng), 1) if eng else 0,
            "example": example.text[:120],
        })
    return archetypes


def _engagement_baseline(posts: List[Post]) -> Dict[str, Any]:
    likes = [p.likes for p in posts]
    rts = [p.retweets for p in posts]
    reps = [p.replies for p in posts]
    eng = [p.engagements for p in posts]

    def stat(xs: List[int]) -> Dict[str, float]:
        if not xs:
            return {"median": 0, "mean": 0, "p90": 0}
        xs_sorted = sorted(xs)
        p90 = xs_sorted[min(len(xs_sorted) - 1, int(len(xs_sorted) * 0.9))]
        return {
            "median": round(statistics.median(xs), 1),
            "mean": round(statistics.mean(xs), 1),
            "p90": p90,
        }

    with_media = [p.engagements for p in posts if p.has_media]
    no_media = [p.engagements for p in posts if not p.has_media]
    return {
        "likes": stat(likes),
        "retweets": stat(rts),
        "replies": stat(reps),
        "engagement": stat(eng),
        "media_lift": round(
            (statistics.mean(with_media) / statistics.mean(no_media))
            if with_media and no_media and statistics.mean(no_media) else 1.0, 2
        ),
    }


def predict_timelines(cfg: Config, posts: List[Post], audience: Dict[str, Any],
                      llm: LLMClient) -> Dict[str, Any]:
    segments = audience.get("segments", [])
    # セグメントの signal 文書をベクトル化
    seg_index: Dict[str, TfidfIndex] = {}
    for seg in segments:
        signal = " ".join(seg.get("signal_phrases", []) + [seg.get("name", ""),
                                                           seg.get("who", "")])
        seg_index[seg["id"]] = TfidfIndex([signal or seg.get("name", "x")])

    # 投稿をセグメントへ割り当て
    by_seg: Dict[str, List[Post]] = defaultdict(list)
    for p in posts:
        sid = _assign_segment(p, audience, seg_index) or (segments[0]["id"] if segments else "s1")
        by_seg[sid].append(p)

    seg_results: List[Dict[str, Any]] = []
    for seg in segments:
        ps = by_seg.get(seg["id"], [])
        if not ps:
            seg_results.append({
                "segment_id": seg["id"], "name": seg.get("name"),
                "n_posts": 0, "note": "割り当て投稿なし（収集データ不足）",
            })
            continue
        topics = [{"term": t, "score": c} for t, c in corpus_top_terms((p.text for p in ps), 20)]
        tags = Counter()
        for p in ps:
            tags.update(hashtags(p.text))
        archetypes = _content_archetypes(ps)
        baseline = _engagement_baseline(ps)

        predicted = _predict_surface(seg, topics, archetypes, cfg, llm)

        seg_results.append({
            "segment_id": seg["id"],
            "name": seg.get("name"),
            "n_posts": len(ps),
            "top_topics": topics,
            "top_hashtags": [{"tag": t, "count": c} for t, c in tags.most_common(10)],
            "engagement_baseline": baseline,
            "content_archetypes": archetypes,
            "predicted_timeline": predicted,
        })

    return {"product": cfg.product.name, "segments": seg_results}


def _predict_surface(seg: Dict[str, Any], topics: List[Dict[str, Any]],
                     archetypes: List[Dict[str, Any]], cfg: Config,
                     llm: LLMClient) -> List[Dict[str, Any]]:
    """TL に流れてくる既存ツイートの型を予測。LLM 併用可。"""
    heuristic = []
    for a in archetypes[:4]:
        heuristic.append({
            "kind": "in-network" if a["share"] > 0.15 else "for-you",
            "theme": a["archetype"],
            "why_surfaces": f"この層の投稿の {int(a['share']*100)}% を占め、平均 {a['avg_engagement']} エンゲージ",
            "example_style": a["example"],
        })
    if not llm.available:
        return heuristic
    try:
        topic_terms = ", ".join(t["term"] for t in topics[:12])
        system = ("あなたは X のタイムライン(For You / フォロー中)に何が流れるかを予測する"
                  "アナリストです。実際に流れてくる投稿の型を具体的に描写します。")
        user = f"""ユーザー層: {seg.get('name')} — {seg.get('who')}
この層が実際に発している話題(語彙): {topic_terms}
発話の型と割合: {[{a['archetype']: a['share']} for a in archetypes]}

この層のホームタイムラインに実際に流れてくるであろう既存ツイートを 5〜7 個予測し、
次の JSON 配列で出力:
[{{"kind":"in-network|for-you","theme":"話題","why_surfaces":"なぜ表示されるか","example_style":"流れてくる投稿の例文(実際の口調で)"}}]"""
        data = llm.chat_json(system, user)
        if isinstance(data, list) and data:
            return data
    except LLMError:
        pass
    return heuristic
