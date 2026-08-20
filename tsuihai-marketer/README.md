# 🐦 ツイ廃マーケター (tsuihai-marketer)

**「作りたいプロダクト」を入れると、その価値を欲しがるユーザー層を X 上でサンプリングし、
彼らのタイムラインを予測し、自分のツイ廃アカウントの中から"刺さるツイート"を割り出し、
表示率を上げるアクションまで設計する** — ガチガチのデータ分析エンジンです。

> **🔵 このブランチは Grok 抽出版です。** ツイート収集を **Grok(xAI) の Live Search だけ**で行い、
> nob さんのキットや X API(Bearer) を使いません。必要な鍵は **`XAI_API_KEY` のみ**。
> （X API で厳密な public_metrics を使う版は `claude/twitter-marketer-analyzer-qgve19` ブランチにあります。）

本ツールは 価値抽出 → オーディエンス設計 → **Grokでツイート抽出** → タイムライン予測 →
類似マッチ → ユーザー別TOP出し → アクション予測 を一気通貫で行います。

> 依存パッケージ **0**（Python 3.10+ 標準ライブラリのみ）。

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
 ③Grokでツイート抽出 audience_posts.jsonl    … 【Grok Live Search】各層の実在ユーザーとその投稿を抽出
      │            own_timeline.jsonl      …          ＋自分のツイ廃垢のTLも抽出
      │            sampled_users.json      …          抽出ユーザー台帳＋Grokの引用(citations)
      │
 ④タイムライン予測  timeline_prediction.json… 各層のTLに流れる既存ツイートの"型"を推定
      │
 ⑤自ツイ類似マッチ  matches.json            … 自分のツイ廃垢の中から層に刺さるツイートをTF-IDFで抽出
      │            targets.json  ★         … ユーザー1人単位のTOP出し（ネットワーク＋類似度でreach順）
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
| そのユーザのツイートを複数件取得 | ③ `collect`（Grok Live Search で抽出） |
| タイムラインに表示される既存ツイートを予測 | ④ `timeline` |
| 自分のツイ廃アカウントから似たツイートを割り出す | ⑤ `match`（層単位）／`target`（ユーザー単位のTOP出し★） |
| ユーザへの表示率をあげるアクションを予測 | ⑥ `actions` ＋ `target`（生成ツイート・ネットワーク行動） |

### ★ 核心：ユーザー単位の「TOP出し」（`target`）

Xはネットワーク（グラフ）で表示が決まる。あるユーザーのTLには、そのユーザーが絡む相手
（＝@メンションで近似したネットワーク隣人）に流れている内容が出る。だから
**「そのユーザーのTLに一番“溶け込む”自分のツイ廃履歴」を類似度でTOP出し**すれば、
それが最も表示されやすい候補になる、という仮説。`target` は各ユーザーについて
`reach_score = 最大類似度 × ネットワーク到達性` を出し、狙うべき順に並べます。
LLMがあれば「溶け込む新規ツイート案」と「誰に絡めば届くか（ネットワーク行動）」も生成します。

```bash
python3 tmark.py target --config config.json              # LLMで生成込み
python3 tmark.py target --config config.json --no-generate # 類似度TOP出しのみ
```

### 🌐 ブラウザで触れるデモ（webdemo.html）

`webdemo.html` は、サンプルデータを埋め込み、**ブラウザ内でTF-IDF類似度を計算する
「ユーザー別TOP出し」のインタラクティブデモ**です（Claude Artifact として公開可能・API不要）。
ローカルなら `open webdemo.html`、もしくはそのまま Artifact 化して共有できます。

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

## 🔑 本番の使い方（Grok 課金のみ）

### 1. 環境変数を設定（`.env.example` 参照）

```bash
export XAI_API_KEY=xai-...   # これ1つだけ。価値抽出・ツイート抽出・予測すべてに使う
```

`config.json` を作り（`config.example.json` をコピー）、次の2箇所を確認:

```json
"llm":        { "provider": "grok", "model": "grok-3-latest" },
"collection": { "provider": "grok", "posts_per_user": 15 }
```

### 2. 全自動で回す

```bash
python3 tmark.py run --config config.json
```

これだけで **①価値抽出 → ②オーディエンス設計 → ③Grokでツイート抽出
（各層に合う実在ユーザーとその投稿を Live Search で抽出＋自分のツイ廃垢のTLも抽出）
→ ④TL予測 → ⑤類似マッチ → ⑥ユーザー別TOP出し → ⑦アクション → レポート**
まで一気通貫します。`data/sampled_users.json` に抽出ユーザー台帳と Grok の引用(citations)も残ります。

収集だけ単独で回すこともできます:

```bash
python3 tmark.py collect --config config.json           # Grok抽出（自TLも）
python3 tmark.py collect --config config.json --no-own  # 自TL抽出はスキップ
```

### 3. Grok 抽出の仕組み

`grok_extract.py` が Grok chat completions の `search_parameters`（`sources:[{type:"x"}]`）を使い、
各セグメントについて「該当する実在ユーザー＋最近の投稿」を構造化 JSON で返させます。
自TLは `included_x_handles:[あなたのhandle]` で対象を絞って抽出します。

> ⚠️ Grok による検索・要約ベースの抽出なので、エンゲージメントは**概算**です。
> 厳密な public_metrics が必要なら X API 版ブランチ（`collection.provider:"xapi"` ＋ `X_BEARER_TOKEN`）を使ってください。
> なお `--provider xapi` を付ければこのブランチでも X API 収集に切り替えられます。

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
├── tmark.py                     # CLI（doctor/values/audience/collect/ingest/timeline/match/actions/report/run）
├── config.example.json          # 設定テンプレ
├── config.demo.json             # サンプルデータで動くデモ設定
├── .env.example
├── src/tsuihai_marketer/
│   ├── llm.py                   # Grok/Claude ラッパー（urllib のみ）
│   ├── textutil.py              # 日本語対応 TF-IDF / コサイン類似度
│   ├── config.py                # 設定 & I/O
│   ├── grok_extract.py          # ③Grok Live Search 抽出（★このブランチの主役）
│   ├── xclient.py               # ③X API v2 クライアント（--provider xapi 用・任意）
│   ├── collect.py               # ③収集オーケストレーション（provider分岐）
│   ├── ingest.py                # ツイートデータの正規化
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
