@echo off
title LoRA Studio
cd /d "%~dp0"

echo ============================================
echo   LoRA Studio Launcher
echo ============================================
echo.

REM ---- Find Python ----
set PY=
py -3.12 --version >nul 2>&1
if not errorlevel 1 (
    set PY=py -3.12
    goto :pyfound
)
py -3 --version >nul 2>&1
if not errorlevel 1 (
    set PY=py -3
    goto :pyfound
)
python --version >nul 2>&1
if not errorlevel 1 (
    set PY=python
    goto :pyfound
)
echo [ERROR] Python not found!
echo   Please install Python 3.12 from https://python.org
goto :done

:pyfound
for /f "tokens=*" %%v in ('%PY% --version 2^>^&1') do echo [OK] %%v

REM ---- Check ffmpeg ----
ffmpeg -version >nul 2>&1
if errorlevel 1 (
    echo [!] ffmpeg not found — installing via winget...
    winget install Gyan.FFmpeg --accept-package-agreements --accept-source-agreements >nul 2>&1
    ffmpeg -version >nul 2>&1
    if errorlevel 1 (
        echo [!] Install ffmpeg manually: https://ffmpeg.org/download.html
    ) else (
        echo [OK] ffmpeg installed
    )
) else (
    echo [OK] ffmpeg found
)

REM ---- Check GPU ----
nvidia-smi >nul 2>&1
if errorlevel 1 (
    echo [WARNING] NVIDIA GPU not detected!
) else (
    echo [OK] NVIDIA GPU found
)

REM ---- Venv ----
if not exist "venv" (
    echo.
    echo [1/4] Creating virtual environment...
    %PY% -m venv venv
    if errorlevel 1 (
        echo [ERROR] Failed to create venv.
        goto :done
    )
)
call venv\Scripts\activate.bat

REM ---- Dependencies ----
echo [2/4] Installing dependencies...
python -m pip install --upgrade pip --quiet
python -m pip install torch torchvision torchaudio --extra-index-url https://download.pytorch.org/whl/cu128 --quiet
python -m pip install -r requirements.txt --quiet
python -m pip install -r lora-studio\requirements.txt --quiet

REM ---- Models ----
echo [3/4] Checking models...
if not exist "checkpoints\acestep-v15-turbo" (
    echo   Models not found. They will download automatically on first run.
)

REM ---- Start ----
echo [4/4] Starting LoRA Studio...
echo.
echo ============================================
echo   Local: http://localhost:8888
echo   Press Ctrl+C to stop.
echo ============================================
echo.

cd lora-studio
python server.py

:done
echo.
echo Press any key to close...
pause >nul
