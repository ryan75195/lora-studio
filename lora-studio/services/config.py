"""Centralised path and environment configuration for LoRA Studio.

Load order:
  1. config.json in the lora-studio directory (if present)
  2. .env file in the lora-studio directory (if present)
  3. Hardcoded defaults / auto-detected paths

config.json is optional.  If it doesn't exist the first time we load,
we create one with sensible defaults so the setup wizard has something
to read/write.  Existing .env setups continue to work unchanged.
"""

import json
import os
from pathlib import Path

from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Resolve directories
# ---------------------------------------------------------------------------
_HERE = Path(__file__).parent.parent.resolve()          # lora-studio/
_CONFIG_PATH = _HERE / "config.json"

# Always load .env so existing deployments keep working
load_dotenv(_HERE / ".env")

# ---------------------------------------------------------------------------
# Default config template (used when creating config.json for the first time)
# ---------------------------------------------------------------------------
_DEFAULT_CONFIG = {
    "server": {
        "host": "0.0.0.0",
        "port": 8888,
    },
    "paths": {
        "project_root": "",
        "data_dir": "",
        "lora_dir": "",
        "output_dir": "",
        "checkpoint_dir": "",
    },
    "api_keys": {
        "openai_api_key": "",
        "gemini_api_key": "",
        "kling_access_key": "",
        "kling_secret_key": "",
        "google_client_id": "",
        "google_client_secret": "",
    },
    "generation": {
        "default_lora_strength": 1.3,
        "inference_steps": 8,
        "guidance_scale": 9.0,
    },
    "training": {
        "lora_rank": 16,
        "lora_alpha": 32,
        "epochs": 15,
        "batch_size": 2,
        "learning_rate": 0.0003,
    },
}

# ---------------------------------------------------------------------------
# Load / create config.json
# ---------------------------------------------------------------------------

def _load_config() -> dict:
    """Return merged config dict (config.json -> defaults)."""
    if _CONFIG_PATH.exists():
        try:
            with open(_CONFIG_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def _deep_merge(base: dict, override: dict) -> dict:
    """Recursively merge *override* into *base* (non-destructive)."""
    merged = dict(base)
    for key, val in override.items():
        if key in merged and isinstance(merged[key], dict) and isinstance(val, dict):
            merged[key] = _deep_merge(merged[key], val)
        else:
            merged[key] = val
    return merged


def save_config(cfg: dict) -> None:
    """Write *cfg* to config.json (pretty-printed)."""
    with open(_CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)
        f.write("\n")


def get_full_config() -> dict:
    """Return the full merged config (defaults + file)."""
    return _deep_merge(_DEFAULT_CONFIG, _load_config())


def reload_config():
    """Re-read config.json and refresh all module-level values.

    Called after the setup wizard saves new settings.
    """
    global OPENAI_API_KEY, GEMINI_API_KEY, KLING_ACCESS_KEY, KLING_SECRET_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
    global PROJECT_ROOT, DATA_DIR, LORA_DIR, OUTPUT_DIR, CHECKPOINT_DIR
    global DRAFT_DIR, LIBRARY_PATH, COVERS_DIR
    global SERVER_HOST, SERVER_PORT

    cfg = get_full_config()

    # API keys: config.json > .env > empty
    keys = cfg.get("api_keys", {})
    OPENAI_API_KEY = keys.get("openai_api_key") or os.environ.get("OPENAI_API_KEY", "")
    GEMINI_API_KEY = keys.get("gemini_api_key") or os.environ.get("GEMINI_API_KEY", "")
    KLING_ACCESS_KEY = keys.get("kling_access_key") or os.environ.get("KLING_ACCESS_KEY", "")
    KLING_SECRET_KEY = keys.get("kling_secret_key") or os.environ.get("KLING_SECRET_KEY", "")
    GOOGLE_CLIENT_ID = keys.get("google_client_id") or os.environ.get("GOOGLE_CLIENT_ID", "")
    GOOGLE_CLIENT_SECRET = keys.get("google_client_secret") or os.environ.get("GOOGLE_CLIENT_SECRET", "")

    # Push into environment so downstream libraries (openai SDK, etc.) pick them up
    if OPENAI_API_KEY:
        os.environ["OPENAI_API_KEY"] = OPENAI_API_KEY
    if GOOGLE_CLIENT_ID:
        os.environ["GOOGLE_CLIENT_ID"] = GOOGLE_CLIENT_ID
    if GOOGLE_CLIENT_SECRET:
        os.environ["GOOGLE_CLIENT_SECRET"] = GOOGLE_CLIENT_SECRET

    # Server
    srv = cfg.get("server", {})
    SERVER_HOST = srv.get("host") or "0.0.0.0"
    SERVER_PORT = int(srv.get("port") or 8888)

    # Paths: config.json value wins if non-empty, else auto-detect
    paths = cfg.get("paths", {})
    _auto_root = _HERE.parent.resolve()

    PROJECT_ROOT = Path(paths.get("project_root") or str(_auto_root))
    DATA_DIR     = Path(paths.get("data_dir"))     if paths.get("data_dir")     else PROJECT_ROOT / "data" / "artists"
    LORA_DIR     = Path(paths.get("lora_dir"))     if paths.get("lora_dir")     else PROJECT_ROOT / "lora-output"
    OUTPUT_DIR   = Path(paths.get("output_dir"))   if paths.get("output_dir")   else PROJECT_ROOT / "acestep_output"
    CHECKPOINT_DIR = Path(paths.get("checkpoint_dir")) if paths.get("checkpoint_dir") else PROJECT_ROOT / "checkpoints"

    DRAFT_DIR    = PROJECT_ROOT / "data" / "drafts"
    LIBRARY_PATH = PROJECT_ROOT / "data" / "library.json"
    COVERS_DIR   = PROJECT_ROOT / "data" / "covers"

    # Ensure required directories exist
    for d in (DATA_DIR, LORA_DIR, OUTPUT_DIR, DRAFT_DIR, COVERS_DIR):
        d.mkdir(parents=True, exist_ok=True)


# Create config.json with defaults if it does not exist yet
if not _CONFIG_PATH.exists():
    save_config(_DEFAULT_CONFIG)

# ---------------------------------------------------------------------------
# Module-level values (populated on first import)
# ---------------------------------------------------------------------------

# Placeholders so the module always exposes every name
OPENAI_API_KEY: str = ""
GEMINI_API_KEY: str = ""
KLING_ACCESS_KEY: str = ""
KLING_SECRET_KEY: str = ""
GOOGLE_CLIENT_ID: str = ""
GOOGLE_CLIENT_SECRET: str = ""
PROJECT_ROOT: Path = _HERE.parent.resolve()
DATA_DIR: Path = PROJECT_ROOT / "data" / "artists"
LORA_DIR: Path = PROJECT_ROOT / "lora-output"
OUTPUT_DIR: Path = PROJECT_ROOT / "acestep_output"
CHECKPOINT_DIR: Path = PROJECT_ROOT / "checkpoints"
DRAFT_DIR: Path = PROJECT_ROOT / "data" / "drafts"
LIBRARY_PATH: Path = PROJECT_ROOT / "data" / "library.json"
COVERS_DIR: Path = PROJECT_ROOT / "data" / "covers"
SERVER_HOST: str = "0.0.0.0"
SERVER_PORT: int = 8888

# Static-file directories (never overridden by config.json)
STATIC_BUILD = _HERE / "static-build"
STATIC_LEGACY = _HERE / "static"

# Apply the real values
reload_config()
