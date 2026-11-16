@echo off
title BlueMart Python Local Server - ORG | UNK
echo Starting BlueMart Local Server...
python server.py
if errorlevel 1 (
    echo.
    echo Trying py launcher...
    py server.py
)
pause
