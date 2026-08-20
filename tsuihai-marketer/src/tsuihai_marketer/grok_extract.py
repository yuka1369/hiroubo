"""ステップ3(Grok版): Grok の Live Search だけでツイートデータを抽出する。

nob さんのキットや X API(Bearer) を使わず、Grok(xAI) の Live Search
(search_parameters.sources = x) で X を検索し、各セグメントに合うユーザーと
その投稿を構造化 JSON で抽出する。出力は collect.py と同じスキーマ
(audience_posts.jsonl / sampled_users.json / own_timeline.jsonl) なので、
以降の timeline / match / target / actions / report はそのまま動く。

注意: Live Search は Grok による検索・要約に基づく抽出であり、X API v2 の生の
public_metrics とは異なる（エンゲージメントは概算）。厳密な数値が要る場合は
X API 版(collect.py)を使うこと。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

from .config import Config, write_json
from .ingest import Post, dedupe, normalize_record
from .llm import LLMClient, LLMError

EXTRACT_SYSTEM = """あなたは X(Twitter) のオーディエンス調査アナリストです。
Live Search で X を実際に検索し、指定されたユーザー層に該当する実在アカウントと
その最近の投稿を抽出します。憶測で作らず、検索で見つかった実データに基づいて
構造化してください。露骨な個人特定情報は含めず、公開情報の範囲で扱います。"""

EXTRACT_USER_TMPL = """# 探すユーザー層
{seg_name}: {seg_who}
なぜこの価値を必要とするか: {seg_why}
検索の手がかり(語彙): {signals}

# 指示
この層に該当する X 上の実在ユーザーを最大 {quota} 人、Live Search で見つけてください。
各ユーザーについて最近の投稿を最大 {posts_per_user} 件、次の JSON で返します。
engagement は概算で構いません。mentions はその投稿で絡んでいる相手(@なし handle)。

{{
  "users": [
    {{
      "handle": "screen_name(@なし)",
      "bio": "プロフィール要約",
      "topics": ["よく話す話題"],
      "tweets": [
        {{"text": "投稿本文", "approx_likes": 0, "approx_replies": 0,
          "approx_retweets": 0, "mentions": ["絡む相手のhandle"]}}
      ]
    }}
  ]
}}"""

OWN_SYSTEM = """あなたは X の調査アシスタントです。Live Search で指定アカウントの
最近の公開投稿を収集し、構造化して返します。実在の投稿のみ、憶測で作らないこと。"""

OWN_USER_TMPL = """# 対象アカウント
@{handle}

