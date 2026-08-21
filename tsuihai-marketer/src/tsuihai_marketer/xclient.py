"""X API v2 クライアント（標準ライブラリのみ / Bearer トークン App-only 認証）。

課金済みの X API（Basic/Pro 以上、recent search が使えるティア）を前提に、
- recent search でオーディエンスをサンプリング
- ユーザータイムラインで各ユーザーの複数ツイートを取得
- 自分のツイ廃アカウントのタイムラインを取得
を行う。レート制限(429)は Retry-After / x-rate-limit-reset を見て待機する。

nob さんの x-audience-research-kit と同じデータ(posts.jsonl 相当)を直接得るための層。
kit を使いたい場合は従来どおり research.generated.json を渡す運用も可能。
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Iterable, List, Optional

API_BASE = "https://api.x.com/2"

TWEET_FIELDS = "created_at,lang,public_metrics,entities,attachments,referenced_tweets,in_reply_to_user_id,author_id"
USER_FIELDS = "username,name,public_metrics,description,verified"


class XAPIError(RuntimeError):
    pass


class XRateLimit(XAPIError):
    """レート制限に達し、待機してもなお続行不能な場合。"""


class XClient:
    def __init__(self, bearer_token: Optional[str] = None, *,
                 timeout: int = 30, max_wait: int = 900, verbose: bool = True):
        self.token = bearer_token or os.environ.get("X_BEARER_TOKEN")
        self.timeout = timeout
        self.max_wait = max_wait          # 429 で待つ最大秒数
        self.verbose = verbose
        # 従量課金の実測カウンタ（予算管理に使用）
        self.post_reads = 0
        self.user_reads = 0

    @property
    def available(self) -> bool:
        return bool(self.token)

    def _log(self, msg: str) -> None:
        if self.verbose:
            import sys
            print(f"[x-api] {msg}", file=sys.stderr)

    # ---- low level -----------------------------------------------------
    def _get(self, path: str, params: Dict[str, Any]) -> Dict[str, Any]:
        if not self.available:
            raise XAPIError("X_BEARER_TOKEN が未設定です。")
        url = f"{API_BASE}{path}?{urllib.parse.urlencode(params)}"
        headers = {
            "Authorization": f"Bearer {self.token}",
            "User-Agent": "tsuihai-marketer/0.1",
        }
        attempts = 0
        while True:
            attempts += 1
            req = urllib.request.Request(url, headers=headers, method="GET")
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    return json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                body = e.read().decode("utf-8", "replace")
                if e.code == 429:
                    wait = self._rate_wait(e)
                    if wait > self.max_wait or attempts > 5:
                        raise XRateLimit(f"レート制限。待機 {wait}s が上限超過。{body[:200]}") from e
                    self._log(f"429 レート制限。{wait}s 待機します…")
                    time.sleep(wait)
                    continue
                if e.code in (500, 502, 503, 504) and attempts <= 4:
                    time.sleep(2 ** attempts)
                    continue
                raise XAPIError(f"X API {e.code} {path}: {body[:300]}") from e
            except urllib.error.URLError as e:
                if attempts <= 4:
                    time.sleep(2 ** attempts)
                    continue
                raise XAPIError(f"X API 接続失敗 {path}: {e}") from e

    @staticmethod
    def _rate_wait(e: urllib.error.HTTPError) -> int:
        ra = e.headers.get("retry-after")
        if ra and ra.isdigit():
            return int(ra) + 1
        reset = e.headers.get("x-rate-limit-reset")
        if reset and reset.isdigit():
            return max(1, int(reset) - int(time.time()) + 1)
        return 60

    def _paginate(self, path: str, params: Dict[str, Any], *,
                  max_items: int, page_size: int = 100) -> List[dict]:
        """next_token を辿って max_items まで data を集める。"""
        out: List[dict] = []
        token: Optional[str] = None
        while len(out) < max_items:
            p = dict(params)
            p["max_results"] = min(page_size, max(10, max_items - len(out)))
            if token:
                p["pagination_token"] = token
            data = self._get(path, p)
            rows = data.get("data") or []
            out.extend(rows)
            meta = data.get("meta") or {}
            token = meta.get("next_token")
            if not token or not rows:
                break
        return out[:max_items]

    # ---- high level ----------------------------------------------------
    def recent_search(self, query: str, *, max_results: int = 100) -> Dict[str, Any]:
        """recent search（過去約7日）。data と includes.users を返す。"""
        params = {
            "query": query,
            "tweet.fields": TWEET_FIELDS,
            "expansions": "author_id",
            "user.fields": USER_FIELDS,
            "max_results": min(100, max(10, max_results)),
        }
        # ページング（authors を quota 分集めたいので複数ページ許容）
        all_tweets: List[dict] = []
        users: Dict[str, dict] = {}
        token: Optional[str] = None
        while len(all_tweets) < max_results:
            p = dict(params)
            p["max_results"] = min(100, max(10, max_results - len(all_tweets)))
            if token:
                p["next_token"] = token
            data = self._get("/tweets/search/recent", p)
            rows = data.get("data") or []
            all_tweets.extend(rows)
            self.post_reads += len(rows)               # 従量課金カウント
            new_users = (data.get("includes") or {}).get("users") or []
            for u in new_users:
                if u["id"] not in users:
                    self.user_reads += 1
                users[u["id"]] = u
            token = (data.get("meta") or {}).get("next_token")
            if not token or not rows:
                break
        return {"tweets": all_tweets, "users": users}

    def get_user_by_username(self, username: str) -> Optional[dict]:
        username = username.lstrip("@")
        try:
            data = self._get(f"/users/by/username/{urllib.parse.quote(username)}",
                             {"user.fields": USER_FIELDS})
        except XAPIError as e:
            self._log(f"ユーザー取得失敗 @{username}: {e}")
            return None
        self.user_reads += 1
        return data.get("data")

    def get_user_timeline(self, user_id: str, *, max_results: int = 20,
                          exclude_replies: bool = False) -> List[dict]:
        params = {
            "tweet.fields": TWEET_FIELDS,
            "exclude": "retweets" + (",replies" if exclude_replies else ""),
        }
        rows = self._paginate(f"/users/{user_id}/tweets", params,
                              max_items=max_results, page_size=min(100, max_results))
        self.post_reads += len(rows)                    # 従量課金カウント
        return rows
