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
 ③ツイート収集      audience_posts.jsonl    … 【自動】X APIでサンプリング＋各ユーザーのTL取得
      │            own_timeline.jsonl      …          ＋自分のツイ廃垢のTLも自動取得
      │            （X_BEARER_TOKEN無しなら nob キットで収集 → 正規化取り込み）
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
| そのユーザのツイートを複数件取得 | ③ `collect`（X API直叩き・自動）または nobキット→ `ingest` |
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

## 🔑 本番の使い方（Grok / X API 課金あり）

### 1. 環境変数を設定（`.env.example` 参照）

```bash
export XAI_API_KEY=xai-...        # 価値抽出・予測・アクション設計に使う Grok
# export ANTHROPIC_API_KEY=sk-... # Claude を使う場合は config の provider を "anthropic" に
export X_BEARER_TOKEN=...         # ★これがあると ③収集が全自動になる（X API 課金が必要）
```

`config.json` を作り（`config.example.json` をコピー）、`llm.provider` を `"grok"` に。

### 2. 全自動で回す（推奨）

```bash
python3 tmark.py run --config config.json
```

これだけで **①価値抽出 → ②オーディエンス設計 → ③X APIでツイート収集
（オーディエンスのサンプリング＋各ユーザーのTL取得＋自分のツイ廃垢のTL取得）
→ ④TL予測 → ⑤類似マッチ → ⑥アクション → レポート** まで一気通貫します。

`X_BEARER_TOKEN` があるかどうかで収集方式が自動で切り替わります:
- **あり** → `collect`（X API v2 を直接叩いて自動収集）
- **なし** → `ingest`（後述の nob キットで収集したデータを取り込み）

収集だけ単独で回すこともできます:

```bash
python3 tmark.py collect --config config.json          # 自動収集（自TLも取得）
python3 tmark.py collect --config config.json --no-own # 自TL収集はスキップ
```

`collect` は `data/sampled_users.json`（サンプリングしたユーザー台帳）も残します。
`config.json` の `collection.posts_per_user`（既定20）で 1 ユーザーあたりの取得件数を調整できます。

### 3.（任意）nob さんのキットで収集する場合

X API を直接使わず nob さんの [x-audience-research-kit](https://github.com/nobphotographr/x-audience-research-kit)
で収集したいときは、`audience` が出力する `data/research.generated.json` を渡します:

```bash
python3 tmark.py values   --config config.json
python3 tmark.py audience --config config.json          # research.generated.json を出力
git clone https://github.com/nobphotographr/x-audience-research-kit
cd x-audience-research-kit
cp ../tsuihai-marketer/data/research.generated.json research.json
python3 xark.py plan --config research.json   # 以下 grok-search → hydrate → timelines → prepare-analysis
cd -
python3 tmark.py run --config config.json --no-collect  # nob キット出力を取り込んで分析
```

`config.json` の `nob_kit.path` / `nob_kit.data_dir` を clone 先に合わせておきます。

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
  "collection": { "posts_per_user": 15 },
  "budget": {                       // ★円建て予算・上限
    "currency": "JPY", "usd_jpy": 155,
    "per_run_limit_jpy": 2500,      // 1回の実行あたり上限（超えたら自動停止）
    "monthly_limit_jpy": 10000,     // 月あたり上限（到達で中止）
    "enforce": true,
    "prices_usd": { "post_read": 0.005, "user_read": 0.010 }  // X API従量課金の単価
  },
  "llm": { "provider": "grok", "model": "grok-3-latest" },  // "anthropic" | "none"
  "nob_kit": { "path": "../x-audience-research-kit", "data_dir": "data/processed" }
}
```

---

## 💴 予算（円建て・上限つき）

X API は 2026 年に**従量課金が既定**になりました（新規は定額 Basic/Pro 不可）。読み取り課金が実費になるため、
本ツールは**円で見積もり、設定した上限で自動的に収集を止めます**（実費が予算を超えません）。

```bash
# 実行前に「1回いくら」を円で確認（--sample-size / --posts-per-user で試算も）
python3 tmark.py cost --config config.json
python3 tmark.py cost --config config.json --sample-size 20 --posts-per-user 10
```

- **上限の効き方**: `collect`/`run` は実行中の実費（**ユーザー読み取り費用も込み**）を監視し、
  `per_run_limit_jpy`（1回）と `monthly_limit_jpy`（月）の小さい方を超える前にユーザー取得を止めます。
  検索サイズも残予算に合わせて縮小するので、**設定した円を超えません**。
- **月次台帳**: 実費は `data/spend_ledger.json` に月ごとに累積。月上限に達すると次回以降は中止します。
- **単価・為替は変動**します。`budget.prices_usd` と `usd_jpy` を[公式ポータル](https://developer.x.com)の実額に合わせてください。
- お試しは `--sample-size 20 --posts-per-user 10`（≈¥900/回）で精度を見てから本番（100人）へ。

> 目安（為替155円）: **20人×10 ≈ ¥900 / 100人×15 ≈ ¥2,700 / 1回**。読み取りのみで投稿はしないため、
> 投稿課金（リンク投稿 $0.20 等）は一切かかりません。

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
├── tmark.py                     # CLI（doctor/cost/values/audience/collect/ingest/timeline/match/target/actions/report/run）
├── config.example.json          # 設定テンプレ
├── config.demo.json             # サンプルデータで動くデモ設定
├── .env.example
├── src/tsuihai_marketer/
│   ├── llm.py                   # Grok/Claude ラッパー（urllib のみ）
│   ├── textutil.py              # 日本語対応 TF-IDF / コサイン類似度
│   ├── config.py                # 設定 & I/O
│   ├── budget.py                # 💴円建て予算・見積り・上限・月次台帳
│   ├── xclient.py               # ③X API v2 クライアント（Bearer / urllib のみ・読み取り数を計測）
│   ├── collect.py               # ③自動収集（サンプリング＋TL取得＋自TL取得）
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
