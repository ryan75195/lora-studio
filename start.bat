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

REM ---- Find Python (try py -3.12, then py -3, then python) ----
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
echo.
echo   Please install Python 3.12 from https://python.org
echo   Make sure to check "Add Python to PATH" during install.
echo.
exit /b 1

:pyfound
for /f "tokens=*" %%v in ('%PY% --version 2^>^&1') do echo [OK] %%v

REM ---- Check platform ----
%PY% -c "import sys; assert sys.platform=='win32'" >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Wrong Python detected! You may have WSL or Linux Python.
    exit /b 1
)

REM ---- Check ffmpeg ----
ffmpeg -version >nul 2>&1
if errorlevel 1 (
    echo [!] ffmpeg not found — attempting install via winget...
    winget install Gyan.FFmpeg --accept-package-agreements --accept-source-agreements >nul 2>&1
    ffmpeg -version >nul 2>&1
    if errorlevel 1 (
        echo [!] Install ffmpeg manually: https://ffmpeg.org/download.html
        echo.
    ) else (
        echo [OK] ffmpeg installed
    )
) else (
    echo [OK] ffmpeg found
)

REM ---- Check NVIDIA GPU ----
nvidia-smi >nul 2>&1
if errorlevel 1 (
    echo [WARNING] NVIDIA GPU not detected!
    echo   Install drivers from: https://www.nvidia.com/drivers
    echo.
) else (
    echo [OK] NVIDIA GPU found
)

REM ---- Create/activate venv ----
if not exist "venv" (
    echo.
    echo [1/4] Creating virtual environment...
    %PY% -m venv venv
    if errorlevel 1 (
        echo [ERROR] Failed to create venv.
        exit /b 1
    )
)
call venv\Scripts\activate.bat

REM ---- Install dependencies ----
echo [2/4] Installing dependencies (first run may take a few minutes)...
python -m pip install --upgrade pip --quiet
python -m pip install torch torchvision torchaudio --extra-index-url https://download.pytorch.org/whl/cu128 --quiet
python -m pip install -r requirements.txt --quiet
python -m pip install -r lora-studio\requirements.txt --quiet

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
