"""ツイートデータの取り込みと正規化。

nob さんの x-audience-research-kit が出力する `posts.jsonl` / `posts.csv`、
および自分のツイ廃アカウントのタイムライン（同形式 or 素の JSONL）を
共通スキーマ `Post` に正規化する。

nob キットの 1 レコードは概ね次のキーを持つ（バージョン差を吸収する）:
  id, text, author_id, author_username, created_at,
  public_metrics{like_count, reply_count, retweet_count, quote_count,
                 impression_count, bookmark_count}, lang, ...
"""

from __future__ import annotations

import csv
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

from .config import read_jsonl


@dataclass
class Post:
    id: str
    text: str
    author: str            # username（@なし）
    author_id: str = ""
    created_at: str = ""
    lang: str = ""
    likes: int = 0
    replies: int = 0
    retweets: int = 0
    quotes: int = 0
    bookmarks: int = 0
    impressions: int = 0
    has_media: bool = False
    has_link: bool = False
    is_reply: bool = False
    raw: Dict[str, Any] = field(default_factory=dict)

    @property
    def engagements(self) -> int:
        return self.likes + self.replies + self.retweets + self.quotes + self.bookmarks

    @property
    def engagement_rate(self) -> float:
        if self.impressions > 0:
            return self.engagements / self.impressions
        # インプレッション不明時はフォロワー非依存の簡易比率
        return 0.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "text": self.text,
            "author": self.author,
            "author_id": self.author_id,
            "created_at": self.created_at,
            "lang": self.lang,
            "likes": self.likes,
            "replies": self.replies,
            "retweets": self.retweets,
            "quotes": self.quotes,
            "bookmarks": self.bookmarks,
            "impressions": self.impressions,
            "has_media": self.has_media,
            "has_link": self.has_link,
            "is_reply": self.is_reply,
        }


def _as_int(v: Any) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def _detect_media(rec: dict, text: str) -> bool:
    if rec.get("has_media") is not None:
        return bool(rec.get("has_media"))
    attach = rec.get("attachments") or {}
    if attach.get("media_keys"):
        return True
    entities = rec.get("entities") or {}
    return bool(entities.get("media"))


def _detect_link(rec: dict, text: str) -> bool:
    if rec.get("has_link") is not None:
        return bool(rec.get("has_link"))
    if "http://" in text or "https://" in text:
        return True
    entities = rec.get("entities") or {}
    return bool(entities.get("urls"))


def normalize_record(rec: dict) -> Optional[Post]:
    text = rec.get("text") or rec.get("full_text") or ""
    pid = str(rec.get("id") or rec.get("id_str") or rec.get("tweet_id") or "")
    if not text and not pid:
        return None

    metrics = rec.get("public_metrics") or {}

    def metric(*names: str) -> int:
        for n in names:
            if n in rec and rec[n] is not None:
                return _as_int(rec[n])
            if n in metrics and metrics[n] is not None:
                return _as_int(metrics[n])
        return 0

    author_obj = rec.get("author")
    author_from_obj = author_obj.get("username", "") if isinstance(author_obj, dict) else ""
    author_flat = author_obj if isinstance(author_obj, str) else ""
    author = (
        rec.get("author_username")
        or rec.get("username")
        or author_from_obj
        or author_flat
        or rec.get("screen_name")
        or ""
    )
    author = str(author or "").lstrip("@")

    referenced = rec.get("referenced_tweets") or []
    is_reply = (
        rec.get("in_reply_to_user_id") is not None
        or any(r.get("type") == "replied_to" for r in referenced if isinstance(r, dict))
        or text.startswith("@")
    )

    return Post(
        id=pid,
        text=text,
        author=author,
        author_id=str(rec.get("author_id") or rec.get("user_id") or ""),
        created_at=str(rec.get("created_at") or ""),
        lang=str(rec.get("lang") or ""),
        likes=metric("like_count", "likes", "favorite_count"),
        replies=metric("reply_count", "replies"),
        retweets=metric("retweet_count", "retweets"),
        quotes=metric("quote_count", "quotes"),
        bookmarks=metric("bookmark_count", "bookmarks"),
        impressions=metric("impression_count", "impressions", "views"),
        has_media=_detect_media(rec, text),
        has_link=_detect_link(rec, text),
        is_reply=bool(is_reply),
        raw=rec,
    )


def load_posts_jsonl(path: Path) -> List[Post]:
    posts: List[Post] = []
    for rec in read_jsonl(path):
        p = normalize_record(rec)
        if p:
            posts.append(p)
    return posts


def load_posts_csv(path: Path) -> List[Post]:
    posts: List[Post] = []
    if not path.exists():
        return posts
    with path.open(encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            p = normalize_record(dict(row))
            if p:
                posts.append(p)
    return posts


def load_nob_kit_output(nob_data_dir: Path) -> List[Post]:
    """nob キットの processed ディレクトリから posts を読み込む。"""
    jsonl = nob_data_dir / "posts.jsonl"
    if jsonl.exists():
        return load_posts_jsonl(jsonl)
    csv_path = nob_data_dir / "posts.csv"
    if csv_path.exists():
        return load_posts_csv(csv_path)
    return []


def dedupe(posts: List[Post]) -> List[Post]:
    seen = set()
    out: List[Post] = []
    for p in posts:
        key = p.id or (p.author, p.text[:60])
        if key in seen:
            continue
        seen.add(key)
        out.append(p)
    return out
