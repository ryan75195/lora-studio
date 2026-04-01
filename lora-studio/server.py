"""LoRA Studio - FastAPI backend for ACE-Step 1.5."""

import threading

from fastapi import FastAPI
from fastapi.responses import FileResponse
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
        _model_status["message"] = "Downloading models (first run only)..."
        print("  Warming up models...", flush=True)
        _model_status["message"] = "Loading AI models into GPU..."
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
    # Log to file AND console
    import logging
    log_path = str(Path(__file__).parent.parent / "lora-studio.log")
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(message)s",
        handlers=[
            logging.StreamHandler(),
            logging.FileHandler(log_path, encoding="utf-8"),
        ],
    )
    uvicorn.run(app, host=SERVER_HOST, port=SERVER_PORT, log_level="info")
# trigger
