"""Resume LoRA training from preprocessed tensors - fast config."""

import sys
import os
import multiprocessing

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(__file__))
os.environ["TOKENIZERS_PARALLELISM"] = "false"
# Force unbuffered stdout for progress visibility
os.environ["PYTHONUNBUFFERED"] = "1"

PROJECT_ROOT = "F:/ACE-Step-1.5"
TENSOR_DIR = "F:/ACE-Step-1.5/training-data/mixed/preprocessed"
OUTPUT_DIR = "F:/ACE-Step-1.5/lora-output/sabrina-clapton-mix"
CHECKPOINT_DIR = "F:/ACE-Step-1.5/checkpoints"


def main():
    import time

    # ---- Init handler ----
    print("=== Initializing AceStepHandler ===", flush=True)
    from acestep.handler import AceStepHandler

    handler = AceStepHandler()
    status_msg, ok = handler.initialize_service(
        project_root=PROJECT_ROOT,
        config_path="acestep-v15-turbo",
        device="auto",
        offload_to_cpu=True,
    )
    print(f"  Handler init: {status_msg} (ok={ok})", flush=True)
    if not ok:
        print("ERROR: Handler failed to initialize. Aborting.", flush=True)
        return

    # ---- Train LoRA ----
    print("\n=== Training LoRA (10 epochs, fast config) ===", flush=True)
    from acestep.training.trainer import LoRATrainer
    from acestep.training.configs import LoRAConfig, TrainingConfig

    lora_config = LoRAConfig(
        r=8,
        alpha=16,
        dropout=0.1,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
    )

    training_config = TrainingConfig(
        learning_rate=5e-4,         # Higher LR for fewer epochs
        batch_size=2,               # Double batch size
        gradient_accumulation_steps=2,  # Less accumulation
        max_epochs=10,              # 10 epochs instead of 100
        save_every_n_epochs=5,      # Save at epoch 5 and 10
        warmup_steps=20,            # Less warmup
        output_dir=OUTPUT_DIR,
        mixed_precision="bf16",
        num_workers=0,
        pin_memory=True,
        prefetch_factor=None,
        persistent_workers=False,
        pin_memory_device="cuda",
        log_every_n_steps=1,        # Log every step for visibility
    )

    training_state = {"is_training": True, "should_stop": False}

    trainer = LoRATrainer(
        dit_handler=handler,
        lora_config=lora_config,
        training_config=training_config,
    )

    start_time = time.time()
    for step, loss, status in trainer.train_from_preprocessed(TENSOR_DIR, training_state):
        elapsed = time.time() - start_time
        print(f"  [{elapsed:.0f}s] Step {step} | Loss: {loss:.4f} | {status}", flush=True)

    total_time = time.time() - start_time
    print(f"\n=== Done in {total_time:.0f}s! LoRA saved to {OUTPUT_DIR} ===", flush=True)


if __name__ == '__main__':
    multiprocessing.freeze_support()
    main()
