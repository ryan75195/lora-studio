"""Persistent generation job queue for LoRA Studio.

Jobs are stored as JSON files in data/queue/.
States: queued -> generating -> ready_for_review -> accepted | discarded | failed

A single background worker thread processes jobs FIFO, one at a time.
The queue survives restarts: any job left in "generating" state at startup
is reset to "queued" so it can be retried.
"""

import json
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

# ---------------------------------------------------------------------------
# Paths (resolved lazily so tests can patch them)
# ---------------------------------------------------------------------------

_QUEUE_DIR: Optional[Path] = None


def _get_queue_dir() -> Path:
    global _QUEUE_DIR
    if _QUEUE_DIR is None:
        from services.config import PROJECT_ROOT
        _QUEUE_DIR = PROJECT_ROOT / "data" / "queue"
    _QUEUE_DIR.mkdir(parents=True, exist_ok=True)
    return _QUEUE_DIR


# ---------------------------------------------------------------------------
# Valid states
# ---------------------------------------------------------------------------

QUEUED = "queued"
GENERATING = "generating"
READY_FOR_REVIEW = "ready_for_review"
ACCEPTED = "accepted"
DISCARDED = "discarded"
FAILED = "failed"

_ACTIVE_STATES = {QUEUED, GENERATING}

# ---------------------------------------------------------------------------
# Internal locking
# ---------------------------------------------------------------------------

_lock = threading.Lock()
_worker_started = False


# ---------------------------------------------------------------------------
# Job CRUD helpers
# ---------------------------------------------------------------------------

def _job_path(job_id: str) -> Path:
    return _get_queue_dir() / f"{job_id}.json"


def _read_job(job_id: str) -> Optional[dict]:
    p = _job_path(job_id)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


def _write_job(job: dict) -> None:
    _job_path(job["id"]).write_text(json.dumps(job, indent=2), encoding="utf-8")


def _delete_job(job_id: str) -> None:
    p = _job_path(job_id)
    if p.exists():
        p.unlink()


def _list_jobs() -> list[dict]:
    """Return all jobs sorted newest-first by created_at."""
    jobs = []
    for p in _get_queue_dir().glob("*.json"):
        try:
            jobs.append(json.loads(p.read_text(encoding="utf-8")))
        except Exception:
            continue
    jobs.sort(key=lambda j: j.get("created_at", ""), reverse=True)
    return jobs


def _list_queued_fifo() -> list[dict]:
    """Return only queued jobs, oldest first (FIFO processing order)."""
    jobs = [j for j in _list_jobs() if j.get("status") == QUEUED]
    jobs.sort(key=lambda j: j.get("created_at", ""))
    return jobs


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def add_job(
    title: str,
    request_params: dict,
    message: str = "",
) -> dict:
    """Create a new queued job and return it."""
    job_id = str(uuid.uuid4())[:8]
    job = {
        "id": job_id,
        "title": title or job_id,
        "status": QUEUED,
        "message": message,
        "request_params": request_params,
        "draft_id": None,
        "created_at": datetime.now().isoformat(),
        "updated_at": datetime.now().isoformat(),
    }
    with _lock:
        _write_job(job)
    _ensure_worker()
    return job


def get_job(job_id: str) -> Optional[dict]:
    return _read_job(job_id)


def list_jobs() -> list[dict]:
    return _list_jobs()


def cancel_job(job_id: str) -> tuple[bool, str]:
    """Cancel a queued job. Returns (success, reason)."""
    with _lock:
        job = _read_job(job_id)
        if job is None:
            return False, "not_found"
        if job["status"] == GENERATING:
            return False, "generating"
        if job["status"] not in (QUEUED,):
            return False, "not_queued"
        _delete_job(job_id)
    return True, "ok"


def retry_job(job_id: str) -> tuple[bool, str]:
    """Re-queue a failed job. Returns (success, reason)."""
    with _lock:
        job = _read_job(job_id)
        if job is None:
            return False, "not_found"
        if job["status"] != FAILED:
            return False, "not_failed"
        job["status"] = QUEUED
        job["message"] = ""
        job["draft_id"] = None
        job["updated_at"] = datetime.now().isoformat()
        _write_job(job)
    _ensure_worker()
    return True, "ok"


