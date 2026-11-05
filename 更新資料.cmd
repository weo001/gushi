@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem 手動更新今天的資料（金鑰放在 pipeline\.env，會自動讀：GROQ_API_KEY、MASSIVE_API_KEY）
echo ==== 台股 ====
node pipeline\build.js
echo ==== 陸股 ====
set PYTHONIOENCODING=utf-8
python pipeline\cn_fetch.py && node pipeline\cn.js
echo ==== 美股 ====
node pipeline\us.js
pause