# 指示
このアカウントの最近の公開投稿を最大 {n} 件、Live Search で収集し JSON で返す:
{{
  "tweets": [
    {{"text": "投稿本文", "approx_likes": 0, "approx_replies": 0,
      "approx_retweets": 0, "mentions": ["絡む相手のhandle"]}}
  ]
}}"""


def _x_search_params(cfg: Config, max_results: int,
                     handles: List[str] = None) -> Dict[str, Any]:
    source: Dict[str, Any] = {"type": "x"}
    if handles:
        source["included_x_handles"] = [h.lstrip("@") for h in handles][:10]
    return {
        "mode": "on",
        "return_citations": True,
        "max_search_results": max(5, min(30, max_results)),
        "sources": [source],
    }


def _rec_from_grok_tweet(t: dict, handle: str, cfg: Config) -> dict:
    return {
        "text": t.get("text", ""),
        "author_username": handle,
        "lang": cfg.language,
        "like_count": t.get("approx_likes", 0),
        "reply_count": t.get("approx_replies", 0),
        "retweet_count": t.get("approx_retweets", 0),
        "quote_count": t.get("approx_quotes", 0),
        "entities": {"mentions": [{"username": m} for m in (t.get("mentions") or [])]},
    }


def extract_audience(cfg: Config, audience: Dict[str, Any], llm: LLMClient,
                     posts_per_user: int, log) -> Dict[str, Any]:
    segments = audience.get("segments", [])
    posts: List[Post] = []
    sampled_users: List[Dict[str, Any]] = []
    all_citations: List[str] = []

    for seg in segments:
        quota = int(seg.get("sample_quota", 0)) or 0
        if quota <= 0:
            continue
        log(f"Grok検索: {seg.get('id')} {seg.get('name')} (最大{quota}人)…")
        params = _x_search_params(cfg, max_results=max(10, quota * 2))
        user = EXTRACT_USER_TMPL.format(
            seg_name=seg.get("name", ""),
            seg_who=seg.get("who", ""),
            seg_why=seg.get("why_needs_value", ""),
            signals=", ".join(seg.get("signal_phrases", []) or []),
            quota=quota,
            posts_per_user=posts_per_user,
        )
        try:
            data, citations = llm.grok_search_json(EXTRACT_SYSTEM, user, params)
        except LLMError as e:
            log(f"  [!] 抽出失敗 ({seg.get('id')}): {e}")
            continue
        all_citations.extend(citations or [])
        for u in (data.get("users") or [])[:quota]:
            handle = (u.get("handle") or "").lstrip("@")
            if not handle:
                continue
            n = 0
            for t in (u.get("tweets") or [])[:posts_per_user]:
                p = normalize_record(_rec_from_grok_tweet(t, handle, cfg))
                if p:
                    p.raw["_segment"] = seg.get("id")
                    posts.append(p)
                    n += 1
            sampled_users.append({
                "id": handle, "username": handle,
                "segment": seg.get("id"), "segment_name": seg.get("name"),
                "bio": u.get("bio", ""), "topics": u.get("topics", []),
                "collected_tweets": n,
            })
        log(f"  → {len([s for s in sampled_users if s['segment']==seg.get('id')])} 人分抽出")

    return {"posts": dedupe(posts), "sampled_users": sampled_users,
            "citations": list(dict.fromkeys(all_citations))}


def extract_own_timeline(cfg: Config, llm: LLMClient, n: int, log) -> List[Post]:
    handle = cfg.own_handle.lstrip("@")
    if not handle:
        log("own_account.handle 未設定のため自TL抽出をスキップ。")
        return []
    log(f"Grok検索: 自アカウント @{handle} の投稿を抽出…")
    params = _x_search_params(cfg, max_results=n, handles=[handle])
    try:
        data, _ = llm.grok_search_json(OWN_SYSTEM,
                                       OWN_USER_TMPL.format(handle=handle, n=n), params)
    except LLMError as e:
        log(f"  [!] 自TL抽出失敗: {e}")
        return []
    posts: List[Post] = []
    for t in (data.get("tweets") or [])[:n]:
        p = normalize_record(_rec_from_grok_tweet(t, handle, cfg))
        if p:
            posts.append(p)
    log(f"  → 自ツイート {len(posts)} 件抽出")
    return dedupe(posts)


def run_grok_extraction(cfg: Config, audience: Dict[str, Any], llm: LLMClient,
                        posts_per_user: int, collect_own: bool, log) -> Dict[str, Any]:
    from .collect import write_posts_jsonl

    result = extract_audience(cfg, audience, llm, posts_per_user, log)
    write_posts_jsonl(cfg.path("audience_posts.jsonl"), result["posts"])
    write_json(cfg.path("sampled_users.json"),
               {"product": cfg.product.name, "provider": "grok",
                "users": result["sampled_users"], "citations": result["citations"]})
    log(f"→ audience_posts.jsonl ({len(result['posts'])} ツイート / "
        f"{len(result['sampled_users'])} ユーザー / 引用 {len(result['citations'])}件)")

    own_written = 0
    if collect_own:
        own_posts = extract_own_timeline(cfg, llm, max(posts_per_user, 60), log)
        if own_posts:
            write_posts_jsonl(cfg.resolve(cfg.own_timeline_file), own_posts)
            own_written = len(own_posts)
            log(f"→ {cfg.own_timeline_file} ({own_written} ツイート)")

    return {"audience_posts": len(result["posts"]),
            "sampled_users": len(result["sampled_users"]),
            "own_posts": own_written, "citations": len(result["citations"])}
