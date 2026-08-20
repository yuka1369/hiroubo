"""ステップ1: プロダクトから「価値要素」を抽出する。

プロダクトの説明文を入力に、それが提供する価値を構造化して取り出す。
LLM(Grok/Claude) が使えれば意味的に抽出、無ければ説明文からの
キーフレーズ抽出でヒューリスティックにフォールバックする。

出力 value_elements.json の形:
{
  "product": {...},
  "value_elements": [
    {"id": "v1", "value": "...", "type": "functional|emotional|social",
     "job_to_be_done": "...", "keywords": [...], "weight": 0.0-1.0,
     "pain_relieved": "..."}
  ],
  "positioning": "...",
  "method": "llm|heuristic"
}
"""

from __future__ import annotations

from typing import Any, Dict, List

from .config import Config
from .llm import LLMClient, LLMError
from .textutil import keywords

SYSTEM = """あなたは B2C プロダクトのバリュープロポジション分析の専門家です。
与えられたプロダクトが顧客に提供する「価値要素(value elements)」を抽出します。
機能的価値(functional)・情緒的価値(emotional)・社会的価値(social)の3層で捉え、
各価値について「どんな用事(Jobs To Be Done)を片づけるか」「どんな痛みを解消するか」
「X(Twitter)上でその価値を欲する人が発しそうなキーワード」を specifics に落とします。"""

USER_TMPL = """# プロダクト
名前: {name}
カテゴリ: {category}
価格: {price}
説明: {description}

# 指示
このプロダクトの価値要素を 6〜10 個抽出し、次の JSON で出力してください。
weight は「そのプロダクトの魅力における重要度」を 0〜1 で相対配分（合計は概ね1.0）。
keywords は X で検索・観測しやすい日本語の語を各 4〜8 個。

{{
  "value_elements": [
    {{
      "id": "v1",
      "value": "端的な価値の名前",
      "type": "functional | emotional | social",
      "job_to_be_done": "ユーザーが片づけたい用事",
      "pain_relieved": "解消される痛み・不満",
      "keywords": ["語1", "語2", "..."],
      "weight": 0.2
    }}
  ],
  "positioning": "一文でのポジショニング（誰の・どんな時の・何を解決する）"
}}"""


def _heuristic(cfg: Config) -> Dict[str, Any]:
    """LLM 無しの簡易抽出。説明文からキーフレーズを価値候補にする。"""
    p = cfg.product
    kws = keywords(f"{p.name} {p.description} {p.category}", top=12)
    # 説明文を句点で割って価値候補にする
    sentences = [s.strip() for s in p.description.replace("。", "。\n").splitlines() if s.strip()]
    elements: List[Dict[str, Any]] = []
    base = sentences or [p.description]
    n = min(max(len(base), 4), 8)
    for i in range(n):
        sent = base[i % len(base)]
        elements.append({
            "id": f"v{i+1}",
            "value": sent[:40],
            "type": ["functional", "emotional", "social"][i % 3],
            "job_to_be_done": sent[:80],
            "pain_relieved": "",
            "keywords": kws[i * 2: i * 2 + 4] or kws[:4],
            "weight": round(1.0 / n, 3),
        })
    return {
        "value_elements": elements,
        "positioning": f"{p.category or 'プロダクト'}: {p.description[:60]}",
        "method": "heuristic",
    }


def extract_values(cfg: Config, llm: LLMClient) -> Dict[str, Any]:
    p = cfg.product
    result: Dict[str, Any]
    if llm.available:
        try:
            user = USER_TMPL.format(
                name=p.name,
                category=p.category or "(未指定)",
                price=p.price or "(未指定)",
                description=p.description,
            )
            data = llm.chat_json(SYSTEM, user)
            elements = data.get("value_elements") or []
            # weight 正規化
            total = sum(float(e.get("weight", 0)) for e in elements) or 1.0
            for i, e in enumerate(elements):
                e.setdefault("id", f"v{i+1}")
                e["weight"] = round(float(e.get("weight", 0)) / total, 3)
            result = {
                "value_elements": elements,
                "positioning": data.get("positioning", ""),
                "method": "llm",
            }
        except LLMError as e:
            result = _heuristic(cfg)
            result["llm_error"] = str(e)
    else:
        result = _heuristic(cfg)

    result["product"] = {
        "name": p.name,
        "description": p.description,
        "category": p.category,
        "url": p.url,
        "price": p.price,
    }
    return result