def mark_accepted(draft_id: str) -> None:
    """Mark the job whose draft_id matches as accepted."""
    for job in _list_jobs():
        if job.get("draft_id") == draft_id:
            with _lock:
                job["status"] = ACCEPTED
                job["updated_at"] = datetime.now().isoformat()
                _write_job(job)
            return


def mark_discarded(draft_id: str) -> None:
    """Mark the job whose draft_id matches as discarded."""
    for job in _list_jobs():
        if job.get("draft_id") == draft_id:
            with _lock:
                job["status"] = DISCARDED
                job["updated_at"] = datetime.now().isoformat()
                _write_job(job)
            return


def clear_finished() -> int:
    """Delete all non-active jobs (accepted, discarded, failed). Returns count removed."""
    count = 0
    for job in _list_jobs():
        if job["status"] in (ACCEPTED, DISCARDED, FAILED):
            _delete_job(job["id"])
            count += 1
    return count


def discard_all_reviews() -> int:
    """Discard all ready_for_review jobs and delete their draft files. Returns count."""
    from services.config import DRAFT_DIR
    count = 0
    for job in _list_jobs():
        if job["status"] == READY_FOR_REVIEW:
            # Delete draft files
            draft_id = job.get("draft_id")
            if draft_id:
                for ext in [".mp3", ".json"]:
                    p = DRAFT_DIR / f"{draft_id}{ext}"
                    if p.exists():
                        p.unlink()
            with _lock:
                job["status"] = DISCARDED
                job["updated_at"] = datetime.now().isoformat()
                _write_job(job)
            count += 1
    return count


def queue_position(job_id: str) -> int:
    """1-based position of a queued job in the FIFO queue (0 if not queued)."""
    fifo = _list_queued_fifo()
    for i, j in enumerate(fifo, start=1):
        if j["id"] == job_id:
            return i
    return 0


# ---------------------------------------------------------------------------
# Worker
# ---------------------------------------------------------------------------

def _ensure_worker() -> None:
    global _worker_started
    with _lock:
        if _worker_started:
            return
        _worker_started = True
    t = threading.Thread(target=_worker_loop, daemon=True, name="queue-worker")
    t.start()


def _worker_loop() -> None:
    """Continuously pick the next queued job and process it."""
    import time
    while True:
        job = None
        with _lock:
            pending = _list_queued_fifo()
            if pending:
                job = pending[0]
                job["status"] = GENERATING
                job["message"] = "Starting..."
                job["updated_at"] = datetime.now().isoformat()
                _write_job(job)

        if job is None:
            time.sleep(1)
            continue

        _process_job(job)


def _update_job_message(job_id: str, message: str) -> None:
    with _lock:
        job = _read_job(job_id)
        if job:
            job["message"] = message
            job["updated_at"] = datetime.now().isoformat()
            _write_job(job)


