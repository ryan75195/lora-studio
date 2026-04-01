"""Train a mixed Sabrina Carpenter + Eric Clapton LoRA."""

import sys
import os
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(__file__))
os.environ["TOKENIZERS_PARALLELISM"] = "false"

PROJECT_ROOT = "F:/ACE-Step-1.5"
AUDIO_DIR = "F:/ACE-Step-1.5/training-data/mixed"
TENSOR_DIR = "F:/ACE-Step-1.5/training-data/mixed/preprocessed"
OUTPUT_DIR = "F:/ACE-Step-1.5/lora-output/sabrina-clapton-mix"
CHECKPOINT_DIR = "F:/ACE-Step-1.5/checkpoints"

# ---- Step 1: Scan ----
print("=== Step 1: Scanning audio files ===")
from acestep.training.dataset_builder import DatasetBuilder
builder = DatasetBuilder()
samples, status = builder.scan_directory(AUDIO_DIR)
print(f"  {status}")
print(f"  Found {len(samples)} tracks")

# ---- Step 2: Init handler ----
print("\n=== Step 2: Initializing AceStepHandler ===")
from acestep.handler import AceStepHandler
from acestep.llm_inference import LLMHandler

handler = AceStepHandler()
status_msg, ok = handler.initialize_service(
    project_root=PROJECT_ROOT,
    config_path="acestep-v15-turbo",
    device="auto",
    offload_to_cpu=True,
)
print(f"  Handler init: {status_msg} (ok={ok})")

print("  Initializing LLM...")
llm = LLMHandler()
llm_status, llm_ok = llm.initialize(
    checkpoint_dir=CHECKPOINT_DIR,
    lm_model_path="acestep-5Hz-lm-1.7B",
    backend="pt",
    device="auto",
    offload_to_cpu=True,
)
print(f"  LLM init: {llm_status} (ok={llm_ok})")

# ---- Step 3: Auto-label ----
print("\n=== Step 3: Auto-labeling all tracks ===")
def progress(msg):
    print(f"  {msg}")

samples, status = builder.label_all_samples(
    dit_handler=handler,
    llm_handler=llm,
    format_lyrics=False,
    transcribe_lyrics=False,
    skip_metas=False,
    only_unlabeled=False,
    progress_callback=progress,
)
print(f"  {status}")

# Save dataset
dataset_path = os.path.join(AUDIO_DIR, "my_lora_dataset.json")
builder.save_dataset(dataset_path)
print(f"  Dataset saved to {dataset_path}")

# ---- Step 4: Preprocess to tensors ----
print("\n=== Step 4: Preprocessing dataset to tensors ===")
output_paths, preprocess_status = builder.preprocess_to_tensors(
    dit_handler=handler,
    output_dir=TENSOR_DIR,
    preprocess_mode="lora",
    progress_callback=progress,
)
print(f"  {preprocess_status}")

# ---- Step 5: Train LoRA ----
print("\n=== Step 5: Training LoRA (100 epochs) ===")
from acestep.training.trainer import LoRATrainer
from acestep.training.configs import LoRAConfig, TrainingConfig

lora_config = LoRAConfig(
    r=8,
    alpha=16,
    dropout=0.1,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
)

training_config = TrainingConfig(
    learning_rate=1e-4,
    batch_size=1,
    gradient_accumulation_steps=4,
    max_epochs=100,
    save_every_n_epochs=10,
    warmup_steps=100,
    output_dir=OUTPUT_DIR,
    mixed_precision="bf16",
    num_workers=4,
    pin_memory=True,
    prefetch_factor=2,
    persistent_workers=True,
    pin_memory_device="cuda",
)

training_state = {"is_training": True, "should_stop": False}

trainer = LoRATrainer(
    dit_handler=handler,
    lora_config=lora_config,
    training_config=training_config,
)

for step, loss, status in trainer.train_from_preprocessed(TENSOR_DIR, training_state):
    if step % 10 == 0 or "Epoch" in str(status):
        print(f"  Step {step} | Loss: {loss:.4f} | {status}")

print(f"\n=== Done! LoRA saved to {OUTPUT_DIR} ===")
