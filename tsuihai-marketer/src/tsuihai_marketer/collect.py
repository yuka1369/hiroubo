"""ステップ3(自動化): X API から直接ツイートを収集する。

audience.json のセグメント定義に沿って:
  1. 各層の x_search_query で recent search → 発話しているユーザーを quota 分サンプリング
  2. サンプリングした各ユーザーのタイムラインを posts_per_user 件取得
  3. 自分のツイ廃アカウント(handle)のタイムラインを取得
を行い、audience_posts.jsonl / own_timeline.jsonl を書き出す。

これにより「nob キットを手動で回す」工程を挟まずに一気通貫できる。
（nob キットを使いたい場合は従来どおり research.generated.json を渡す運用も可能。）
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from .config import Config
from .ingest import Post, dedupe, normalize_record
from .xclient import XAPIError, XClient


def _sample_users_for_segment(x: XClient, seg: Dict[str, Any], quota: int,
                              already: Set[str], log,
                              max_tweets_budget: int = None) -> List[Dict[str, Any]]:
    """1 セグメントの検索クエリから、まだ選ばれていないユーザーを quota 件集める。

    max_tweets_budget を渡すと、検索で読み取るツイート数をその上限に抑える（予算対策）。
    """
    query = seg.get("x_search_query")
    if not query:
        return []
    # quota を満たすため、検索は quota の数倍のツイートを見てユニーク著者を拾う
    want_tweets = min(500, max(100, quota * 8))
    if max_tweets_budget is not None:
        want_tweets = max(10, min(want_tweets, max_tweets_budget))
    try:
        res = x.recent_search(query, max_results=want_tweets)
    except XAPIError as e:
        log(f"  [!] 検索失敗 ({seg.get('id')}): {e}")
        return []
    users = res["users"]
    # 著者を出現順（=検索関連度順に近い）に、ユニークで quota 件
    picked: List[Dict[str, Any]] = []
    seen_here: Set[str] = set()
    for tw in res["tweets"]:
        aid = tw.get("author_id")
        if not aid or aid in already or aid in seen_here:
            continue
        u = users.get(aid)
        if not u:
            continue
        seen_here.add(aid)
        picked.append({"id": aid, "username": u.get("username", ""),
                       "segment": seg.get("id"), "segment_name": seg.get("name")})
        if len(picked) >= quota:
            break
    return picked


def collect_audience(cfg: Config, audience: Dict[str, Any], x: XClient,
                     posts_per_user: int, log,
                     budget=None, cap_jpy: float = None) -> Dict[str, Any]:
    """オーディエンスのサンプリング＋各ユーザーのツイート収集。

    budget と cap_jpy を渡すと、実費(円・ユーザー読み取り含む)が上限を超えないよう
    収集を止める（予算上限）。
    """
    def spent_jpy() -> float:
        return budget.reads_cost_jpy(x.post_reads, x.user_reads) if budget else 0.0

    segments = audience.get("segments", [])
    sampled_users: List[Dict[str, Any]] = []
    already: Set[str] = set()

    log("オーディエンスをサンプリング中（recent search）…")
    for seg in segments:
        quota = int(seg.get("sample_quota", 0)) or 0
        if quota <= 0:
            continue
        if cap_jpy is not None and spent_jpy() >= cap_jpy:
            log(f"  予算上限に達したためサンプリング打ち切り（実費 ¥{spent_jpy():,.0f}）")
            break
        # この検索で読んでよいツイート数を残予算から算出（1件が新規ユーザーでもある最悪ケースで換算）
        max_tw = None
        if cap_jpy is not None and budget is not None:
            worst_per_tweet = budget.reads_cost_jpy(1, 1)
            remaining = cap_jpy - spent_jpy()
            max_tw = int(remaining // worst_per_tweet) if worst_per_tweet > 0 else None
            if max_tw is not None and max_tw < 10:
                log(f"  予算上限に達したためサンプリング打ち切り（実費 ¥{spent_jpy():,.0f}）")
                break
        picked = _sample_users_for_segment(x, seg, quota, already, log,
                                           max_tweets_budget=max_tw)
        for u in picked:
            already.add(u["id"])
        sampled_users.extend(picked)
        log(f"  {seg.get('id')} {seg.get('name')}: {len(picked)}/{quota} 人")

    log(f"サンプリング合計: {len(sampled_users)} 人。各ユーザーのツイートを取得中…")
    posts: List[Post] = []
    user_index: List[Dict[str, Any]] = []
    stopped = False
    next_cost_jpy = budget.reads_cost_jpy(posts_per_user, 0) if budget else 0.0
    for i, u in enumerate(sampled_users, 1):
        # 次の1人分を取ると上限を超えるなら止める
        if cap_jpy is not None and spent_jpy() + next_cost_jpy > cap_jpy:
            log(f"  予算上限のためユーザー取得を停止（{i-1}/{len(sampled_users)} 人で打ち切り、"
                f"実費 ¥{spent_jpy():,.0f}）")
            stopped = True
            break
        try:
            raw_tweets = x.get_user_timeline(u["id"], max_results=posts_per_user)
        except XAPIError as e:
            log(f"  [!] TL取得失敗 @{u['username']}: {e}")
            raw_tweets = []
        n = 0
        for rec in raw_tweets:
            rec.setdefault("author_username", u["username"])
            rec.setdefault("author_id", u["id"])
            p = normalize_record(rec)
            if p:
                # segment 情報を保持
                p.raw["_segment"] = u["segment"]
                posts.append(p)
                n += 1
        user_index.append({**u, "collected_tweets": n})
        if i % 10 == 0:
            log(f"  {i}/{len(sampled_users)} 人分 取得済み（累計 {len(posts)} ツイート）")

    posts = dedupe(posts)
    return {"posts": posts, "sampled_users": user_index, "budget_stopped": stopped}


def collect_own_timeline(cfg: Config, x: XClient, posts_per_user: int, log) -> List[Post]:
    """自分のツイ廃アカウントのタイムラインを収集。"""
    handle = cfg.own_handle
    if not handle:
        log("own_account.handle 未設定のため自TL収集をスキップ。")
        return []
    log(f"自アカウント @{handle.lstrip('@')} のタイムラインを取得中…")
    user = x.get_user_by_username(handle)
    if not user:
        log(f"  [!] @{handle} が取得できませんでした。")
        return []
    # 自分の発信スタイル把握には多めに取る
    n = max(posts_per_user, cfg.raw.get("own_account", {}).get("max_tweets", 100))
    try:
        raw = x.get_user_timeline(user["id"], max_results=n)
    except XAPIError as e:
        log(f"  [!] 自TL取得失敗: {e}")
        return []
    posts: List[Post] = []
    for rec in raw:
        rec.setdefault("author_username", user.get("username", handle.lstrip("@")))
        rec.setdefault("author_id", user["id"])
        p = normalize_record(rec)
        if p:
            posts.append(p)
    posts = dedupe(posts)
    log(f"  自ツイート {len(posts)} 件取得。")
    return posts


def write_posts_jsonl(path: Path, posts: List[Post]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for p in posts:
            f.write(json.dumps(p.to_dict(), ensure_ascii=False) + "\n")


def run_collection(cfg: Config, audience: Dict[str, Any], x: XClient,
                   posts_per_user: int, collect_own: bool, log,
                   budget=None, cap_jpy: float = None) -> Dict[str, Any]:
    # 自TL取得分の費用を予約してからオーディエンスの上限を決める
    own_reserve_reads = max(posts_per_user, cfg.raw.get("own_account", {}).get("max_tweets", 100)) \
        if collect_own else 0
    own_reserve_jpy = budget.reads_cost_jpy(own_reserve_reads, 1) if (budget and collect_own) else 0.0
    audience_cap_jpy = None
    if cap_jpy is not None:
        audience_cap_jpy = max(0.0, cap_jpy - own_reserve_jpy)

    result = collect_audience(cfg, audience, x, posts_per_user, log,
                              budget=budget, cap_jpy=audience_cap_jpy)
    write_posts_jsonl(cfg.path("audience_posts.jsonl"), result["posts"])
    log(f"→ audience_posts.jsonl ({len(result['posts'])} ツイート / "
        f"{len(result['sampled_users'])} ユーザー)")

    # サンプリング台帳も残す
    from .config import write_json
    write_json(cfg.path("sampled_users.json"),
               {"product": cfg.product.name, "users": result["sampled_users"]})

    own_written = 0
    if collect_own:
        cur_jpy = budget.reads_cost_jpy(x.post_reads, x.user_reads) if budget else 0.0
        # 上限内に自TL分が残っていれば取得
        if cap_jpy is None or cur_jpy + own_reserve_jpy <= cap_jpy:
            own_posts = collect_own_timeline(cfg, x, posts_per_user, log)
            if own_posts:
                own_path = cfg.resolve(cfg.own_timeline_file)
                write_posts_jsonl(own_path, own_posts)
                own_written = len(own_posts)
                log(f"→ {cfg.own_timeline_file} ({own_written} ツイート)")

    return {
        "audience_posts": len(result["posts"]),
        "sampled_users": len(result["sampled_users"]),
        "own_posts": own_written,
        "budget_stopped": result.get("budget_stopped", False),
    }