def _process_job(job: dict) -> None:
    """Run one generation job synchronously (called from worker thread)."""
    from services.config import DRAFT_DIR, LORA_DIR
    from services import models as _models
    from services.gpu_lock import wait_for_gpu, release_gpu
    from pathlib import Path
    import json
    import tempfile
    import shutil
    from datetime import datetime

    job_id = job["id"]
    params = job["request_params"]

    try:
        # Acquire GPU lock before using models
        _update_job_message(job_id, "Waiting for GPU...")
        if not wait_for_gpu("generation", progress_callback=lambda msg: _update_job_message(job_id, msg)):
            _fail_job(job_id, "Timed out waiting for GPU")
            return

        try:
            _update_job_message(job_id, "Waiting for models...")
            # Wait for warmup to finish (models loaded by startup event)
            import time
            for _ in range(120):  # wait up to 2 minutes
                if _models._handler is not None and _models._llm is not None:
                    break
                time.sleep(1)
            _models._ensure_models()

            lora_name = params.get("lora_name", "")
            strength = float(params.get("strength", 1.0))

            _update_job_message(job_id, "Setting up LoRA..." if lora_name else "Using base model...")
            _models._setup_lora(lora_name, strength)

            from acestep.inference import generate_music, GenerationParams, GenerationConfig
            from services.config import OUTPUT_DIR as _OUT_DIR

            # Determine task type based on generation mode
            source_song_id = params.get("source_song_id", "")
            generation_mode = params.get("generation_mode", "fresh")
            is_cover = generation_mode == "cover" and source_song_id
            is_remix = generation_mode == "remix" and source_song_id

            if is_remix:
                # --- REMIX MODE ---
                # 1. Separate original song into vocals + instrumentals
                # 2. Generate fresh audio with new lyrics
                # 3. Separate new audio into vocals + instrumentals
                # 4. Mix original instrumentals + new vocals
                _process_remix_job(job_id, params, lora_name, strength, _OUT_DIR, DRAFT_DIR)
            else:
                # --- FRESH or COVER MODE ---
                task_type = "cover" if is_cover else "text2music"
                src_audio = str(_OUT_DIR / f"{source_song_id}.mp3") if is_cover else None

                _update_job_message(job_id, "Generating song...")

                gen_params = GenerationParams(
                    task_type=task_type,
                    src_audio=src_audio,
                    caption=params.get("caption", ""),
                    lyrics=params.get("lyrics", ""),
                    duration=float(params.get("duration", 120.0)),
                    bpm=params.get("bpm"),
                    keyscale=params.get("key", ""),
                    timesignature="4/4",
                    vocal_language="en",
                    inference_steps=15,
                    guidance_scale=12.0,
                    thinking=True,
                )
                config = GenerationConfig(batch_size=1, use_random_seed=True, audio_format="mp3")
                result = generate_music(
                    dit_handler=_models._handler,
                    llm_handler=_models._llm,
                    params=gen_params,
                    config=config,
                    save_dir=str(DRAFT_DIR),
                )

                _finalize_generation(job_id, params, result, lora_name, strength, DRAFT_DIR)

        finally:
            release_gpu()

    except Exception as e:
        _fail_job(job_id, str(e))


def _process_remix_job(job_id, params, lora_name, strength, output_dir, draft_dir):
    """Handle remix mode: separate, regenerate, extract vocals, mix."""
    from services import models as _models
    from acestep.inference import generate_music, GenerationParams, GenerationConfig
    from services.separation import separate_vocals, mix_audio
    from pathlib import Path
    import tempfile
    import shutil

    source_song_id = params.get("source_song_id", "")
    source_path = str(output_dir / f"{source_song_id}.mp3")

    if not Path(source_path).exists():
        _fail_job(job_id, "Source song not found for remix")
        return

    tmp_dir = tempfile.mkdtemp(prefix="remix_")
    try:
        # Step 1: Separate original audio
        _update_job_message(job_id, "Separating original audio...")
        orig_sep_dir = str(Path(tmp_dir) / "original")
        try:
            print(f"  Remix: separating {source_path} -> {orig_sep_dir}", flush=True)
            _, orig_instrumentals_path = separate_vocals(source_path, orig_sep_dir)
            print(f"  Remix: separation complete, instrumentals at {orig_instrumentals_path}", flush=True)
        except Exception as e:
            import traceback
            print(f"  Remix: separation failed: {e}", flush=True)
            traceback.print_exc()
            _update_job_message(job_id, "Separation failed, falling back to fresh generation...")
            _process_remix_fallback(job_id, params, lora_name, strength, draft_dir)
            return

        # Step 2: Generate new audio with edited lyrics (fresh generation)
        _update_job_message(job_id, "Generating new version...")
        gen_params = GenerationParams(
            task_type="text2music",
            src_audio=None,
            caption=params.get("caption", ""),
            lyrics=params.get("lyrics", ""),
            duration=float(params.get("duration", 120.0)),
            bpm=params.get("bpm"),
            keyscale=params.get("key", ""),
            timesignature="4/4",
            vocal_language="en",
            inference_steps=15,
            guidance_scale=12.0,
            thinking=True,
        )
        config = GenerationConfig(batch_size=1, use_random_seed=True, audio_format="mp3")
        result = generate_music(
            dit_handler=_models._handler,
            llm_handler=_models._llm,
            params=gen_params,
            config=config,
            save_dir=tmp_dir,
        )

        if not result.success or not result.audios:
            _fail_job(job_id, result.error or "Generation failed during remix")
            return

        new_audio_path = result.audios[0].get("path", "")
        if not new_audio_path or not Path(new_audio_path).exists():
            _fail_job(job_id, "No audio path returned during remix generation")
            return

        # Step 3: Separate new generation to extract vocals
        _update_job_message(job_id, "Extracting new vocals...")
        new_sep_dir = str(Path(tmp_dir) / "new")
        try:
            new_vocals_path, _ = separate_vocals(new_audio_path, new_sep_dir)
        except Exception as e:
            print(f"  Remix: new audio separation failed, falling back: {e}", flush=True)
            _update_job_message(job_id, "Vocal extraction failed, using full generation...")
            # Fall back: just use the fresh generation as-is
            draft_id = job_id
            draft_path = draft_dir / f"{draft_id}.mp3"
            Path(new_audio_path).rename(draft_path)
            _save_draft_meta(job_id, params, lora_name, strength, draft_dir)
            return

        # Step 4: Mix original instrumentals + new vocals
        _update_job_message(job_id, "Mixing tracks...")
        draft_id = job_id
        draft_path = draft_dir / f"{draft_id}.mp3"
        mix_audio(
            instrumental_path=orig_instrumentals_path,
            vocal_path=new_vocals_path,
            output_path=str(draft_path),
            vocal_volume=1.0,
            format="mp3",
        )

        _save_draft_meta(job_id, params, lora_name, strength, draft_dir)

    finally:
        # Clean up temp directory
        try:
            shutil.rmtree(tmp_dir, ignore_errors=True)
        except Exception:
            pass


