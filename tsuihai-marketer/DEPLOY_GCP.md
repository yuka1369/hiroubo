# ☁️ GCP（Cloud Run）で動かす — ブラウザだけで完結

自分のPCのターミナルもMacの開発ツールも不要。**GCPのCloud Shell（ブラウザ内ターミナル）**から
Cloud Run にデプロイすると、**常時使えるURL**になります。キーはCloud Run側に安全に保持されます。

> Cloud Run はアイドル時は0スケール（起動していない）ので、使わない間の料金はほぼ¥0。
> 無料枠も大きいので、個人利用ならほぼ無料〜わずかです（X APIの従量課金は別途）。

---

## 手順（全部ブラウザ）

### 1. 準備
- [console.cloud.google.com](https://console.cloud.google.com) にログイン
- プロジェクトを作成（または選択）し、**課金を有効化**（Cloud Run/Build に必要）

### 2. Cloud Shell を開く
- 画面右上の **`>_`（Cloud Shellを有効にする）** アイコンをクリック → ブラウザ内にターミナルが開く
  （ここが「あなたのPCのターミナルの代わり」。Mac の xcode 等は一切不要）

### 3. デプロイ（コマンドは1つ）
Cloud Shell に貼り付け（`◯◯` を自分の値に置き換え）:

```bash
git clone https://github.com/yuka1369/hiroubo
cd hiroubo/tsuihai-marketer
git checkout claude/twitter-marketer-analyzer-qgve19

gcloud run deploy tsuihai-marketer \
  --source . \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --memory 512Mi --cpu 1 --timeout 900 \
  --set-env-vars TMARK_HOST=0.0.0.0,APP_PASSWORD=好きな合言葉,X_BEARER_TOKEN=あなたのBearer,XAI_API_KEY=あなたのGrokキー
```

- 途中で API 有効化やリージョンを聞かれたら `y` / 指示に従う
- 完了すると **Service URL**（`https://tsuihai-marketer-xxxx.a.run.app`）が表示される

### 4. 使う
- その URL をブラウザで開く → **アクセスパスワード**（`APP_PASSWORD` に入れた合言葉）を入力
- プロダクト・自分のhandle・人数・予算を入れて「実行する」→ 本物データでTOP出し

---

## セキュリティ（重要）

- **必ず `APP_PASSWORD` を設定**してください。公開URLなので、これが無いと他人があなたの
  X API 予算を使えてしまいます。合言葉を知っている人だけが実行できます。
- さらに堅くするなら、`--allow-unauthenticated` を外して IAM 認証にする、
  またはキーを **Secret Manager** で渡す（下記）方法があります。

### キーを Secret Manager で渡す（より安全・任意）
```bash
printf 'あなたのBearer' | gcloud secrets create X_BEARER_TOKEN --data-file=-
printf 'あなたのGrokキー' | gcloud secrets create XAI_API_KEY   --data-file=-

gcloud run deploy tsuihai-marketer \
  --source . --region asia-northeast1 --allow-unauthenticated \
  --memory 512Mi --cpu 1 --timeout 900 \
  --set-env-vars TMARK_HOST=0.0.0.0,APP_PASSWORD=好きな合言葉 \
  --set-secrets X_BEARER_TOKEN=X_BEARER_TOKEN:latest,XAI_API_KEY=XAI_API_KEY:latest
```

---

## 予算の注意（クラウド特有）

- **1回あたりの上限（`per_run_limit_jpy`）は毎回きっちり効きます**（収集中の実費を監視して自動停止）。
  これは画面のフォームで指定する上限で、クラウドでも有効です。
- **月あたりの上限**は、Cloud Run はディスクが毎回リセットされるため**リクエストをまたいで
  累積しません**（月次台帳が保存されない）。当面は「1回の上限 × 実行回数」で管理してください。
  月次を厳密に持たせたい場合は GCS か Firestore に台帳を置く拡張が必要です（希望あれば対応します）。

---

## 更新したいとき
コードを直したら、Cloud Shell で同じ `gcloud run deploy ...` をもう一度実行すれば新版に置き換わります。

## 止めたい / 消したいとき
```bash
gcloud run services delete tsuihai-marketer --region asia-northeast1
```
