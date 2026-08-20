"""中核: ユーザー1人単位の「TOP出し」ターゲティング。

Xはネットワーク(グラフ)で表示が決まる。あるユーザー U のタイムラインには
U のネットワーク(絡む相手＝隣人)に流れている内容が出る。したがって
「U のTLに流れる内容に、自分のツイ廃履歴の中でいちばん似ているツイート」を
TOP出しすれば、それが U のネットワークに最も溶け込み＝表示されやすい候補になる。

各ターゲットユーザーについて次を出す:
  - timeline_profile : U の発話プロフィール(TF-IDF)
  - network          : U が絡む隣人(@メンション頻度)＝グラフの入口
  - top_own_tweets   : 自分の過去ツイートを類似度で並べた上位（★TOP出し）
  - generated_tweet  : U のTLに溶け込むよう生成した新規ツイート案(LLM)
  - network_action   : どの隣人に絡めば U に届くか(グラフ的アクション)
  - reach_score      : そのユーザーを狙う価値(類似度×ネットワーク到達性)
出力は reach_score 降順（＝狙うべきユーザー順）。
"""

from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any, Dict, List, Optional

from .config import Config
from .ingest import Post
from .llm import LLMClient, LLMError
from .textutil import TfidfIndex, corpus_top_terms


def _group_by_author(posts: List[Post]) -> Dict[str, List[Post]]:
    g: Dict[str, List[Post]] = defaultdict(list)
    for p in posts:
        key = p.author or p.author_id or "unknown"
        g[key].append(p)
    return g


def _user_network(posts: List[Post]) -> List[Dict[str, Any]]:
    c: Counter = Counter()
    for p in posts:
        c.update(p.mentions)
    return [{"handle": h, "weight": w} for h, w in c.most_common(10)]


def _segment_of(username: str, sampled_users: Optional[Dict[str, Any]]) -> Dict[str, str]:
    if not sampled_users:
        return {}
    for u in sampled_users.get("users", []):
        if (u.get("username") or "").lower() == (username or "").lower():
            return {"segment": u.get("segment", ""), "segment_name": u.get("segment_name", "")}
    return {}


def build_targets(cfg: Config, own_posts: List[Post], audience_posts: List[Post],
                  values: Dict[str, Any], llm: LLMClient, *,
                  top_k: int = 5, max_users: int = 100,
                  sampled_users: Optional[Dict[str, Any]] = None,
                  generate: bool = True) -> Dict[str, Any]:
    if not own_posts:
        return {"targets": [], "note": "自アカウントのツイートが空です。"}
    if not audience_posts:
        return {"targets": [], "note": "オーディエンスのツイートが空です。先に収集してください。"}

    own_index = TfidfIndex([p.text for p in own_posts])
    by_user = _group_by_author(audience_posts)

    targets: List[Dict[str, Any]] = []
    for username, uposts in by_user.items():
        profile_text = " ".join(p.text for p in uposts)
        prof_vec = own_index.vectorize_text(profile_text)

        scored = []
        for i, op in enumerate(own_posts):
            sim = TfidfIndex.cosine(own_index.doc_vectors[i], prof_vec)
            if sim > 0:
                scored.append((sim, op))
        scored.sort(key=lambda x: x[0], reverse=True)
        top = scored[:top_k]

        network = _user_network(uposts)
        topics = [t for t, _ in corpus_top_terms((p.text for p in uposts), 10)]
        best_sim = top[0][0] if top else 0.0
        # ネットワーク到達性: 隣人が多い/絡みが活発なほど、その隣人経由で届きやすい
        net_reach = min(1.0, sum(n["weight"] for n in network) / 10.0)
        reach_score = round(best_sim * (0.6 + 0.4 * net_reach), 4)

        targets.append({
            "user": username,
            **_segment_of(username, sampled_users),
            "timeline_size": len(uposts),
            "timeline_topics": topics,
            "network": network,
            "top_own_tweets": [
                {"text": op.text[:200], "similarity": round(sim, 4),
                 "own_engagement": op.engagements, "post_id": op.id}
                for sim, op in top
            ],
            "best_tweet": ({"text": top[0][1].text, "similarity": round(top[0][0], 4)}
                           if top else None),
            "reach_score": reach_score,
        })

    targets.sort(key=lambda t: t["reach_score"], reverse=True)
    targets = targets[:max_users]

    if generate and llm.available:
        for t in targets[: min(len(targets), 20)]:  # コスト配慮: 上位のみ生成
            _augment_with_llm(cfg, t, values, llm)

    return {
        "product": cfg.product.name,
        "n_users": len(by_user),
        "targets": targets,
        "method": "llm" if (generate and llm.available) else "similarity-only",
    }


def _augment_with_llm(cfg: Config, target: Dict[str, Any], values: Dict[str, Any],
                      llm: LLMClient) -> None:
    """上位ターゲットに、溶け込むツイート生成＋ネットワークアクションを付与。"""
    try:
        best = target.get("best_tweet") or {}
        neighbors = ", ".join(f"@{n['handle']}" for n in target.get("network", [])[:5]) or "(不明)"
        system = ("あなたは X グロースの実務家です。X はネットワーク(グラフ)で表示が決まるという前提で、"
                  "あるターゲットユーザーのタイムラインに溶け込み、かつ自分のプロダクト価値も匂わせる"
                  "ツイートと、そのユーザーに届くためのネットワーク行動を設計します。露骨な宣伝は禁止。")
        user = f"""# プロダクト
{cfg.product.name} — {cfg.product.description}
価値: {[e.get('value') for e in values.get('value_elements', [])][:6]}

# ターゲットユーザー
発話トピック: {target.get('timeline_topics')}
絡んでいる相手(ネットワーク隣人): {neighbors}
自分の過去ツイートで最も刺さるもの: {best.get('text','')}

# 出力(JSON)
{{
  "generated_tweet": "このユーザーのTLに自然に溶け込む新規ツイート案(自分の声・140字以内・宣伝臭を消す)",
  "network_action": "このユーザーに表示されるためのグラフ的行動(誰にどう絡むか。隣人や共通話題を使う)",
  "why": "なぜこれで表示率が上がるか(ネットワーク観点で一文)"
}}"""
        data = llm.chat_json(system, user)
        if isinstance(data, dict):
            target["generated_tweet"] = data.get("generated_tweet", "")
            target["network_action"] = data.get("network_action", "")
            target["reason"] = data.get("why", "")
    except LLMError:
        pass
