"""テキスト解析ユーティリティ（標準ライブラリのみ）。

MeCab 等の形態素解析器に依存せず日本語ツイートを扱うため、
「英数字は単語」「日本語は文字bigram」というハイブリッド tokenizer を用いる。
これにより外部依存なしで十分な精度の TF-IDF / コサイン類似度が得られる。
"""

from __future__ import annotations

import math
import re
import unicodedata
from collections import Counter
from typing import Dict, Iterable, List, Sequence, Tuple

# よく出るが情報量の乏しい語（日本語 / 英語）
STOPWORDS = {
    "こと", "これ", "それ", "あれ", "する", "した", "して", "います", "ます",
    "です", "でも", "ない", "なる", "ある", "いる", "みたい", "みたいな",
    "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "it",
    "rt", "https", "http", "co", "com", "www",
}

_URL_RE = re.compile(r"https?://\S+")
_MENTION_RE = re.compile(r"@\w+")
_HASHTAG_RE = re.compile(r"#(\w+)")
_ALNUM_RE = re.compile(r"[a-zA-Z0-9_]+")
# CJK（漢字・ひらがな・カタカナ）
_CJK_RE = re.compile(r"[぀-ヿ㐀-䶿一-鿿々ー]+")


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text or "")
    return text.strip()


def clean_for_tokens(text: str, keep_hashtags: bool = True) -> str:
    text = normalize(text)
    text = _URL_RE.sub(" ", text)
    text = _MENTION_RE.sub(" ", text)
    if keep_hashtags:
        text = _HASHTAG_RE.sub(r" \1 ", text)
    return text


def tokenize(text: str) -> List[str]:
    """英数字は単語単位、CJK は文字 bigram でトークン化。"""
    text = clean_for_tokens(text).lower()
    tokens: List[str] = []
    for m in _ALNUM_RE.findall(text):
        if len(m) >= 2 and m not in STOPWORDS:
            tokens.append(m)
    for chunk in _CJK_RE.findall(text):
        if len(chunk) == 1:
            continue
        for i in range(len(chunk) - 1):
            bigram = chunk[i:i + 2]
            if bigram not in STOPWORDS:
                tokens.append(bigram)
    return tokens


def hashtags(text: str) -> List[str]:
    return [h.lower() for h in _HASHTAG_RE.findall(normalize(text))]


def keywords(text: str, top: int = 8) -> List[str]:
    """1 文書内で目立つ語（英数字語 + CJK 名詞候補）を頻度順に。"""
    text = clean_for_tokens(text).lower()
    words: List[str] = []
    for m in _ALNUM_RE.findall(text):
        if len(m) >= 3 and m not in STOPWORDS:
            words.append(m)
    # CJK は 2〜4gram を候補にする（名詞をざっくり拾う）
    for chunk in _CJK_RE.findall(text):
        for n in (4, 3, 2):
            for i in range(len(chunk) - n + 1):
                gram = chunk[i:i + n]
                if gram not in STOPWORDS:
                    words.append(gram)
    counts = Counter(words)
    ranked = [w for w, _ in counts.most_common(top * 3)]
    # より長い採用語に包含される短い断片(例:「アプ」⊂「アプリ」)は落とす
    kept: List[str] = []
    for w in sorted(ranked, key=len, reverse=True):
        if any(w != k and w in k for k in kept):
            continue
        kept.append(w)
    kept.sort(key=lambda w: ranked.index(w))
    return kept[:top]


class TfidfIndex:
    """小さめのコーパス向け TF-IDF ベクトル空間。"""

    def __init__(self, documents: Sequence[str]):
        self.docs_tokens: List[List[str]] = [tokenize(d) for d in documents]
        self.n_docs = len(self.docs_tokens)
        self.df: Counter = Counter()
        for toks in self.docs_tokens:
            for t in set(toks):
                self.df[t] += 1
        self.idf: Dict[str, float] = {
            t: math.log((1 + self.n_docs) / (1 + dfc)) + 1.0
            for t, dfc in self.df.items()
        }
        self.doc_vectors: List[Dict[str, float]] = [
            self._vectorize(toks) for toks in self.docs_tokens
        ]

    def _vectorize(self, tokens: Sequence[str]) -> Dict[str, float]:
        if not tokens:
            return {}
        tf = Counter(tokens)
        total = len(tokens)
        vec = {t: (c / total) * self.idf.get(t, math.log(1 + self.n_docs) + 1.0)
               for t, c in tf.items()}
        norm = math.sqrt(sum(v * v for v in vec.values())) or 1.0
        return {t: v / norm for t, v in vec.items()}

    def vectorize_text(self, text: str) -> Dict[str, float]:
        return self._vectorize(tokenize(text))

    @staticmethod
    def cosine(a: Dict[str, float], b: Dict[str, float]) -> float:
        if not a or not b:
            return 0.0
        # 少ない方を回す
        if len(a) > len(b):
            a, b = b, a
        return sum(v * b.get(t, 0.0) for t, v in a.items())

    def top_terms(self, doc_index: int, top: int = 10) -> List[Tuple[str, float]]:
        vec = self.doc_vectors[doc_index]
        return sorted(vec.items(), key=lambda kv: kv[1], reverse=True)[:top]


def corpus_top_terms(documents: Iterable[str], top: int = 25) -> List[Tuple[str, int]]:
    """コーパス全体で頻出する語（bigram/単語）を返す。話題把握用。"""
    counts: Counter = Counter()
    for doc in documents:
        counts.update(set(tokenize(doc)))
    return counts.most_common(top)
