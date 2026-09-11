@echo off
chcp 65001 >nul
title 留言板服务器 - Wang Yutong
cd /d "%~dp0"
"%~dp0tools\python\python.exe" "%~dp0server.py"
echo.
echo 服务器已退出，按任意键关闭窗口...
pause >nul
