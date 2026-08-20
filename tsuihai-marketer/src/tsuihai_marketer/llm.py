"""LLM ラッパー（標準ライブラリのみ）。

Grok(xAI) と Anthropic(Claude) の両方に対応。API キーが無い場合は
`provider="none"` として動き、各分析モジュールはヒューリスティックに
フォールバックする。xAI/Anthropic どちらも OpenAI 互換ではないが、
ここでは urllib で直接叩くことで依存パッケージ 0 を維持する。
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Optional


class LLMError(RuntimeError):
    pass


@dataclass
class LLMConfig:
    provider: str = "none"          # "grok" | "anthropic" | "none"
    model: str = "grok-3-latest"
    temperature: float = 0.3
    max_tokens: int = 2048
    timeout: int = 60

    @classmethod
    def from_dict(cls, d: Optional[dict]) -> "LLMConfig":
        d = d or {}
        return cls(
            provider=(d.get("provider") or "none").lower(),
            model=d.get("model") or ("grok-3-latest" if (d.get("provider") or "").lower() == "grok"
                                     else "claude-sonnet-4-5"),
            temperature=float(d.get("temperature", 0.3)),
            max_tokens=int(d.get("max_tokens", 2048)),
            timeout=int(d.get("timeout", 60)),
        )


class LLMClient:
    """薄い LLM クライアント。`chat()` で 1 往復、`chat_json()` で JSON を強制。"""

    def __init__(self, config: LLMConfig):
        self.config = config
        self._key = self._resolve_key()

    def _resolve_key(self) -> Optional[str]:
        if self.config.provider == "grok":
            return os.environ.get("XAI_API_KEY") or os.environ.get("GROK_API_KEY")
        if self.config.provider == "anthropic":
            return os.environ.get("ANTHROPIC_API_KEY")
        return None

    @property
    def available(self) -> bool:
        return self.config.provider in ("grok", "anthropic") and bool(self._key)

    # ---- public --------------------------------------------------------
    def chat(self, system: str, user: str) -> str:
        if not self.available:
            raise LLMError(
                f"LLM 未設定 (provider={self.config.provider})。"
                "環境変数 XAI_API_KEY / ANTHROPIC_API_KEY を確認してください。"
            )
        if self.config.provider == "grok":
            return self._grok(system, user)
        return self._anthropic(system, user)

    def chat_json(self, system: str, user: str) -> Any:
        """JSON を返すよう強制し、パースして返す。失敗時は LLMError。"""
        guard = (
            "\n\n重要: 出力は JSON のみ。前置き・説明・コードフェンスは一切禁止。"
        )
        raw = self.chat(system + guard, user)
        return _extract_json(raw)

    def grok_search_json(self, system: str, user: str,
                         search_parameters: dict) -> Any:
        """Grok の Live Search を使って X 等を検索し、JSON を返させる。

        戻り値: (parsed_json, citations)
        Grok(xAI) 専用。他プロバイダでは LLMError。
        """
        if self.config.provider != "grok" or not self.available:
            raise LLMError("grok_search は Grok(xAI) かつ XAI_API_KEY 設定時のみ利用可能です。")
        guard = "\n\n重要: 出力は JSON のみ。前置き・説明・コードフェンスは一切禁止。"
        content, citations = self._grok(system + guard, user,
                                        search_parameters=search_parameters,
                                        return_citations=True)
        return _extract_json(content), citations

    # ---- providers -----------------------------------------------------
    def _grok(self, system: str, user: str, *, search_parameters: dict = None,
              return_citations: bool = False):
        body = {
            "model": self.config.model,
            "temperature": self.config.temperature,
            "max_tokens": self.config.max_tokens,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        if search_parameters:
            body["search_parameters"] = search_parameters
        data = self._post(
            "https://api.x.ai/v1/chat/completions",
            body,
            {"Authorization": f"Bearer {self._key}"},
        )
        content = data["choices"][0]["message"]["content"]
        if return_citations:
            return content, data.get("citations") or []
        return content

    def _anthropic(self, system: str, user: str) -> str:
        body = {
            "model": self.config.model,
            "max_tokens": self.config.max_tokens,
            "temperature": self.config.temperature,
            "system": system,
            "messages": [{"role": "user", "content": user}],
        }
        data = self._post(
            "https://api.anthropic.com/v1/messages",
            body,
            {
                "x-api-key": self._key or "",
                "anthropic-version": "2023-06-01",
            },
        )
        return "".join(
            part.get("text", "") for part in data.get("content", [])
            if part.get("type") == "text"
        )

    def _post(self, url: str, body: dict, headers: dict, retries: int = 3) -> dict:
        payload = json.dumps(body).encode("utf-8")
        base_headers = {"Content-Type": "application/json"}
        base_headers.update(headers)
        last_err: Optional[Exception] = None
        for attempt in range(retries):
            req = urllib.request.Request(url, data=payload, headers=base_headers, method="POST")
            try:
                with urllib.request.urlopen(req, timeout=self.config.timeout) as resp:
                    return json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                detail = e.read().decode("utf-8", "replace")[:500]
                # 4xx はリトライしない
                if 400 <= e.code < 500 and e.code != 429:
                    raise LLMError(f"LLM API {e.code}: {detail}") from e
                last_err = LLMError(f"LLM API {e.code}: {detail}")
            except urllib.error.URLError as e:
                last_err = LLMError(f"LLM API 接続失敗: {e}")
            time.sleep(2 ** attempt)
        raise last_err or LLMError("LLM API 不明なエラー")


def _extract_json(text: str) -> Any:
    """テキストから JSON 部分を抽出してパース。"""
    text = text.strip()
    # コードフェンス除去
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]
        text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # 最初の { or [ から対応する括弧までを探す
    for opener, closer in (("{", "}"), ("[", "]")):
        start = text.find(opener)
        end = text.rfind(closer)
        if start != -1 and end > start:
            try:
                return json.loads(text[start:end + 1])
            except json.JSONDecodeError:
                continue
    raise LLMError(f"LLM 応答を JSON としてパースできませんでした: {text[:200]}")
