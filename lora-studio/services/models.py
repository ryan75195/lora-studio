"""Model state singleton: handler, LLM, and LoRA management."""

import sys
import os

from services.config import PROJECT_ROOT, CHECKPOINT_DIR, LORA_DIR

# --- Module-level singletons ---
_handler = None
_llm = None
_loaded_lora = None


def _ensure_models():
    """Initialize AceStepHandler and LLMHandler if not already loaded."""
    global _handler, _llm
    if _handler is None:
        sys.path.insert(0, str(PROJECT_ROOT))
        os.environ["TOKENIZERS_PARALLELISM"] = "false"
        from acestep.handler import AceStepHandler
        _handler = AceStepHandler()
        _handler.initialize_service(
            project_root=str(PROJECT_ROOT),
            config_path="acestep-v15-turbo",
            device="auto",
            offload_to_cpu=True,
        )
    if _llm is None:
        from acestep.llm_inference import LLMHandler
        _llm = LLMHandler()
        _llm.initialize(
            checkpoint_dir=str(CHECKPOINT_DIR),
            lm_model_path="acestep-5Hz-lm-1.7B",
            backend="pt",
            device="auto",
            offload_to_cpu=True,
        )


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
