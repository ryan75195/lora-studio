"""Generation routes: queue-based generation, drafts CRUD, repaint, open-folder."""

import json
import re
import shutil
import threading
import uuid as _uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from services.config import DRAFT_DIR, OUTPUT_DIR, LORA_DIR
from services import models as _models
import services.queue as _queue

router = APIRouter()

# --- Generation status for repaint (module-level singleton) ---
gen_status = {"active": False, "message": ""}


# --- Models ---

class GenerateRequest(BaseModel):
    title: str = ""
    lora_name: str = ""
    strength: float = 1.0
    caption: str
    lyrics: str = ""
    bpm: Optional[int] = None
    key: str = ""
    duration: float = 120.0
    ai_prompt: str = ""
    chat_history: list = []
    source_song_id: str = ""
    generation_mode: str = "fresh"


class RepaintRequest(BaseModel):
    draft_id: str
    start: float
    end: float
    caption: str = ""
    lyrics: str = ""
    mode: str = "balanced"
    strength: float = 0.5


class SongRepaintRequest(BaseModel):
    song_id: str
    start: float
    end: float
    caption: str = ""
    lyrics: str = ""
    mode: str = "balanced"
    strength: float = 0.5


# --- Queue routes ---

@router.post("/api/generate")
async def generate_song(body: GenerateRequest):
    """Add a generation job to the queue. Returns job_id and queue position."""
    try:
        from services.telemetry import log_event
        log_event("generate", {"title": body.title, "lora": body.lora_name, "bpm": body.bpm, "key": body.key, "duration": body.duration})
    except Exception:
        pass
    if body.lora_name:
        lora_path = LORA_DIR / body.lora_name / "final" / "adapter"
        if not (lora_path / "adapter_model.safetensors").exists():
            raise HTTPException(status_code=404, detail="LoRA not found")

    request_params = {
        "title": body.title,
        "lora_name": body.lora_name,
        "strength": body.strength,
        "caption": body.caption,
        "lyrics": body.lyrics,
        "bpm": body.bpm,
        "key": body.key,
        "duration": body.duration,
        "ai_prompt": body.ai_prompt,
        "chat_history": body.chat_history,
        "source_song_id": body.source_song_id,
        "generation_mode": body.generation_mode,
    }

    job = _queue.add_job(
        title=body.title or body.caption[:40],
        request_params=request_params,
    )
    position = _queue.queue_position(job["id"])
    return {"job_id": job["id"], "position": position}


@router.get("/api/queue")
async def get_queue():
    """List all jobs, newest first."""
    return _queue.list_jobs()


@router.delete("/api/queue/{job_id}")
async def cancel_job(job_id: str):
    """Cancel a queued job (cannot cancel a job that is currently generating)."""
    ok, reason = _queue.cancel_job(job_id)
    if not ok:
        if reason == "not_found":
            raise HTTPException(status_code=404, detail="Job not found")
        if reason == "generating":
            raise HTTPException(status_code=409, detail="Cannot cancel a job that is currently generating")
        raise HTTPException(status_code=400, detail=f"Cannot cancel job: {reason}")
    return {"cancelled": job_id}


@router.post("/api/queue/clear")
async def clear_queue():
    """Delete all finished jobs (accepted, discarded, failed)."""
    count = _queue.clear_finished()
    return {"cleared": count}


@router.post("/api/queue/discard-all")
async def discard_all_reviews():
    """Discard all drafts waiting for review."""
    count = _queue.discard_all_reviews()
    return {"discarded": count}


@router.post("/api/queue/{job_id}/retry")
async def retry_job(job_id: str):
    """Re-queue a failed job."""
    ok, reason = _queue.retry_job(job_id)
    if not ok:
        if reason == "not_found":
            raise HTTPException(status_code=404, detail="Job not found")
        raise HTTPException(status_code=400, detail=f"Cannot retry job: {reason}")
    job = _queue.get_job(job_id)
    position = _queue.queue_position(job_id)
    return {"job_id": job_id, "position": position}


# Keep legacy status endpoint for repaint polling
@router.get("/api/generate/status")
async def get_gen_status():
    return gen_status


# --- Draft routes ---

@router.get("/api/drafts/{draft_id}/audio")
async def serve_draft_audio(draft_id: str):
    path = DRAFT_DIR / f"{draft_id}.mp3"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Draft not found")
    return FileResponse(path, media_type="audio/mpeg")


