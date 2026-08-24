#!/bin/bash
# ツイ廃マーケター ローカル起動（Mac / Linux 用・ダブルクリックで実行）
# 初回だけ：右クリック→開く で許可（未署名のため）。
cd "$(dirname "$0")"
echo "ツイ廃マーケターを起動します…（ブラウザが自動で開きます）"
echo "終了はこのウィンドウで Ctrl+C、または閉じてください。"
if command -v python3 >/dev/null 2>&1; then
  python3 tmark_web.py
else
  echo "Python3 が見つかりません。https://www.python.org からインストールしてください。"
  read -n 1 -s -r -p "何かキーを押すと閉じます"
fi
