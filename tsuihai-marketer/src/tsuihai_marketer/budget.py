"""予算管理（円建て）。X API 従量課金の見積り・上限・月次台帳。

X API は 2026 年に従量課金が既定になった（新規は Basic/Pro 定額不可）。
本モジュールは「読み取り件数 × 単価(USD) × 為替 = 円」で費用を見積もり、
1 回あたり / 月あたりの円上限で収集を止められるようにする。

⚠️ 単価・為替は変動する。config の budget.prices_usd / usd_jpy を実際の
公式ポータルの課金額に合わせて更新すること（表示価格が正）。
"""

from __future__ import annotations

import datetime as _dt
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Optional

from .config import read_json, write_json

# X API 従量課金の既定単価(USD)。要・最新確認。
DEFAULT_PRICES = {
    "post_read": 0.005,   # 投稿1件の読み取り
    "user_read": 0.010,   # ユーザー1件の読み取り
}
DEFAULT_USD_JPY = 155.0


@dataclass
class Budget:
    currency: str = "JPY"
    usd_jpy: float = DEFAULT_USD_JPY
    prices_usd: Dict[str, float] = field(default_factory=lambda: dict(DEFAULT_PRICES))
    per_run_limit_jpy: Optional[float] = None    # 1回の実行あたり上限（円）
    monthly_limit_jpy: Optional[float] = None    # 月あたり上限（円）
    enforce: bool = True                         # 上限で収集を止めるか

    @classmethod
    def from_config(cls, raw: Dict[str, Any]) -> "Budget":
        b = raw.get("budget") or {}
        prices = dict(DEFAULT_PRICES)
        prices.update(b.get("prices_usd") or {})
        return cls(
            currency=b.get("currency", "JPY"),
            usd_jpy=float(b.get("usd_jpy", DEFAULT_USD_JPY)),
            prices_usd=prices,
            per_run_limit_jpy=(float(b["per_run_limit_jpy"])
                               if b.get("per_run_limit_jpy") is not None else None),
            monthly_limit_jpy=(float(b["monthly_limit_jpy"])
                               if b.get("monthly_limit_jpy") is not None else None),
            enforce=bool(b.get("enforce", True)),
        )

    # ---- 換算 ----------------------------------------------------------
    def usd_to_jpy(self, usd: float) -> float:
        return usd * self.usd_jpy

    def reads_cost_usd(self, post_reads: int, user_reads: int = 0) -> float:
        return (post_reads * self.prices_usd.get("post_read", 0.005)
                + user_reads * self.prices_usd.get("user_read", 0.010))

    def reads_cost_jpy(self, post_reads: int, user_reads: int = 0) -> float:
        return self.usd_to_jpy(self.reads_cost_usd(post_reads, user_reads))

    def max_post_reads_for(self, limit_jpy: Optional[float]) -> Optional[int]:
        """円上限に収まる投稿読み取りの最大件数。上限なしなら None。"""
        if not limit_jpy:
            return None
        per = self.usd_to_jpy(self.prices_usd.get("post_read", 0.005))
        if per <= 0:
            return None
        return int(limit_jpy // per)


def estimate_run(budget: Budget, sample_size: int, posts_per_user: int,
                 n_segments: int) -> Dict[str, Any]:
    """1回の run で発生する読み取り件数と費用(円)の見積り。"""
    # サンプリング検索: 1層あたり quota*8 件（上限500）を見る近似
    per_seg_quota = max(1, sample_size // max(1, n_segments))
    search_reads = 0
    for _ in range(max(1, n_segments)):
        search_reads += min(500, max(100, per_seg_quota * 8))
    timeline_reads = sample_size * posts_per_user
    own_reads = max(posts_per_user, 60)
    post_reads = search_reads + timeline_reads + own_reads
    # ユーザー読み取り: 検索で返る著者(billされる)≈0.7×検索件数 ＋ 自分
    user_reads = int(0.7 * search_reads) + 1

    usd = budget.reads_cost_usd(post_reads, user_reads)
    jpy = budget.usd_to_jpy(usd)
    return {
        "sample_size": sample_size,
        "posts_per_user": posts_per_user,
        "n_segments": n_segments,
        "post_reads": post_reads,
        "user_reads": user_reads,
        "breakdown": {
            "search_reads": search_reads,
            "timeline_reads": timeline_reads,
            "own_reads": own_reads,
        },
        "usd": round(usd, 3),
        "jpy": round(jpy, 1),
        "usd_jpy": budget.usd_jpy,
    }


# ---- 月次台帳 ----------------------------------------------------------
def _month_key(when: Optional[_dt.date] = None) -> str:
    d = when or _dt.date.today()
    return f"{d.year:04d}-{d.month:02d}"


def load_ledger(path: Path) -> Dict[str, Any]:
    if path.exists():
        try:
            return read_json(path)
        except Exception:
            pass
    return {"months": {}}


def month_spent_jpy(ledger: Dict[str, Any], when: Optional[_dt.date] = None) -> float:
    return float((ledger.get("months") or {}).get(_month_key(when), {}).get("jpy", 0.0))


def record_spend(path: Path, post_reads: int, user_reads: int, jpy: float,
                 note: str = "") -> Dict[str, Any]:
    ledger = load_ledger(path)
    months = ledger.setdefault("months", {})
    key = _month_key()
    m = months.setdefault(key, {"jpy": 0.0, "post_reads": 0, "user_reads": 0, "runs": 0})
    m["jpy"] = round(m["jpy"] + jpy, 1)
    m["post_reads"] += post_reads
    m["user_reads"] += user_reads
    m["runs"] += 1
    m.setdefault("log", []).append({
        "at": _dt.datetime.now().isoformat(timespec="seconds"),
        "jpy": round(jpy, 1), "post_reads": post_reads, "user_reads": user_reads,
        "note": note,
    })
    write_json(path, ledger)
    return ledger


def remaining_run_cap_jpy(budget: Budget, ledger: Dict[str, Any]) -> Optional[float]:
    """今回の run で使ってよい上限（円）。per_run と 月残の小さい方。上限なしなら None。"""
    caps = []
    if budget.per_run_limit_jpy:
        caps.append(budget.per_run_limit_jpy)
    if budget.monthly_limit_jpy:
        caps.append(max(0.0, budget.monthly_limit_jpy - month_spent_jpy(ledger)))
    if not caps:
        return None
    return min(caps)


def remaining_run_cap_reads(budget: Budget, ledger: Dict[str, Any]) -> Optional[int]:
    """円上限を投稿読み取り件数に換算（参考表示用）。"""
    cap_jpy = remaining_run_cap_jpy(budget, ledger)
    return budget.max_post_reads_for(cap_jpy)