@router.get("/api/drafts/{draft_id}")
async def get_draft(draft_id: str):
    meta_path = DRAFT_DIR / f"{draft_id}.json"
    if not meta_path.exists():
        raise HTTPException(status_code=404, detail="Draft not found")
    return json.loads(meta_path.read_text(encoding="utf-8"))


@router.post("/api/drafts/{draft_id}/accept")
async def accept_draft(draft_id: str, overwrite_id: str = ""):
    """Move draft to output folder as a saved song.

    If *overwrite_id* is provided, the draft replaces the existing song
    with that ID (filename stem) instead of creating a new file.
    """
    try:
        from services.telemetry import log_event
        log_event("accept", {"draft_id": draft_id, "overwrite_id": overwrite_id})
    except Exception:
        pass
    draft_mp3 = DRAFT_DIR / f"{draft_id}.mp3"
    draft_json = DRAFT_DIR / f"{draft_id}.json"
    if not draft_mp3.exists():
        raise HTTPException(status_code=404, detail="Draft not found")

    meta = json.loads(draft_json.read_text(encoding="utf-8")) if draft_json.exists() else {}

    if overwrite_id:
        # Overwrite existing song files
        dest = OUTPUT_DIR / f"{overwrite_id}.mp3"
        if not dest.exists():
            raise HTTPException(status_code=404, detail="Original song not found for overwrite")
        shutil.move(str(draft_mp3), str(dest))
        inputs_path = OUTPUT_DIR / f"{overwrite_id}.inputs.json"
        meta["created_at"] = datetime.now().isoformat()
        inputs_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    else:
        # Create new song (original behaviour)
        title = meta.get("title", draft_id)
        safe_title = re.sub(r'[<>:"/\\|?*]', '', title).strip() or draft_id

        dest = OUTPUT_DIR / f"{safe_title}.mp3"
        counter = 1
        while dest.exists():
            dest = OUTPUT_DIR / f"{safe_title} ({counter}).mp3"
            counter += 1

        shutil.move(str(draft_mp3), str(dest))
        inputs_path = dest.with_suffix(".inputs.json")
        meta["created_at"] = datetime.now().isoformat()
        inputs_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")

    if draft_json.exists():
        draft_json.unlink()

    # Update queue job status
    _queue.mark_accepted(draft_id)

    # Favourites are user-curated — songs are added manually via the heart button

    return {"saved": str(dest), "filename": dest.name}


@router.post("/api/drafts/{draft_id}/discard")
async def discard_draft(draft_id: str):
    """Delete a draft."""
    for ext in [".mp3", ".json"]:
        p = DRAFT_DIR / f"{draft_id}{ext}"
        if p.exists():
            p.unlink()

    # Update queue job status
    _queue.mark_discarded(draft_id)

    return {"discarded": draft_id}


_draft_strip_progress: dict = {"active": False, "message": "", "done": False, "error": None}


class DraftStripRequest(BaseModel):
    keep: list[str] = ["drums", "bass", "other", "piano"]


@router.post("/api/drafts/{draft_id}/strip-stems")
async def strip_draft_stems(draft_id: str, body: DraftStripRequest):
    """Strip stems from a draft using 6-stem Demucs. Overwrites draft in-place."""
    global _draft_strip_progress
    mp3 = DRAFT_DIR / f"{draft_id}.mp3"
    if not mp3.exists():
        raise HTTPException(status_code=404, detail="Draft not found")
    if _draft_strip_progress["active"]:
        raise HTTPException(status_code=409, detail="Already stripping")

    _draft_strip_progress = {"active": True, "message": "Starting...", "done": False, "error": None}

    def run():
        global _draft_strip_progress
        try:
            import tempfile, shutil, subprocess
            from services.separation import separate_stems

            _draft_strip_progress["message"] = "Separating stems..."
            tmp = tempfile.mkdtemp(prefix="dstrip_")
            output = separate_stems(str(mp3), tmp, keep=body.keep)

            _draft_strip_progress["message"] = "Converting to MP3..."
            mp3_out = tmp + "/output.mp3"
            subprocess.run(["ffmpeg", "-y", "-i", output, "-b:a", "192k", mp3_out], capture_output=True)

            shutil.copy2(mp3_out, str(mp3))
            shutil.rmtree(tmp, ignore_errors=True)
            _draft_strip_progress.update(active=False, done=True, message="Stems stripped!")
        except Exception as e:
            _draft_strip_progress.update(active=False, done=True, error=str(e), message=f"Error: {e}")

    threading.Thread(target=run, daemon=True).start()
    return {"status": "started"}


