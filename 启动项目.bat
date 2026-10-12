@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo [反思之旅 V0.5] 正在检查依赖...
if not exist node_modules (
  echo 首次运行，正在执行 npm install...
  call npm install
  if errorlevel 1 pause & exit /b 1
)
if not exist .env.local (
  echo.
  echo [提示] 尚未发现 .env.local。网站仍可用本地认知引擎运行。
  echo 如需真实 AI，请复制 .env.example 为 .env.local 并填写 API Key。
  echo.
)
echo 正在启动开发服务器...
call npm run dev
pause
