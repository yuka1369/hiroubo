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

## 💾 データを永続化する（実行結果・履歴・月次台帳を残す）

Cloud Run はディスクが毎回リセットされるので、そのままだと収集データや履歴が消えます。
**GCS バケットをマウント**して永続化します。環境変数 `TMARK_DATA_ROOT` をそのマウント先に向けると、
アプリは実行ごとに `TMARK_DATA_ROOT/<日時>/` に結果を保存し、画面下の「履歴」から過去の実行を再表示できます。
月次予算の台帳もここに置かれ、リクエストをまたいで正しく累積します。

### 1. バケットを作る（世界で一意な名前に）
```bash
gcloud storage buckets create gs://tsuihai-krokodama-data --location=asia-northeast1
```

### 2. バケットをマウントしてデプロイ
```bash
PW='好きな合言葉'
XT='あなたのBearer'
gcloud run deploy tsuihai-marketer \
  --source . --region asia-northeast1 --allow-unauthenticated \
  --memory 512Mi --cpu 1 --timeout 900 \
  --add-volume=name=tmarkdata,type=cloud-storage,bucket=tsuihai-krokodama-data \
  --add-volume-mount=volume=tmarkdata,mount-path=/data \
  --set-env-vars TMARK_HOST=0.0.0.0,TMARK_DATA_ROOT=/data,APP_PASSWORD=$PW,X_BEARER_TOKEN=$XT
```

これで、サイトで実行した結果は GCS バケットに残り、**履歴として何度でも見返せます**。
（バケットへのアクセス権が足りないとデプロイ後にエラーになる場合があります。その時は
Cloud Run のサービスアカウントにそのバケットの「Storage オブジェクト管理者」を付与してください。）

## 予算の注意

- **1回あたりの上限（`per_run_limit_jpy`）は毎回きっちり効きます**（収集中の実費を監視して自動停止）。
- **月あたりの上限**も、上のGCSマウントで台帳を永続化すれば**リクエストをまたいで累積**します
  （マウント無しだと毎回リセットされ月次は効きません）。

---

## 更新したいとき
コードを直したら、Cloud Shell で同じ `gcloud run deploy ...` をもう一度実行すれば新版に置き換わります。

## 止めたい / 消したいとき
```bash
gcloud run services delete tsuihai-marketer --region asia-northeast1
```
