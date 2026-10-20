@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "RJ_NODE=node"
if exist "%~dp0runtime\node.exe" set "RJ_NODE=%~dp0runtime\node.exe"
"%RJ_NODE%" -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major>24||(major===24&&minor>=13)?0:1)"
if errorlevel 1 (
  echo 请使用随附 Windows 运行版，或安装 Node.js 24.13 及以上版本。
  pause
  exit /b 1
)
if not exist dist\index.html (
  if exist "%~dp0runtime\node.exe" (
    echo 运行包缺少构建文件。请重新完整解压 Windows 运行版。
    goto failed
  )
  echo 正在准备源码运行环境，请保持网络连接...
  call npm ci
  if errorlevel 1 goto failed
  call npm run build
  if errorlevel 1 goto failed
)
echo 反思之旅 正在启动...
"%RJ_NODE%" scripts\start-local.mjs %*
if errorlevel 1 goto failed
exit /b 0
:failed
echo.
echo 启动尚未完成，请按上方提示检查。现有配置和记录没有被覆盖。
pause
exit /b 1
