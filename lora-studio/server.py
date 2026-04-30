"""LoRA Studio - FastAPI backend for ACE-Step 1.5."""

import os
import sys
import logging
import traceback
from pathlib import Path as _Path

# Fix Windows console encoding for Unicode characters (emojis in ACE-Step output)
os.environ.setdefault("PYTHONIOENCODING", "utf-8")
if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

# --- Logging setup (early, before any imports that might log) ---
_log_path = _Path(__file__).parent.parent / "lora-studio.log"
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(str(_log_path), encoding="utf-8"),
    ],
)
logger = logging.getLogger("lora-studio")

import threading

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from services.config import STATIC_BUILD, STATIC_LEGACY, SERVER_HOST, SERVER_PORT
from services import models as _models
from services import queue as _queue

from routes.artists import router as artists_router
from routes.training import router as training_router
from routes.generation import router as generation_router
from routes.songs import router as songs_router
from routes.library import router as library_router
from routes.ai import router as ai_router
from routes.telemetry import router as telemetry_router
from routes.youtube import router as youtube_router
from routes.youtube_upload import router as youtube_upload_router
from routes.setup import router as setup_router

app = FastAPI(title="LoRA Studio")


# --- Global error handler — catches all unhandled exceptions ---
@app.middleware("http")
async def catch_exceptions(request: Request, call_next):
    try:
        return await call_next(request)
    except Exception:
        tb = traceback.format_exc()
        logger.error(f"Unhandled error on {request.method} {request.url.path}\n{tb}")
        return JSONResponse(status_code=500, content={"detail": "Internal server error"})


# --- Static files ---
if STATIC_BUILD.exists():
    app.mount("/assets", StaticFiles(directory=STATIC_BUILD / "assets"), name="assets")
app.mount("/static", StaticFiles(directory=STATIC_LEGACY), name="static")

# --- Routers ---
app.include_router(setup_router)
app.include_router(artists_router)
app.include_router(training_router)
app.include_router(generation_router)
app.include_router(songs_router)
app.include_router(library_router)
app.include_router(ai_router)
app.include_router(telemetry_router)
app.include_router(youtube_router)
app.include_router(youtube_upload_router)


# --- RVC PoC comparison page (temporary) ---

@app.get("/api/rvc-demo")
async def rvc_poc_page():
    from fastapi.responses import HTMLResponse
    return HTMLResponse("""
    <html><head><title>RVC Voice Conversion PoC</title>
    <style>
        body { background: #0f0f0f; color: #fff; font-family: system-ui; padding: 40px; max-width: 800px; margin: 0 auto; }
        h1 { color: #1ed760; }
        .track { background: #1a1a1a; border-radius: 16px; padding: 20px; margin-bottom: 16px; }
        .track h3 { margin: 0 0 8px; font-size: 16px; }
        .track p { color: #888; font-size: 13px; margin: 0 0 12px; }
        audio { width: 100%; height: 48px; }
        .label { display: inline-block; padding: 3px 10px; border-radius: 10px; font-size: 11px; font-weight: 600; margin-bottom: 8px; }
        .original { background: rgba(255,255,255,0.1); color: #888; }
        .converted { background: rgba(30,215,96,0.15); color: #1ed760; }
    </style></head><body>
    <h1>RVC Voice Conversion PoC</h1>
    <p style="color:#888;margin-bottom:24px">Clapton voice model trained on 11 tracks, 98 epochs (minimal). Compare the original vs converted vocals.</p>

    <div class="track">
        <span class="label original">ORIGINAL</span>
        <h3>Last Dance Home — Full Song</h3>
        <p>Original ACE-Step generation</p>
        <audio controls preload="auto" src="/api/rvc-poc/original"></audio>
    </div>

    <div class="track">
        <span class="label original">EXTRACTED</span>
        <h3>Vocals Only (before conversion)</h3>
        <p>Demucs-separated vocals from the original</p>
        <audio controls preload="auto" src="/api/rvc-poc/vocals-before"></audio>
    </div>

    <div class="track">
        <span class="label original">V1 (98 epochs)</span>
        <h3>Vocals — First Attempt</h3>
        <p>98 epochs, 11 tracks — barely trained</p>
        <audio controls preload="auto" src="/api/rvc-poc/vocals-after-v1"></audio>
    </div>

    <div class="track">
        <span class="label converted">V2 (800 epochs)</span>
        <h3>Vocals — Proper Training</h3>
        <p>800 epochs, 24 tracks, GPU trained</p>
        <audio controls preload="auto" src="/api/rvc-poc/vocals-after"></audio>
    </div>

    <div class="track">
        <span class="label original">V1 FINAL MIX</span>
        <h3>V1 Mix (98 epochs)</h3>
        <p>First attempt remixed with instrumentals</p>
        <audio controls preload="auto" src="/api/rvc-poc/final-v1"></audio>
    </div>

    <div class="track">
        <span class="label converted">V2 FINAL MIX</span>
        <h3>V2 Mix (800 epochs)</h3>
        <p>Proper training remixed with instrumentals</p>
        <audio controls preload="auto" src="/api/rvc-poc/final"></audio>
    </div>
    </body></html>
    """)

