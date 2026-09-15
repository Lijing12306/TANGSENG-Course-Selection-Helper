@echo off
chcp 936 >nul
title 选课助手
cd /d "%~dp0"

set "NODE="

rem 1) 优先使用本目录自带的便携版 Node
if exist "%~dp0node\node.exe" set "NODE=%~dp0node\node.exe"

rem 2) 系统 PATH 中的 Node
if not defined NODE for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE set "NODE=%%i"

rem 3) 常见安装位置
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"

if not defined NODE (
  echo.
  echo   [错误] 未检测到 Node.js
  echo.
  echo   请先安装 Node.js 18 或更高版本： https://nodejs.org/
  echo   安装完成后重新双击本文件即可。
  echo.
  echo   ^(进阶：也可以把便携版 node.exe 放到本目录的  node\node.exe^)
  echo.
  pause
  exit /b 1
)

echo.
echo   正在启动选课助手，请稍候……
echo   启动后会自动打开浏览器控制台。
echo   关闭本窗口即停止程序。
echo.
"%NODE%" src\main.js %*

echo.
echo   程序已退出。
pause
