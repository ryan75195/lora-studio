"""Setup wizard routes: first-run configuration, model checks, and downloads."""

import threading
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

import services.config as _cfg
from services.config import get_full_config, save_config, reload_config

router = APIRouter()

# ---------------------------------------------------------------------------
# Model download state (module-level singleton)
# ---------------------------------------------------------------------------
_download_state = {
    "active": False,
    "message": "",
    "success": None,  # None = not started, True/False = finished
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _is_setup_complete() -> bool:
    """Setup is complete when an OpenAI API key is configured."""
    cfg = get_full_config()
    key = cfg.get("api_keys", {}).get("openai_api_key", "")
    if key:
        return True
    # Fall back to env var (for existing .env-based setups)
    import os
    return bool(os.environ.get("OPENAI_API_KEY", ""))


def _check_models_present() -> dict:
    """Check whether the required ACE-Step model components are downloaded."""
    import sys
    sys.path.insert(0, str(_cfg.CHECKPOINT_DIR.parent))
    try:
        from acestep.model_downloader import (
            check_main_model_exists,
            MAIN_MODEL_COMPONENTS,
        )
        all_present = check_main_model_exists(_cfg.CHECKPOINT_DIR)
        components = {}
        for comp in MAIN_MODEL_COMPONENTS:
            comp_path = _cfg.CHECKPOINT_DIR / comp
            components[comp] = comp_path.exists() and any(comp_path.iterdir()) if comp_path.exists() else False
        return {
            "all_present": all_present,
            "checkpoint_dir": str(_cfg.CHECKPOINT_DIR),
            "components": components,
        }
    except ImportError:
        # acestep package not importable — just check directory heuristically
        turbo = _cfg.CHECKPOINT_DIR / "acestep-v15-turbo"
        vae = _cfg.CHECKPOINT_DIR / "vae"
        lm = _cfg.CHECKPOINT_DIR / "acestep-5Hz-lm-1.7B"
        all_ok = turbo.exists() and vae.exists() and lm.exists()
        return {
            "all_present": all_ok,
            "checkpoint_dir": str(_cfg.CHECKPOINT_DIR),
            "components": {
                "acestep-v15-turbo": turbo.exists(),
                "vae": vae.exists(),
                "acestep-5Hz-lm-1.7B": lm.exists(),
            },
        }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/api/setup/status")
async def setup_status():
    """Return whether first-run setup is complete."""
    return {
        "setup_complete": _is_setup_complete(),
        "models_present": _check_models_present()["all_present"],
    }


@router.get("/api/setup/config")
async def get_setup_config():
    """Return current config with API keys redacted (show set/unset only)."""
    cfg = get_full_config()

    # Redact API keys — only reveal whether they are set
    keys = cfg.get("api_keys", {})
    redacted_keys = {}
    for k, v in keys.items():
        redacted_keys[k] = bool(v)
    cfg["api_keys"] = redacted_keys

    return cfg


class SaveConfigRequest(BaseModel):
    server: Optional[dict] = None
    paths: Optional[dict] = None
    api_keys: Optional[dict] = None
    generation: Optional[dict] = None
    training: Optional[dict] = None


@router.post("/api/setup/config")
async def save_setup_config(body: SaveConfigRequest):
    """Save provided config values to config.json, merging with existing."""
    current = get_full_config()

    incoming = body.model_dump(exclude_none=True)

    # Merge each top-level section
    for section, values in incoming.items():
        if isinstance(values, dict) and section in current and isinstance(current[section], dict):
            current[section].update(values)
        else:
            current[section] = values

    save_config(current)
    reload_config()

    return {"ok": True}


@router.get("/api/setup/check-models")
async def check_models():
    """Check if ACE-Step models are downloaded."""
    return _check_models_present()


@router.post("/api/setup/download-models")
async def download_models():
    """Trigger background download of ACE-Step models."""
    if _download_state["active"]:
        return {"ok": False, "message": "Download already in progress"}

    _download_state["active"] = True
    _download_state["message"] = "Starting download..."
    _download_state["success"] = None

    def _do_download():
        import sys
        sys.path.insert(0, str(_cfg.CHECKPOINT_DIR.parent))
        try:
            from acestep.model_downloader import download_main_model
            _download_state["message"] = "Downloading models from HuggingFace / ModelScope..."
            success, msg = download_main_model(_cfg.CHECKPOINT_DIR)
            _download_state["success"] = success
            _download_state["message"] = msg
        except Exception as e:
            _download_state["success"] = False
            _download_state["message"] = str(e)
        finally:
            _download_state["active"] = False

    threading.Thread(target=_do_download, daemon=True).start()
    return {"ok": True, "message": "Download started"}


@router.get("/api/setup/download-status")
async def download_status():
    """Poll the model download progress."""
    return {
        "active": _download_state["active"],
        "message": _download_state["message"],
        "success": _download_state["success"],
    }