@app.get("/api/rvc-poc/{track}")
async def rvc_poc_audio(track: str):
    from pathlib import Path
    root = Path(__file__).parent.parent.resolve()
    files = {
        "original": root / "acestep_output" / "Last Dance Home.mp3",
        "vocals-before": root / "screenshots" / "rvc_poc_original.mp3",
        "vocals-after-v1": root / "screenshots" / "rvc_poc_sovits.mp3",
        "final-v1": root / "screenshots" / "rvc_poc_final.mp3",
        "vocals-after": root / "screenshots" / "rvc_poc_v2.mp3",
        "final": root / "screenshots" / "rvc_poc_final_v2.mp3",
    }
    path = files.get(track)
    if not path or not path.exists():
        print(f"  [RVC PoC] Not found: track={track}, path={path}, exists={path.exists() if path else 'N/A'}", flush=True)
        from fastapi import HTTPException as _H
        raise _H(status_code=404, detail=f"Not found: {track}")
    media = "audio/mpeg" if str(path).endswith(".mp3") else "audio/wav"
    return FileResponse(path, media_type=media)

# --- Core routes ---

@app.get("/")
async def root():
    if STATIC_BUILD.exists() and (STATIC_BUILD / "index.html").exists():
        return FileResponse(STATIC_BUILD / "index.html")
    return FileResponse(STATIC_LEGACY / "index.html")


@app.get("/api/health")
async def health():
    return {"status": "ok"}


# --- Startup ---

_model_status = {"ready": False, "message": "Starting..."}


@app.get("/api/model-status")
async def model_status():
    return _model_status


@app.on_event("startup")
async def warmup_models():
    _queue.recover_on_startup()

    def _warmup():
        from pathlib import Path
        cp = Path(__file__).parent.parent / "checkpoints"
        has_models = (cp / "acestep-v15-turbo").exists()

        if not has_models:
            _model_status["message"] = "Downloading AI models (~5GB, first run only)..."
            print("  Models not found — downloading...", flush=True)

            # Monitor download progress by checking file count
            import threading, time
            stop_monitor = threading.Event()
            def monitor():
                while not stop_monitor.is_set():
                    try:
                        files = list(cp.rglob("*")) if cp.exists() else []
                        total_mb = sum(f.stat().st_size for f in files if f.is_file()) / (1024*1024)
                        _model_status["message"] = f"Downloading models... ({total_mb:.0f} MB downloaded)"
                    except Exception:
                        pass
                    time.sleep(3)
            t = threading.Thread(target=monitor, daemon=True)
            t.start()

            print("  Warming up models...", flush=True)
            _models._ensure_models()
            stop_monitor.set()
        else:
            _model_status["message"] = "Loading AI models into GPU..."
            print("  Warming up models...", flush=True)
            _models._ensure_models()

        _model_status["ready"] = True
        _model_status["message"] = "Ready!"
        print("  Models ready!", flush=True)
        from routes.training import resume_training_if_pending
        resume_training_if_pending()
    threading.Thread(target=_warmup, daemon=True).start()


# --- Entry point ---

if __name__ == "__main__":
    import socket
    import uvicorn

    from services.config import DATA_DIR, LORA_DIR, OUTPUT_DIR

    local_ip = "127.0.0.1"
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
    except Exception:
        pass

    print("=" * 50)
    print("  LoRA Studio")
    print(f"  Local:   http://127.0.0.1:{SERVER_PORT}")
    print(f"  Network: http://{local_ip}:{SERVER_PORT}")
    print(f"  Artists: {DATA_DIR}")
    print(f"  LoRAs:   {LORA_DIR}")
    print(f"  Output:  {OUTPUT_DIR}")
    print("=" * 50)
    uvicorn.run(app, host=SERVER_HOST, port=SERVER_PORT, log_level="info")
# trigger
