# 🐦 ツイ廃マーケター (tsuihai-marketer)

**「作りたいプロダクト」を入れると、その価値を欲しがるユーザー層を X 上でサンプリングし、
彼らのタイムラインを予測し、自分のツイ廃アカウントの中から"刺さるツイート"を割り出し、
表示率を上げるアクションまで設計する** — ガチガチのデータ分析エンジンです。

ツイート収集は **nob さんの [x-audience-research-kit](https://github.com/nobphotographr/x-audience-research-kit)** に委譲し、
本ツールはその前後の「価値抽出 → オーディエンス設計 → タイムライン予測 → 類似マッチ → アクション予測」を担います。

> 依存パッケージ **0**（Python 3.10+ 標準ライブラリのみ）。nob さんのキットと同じ思想です。

---

## 🧠 何をするのか（パイプライン）

```
 プロダクト定義
      │
 ①価値抽出        value_elements.json     … 機能/情緒/社会の3層で価値を構造化（重み付き）
      │
 ②オーディエンス設計 audience.json           … 価値を欲する100件のユーザー層＋X検索クエリ
      │            research.generated.json  … ★nobキットに渡す収集設定を自動生成
      │
 〜〜〜 ここで nob さんの x-audience-research-kit がツイートを収集 〜〜〜
      │
 ③取り込み        audience_posts.jsonl    … 収集ツイートを正規化
      │
 ④タイムライン予測  timeline_prediction.json… 各層のTLに流れる既存ツイートの"型"を推定
      │
 ⑤自ツイ類似マッチ  matches.json            … 自分のツイ廃垢の中から層に刺さるツイートをTF-IDFで抽出
      │
 ⑥アクション予測    actions.json            … Xのランキングアルゴリズムに基づく表示率UP施策
      │
 レポート          reports/analysis.md     … 全部を1枚のMarkdownに
```

要件との対応:

| あなたの要件 | 担当 |
|---|---|
| プロダクトに含まれる価値の要素を抽出 | ① `values` |
| その価値を必要とするユーザー層を100件サンプリング | ② `audience`（+ nobキットで実収集） |
| そのユーザのツイートを複数件取得 | nobキット `hydrate` / `timelines` → ③ `ingest` |
| タイムラインに表示される既存ツイートを予測 | ④ `timeline` |
| 自分のツイ廃アカウントから似たツイートを割り出す | ⑤ `match` |
| ユーザへの表示率をあげるアクションを予測 | ⑥ `actions` |

---

## 🚀 クイックスタート（APIキー無しでも動く）

サンプルデータで一気通貫を体験できます:

```bash
cd tsuihai-marketer
python3 tmark.py run --config config.demo.json --allow-sample
cat reports/analysis.md
```

`--allow-sample` は、まだ nob キットで収集していないとき `examples/` のサンプルツイートを使います。
LLM 無し（`llm.provider: "none"`）だと価値抽出・タイムライン予測はヒューリスティックにフォールバックします。

---

## 🔑 本番の使い方（Grok / X API 課金あり）

### 1. LLM を有効化（価値抽出・予測・アクション設計の精度が上がる）

`config.json` を作り（`config.example.json` をコピー）、`llm` を設定:

```json
"llm": { "provider": "grok", "model": "grok-3-latest" }
```

環境変数に API キーを入れる（`.env.example` 参照）:

```bash
export XAI_API_KEY=xai-...        # Grok を使う場合
# export ANTHROPIC_API_KEY=sk-... # Claude を使う場合は provider を "anthropic" に
```

### 2. 価値抽出 → オーディエンス設計

```bash
python3 tmark.py values   --config config.json
python3 tmark.py audience --config config.json
```

`data/research.generated.json` が出力されます。**これが nob キットへの受け渡しファイル**です。

### 3. nob さんのキットでツイート収集（X API / Grok 課金）

```bash
git clone https://github.com/nobphotographr/x-audience-research-kit
cd x-audience-research-kit
cp ../tsuihai-marketer/data/research.generated.json research.json
# kit 側の .env に X_BEARER_TOKEN を設定
python3 xark.py doctor
python3 xark.py plan            --config research.json   # 件数プレビュー
python3 xark.py grok-search     --config research.json   # 意味検索で発見
python3 xark.py hydrate         --config research.json   # X API でエンリッチ
python3 xark.py timelines       --config research.json   # アカウントのタイムライン収集
python3 xark.py prepare-analysis --config research.json  # data/processed/posts.jsonl 生成
```

`config.json` の `nob_kit.path` を clone 先に合わせておきます。

### 4. 分析 → レポート

```bash
python3 tmark.py ingest   --config config.json   # posts.jsonl を取り込み
python3 tmark.py timeline --config config.json
python3 tmark.py match    --config config.json
python3 tmark.py actions  --config config.json
python3 tmark.py report   --config config.json
# もしくは全部まとめて:
python3 tmark.py run      --config config.json
```

自分のツイ廃アカウントのツイートは `own_account.timeline_file`（JSONL）に置きます。
nob キットの `timelines` で自分の handle を対象に取得したものをそのまま使えます。

---

## ⚙️ 設定ファイル

```jsonc
{
  "product": {
    "name": "CallMe",
    "category": "生産性 / ADHD支援アプリ",
    "description": "…プロダクトの説明（価値抽出の入力になる）…"
  },
  "own_account": {
    "handle": "@my_tsuihai_account",
    "timeline_file": "data/own_timeline.jsonl"   // 自分のツイ廃垢のツイート(JSONL)
  },
  "audience": { "sample_size": 100, "language": "ja" },
  "llm": { "provider": "grok", "model": "grok-3-latest" },  // "anthropic" | "none"
  "nob_kit": { "path": "../x-audience-research-kit", "data_dir": "data/processed" }
}
```

---

## 🔬 分析ロジックの中身（"ガチガチ"の部分）

- **価値抽出**: 機能的 / 情緒的 / 社会的価値の3層 ＋ Jobs-To-Be-Done ＋ 解消する痛み ＋ 重み。
- **タイムライン予測**: 収集ツイートを TF-IDF でセグメントに割り当て、頻出トピック・ハッシュタグ・
  エンゲージメント統計（中央値/平均/p90・メディアリフト）・コンテンツの型（質問/共感/情報/実況…）を集計し、
  in-network / For-You で流れてくる投稿を推定。
- **類似マッチ**: 自ツイートを TF-IDF ベクトル化し、各層のTL語彙とのコサイン類似度で並べ替え。
  日本語は文字 bigram でトークナイズするため MeCab 等の外部依存は不要。
- **アクション予測**: X が公開したランキングアルゴリズムの既知シグナル
  （本人返信 ~+75x / RT ~+20x / メディア加点 / 外部リンク減点 / recency 半減期 /
  ネガティブフィードバック大幅減点 など）をルール化し、自アカウント診断＋層別施策を出力。

---

## 📁 ファイル構成

```
tsuihai-marketer/
├── tmark.py                     # CLI エントリ（doctor/values/audience/ingest/timeline/match/actions/report/run）
├── config.example.json          # 設定テンプレ
├── config.demo.json             # サンプルデータで動くデモ設定
├── .env.example
├── src/tsuihai_marketer/
│   ├── llm.py                   # Grok/Claude ラッパー（urllib のみ）
│   ├── textutil.py              # 日本語対応 TF-IDF / コサイン類似度
│   ├── config.py                # 設定 & I/O
│   ├── ingest.py                # nobキット出力の正規化
│   ├── value_extraction.py      # ①価値抽出
│   ├── audience.py              # ②オーディエンス設計 + research.json 生成
│   ├── timeline_predict.py      # ④タイムライン予測
│   ├── similarity.py            # ⑤自ツイ類似マッチ
│   ├── actions.py               # ⑥アクション予測
│   └── report.py                # レポート生成
└── examples/                    # サンプルツイート（動作確認用）
```

---

## 🙏 クレジット

- ツイート収集: **nob さん / [x-audience-research-kit](https://github.com/nobphotographr/x-audience-research-kit)**
  （X Premium / X API の課金が必要です）
- 本ツールは収集データを前提に、価値抽出〜アクション設計を行う分析レイヤーです。

## 📝 注意

- 公開情報（public tweets）の分析用途です。X の利用規約・API 規約、各国の法令、
  プライバシーに配慮して使ってください。個人を狙い撃つ用途や大量の自動化には使わないこと。
- `.env` と `data/` の収集データは `.gitignore` 済みです。コミットしないよう注意。
