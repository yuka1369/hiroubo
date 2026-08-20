"""ステップ5: 自分のツイ廃アカウントの中から、各層のTLに"似た"ツイートを割り出す。

自分の過去ツイート（own_timeline）を TF-IDF ベクトル化し、
各セグメントの予測タイムライン（話題語彙＋実際の投稿群）に対する
コサイン類似度で並べ替える。似ているツイートほど、その層のTLに
自然に溶け込み表示されやすい＝刺さる可能性が高い、という仮説。

出力 matches.json:
{
  "segments": [
    {"segment_id","name","matches":[
       {"post_id","text","similarity","own_engagement","topics_hit":[...]}
    ]}
  ],
  "unused_own_posts": <int>,   // どの層にも刺さらなかった自ツイート数
  "coverage": {...}
}
"""

from __future__ import annotations

from typing import Any, Dict, List

from .config import Config
from .ingest import Post
from .textutil import TfidfIndex, tokenize


def _segment_profile_text(seg_pred: Dict[str, Any]) -> str:
    """予測タイムライン結果から、その層の"TL 語彙"を代表するテキストを作る。"""
    parts: List[str] = []
    for t in seg_pred.get("top_topics", []):
        parts.extend([t["term"]] * min(3, int(t.get("score", 1))))  # 頻度で重み
    for pt in seg_pred.get("predicted_timeline", []):
        parts.append(pt.get("example_style", ""))
        parts.append(pt.get("theme", ""))
    for a in seg_pred.get("content_archetypes", []):
        parts.append(a.get("example", ""))
    for h in seg_pred.get("top_hashtags", []):
        parts.append(h.get("tag", ""))
    return " ".join(p for p in parts if p)


def match_own_posts(cfg: Config, own_posts: List[Post],
                    timeline_pred: Dict[str, Any], top_k: int = 10) -> Dict[str, Any]:
    seg_preds = timeline_pred.get("segments", [])
    if not own_posts:
        return {"segments": [], "note": "自アカウントのタイムラインが空です。own_timeline を用意してください。"}

    # 自ツイートのインデックスを一度だけ構築
    own_texts = [p.text for p in own_posts]
    own_index = TfidfIndex(own_texts)

    used_ids = set()
    seg_results: List[Dict[str, Any]] = []
    for seg in seg_preds:
        profile = _segment_profile_text(seg)
        if not profile.strip():
            seg_results.append({
                "segment_id": seg.get("segment_id"), "name": seg.get("name"),
                "matches": [], "note": "層のTL語彙が不足",
            })
            continue
        seg_vec = own_index.vectorize_text(profile)
        seg_terms = set(tokenize(profile))

        scored = []
        for i, post in enumerate(own_posts):
            sim = TfidfIndex.cosine(own_index.doc_vectors[i], seg_vec)
            if sim <= 0:
                continue
            hits = sorted(seg_terms.intersection(set(tokenize(post.text))))
            scored.append((sim, i, post, hits))
        scored.sort(key=lambda x: x[0], reverse=True)

        matches = []
        for sim, i, post, hits in scored[:top_k]:
            used_ids.add(post.id or i)
            matches.append({
                "post_id": post.id,
                "text": post.text[:200],
                "similarity": round(sim, 4),
                "own_engagement": post.engagements,
                "has_media": post.has_media,
                "topics_hit": hits[:8],
            })
        seg_results.append({
            "segment_id": seg.get("segment_id"),
            "name": seg.get("name"),
            "avg_top_similarity": round(
                sum(m["similarity"] for m in matches) / len(matches), 4) if matches else 0.0,
            "matches": matches,
        })

    coverage = {
        "own_posts_total": len(own_posts),
        "own_posts_matched": len(used_ids),
        "match_rate": round(len(used_ids) / len(own_posts), 3) if own_posts else 0.0,
    }
    return {
        "product": cfg.product.name,
        "segments": seg_results,
        "coverage": coverage,
    }
