"""Training routes: LoRA listing, start training, SSE status stream."""

import sys
import os
import json
import asyncio
import threading
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from services.config import DATA_DIR, LORA_DIR, CHECKPOINT_DIR, PROJECT_ROOT

# Pending training request file (for auto-resume after restart)
_PENDING_TRAIN_FILE = DATA_DIR.parent / "pending_train.json"

router = APIRouter()

# --- Training state (module-level singleton) ---
train_progress = {"active": False, "message": "", "step": 0, "total": 0, "error": None}


# --- Models ---

class TrainRequest(BaseModel):
    artists: list[str]
    name: str = ""


# --- Routes ---

@router.get("/api/loras")
async def list_loras():
    loras = []
    if LORA_DIR.exists():
        for d in sorted(LORA_DIR.iterdir()):
            adapter_path = d / "final" / "adapter" / "adapter_model.safetensors"
            if adapter_path.exists():
                size_mb = adapter_path.stat().st_size / (1024 * 1024)
                loras.append({
                    "name": d.name,
                    "path": str(d / "final" / "adapter"),
                    "size_mb": round(size_mb, 1),
                    "created_at": datetime.fromtimestamp(adapter_path.stat().st_mtime).isoformat(),
                })
    return loras


@router.post("/api/train")
async def start_training(body: TrainRequest):
    global train_progress
    if train_progress["active"]:
        raise HTTPException(status_code=409, detail="Training already in progress")

    audio_dirs = []
    for slug in body.artists:
        tracks_dir = DATA_DIR / slug / "tracks"
        if not tracks_dir.exists():
            raise HTTPException(status_code=404, detail=f"Artist '{slug}' not found")
        audio_dirs.append(str(tracks_dir))

    name = body.name or "-".join(body.artists)

    # Save request for auto-resume if server restarts
    _PENDING_TRAIN_FILE.write_text(
        json.dumps({"artists": body.artists, "name": name}), encoding="utf-8"
    )

    import time as _time
    train_progress = {
        "active": True, "message": "Starting...", "step": 0, "total": 0,
        "error": None, "phase": "starting", "phase_progress": 0, "phase_total": 0,
        "eta_seconds": None, "started_at": _time.time(), "track_count": 0,
    }

    def run_training():
        global train_progress
        from services.gpu_lock import wait_for_gpu, release_gpu

        # Acquire GPU lock before using models
        train_progress["message"] = "Waiting for GPU..."
        if not wait_for_gpu("training", progress_callback=lambda msg: train_progress.update({"message": msg})):
            train_progress["error"] = "Timed out waiting for GPU"
            train_progress["message"] = "Error: Timed out waiting for GPU"
            train_progress["active"] = False
            return

        try:
            sys.path.insert(0, str(PROJECT_ROOT))
            os.environ["TOKENIZERS_PARALLELISM"] = "false"

            train_progress["message"] = "Scanning audio files..."
            # Monkey-patch preprocess_audio to use soundfile (torchcodec DLL broken on Windows)
            import soundfile as sf
            import torch
            import acestep.training.dataset_builder_modules.preprocess_audio as _pa
            _orig_load = _pa.load_audio_stereo
            def _sf_load(audio_path, target_sample_rate, max_duration):
                try:
                    return _orig_load(audio_path, target_sample_rate, max_duration)
                except Exception:
                    data, sr = sf.read(audio_path, dtype='float32')
                    audio = torch.from_numpy(data).T  # (channels, samples)
                    if audio.dim() == 1:
                        audio = audio.unsqueeze(0)
                    if sr != target_sample_rate:
                        import torchaudio
                        audio = torchaudio.transforms.Resample(sr, target_sample_rate)(audio)
                    if audio.shape[0] == 1:
                        audio = audio.repeat(2, 1)
                    elif audio.shape[0] > 2:
                        audio = audio[:2, :]
                    max_samples = int(max_duration * target_sample_rate)
                    if audio.shape[1] > max_samples:
                        audio = audio[:, :max_samples]
                    return audio, target_sample_rate
            _pa.load_audio_stereo = _sf_load
            from acestep.training.path_safety import set_safe_root
            set_safe_root(str(PROJECT_ROOT))
            from acestep.training.dataset_builder import DatasetBuilder
            builder = DatasetBuilder()
            all_samples = []
            for audio_dir in audio_dirs:
                samples, status = builder.scan_directory(audio_dir)
                all_samples.extend(samples)
            track_count = len(all_samples)
            train_progress["message"] = f"Found {track_count} tracks"
            train_progress["track_count"] = track_count

            # Apply cached labels to scanned samples
            cached_count = 0
            for sample in all_samples:
                fname = os.path.basename(sample.audio_path)
                # Check for per-track label cache next to the audio file
                cache_file = Path(sample.audio_path).with_suffix('.labels.json')
                if cache_file.exists():
                    try:
                        cached = json.loads(cache_file.read_text(encoding='utf-8'))
                        sample.caption = cached.get('caption', '')
                        sample.lyrics = cached.get('lyrics', '')
                        sample.bpm = cached.get('bpm')
                        sample.key = cached.get('key', '')
                        sample.duration = cached.get('duration')
                        sample.language = cached.get('language', '')
                        sample.is_labeled = True
                        sample.labeled = True
                        cached_count += 1
                    except Exception:
                        pass

            needs_labeling = track_count - cached_count
            train_progress.update({"phase": "loading", "message": f"Loading model... ({cached_count} cached labels)"})
            from services import models as _models
            _models._ensure_models()
            handler = _models._handler
            llm = _models._llm

            if needs_labeling > 0:
                label_start = _time.time()
                train_progress.update({
                    "phase": "labeling", "message": f"Labeling {needs_labeling} tracks ({cached_count} cached)...",
                    "phase_progress": 0, "phase_total": needs_labeling,
                })
                from services.gpu_lock import should_training_yield, release_gpu as _yield_rel, wait_for_gpu as _yield_wait
                def label_progress(msg):
                    train_progress["message"] = f"Labeling: {msg}"
                    import re
                    m = re.search(r'(\d+)/(\d+)', msg)
                    if m:
                        done = int(m.group(1))
                        train_progress["phase_progress"] = done
                        if done > 0:
                            elapsed = _time.time() - label_start
                            per_track = elapsed / done
                            remaining = (needs_labeling - done) * per_track
                            train_progress["eta_seconds"] = int(remaining)
                        # Save cache incrementally after each labeled track
                        for sample in all_samples:
                            try:
                                cf = Path(sample.audio_path).with_suffix('.labels.json')
                                if not cf.exists() and getattr(sample, 'is_labeled', False) and getattr(sample, 'caption', ''):
                                    cf.write_text(json.dumps({
                                        'caption': getattr(sample, 'caption', ''),
                                        'lyrics': getattr(sample, 'lyrics', ''),
                                        'bpm': getattr(sample, 'bpm', None),
                                        'key': getattr(sample, 'key', ''),
                                        'duration': getattr(sample, 'duration', None),
                                        'language': getattr(sample, 'language', ''),
                                    }, indent=2), encoding='utf-8')
                            except Exception:
                                pass
                    # Yield GPU to generation if waiting
                    if should_training_yield():
                        train_progress["message"] = "Labeling paused — song generation has priority"
                        _yield_rel()
                        _yield_wait("training", lambda m: train_progress.update({"message": m}))
                        train_progress["message"] = f"Labeling: resuming..."
                builder.label_all_samples(
                    dit_handler=handler,
                    llm_handler=llm,
                    format_lyrics=False,
                    transcribe_lyrics=False,
                    skip_metas=False,
                    only_unlabeled=True,
                    progress_callback=label_progress,
                )
            else:
                train_progress.update({"phase": "labeling", "message": f"All {track_count} tracks labeled (cached)"})

            # Save per-track label cache for future runs
            for sample in all_samples:
                try:
                    cache_file = Path(sample.audio_path).with_suffix('.labels.json')
                    if not cache_file.exists() and hasattr(sample, 'caption') and sample.caption:
                        label_data = {
                            'caption': getattr(sample, 'caption', ''),
                            'lyrics': getattr(sample, 'lyrics', ''),
                            'bpm': getattr(sample, 'bpm', None),
                            'key': getattr(sample, 'key', ''),
                            'duration': getattr(sample, 'duration', None),
                            'language': getattr(sample, 'language', ''),
                        }
                        cache_file.write_text(json.dumps(label_data, indent=2), encoding='utf-8')
                except Exception:
                    pass

            # Disable CPU offloading during preprocessing — VAE must stay loaded
            if hasattr(handler, '_offload_to_cpu'):
                handler._offload_to_cpu = False
                print("  Disabled CPU offloading for preprocessing", flush=True)
            # Move VAE back to GPU if it was offloaded
            if hasattr(handler, 'vae') and handler.vae is not None:
                import torch
                device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
                handler.vae = handler.vae.to(device)
                print(f"  VAE moved to {device}", flush=True)

            tensor_dir = str(LORA_DIR / name / "preprocessed")
            # Check if tensors already exist
            tensor_path = Path(tensor_dir)
            existing_tensors = list(tensor_path.glob("*.pt")) if tensor_path.exists() else []
            if len(existing_tensors) > 0:
                train_progress.update({
                    "phase": "preprocessing", "message": f"Reusing {len(existing_tensors)} cached tensors",
                    "phase_progress": len(existing_tensors), "phase_total": len(existing_tensors), "eta_seconds": None,
                })
            else:
                train_progress.update({
                    "phase": "preprocessing", "message": "Preprocessing to tensors...",
                    "phase_progress": 0, "eta_seconds": None,
                })
                print(f"  Preprocessing {len(all_samples)} samples to {tensor_dir}", flush=True)
                print(f"  Labeled samples: {sum(1 for s in all_samples if getattr(s, 'is_labeled', False))}", flush=True)
                for s in all_samples[:3]:
                    print(f"    Sample: {getattr(s, 'audio_path', '?')}, labeled={getattr(s, 'is_labeled', False)}, caption={getattr(s, 'caption', '')[:50]}", flush=True)
                try:
                    result = builder.preprocess_to_tensors(
                        dit_handler=handler,
                        output_dir=tensor_dir,
                        preprocess_mode="lora",
                    )
                    print(f"  preprocess_to_tensors returned: {result}", flush=True)
                except Exception as preprocess_err:
                    print(f"  Preprocessing ERROR: {preprocess_err}", flush=True)
                    import traceback
                    traceback.print_exc()
                    raise
                # Check what was produced
                produced = list(Path(tensor_dir).glob("*.pt")) if Path(tensor_dir).exists() else []
                print(f"  Preprocessing produced {len(produced)} tensor files", flush=True)

            train_start = _time.time()
            train_progress.update({
                "phase": "training", "message": "Training LoRA...",
                "phase_progress": 0, "eta_seconds": None,
            })
            from acestep.training.trainer import LoRATrainer
            from acestep.training.configs import LoRAConfig, TrainingConfig
            lora_config = LoRAConfig(
                r=16, alpha=32, dropout=0.05,
                target_modules=[
                    "q_proj", "k_proj", "v_proj", "o_proj",  # attention
                    "gate_proj", "up_proj", "down_proj",       # feedforward (captures tonal detail)
                ],
            )
            training_config = TrainingConfig(
                learning_rate=3e-4, batch_size=2, gradient_accumulation_steps=2,
                max_epochs=15, save_every_n_epochs=5, warmup_steps=20,
                output_dir=str(LORA_DIR / name), mixed_precision="bf16",
                num_workers=0, pin_memory=True, prefetch_factor=None,
                persistent_workers=False, pin_memory_device="cuda",
                log_every_n_steps=1,
            )
            training_state = {"is_training": True, "should_stop": False}
            trainer = LoRATrainer(
                dit_handler=handler,
                lora_config=lora_config,
                training_config=training_config,
            )
            total_steps = training_config.max_epochs * max(1, track_count // (training_config.batch_size * training_config.gradient_accumulation_steps))
            train_progress["total"] = total_steps
            # Check for existing checkpoint to resume from
            checkpoint_dir = str(LORA_DIR / name)
            resume_from = None
            if Path(checkpoint_dir).exists():
                # Find latest epoch checkpoint
                ckpts = sorted(Path(checkpoint_dir).glob("epoch_*"))
                if ckpts:
                    resume_from = str(ckpts[-1])
                    train_progress["message"] = f"Resuming from checkpoint: {ckpts[-1].name}"

            # Verify tensors exist before training
            tensor_files = list(Path(tensor_dir).glob("*.pt")) if Path(tensor_dir).exists() else []
            if not tensor_files:
                raise RuntimeError(f"No preprocessed tensors found in {tensor_dir}. Preprocessing may have failed.")
            print(f"  Training on {len(tensor_files)} tensor files", flush=True)

            from services.gpu_lock import should_training_yield, release_gpu as _rel_gpu, wait_for_gpu as _wait_gpu
            step_count = 0
            for step, loss, status in trainer.train_from_preprocessed(tensor_dir, training_state, resume_from=resume_from):
                step_count += 1
                train_progress["step"] = step
                train_progress["phase_progress"] = step
                train_progress["phase_total"] = total_steps
                elapsed = _time.time() - train_start
                if step > 0:
                    per_step = elapsed / step
                    remaining = (total_steps - step) * per_step
                    train_progress["eta_seconds"] = int(remaining)
                train_progress["message"] = f"Step {step}/{total_steps} | Loss: {loss:.4f}"

                # Yield GPU to generation if a song is waiting
                if should_training_yield():
                    train_progress["message"] = f"Step {step}/{total_steps} | Paused — song generation has priority"
                    _rel_gpu()
                    # Wait for generation to finish and reclaim GPU
                    _wait_gpu("training", lambda msg: train_progress.update({"message": f"Step {step}/{total_steps} | {msg}"}))
                    train_progress["message"] = f"Step {step}/{total_steps} | Resuming training..."

            if step_count == 0:
                raise RuntimeError("Training completed 0 steps — check preprocessed tensors and training data.")
            train_progress["message"] = "Done!"
            train_progress["active"] = False

        except Exception as e:
            train_progress["error"] = str(e)
            train_progress["message"] = f"Error: {e}"
            train_progress["active"] = False
        finally:
            release_gpu()
            # Clear pending file — training finished (success or error)
            if _PENDING_TRAIN_FILE.exists():
                _PENDING_TRAIN_FILE.unlink(missing_ok=True)

    thread = threading.Thread(target=run_training, daemon=True)
    thread.start()
    return {"status": "started", "name": name}


@router.get("/api/train/status")
async def train_status():
    async def stream():
        while True:
            yield f"data: {json.dumps(train_progress)}\n\n"
            if not train_progress["active"]:
                break
            await asyncio.sleep(1)
    return StreamingResponse(stream(), media_type="text/event-stream")


@router.get("/api/train/progress")
async def train_progress_json():
    """Plain JSON endpoint for polling (mobile-friendly)."""
    return train_progress


@router.get("/api/gpu-status")
async def gpu_status():
    """Return current GPU lock status."""
    from services.gpu_lock import gpu_owner
    owner = gpu_owner()
    return {"locked": bool(owner), "owner": owner}


def resume_training_if_pending():
    """Called on startup: if a training was interrupted, restart it."""
    if not _PENDING_TRAIN_FILE.exists():
        return
    try:
        data = json.loads(_PENDING_TRAIN_FILE.read_text(encoding="utf-8"))
        artists = data.get("artists", [])
        name = data.get("name", "")
        if not artists:
            _PENDING_TRAIN_FILE.unlink(missing_ok=True)
            return
        print(f"  Resuming interrupted training: {name} ({', '.join(artists)})", flush=True)
        # Simulate the POST /api/train call
        import asyncio
        loop = asyncio.new_event_loop()
        loop.run_until_complete(
            start_training(TrainRequest(artists=artists, name=name))
        )
        loop.close()
    except Exception as e:
        print(f"  Failed to resume training: {e}", flush=True)
        _PENDING_TRAIN_FILE.unlink(missing_ok=True)
