"""設定ファイルの読み込みとパス解決。"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional


@dataclass
class ProductConfig:
    name: str
    description: str
    url: str = ""
    category: str = ""
    price: str = ""
    stage: str = ""  # idea / mvp / launched

    @classmethod
    def from_dict(cls, d: dict) -> "ProductConfig":
        if not d.get("name") or not d.get("description"):
            raise ValueError("product.name と product.description は必須です")
        return cls(
            name=d["name"],
            description=d["description"],
            url=d.get("url", ""),
            category=d.get("category", ""),
            price=d.get("price", ""),
            stage=d.get("stage", ""),
        )


@dataclass
class Config:
    product: ProductConfig
    own_handle: str
    own_timeline_file: str
    sample_size: int
    language: str
    llm: Dict[str, Any]
    nob_kit_path: str
    nob_data_dir: str
    data_dir: str
    reports_dir: str
    root: Path
    raw: Dict[str, Any] = field(default_factory=dict)

    def path(self, name: str) -> Path:
        """data_dir 配下のファイルパスを絶対化して返す。"""
        p = Path(name)
        if p.is_absolute():
            return p
        return (self.root / self.data_dir / name).resolve()

    def report_path(self, name: str) -> Path:
        p = Path(name)
        if p.is_absolute():
            return p
        return (self.root / self.reports_dir / name).resolve()

    def resolve(self, name: str) -> Path:
        """config ファイルからの相対パスを絶対化。"""
        p = Path(name)
        if p.is_absolute():
            return p
        return (self.root / name).resolve()


def load_config(path: str) -> Config:
    cfg_path = Path(path).resolve()
    if not cfg_path.exists():
        raise FileNotFoundError(f"設定ファイルが見つかりません: {cfg_path}")
    with cfg_path.open(encoding="utf-8") as f:
        raw = json.load(f)

    root = cfg_path.parent
    audience = raw.get("audience", {})
    own = raw.get("own_account", {})
    nob = raw.get("nob_kit", {})

    return Config(
        product=ProductConfig.from_dict(raw.get("product", {})),
        own_handle=own.get("handle", ""),
        own_timeline_file=own.get("timeline_file", "own_timeline.jsonl"),
        sample_size=int(audience.get("sample_size", 100)),
        language=audience.get("language", "ja"),
        llm=raw.get("llm", {}),
        nob_kit_path=nob.get("path", "../x-audience-research-kit"),
        nob_data_dir=nob.get("data_dir", "data/processed"),
        data_dir=raw.get("data_dir", "data"),
        reports_dir=raw.get("reports_dir", "reports"),
        root=root,
        raw=raw,
    )


def write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)


def read_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def read_jsonl(path: Path) -> List[dict]:
    rows: List[dict] = []
    if not path.exists():
        return rows
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return rows