@router.get("/api/drafts/strip-progress")
async def draft_strip_progress():
    return _draft_strip_progress


@router.post("/api/songs/{song_id}/to-draft")
async def song_to_draft(song_id: str):
    """Copy a saved song to a draft for editing (repaint, strip, etc)."""
    song_mp3 = OUTPUT_DIR / f"{song_id}.mp3"
    if not song_mp3.exists():
        raise HTTPException(status_code=404, detail="Song not found")

    draft_id = str(_uuid.uuid4())[:8]
    draft_mp3 = DRAFT_DIR / f"{draft_id}.mp3"
    shutil.copy2(str(song_mp3), str(draft_mp3))

    # Copy metadata
    song_meta = {}
    inputs_path = OUTPUT_DIR / f"{song_id}.inputs.json"
    if inputs_path.exists():
        song_meta = json.loads(inputs_path.read_text(encoding="utf-8"))

    song_meta["source_song_id"] = song_id
    draft_json = DRAFT_DIR / f"{draft_id}.json"
    draft_json.write_text(json.dumps(song_meta, indent=2), encoding="utf-8")

    # Create queue job so it shows in review
    job = {
        "id": draft_id,
        "title": song_meta.get("title", song_id),
        "status": "ready_for_review",
        "message": "Ready to edit",
        "request_params": {
            "title": song_meta.get("title", song_id),
            "caption": song_meta.get("caption", ""),
            "source_song_id": song_id,
        },
        "draft_id": draft_id,
        "created_at": datetime.now().isoformat(),
        "updated_at": datetime.now().isoformat(),
    }
    with _queue._lock:
        _queue._write_job(job)

    return {"draft_id": draft_id}


@router.post("/api/songs/repaint")
async def repaint_song(body: SongRepaintRequest):
    """Copy a saved song to a draft and repaint a section. Goes to review queue."""
    global gen_status
    if gen_status.get("active"):
        raise HTTPException(status_code=409, detail="Repaint already in progress")

    song_mp3 = OUTPUT_DIR / f"{body.song_id}.mp3"
    if not song_mp3.exists():
        raise HTTPException(status_code=404, detail="Song not found")

    # Copy song to draft
    draft_id = str(_uuid.uuid4())[:8]
    draft_mp3 = DRAFT_DIR / f"{draft_id}.mp3"
    shutil.copy2(str(song_mp3), str(draft_mp3))

    # Copy metadata
    song_meta = {}
    inputs_path = OUTPUT_DIR / f"{body.song_id}.inputs.json"
    if inputs_path.exists():
        song_meta = json.loads(inputs_path.read_text(encoding="utf-8"))

    draft_json = DRAFT_DIR / f"{draft_id}.json"
    song_meta["source_song_id"] = body.song_id
    song_meta["title"] = song_meta.get("title", body.song_id) + " (Repainted)"
    draft_json.write_text(json.dumps(song_meta, indent=2), encoding="utf-8")

    # Create queue job
    job = {
        "id": draft_id,
        "title": song_meta["title"],
        "status": "generating",
        "message": "Repainting section...",
        "request_params": {
            "title": song_meta["title"],
            "caption": song_meta.get("caption", ""),
            "source_song_id": body.song_id,
        },
        "draft_id": draft_id,
        "created_at": datetime.now().isoformat(),
        "updated_at": datetime.now().isoformat(),
    }
    with _queue._lock:
        _queue._write_job(job)

    # Now repaint using existing logic
    gen_status = {"active": True, "message": "Repainting..."}

    def run():
        global gen_status
        try:
            from services.gpu_lock import wait_for_gpu, release_gpu
            wait_for_gpu("generation")
            try:
                _models._ensure_models()
                lora = song_meta.get("lora_name", "")
                if lora and lora != "(base model)":
                    _models._setup_lora(lora, song_meta.get("strength", 1.0))

                gen_status["message"] = "Repainting section..."
                from acestep.inference import generate_music, GenerationParams, GenerationConfig
                params = GenerationParams(
                    task_type="repaint",
                    src_audio=str(draft_mp3),
                    caption=body.caption or song_meta.get("caption", ""),
                    lyrics=body.lyrics,
                    duration=song_meta.get("duration", 120),
                    bpm=song_meta.get("bpm"),
                    keyscale=song_meta.get("key", ""),
                    timesignature="4/4",
                    vocal_language="en",
                    inference_steps=8,
                    guidance_scale=9.0,
                    thinking=True,
                    repainting_start=body.start,
                    repainting_end=body.end,
                    repaint_mode=body.mode,
                    repaint_strength=body.strength,
                )
                config = GenerationConfig(batch_size=1, use_random_seed=True, audio_format="mp3")
                result = generate_music(
                    dit_handler=_models._handler, llm_handler=_models._llm,
                    params=params, config=config,
                    save_dir=str(DRAFT_DIR),
                )

                if result.success and result.audios:
                    new_path = result.audios[0].get("path", "")
                    if new_path and Path(new_path).exists():
                        if draft_mp3.exists():
                            draft_mp3.unlink()
                        Path(new_path).rename(draft_mp3)
                    # Mark as ready for review
                    with _queue._lock:
                        j = _queue._read_job(draft_id)
                        if j:
                            j["status"] = "ready_for_review"
                            j["message"] = "Ready to review"
                            j["updated_at"] = datetime.now().isoformat()
                            _queue._write_job(j)
                    gen_status = {"active": False, "message": "Done!", "draft_id": draft_id}
                else:
                    with _queue._lock:
                        j = _queue._read_job(draft_id)
                        if j:
                            j["status"] = "failed"
                            j["message"] = result.error or "Repaint failed"
                            j["updated_at"] = datetime.now().isoformat()
                            _queue._write_job(j)
                    gen_status = {"active": False, "message": result.error or "Repaint failed", "error": True}
            finally:
                release_gpu()
        except Exception as e:
            gen_status = {"active": False, "message": str(e), "error": True}

    threading.Thread(target=run, daemon=True).start()
    return {"status": "started", "draft_id": draft_id}


