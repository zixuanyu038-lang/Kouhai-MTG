@echo off
chcp 65001 >nul
setlocal
set "APP_ROOT=%~dp0..\.."
set "ENDSTEP_FORGE_RUNTIME=%APP_ROOT%\runtime"
set "APP_DATA=%LOCALAPPDATA%\EndstepReplayLab\data"
if /i "%~1"=="rollback" (
  "%APP_ROOT%\node.exe" "%APP_ROOT%\endstep-reader\forge\update-runtime.cjs" rollback "%APP_DATA%"
) else if "%~1"=="" (
  echo 请把下载好的官方 forge-installer-版本.tar.bz2 拖到本文件。
  echo 回退时在终端运行 Update-Forge.cmd rollback
) else (
  "%APP_ROOT%\node.exe" "%APP_ROOT%\endstep-reader\forge\update-runtime.cjs" install "%~f1" "%APP_DATA%"
)
pause
