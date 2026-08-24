# 🚀 初回テスト実行ガイド（お試し20人・約¥900）

キー（X_BEARER_TOKEN など）は **自分のPCの環境変数** に入れて実行します。
**チャットや共有ページには貼らないでください**（漏洩防止）。

---

## 🖱 いちばん簡単：ダブルクリックで起動（ターミナルにコマンドを打たない）

**あなたのPCで動くWebアプリ**です。キーはこのPC内だけに保持され、外部やブラウザには出ません。
ターミナルに命令を打つ必要はありません。**起動ファイルをダブルクリックするだけ**：

1. **Python を入れる**（初回だけ）: <https://www.python.org/downloads/> から入れる（Macは元から入っていることが多い）
2. **キーをファイルに書く**（初回だけ）: `tsuihai-marketer` フォルダの `.env.example` を **`.env`** という名前でコピーして、
   テキストエディタで開き、キーを書く：
   ```
   X_BEARER_TOKEN=あなたのBearerトークン
   XAI_API_KEY=あなたのGrokキー
   ```
   （キーをファイルに書きたくなければ空のままでもOK。あとで画面のフォームに入れられます）
3. **起動ファイルをダブルクリック**：
   - **Mac** → `start_mac.command`（初回だけ「右クリック→開く」で許可）
   - **Windows** → `start_windows.bat`
4. **ブラウザが自動で開きます**（`http://127.0.0.1:8787`）。プロダクト・自分のhandle・人数・予算を入れて
   「実行する」を押すと、X APIで収集（予算内で自動停止）→ **ユーザー別TOP出し** が画面に出ます。
5. 終わったら、開いた黒いウィンドウを閉じれば停止します。

> これは**手元で動くローカルアプリ**だからキー入力＆実行ができます。
> claude.ai上の**公開アーティファクトは外部通信不可**なので、そちらはCLIが出力した
> `data/` のJSONLを読み込む方式です（下のCLI手順の6）。

コマンドで起動したい人は `python3 tmark_web.py` でも同じです。

---

## 🧰 CLIで回す（自動化・スクリプト向き）

## 0. 前提

- Python 3.10 以上
- X API を契約して **Bearer Token** を取得済み（[developer.x.com](https://developer.x.com)）
- 精度のため LLM キーも推奨: **Grok**(`XAI_API_KEY`) か **Claude**(`ANTHROPIC_API_KEY`)
  - LLM 無しでも動きますが、検索クエリが弱く精度が落ちます

## 1. 取得

```bash
git clone https://github.com/yuka1369/hiroubo
cd hiroubo
git checkout claude/twitter-marketer-analyzer-qgve19
cd tsuihai-marketer
```

## 2. config を自分用に（1か所だけ編集）

`config.myrun.json` の `own_account.handle` を**自分のツイ廃アカウント**に変更:

```jsonc
"own_account": { "handle": "@あなたのhandle", "timeline_file": "data/own_timeline.jsonl" }
```

（product は CallMe のまま。自分のプロダクトなら name/description も書き換え）

## 3. キーを環境変数に（このシェルだけ・チャットに貼らない）

```bash
export X_BEARER_TOKEN='※あなたのBearerトークン'
export XAI_API_KEY='※あなたのGrokキー'      # 無ければ config の llm.provider を "none" に
```

## 4. 事前チェック（お金はかからない）

```bash
python3 tmark.py doctor --config config.myrun.json   # キーが SET か確認
python3 tmark.py cost   --config config.myrun.json   # 「1回いくら」を円で確認（お試しは約¥900）
```

`doctor` で `X_BEARER_TOKEN: set` と `収集モード: X API 自動収集` が出ればOK。

## 5. 本番実行（ここで初めて課金・予算内で自動停止）

```bash
python3 tmark.py run --config config.myrun.json
```

- 予算上限（1回¥1,500 / 月¥5,000）を超える前に自動で止まります
- 実費は `data/spend_ledger.json` に記録され、完了時に「実費 ¥◯◯」が出ます

### できるもの（`data/` と `reports/`）
| ファイル | 中身 |
|---|---|
| `data/audience_posts.jsonl` | 集めたオーディエンスの本物ツイート |
| `data/own_timeline.jsonl` | あなたのツイ廃履歴 |
| `data/targets.json` | ユーザー別TOP出し（reach順） |
| `reports/analysis.md` | 総合レポート |

## 6. アーティファクトで本物データを見る

<https://claude.ai/code/artifact/0f458075-d1cf-435e-9c95-ff613c116db6>

「**本物データを読み込む**」タブ →
`data/audience_posts.jsonl` と `data/own_timeline.jsonl`（任意で `data/sampled_users.json`）を
選択 → 本物データでユーザー別TOP出し。

---

## 困ったら

- `X_BEARER_TOKEN: NOT set` → `export` し直す（同じシェルで実行しているか確認）
- 429 レート制限 → 自動で待機します。頻発するならプランのレート上限を確認
- 予算で途中停止 → `config.myrun.json` の `budget.per_run_limit_jpy` を上げる
- サンプル数を増やす → `audience.sample_size` を 100 に（費用は `cost` で再確認、約¥2,700）
