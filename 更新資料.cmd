@echo off
cd /d "%~dp0"
rem 手動更新今天的資料（Groq 金鑰放在 pipeline\.env，會自動讀）
node pipeline\build.js
pause
