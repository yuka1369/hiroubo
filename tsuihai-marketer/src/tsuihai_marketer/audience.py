"""ステップ2: 価値要素からオーディエンス層を設計し、収集設定を生成する。

- 価値要素 → それを必要とするユーザー層(segment)を定義（LLM or ヒューリスティック）
- 各セグメントに X 検索クエリ / Grok クエリを付与
- nob さんの x-audience-research-kit にそのまま渡せる `research.generated.json` を出力
  （sample_size=100 件のサンプリングを想定した limits を設定）
"""

from __future__ import annotations

import math
from typing import Any, Dict, List

from .config import Config
from .llm import LLMClient, LLMError

SYSTEM = """あなたは X(Twitter) を用いたオーディエンスリサーチの設計者です。
プロダクトの価値要素をもとに、その価値を強く必要とする「ユーザー層(segment)」を定義し、
各層を X 上で観測・サンプリングするための検索クエリを作ります。
実在しそうなユーザーの発話・興味・フォロー対象を具体的に想像してください。"""

USER_TMPL = """# プロダクト
{name} — {description}

# 価値要素
{values}

# 指示
このプロダクトの価値を必要とする代表的なユーザー層を {n_segments} 個定義し、
合計 {sample_size} 件のユーザーをサンプリングする配分を設計してください。
X API v2 recent search で使える検索クエリ（日本語・演算子込み, lang:ja を推奨）と、
Grok 用の自然文クエリ（意味検索）を各層に付けます。
次の JSON で出力:

{{
  "segments": [
    {{
      "id": "s1",
      "name": "層の名前",
      "who": "誰か（属性・状況）",
      "why_needs_value": "なぜこの価値を必要とするか",
      "target_value_ids": ["v1","v3"],
      "sample_quota": 40,
      "x_search_query": "キーワード (A OR B) lang:ja -is:retweet",
      "grok_query": "…な人の投稿を探す",
      "signal_phrases": ["観測できそうな発話1", "発話2"]
    }}
  ]
}}"""


def _heuristic(cfg: Config, values: Dict[str, Any]) -> List[Dict[str, Any]]:
    elements = values.get("value_elements") or []
    segments: List[Dict[str, Any]] = []
    n = min(max(len(elements), 3), 6)
    per = cfg.sample_size // n if n else cfg.sample_size
    for i in range(n):
        el = elements[i % len(elements)] if elements else {}
        kws = el.get("keywords") or []
        query_terms = " OR ".join(f'"{k}"' for k in kws[:4]) or f'"{cfg.product.name}"'
        segments.append({
            "id": f"s{i+1}",
            "name": f"{el.get('value', cfg.product.category or 'ターゲット')}を求める層",
            "who": el.get("job_to_be_done", ""),
            "why_needs_value": el.get("pain_relieved", ""),
            "target_value_ids": [el.get("id", f"v{i+1}")],
            "sample_quota": per + (1 if i < cfg.sample_size % n else 0),
            "x_search_query": f"({query_terms}) lang:{cfg.language} -is:retweet",
            "grok_query": f"{cfg.product.category or ''} {' '.join(kws[:3])} について困っている/欲しがっている人の投稿",
            "signal_phrases": kws[:4],
        })
    return segments


def build_audience(cfg: Config, values: Dict[str, Any], llm: LLMClient) -> Dict[str, Any]:
    n_segments = max(3, min(6, len(values.get("value_elements") or []) // 2 + 2))
    method = "heuristic"
    segments: List[Dict[str, Any]]

    if llm.available:
        try:
            values_txt = "\n".join(
                f"- [{e.get('id')}] {e.get('value')} (type={e.get('type')}, "
                f"weight={e.get('weight')}) kw={e.get('keywords')}"
                for e in (values.get("value_elements") or [])
            )
            user = USER_TMPL.format(
                name=cfg.product.name,
                description=cfg.product.description,
                values=values_txt,
                n_segments=n_segments,
                sample_size=cfg.sample_size,
            )
            data = llm.chat_json(SYSTEM, user)
            segments = data.get("segments") or []
            method = "llm"
        except LLMError:
            segments = _heuristic(cfg, values)
    else:
        segments = _heuristic(cfg, values)

    # quota を sample_size に合わせて正規化
    _normalize_quota(segments, cfg.sample_size)

    return {
        "product": cfg.product.name,
        "sample_size": cfg.sample_size,
        "language": cfg.language,
        "method": method,
        "segments": segments,
    }


def _normalize_quota(segments: List[Dict[str, Any]], sample_size: int) -> None:
    if not segments:
        return
    quotas = [max(1, int(s.get("sample_quota", 0))) for s in segments]
    total = sum(quotas) or len(segments)
    scaled = [max(1, round(q / total * sample_size)) for q in quotas]
    # 端数調整
    diff = sample_size - sum(scaled)
    i = 0
    while diff != 0 and scaled:
        idx = i % len(scaled)
        if diff > 0:
            scaled[idx] += 1
            diff -= 1
        elif scaled[idx] > 1:
            scaled[idx] -= 1
            diff += 1
        i += 1
        if i > 10000:
            break
    for s, q in zip(segments, scaled):
        s["sample_quota"] = q


def generate_nob_research_config(cfg: Config, values: Dict[str, Any],
                                 audience: Dict[str, Any]) -> Dict[str, Any]:
    """nob さんの x-audience-research-kit 用 research.json を生成。"""
    segments = audience.get("segments") or []
    grok_queries = [s["grok_query"] for s in segments if s.get("grok_query")]
    x_queries = [
        {"segment": s.get("id"), "query": s.get("x_search_query")}
        for s in segments if s.get("x_search_query")
    ]
    max_hydrate = max(200, cfg.sample_size * 5)  # 1ユーザーあたり複数ツイート想定
    return {
        "research_question": (
            f"{cfg.product.name} の価値を必要とするユーザー層は X 上で何を語り、"
            "どんなタイムラインに触れているか？"
        ),
        "product": cfg.product.name,
        "language": cfg.language,
        "grok_queries": grok_queries,
        "x_search_queries": x_queries,
        "segments": [
            {"id": s.get("id"), "name": s.get("name"), "quota": s.get("sample_quota")}
            for s in segments
        ],
        "limits": {
            "max_grok_queries": max(len(grok_queries), 6),
            "max_hydrate_posts": max_hydrate,
            "posts_per_user": 20,
            "sample_users": cfg.sample_size,
        },
        "note": (
            "このファイルは tsuihai-marketer が自動生成しました。"
            "x-audience-research-kit のディレクトリにコピーし "
            "`python3 xark.py plan --config research.json` で件数を確認後、"
            "grok-search → hydrate → timelines → prepare-analysis を実行してください。"
        ),
    }
