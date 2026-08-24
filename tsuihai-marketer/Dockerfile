# ツイ廃マーケター ローカルWebアプリを GCP Cloud Run 等で動かすための最小イメージ。
# 依存パッケージ0（標準ライブラリのみ）なので requirements 不要。
FROM python:3.12-slim

WORKDIR /app
COPY . /app

# クラウドでは全インターフェースで待ち受け、PORT は実行環境が注入する
ENV TMARK_HOST=0.0.0.0
ENV PORT=8080
EXPOSE 8080

# APP_PASSWORD / X_BEARER_TOKEN / XAI_API_KEY はデプロイ時の環境変数で渡す
CMD ["python", "tmark_web.py"]