@router.post("/api/drafts/repaint")
async def repaint_draft(body: RepaintRequest):
    """Repaint a section of a draft. Overwrites the draft in-place."""
    global gen_status
    if gen_status.get("active"):
        raise HTTPException(status_code=409, detail="Generation in progress")

    draft_mp3 = DRAFT_DIR / f"{body.draft_id}.mp3"
    if not draft_mp3.exists():
        raise HTTPException(status_code=404, detail="Draft not found")

    draft_json = DRAFT_DIR / f"{body.draft_id}.json"
    meta = json.loads(draft_json.read_text(encoding="utf-8")) if draft_json.exists() else {}

    gen_status = {"active": True, "message": "Repainting..."}

    def run():
        global gen_status
        try:
            _models._ensure_models()
            _models._setup_lora(meta.get("lora_name", ""), meta.get("strength", 1.0))

            gen_status["message"] = "Repainting section..."
            from acestep.inference import generate_music, GenerationParams, GenerationConfig
            params = GenerationParams(
                task_type="repaint",
                src_audio=str(draft_mp3),
                caption=body.caption or meta.get("caption", ""),
                lyrics=body.lyrics,
                duration=meta.get("duration", 120),
                bpm=meta.get("bpm"),
                keyscale=meta.get("key", ""),
                timesignature="4/4",
                vocal_language="en",
                inference_steps=8,
                guidance_scale=9.0,
                thinking=True,
                repainting_start=body.start,
                repainting_end=body.end,
                repaint_mode=body.mode,
                repaint_strength=body.strength,
            )
            config = GenerationConfig(batch_size=1, use_random_seed=True, audio_format="mp3")
            result = generate_music(
                dit_handler=_models._handler, llm_handler=_models._llm,
                params=params, config=config,
                save_dir=str(DRAFT_DIR),
            )

            if result.success and result.audios:
                new_path = result.audios[0].get("path", "")
                if new_path and Path(new_path).exists():
                    if draft_mp3.exists():
                        draft_mp3.unlink()
                    Path(new_path).rename(draft_mp3)
                gen_status = {"active": False, "message": "Done!", "draft_id": body.draft_id}
            else:
                gen_status = {
                    "active": False,
                    "message": result.error or "Repaint failed",
                    "error": True,
                }
        except Exception as e:
            gen_status = {"active": False, "message": str(e), "error": True}

    threading.Thread(target=run, daemon=True).start()
    return {"draft_id": body.draft_id}


@router.post("/api/open-folder")
async def open_folder():
    import subprocess
    subprocess.Popen(['explorer', str(OUTPUT_DIR)])
    return {"opened": str(OUTPUT_DIR)}
