@echo off
setlocal DisableDelayedExpansion
set ELECTRON_RUN_AS_NODE=
if "%~1"=="--settings" goto desktop
if "%~1"=="--keybindings" goto desktop
set ELECTRON_RUN_AS_NODE=1
"%~dp0proper-karaoke-booth.exe" "%~dp0resources\control\cli.cjs" %*
exit /b %errorlevel%
:desktop
start "" /B "%~dp0proper-karaoke-booth.exe" %*
exit /b %errorlevel%
