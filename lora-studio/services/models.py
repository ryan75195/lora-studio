"""Model state singleton: handler, LLM, and LoRA management."""

import sys
import os

from services.config import PROJECT_ROOT, CHECKPOINT_DIR, LORA_DIR

# --- Module-level singletons ---
_handler = None
_llm = None
_loaded_lora = None


def _ensure_models():
    """Initialize AceStepHandler and LLMHandler if not already loaded.

    Auto-downloads models from HuggingFace if not found locally.
    """
    global _handler, _llm

    sys.path.insert(0, str(PROJECT_ROOT))
    os.environ["TOKENIZERS_PARALLELISM"] = "false"

    # Ensure checkpoints directory exists
    CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)

    # Auto-download models if not present
    _download_models_if_needed()

    if _handler is None:
        from acestep.handler import AceStepHandler
        _handler = AceStepHandler()
        _handler.initialize_service(
            project_root=str(PROJECT_ROOT),
            config_path="acestep-v15-turbo",
            device="auto",
            offload_to_cpu=True,
        )
    # LLM is optional — GPT handles caption/lyrics/BPM planning via the AI builder.
    # Skip loading the 1.7B local LLM to save ~3GB VRAM (critical for 6-8GB cards).
    # If thinking=False in generation params, the LLM isn't used anyway.
    if _llm is None:
        try:
            from acestep.llm_inference import LLMHandler
            _llm = LLMHandler()
            _llm.initialize(
                checkpoint_dir=str(CHECKPOINT_DIR),
                lm_model_path="acestep-5Hz-lm-1.7B",
                backend="pt",
                device="auto",
                offload_to_cpu=True,
            )
        except Exception as e:
            print(f"  [Models] LLM skipped (not critical): {e}", flush=True)
            _llm = None


def _download_models_if_needed():
    """Download ACE-Step models from HuggingFace if not found locally."""
    turbo_dir = CHECKPOINT_DIR / "acestep-v15-turbo"
    lm_dir = CHECKPOINT_DIR / "acestep-5Hz-lm-1.7B"

    if turbo_dir.exists() and lm_dir.exists():
        return  # Already downloaded

    print("  Models not found locally — downloading from HuggingFace...", flush=True)
    print("  This is a one-time download (~5GB). Please wait.", flush=True)

    try:
        from huggingface_hub import snapshot_download

        if not turbo_dir.exists():
            print("  Downloading acestep-v15-turbo...", flush=True)
            snapshot_download(
                repo_id="ACE-Step/ACE-Step-v1-5-turbo",
                local_dir=str(turbo_dir),
                local_dir_use_symlinks=False,
            )
            print("  acestep-v15-turbo downloaded!", flush=True)

        if not lm_dir.exists():
            print("  Downloading acestep-5Hz-lm-1.7B...", flush=True)
            snapshot_download(
                repo_id="ACE-Step/ACE-Step-5Hz-LM-1.7B",
                local_dir=str(lm_dir),
                local_dir_use_symlinks=False,
            )
            print("  acestep-5Hz-lm-1.7B downloaded!", flush=True)

        # Also need VAE and text encoder
        vae_dir = CHECKPOINT_DIR / "vae"
        if not vae_dir.exists():
            print("  Downloading VAE...", flush=True)
            snapshot_download(
                repo_id="ACE-Step/ACE-Step-v1-5-turbo",
                local_dir=str(turbo_dir),
                local_dir_use_symlinks=False,
                allow_patterns=["vae/*"],
            )

        print("  All models downloaded!", flush=True)
    except ImportError:
        print("  [WARNING] huggingface_hub not installed. Install with: pip install huggingface_hub", flush=True)
        print("  Or download models manually from https://huggingface.co/ACE-Step", flush=True)
    except Exception as e:
        print(f"  [WARNING] Model download failed: {e}", flush=True)
        print("  You can retry by restarting the server.", flush=True)


def _setup_lora(lora_name: str, strength: float):
    """Load/switch LoRA adapter, or unload it to use the base model."""
    global _loaded_lora
    if lora_name:
        lora_path = LORA_DIR / lora_name / "final" / "adapter"
        if _loaded_lora != lora_name:
            if _loaded_lora is not None:
                _handler.unload_lora()
            _handler.load_lora(str(lora_path))
            _loaded_lora = lora_name
        _handler.set_lora_scale(strength)
    else:
        if _loaded_lora is not None:
            _handler.unload_lora()
            _loaded_lora = None


def get_handler():
    """Return the current AceStepHandler instance (may be None before warmup)."""
    return _handler


def get_llm():
    """Return the current LLMHandler instance (may be None before warmup)."""
    return _llm