def _process_remix_fallback(job_id, params, lora_name, strength, draft_dir):
    """Fall back to fresh generation when remix separation fails."""
    from services import models as _models
    from acestep.inference import generate_music, GenerationParams, GenerationConfig

    gen_params = GenerationParams(
        task_type="text2music",
        src_audio=None,
        caption=params.get("caption", ""),
        lyrics=params.get("lyrics", ""),
        duration=float(params.get("duration", 120.0)),
        bpm=params.get("bpm"),
        keyscale=params.get("key", ""),
        timesignature="4/4",
        vocal_language="en",
        inference_steps=8,
        guidance_scale=9.0,
        thinking=True,
    )
    config = GenerationConfig(batch_size=1, use_random_seed=True, audio_format="mp3")
    result = generate_music(
        dit_handler=_models._handler,
        llm_handler=_models._llm,
        params=gen_params,
        config=config,
        save_dir=str(draft_dir),
    )
    _finalize_generation(job_id, params, result, lora_name, strength, draft_dir)


def _save_draft_meta(job_id, params, lora_name, strength, draft_dir):
    """Write draft metadata JSON and mark the job as ready for review.

    If ``auto_accept_album_id`` is present in *params*, the draft is
    automatically accepted into the album instead of waiting for review.
    """
    import json
    import re
    import shutil
    from datetime import datetime
    from services.config import OUTPUT_DIR, LIBRARY_PATH

    draft_id = job_id
    meta = {
        "draft_id": draft_id,
        "title": params.get("title") or draft_id,
        "ai_prompt": params.get("ai_prompt", ""),
        "chat_history": params.get("chat_history", []),
        "lora_name": lora_name or "(base model)",
        "strength": strength,
        "caption": params.get("caption", ""),
        "lyrics": params.get("lyrics", ""),
        "bpm": params.get("bpm"),
        "key": params.get("key", ""),
        "duration": params.get("duration", 120.0),
        "source_song_id": params.get("source_song_id", ""),
        "generation_mode": params.get("generation_mode", "fresh"),
        "created_at": datetime.now().isoformat(),
    }

    auto_album = params.get("auto_accept_album_id")

    if auto_album:
        # --- Auto-accept: move draft straight to output and add to album ---
        draft_path = draft_dir / f"{draft_id}.mp3"
        title = params.get("title") or draft_id
        safe_title = re.sub(r'[<>:"/\\|?*]', '', title).strip() or draft_id

        dest = OUTPUT_DIR / f"{safe_title}.mp3"
        safe_title_final = safe_title
        counter = 1
        while dest.exists():
            safe_title_final = f"{safe_title} ({counter})"
            dest = OUTPUT_DIR / f"{safe_title_final}.mp3"
            counter += 1

        shutil.copy2(str(draft_path), str(dest))

        # Write inputs.json beside the mp3
        meta["created_at"] = datetime.now().isoformat()
        inputs_path = OUTPUT_DIR / f"{safe_title_final}.inputs.json"
        inputs_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")

        # Clean up draft files
        if draft_path.exists():
            draft_path.unlink()

        # Add song to album in library.json
        try:
            if LIBRARY_PATH.exists():
                lib = json.loads(LIBRARY_PATH.read_text(encoding="utf-8"))
            else:
                lib = {"albums": []}
            for a in lib["albums"]:
                if a["id"] == auto_album:
                    if safe_title_final not in a.get("song_ids", []):
                        a.setdefault("song_ids", []).append(safe_title_final)
                    break
            LIBRARY_PATH.write_text(json.dumps(lib, indent=2), encoding="utf-8")
        except Exception as e:
            print(f"  [Queue] Auto-accept: failed to update library: {e}", flush=True)

        # Mark job as accepted
        with _lock:
            j = _read_job(job_id)
            if j:
                j["status"] = ACCEPTED
                j["draft_id"] = draft_id
                j["message"] = f"Auto-accepted: {safe_title_final}"
                j["updated_at"] = datetime.now().isoformat()
                _write_job(j)

        print(f"  [Queue] Auto-accepted '{safe_title_final}' into album {auto_album}", flush=True)
    else:
        # --- Normal flow: save draft metadata and mark for review ---
        (draft_dir / f"{draft_id}.json").write_text(
            json.dumps(meta, indent=2), encoding="utf-8"
        )

        with _lock:
            j = _read_job(job_id)
            if j:
                j["status"] = READY_FOR_REVIEW
                j["draft_id"] = draft_id
                j["message"] = "Ready to review"
                j["updated_at"] = datetime.now().isoformat()
                _write_job(j)


