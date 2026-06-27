@echo off
REM Double-click to start the NebulaTerm device lab (simulated Telnet + SSH devices).
cd /d "%~dp0"
title NebulaTerm device lab
node scripts\lab.js
echo.
echo Lab stopped. Press any key to close.
pause >nul
