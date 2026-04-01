@echo off
title LoRA Studio
cd /d "%~dp0"

REM Log everything to file
set LOGFILE=%~dp0lora-studio.log
echo. > "%LOGFILE%"
echo LoRA Studio started at %date% %time% >> "%LOGFILE%"
call :main >> "%LOGFILE%" 2>&1
echo.
echo ============================================
echo   Server stopped.
echo   Log saved to: %LOGFILE%
echo ============================================
echo.
echo Press any key to close...
pause >nul
exit /b

:main
echo ============================================
echo   LoRA Studio Launcher
echo ============================================
echo.

REM ---- Check Python ----
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found!
    echo.
    echo   Please install Python 3.10+ from https://python.org
    echo   Make sure to check "Add Python to PATH" during install.
    echo.
    exit /b 1
)
echo [OK] Python found

REM ---- Check ffmpeg ----
ffmpeg -version >nul 2>&1
if errorlevel 1 (
    echo [!] ffmpeg not found — needed for video creation and audio processing
    echo     Attempting to install via winget...
    winget install Gyan.FFmpeg --accept-package-agreements --accept-source-agreements >nul 2>&1
    ffmpeg -version >nul 2>&1
    if errorlevel 1 (
        echo [!] Auto-install failed. Please install manually:
        echo     https://ffmpeg.org/download.html
        echo     Or: winget install Gyan.FFmpeg
        echo.
    ) else (
        echo [OK] ffmpeg installed successfully
    )
) else (
    echo [OK] ffmpeg found
)

REM ---- Check NVIDIA GPU ----
nvidia-smi >nul 2>&1
if errorlevel 1 (
    echo [WARNING] NVIDIA GPU not detected!
    echo   LoRA Studio requires an NVIDIA GPU with 8GB+ VRAM.
    echo   Install drivers from: https://www.nvidia.com/drivers
    echo.
) else (
    echo [OK] NVIDIA GPU found
)

REM ---- Create/activate venv ----
if not exist "venv" (
    echo.
    echo [1/4] Creating virtual environment...
    python -m venv venv
    if errorlevel 1 (
        echo [ERROR] Failed to create venv.
        exit /b 1
    )
)
call venv\Scripts\activate.bat

REM ---- Install dependencies ----
echo [2/4] Installing dependencies (first run may take a few minutes)...
pip install -r requirements.txt --quiet 2>nul
pip install -r lora-studio\requirements.txt --quiet 2>nul

REM ---- Check models ----
echo [3/4] Checking models...
if not exist "checkpoints\acestep-v15-turbo" (
    echo   Models not found. The setup wizard will download them.
)

REM ---- Start ----
echo [4/4] Starting LoRA Studio...
echo.
echo   Local:   http://localhost:8888
echo.

cd lora-studio
python server.py
exit /b