def _finalize_generation(job_id, params, result, lora_name, strength, draft_dir):
    """Handle generation result: move audio, save metadata, update job status."""
    from pathlib import Path

    if result.success and result.audios:
        src = result.audios[0].get("path", "")
        if src:
            draft_id = job_id
            draft_path = draft_dir / f"{draft_id}.mp3"
            Path(src).rename(draft_path)

            _save_draft_meta(job_id, params, lora_name, strength, draft_dir)
        else:
            _fail_job(job_id, "No audio path returned")
    else:
        _fail_job(job_id, result.error or "Generation failed")


def _fail_job(job_id: str, error: str) -> None:
    with _lock:
        job = _read_job(job_id)
        if job:
            job["status"] = FAILED
            job["message"] = error
            job["updated_at"] = datetime.now().isoformat()
            _write_job(job)


# ---------------------------------------------------------------------------
# Startup recovery: reset any "generating" jobs back to "queued"
# ---------------------------------------------------------------------------

def recover_on_startup() -> None:
    """Call once at server startup to reset interrupted jobs."""
    global _worker_started
    _worker_started = False  # allow fresh worker to start
    recovered = 0
    for job in _list_jobs():
        if job.get("status") == GENERATING:
            with _lock:
                job["status"] = QUEUED
                job["message"] = "Re-queued after restart"
                job["updated_at"] = datetime.now().isoformat()
                _write_job(job)
            recovered += 1
    if recovered:
        print(f"  Queue: recovered {recovered} interrupted job(s)", flush=True)
        _ensure_worker()
    elif any(j.get("status") == QUEUED for j in _list_jobs()):
        _ensure_worker()
