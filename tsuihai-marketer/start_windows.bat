@echo off
REM ツイ廃マーケター ローカル起動（Windows 用・ダブルクリックで実行）
cd /d "%~dp0"
echo ツイ廃マーケターを起動します...（ブラウザが自動で開きます）
echo 終了はこのウィンドウで Ctrl+C、または閉じてください。
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 tmark_web.py
) else (
  where python >nul 2>nul
  if %errorlevel%==0 (
    python tmark_web.py
  ) else (
    echo Python が見つかりません。https://www.python.org からインストールしてください。
    pause
  )
)
