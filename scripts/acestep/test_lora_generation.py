"""Generate a test song using the trained LoRA."""

import sys
import os
import time
import multiprocessing

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(__file__))
os.environ["TOKENIZERS_PARALLELISM"] = "false"

PROJECT_ROOT = "F:/ACE-Step-1.5"
CHECKPOINT_DIR = "F:/ACE-Step-1.5/checkpoints"
LORA_PATH = "F:/ACE-Step-1.5/lora-output/sabrina-clapton-mix/final/adapter"
OUTPUT_DIR = "F:/ACE-Step-1.5/acestep_output"


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

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
    print(f"  Handler init: ok={ok}", flush=True)
    if not ok:
        print(f"ERROR: {status_msg[:300]}", flush=True)
        return

    # ---- Init LLM ----
    print("\n=== Initializing LLM ===", flush=True)
    from acestep.llm_inference import LLMHandler
    llm = LLMHandler()
    llm_status, llm_ok = llm.initialize(
        checkpoint_dir=CHECKPOINT_DIR,
        lm_model_path="acestep-5Hz-lm-1.7B",
        backend="pt",
        device="auto",
        offload_to_cpu=True,
    )
    print(f"  LLM init: ok={llm_ok}", flush=True)

    # ---- Load LoRA ----
    print(f"\n=== Loading LoRA ===", flush=True)
    lora_result = handler.load_lora(LORA_PATH)
    print(f"  {lora_result}", flush=True)

    # ---- Generate using high-level API ----
    print("\n=== Generating test song (60s) ===", flush=True)
    start = time.time()

    from acestep.inference import generate_music, GenerationParams, GenerationConfig

    params = GenerationParams(
        task_type="text2music",
        caption="Pop rock ballad, female vocal, electric guitar, blues influence, emotional, piano, warm production, 120 BPM, E minor",
        lyrics="""[Verse 1]
Standing at the crossroads where our stories meet
Your guitar strings crying in the summer heat
I sing these words like prayers to the fading light
While blues and pop collide into the night

[Chorus]
We're dancing on the edge of something real
Between the rhythm and the way you make me feel
A melody that bridges worlds apart
You play the blues while I give you my heart

[Verse 2]
Neon lights reflecting on your weathered hands
You bend those notes like only legends can
I'll add my voice to every chord you play
Together making music no one else can say

[Chorus]
We're dancing on the edge of something real
Between the rhythm and the way you make me feel
A melody that bridges worlds apart
You play the blues while I give you my heart

[Outro]
So let the music speak for both of us tonight
Where pop meets blues under the city lights""",
        duration=60.0,
        bpm=120,
        keyscale="E minor",
        timesignature="4/4",
        vocal_language="en",
        inference_steps=8,
        guidance_scale=7.0,
        thinking=True,
    )

    config = GenerationConfig(
        batch_size=1,
        use_random_seed=True,
        audio_format="mp3",
    )

    result = generate_music(
        dit_handler=handler,
        llm_handler=llm,
        params=params,
        config=config,
        save_dir=OUTPUT_DIR,
    )

    elapsed = time.time() - start
    print(f"\n  Generation took {elapsed:.1f}s", flush=True)
    print(f"  Success: {result.success}", flush=True)
    print(f"  Status: {result.status_message}", flush=True)

    if result.success and result.audios:
        for i, audio_info in enumerate(result.audios):
            print(f"  Audio {i+1}: {audio_info}", flush=True)
        print(f"\n=== Done! Check {OUTPUT_DIR} for output ===", flush=True)
    else:
        print(f"  Error: {result.error}", flush=True)
        if hasattr(result, 'extra_outputs'):
            print(f"  Extra: {str(result.extra_outputs)[:500]}", flush=True)


if __name__ == '__main__':
    multiprocessing.freeze_support()
    main()
