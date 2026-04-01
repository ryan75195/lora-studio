"""Songs list and audio serving routes."""

import json
import threading
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from fastapi.responses import FileResponse

from services.config import OUTPUT_DIR

router = APIRouter()


@router.get("/api/songs")
async def list_songs():
    songs = []
    if OUTPUT_DIR.exists():
        for mp3 in sorted(
            OUTPUT_DIR.glob("*.mp3"),
            key=lambda f: f.stat().st_mtime,
            reverse=True,
        ):
            json_path = mp3.with_suffix(".json")
            meta = {}
            if json_path.exists():
                try:
                    data = json.loads(json_path.read_text(encoding="utf-8"))
                    audios = data.get("audios", [{}])
                    params = audios[0].get("params", {}) if audios else {}
                    meta = {
                        "bpm": params.get("bpm"),
                        "key": params.get("keyscale", ""),
                        "duration": params.get("duration"),
                        "caption": params.get("caption", ""),
                        "lora_used": "LoRA" if params.get("lora_loaded") else "Base",
                    }
                except Exception:
                    pass
            inputs = {}
            inputs_path = mp3.with_suffix(".inputs.json")
            if inputs_path.exists():
                try:
                    inputs = json.loads(inputs_path.read_text(encoding="utf-8"))
                except Exception:
                    pass
            songs.append({
                "id": mp3.stem,
                "filename": mp3.name,
                "size_mb": round(mp3.stat().st_size / (1024 * 1024), 1),
                "created_at": datetime.fromtimestamp(mp3.stat().st_mtime).isoformat(),
                "inputs": inputs,
                **meta,
            })
    return songs


@router.get("/api/songs/{song_id}/audio")
async def serve_audio(song_id: str):
    mp3 = OUTPUT_DIR / f"{song_id}.mp3"
    if not mp3.exists():
        raise HTTPException(status_code=404, detail="Song not found")
    return FileResponse(mp3, media_type="audio/mpeg")


@router.delete("/api/songs/{song_id}")
async def delete_song(song_id: str):
    mp3 = OUTPUT_DIR / f"{song_id}.mp3"
    if not mp3.exists():
        raise HTTPException(status_code=404, detail="Song not found")
    mp3.unlink()
    for ext in [".json", ".inputs.json", ".labels.json"]:
        p = OUTPUT_DIR / f"{song_id}{ext}"
        if p.exists():
            p.unlink()
    # Remove from any albums
    from services.config import LIBRARY_PATH
    if LIBRARY_PATH.exists():
        lib = json.loads(LIBRARY_PATH.read_text(encoding="utf-8"))
        for album in lib.get("albums", []):
            if song_id in album.get("song_ids", []):
                album["song_ids"] = [s for s in album["song_ids"] if s != song_id]
                album.get("youtube_videos", {}).pop(song_id, None)
        LIBRARY_PATH.write_text(json.dumps(lib, indent=2), encoding="utf-8")
    return {"deleted": song_id}


class BatchDeleteRequest(BaseModel):
    song_ids: list[str]


@router.post("/api/songs/batch-delete")
async def batch_delete_songs(body: BatchDeleteRequest):
    """Delete multiple songs at once, cleaning up files and library references."""
    from services.config import LIBRARY_PATH

    deleted = []
    not_found = []
    for song_id in body.song_ids:
        mp3 = OUTPUT_DIR / f"{song_id}.mp3"
        if not mp3.exists():
            not_found.append(song_id)
            continue
        mp3.unlink()
        for ext in [".json", ".inputs.json", ".labels.json"]:
            p = OUTPUT_DIR / f"{song_id}{ext}"
            if p.exists():
                p.unlink()
        deleted.append(song_id)

    # Remove all deleted songs from albums and favourites in one pass
    if deleted and LIBRARY_PATH.exists():
        lib = json.loads(LIBRARY_PATH.read_text(encoding="utf-8"))
        deleted_set = set(deleted)
        for album in lib.get("albums", []):
            album["song_ids"] = [s for s in album.get("song_ids", []) if s not in deleted_set]
            yt = album.get("youtube_videos", {})
            for sid in deleted:
                yt.pop(sid, None)
        # Remove from favourites
        lib["favourites"] = [s for s in lib.get("favourites", []) if s not in deleted_set]
        LIBRARY_PATH.write_text(json.dumps(lib, indent=2), encoding="utf-8")

    return {"deleted": deleted, "not_found": not_found}


# --- Stem separation ---

_strip_progress: dict = {"active": False, "message": "", "done": False, "error": None}


class StripRequest(BaseModel):
    keep: list[str] = ["drums", "bass", "other", "piano"]
    save_as_new: bool = False  # True = save as new song instead of overwriting


@router.post("/api/songs/{song_id}/strip-stems")
async def strip_stems(song_id: str, body: StripRequest):
    """Strip stems from a song using 6-stem Demucs."""
    global _strip_progress
    mp3 = OUTPUT_DIR / f"{song_id}.mp3"
    if not mp3.exists():
        raise HTTPException(status_code=404, detail="Song not found")
    if _strip_progress["active"]:
        raise HTTPException(status_code=409, detail="Stem separation already in progress")

    _strip_progress = {"active": True, "message": "Starting...", "done": False, "error": None}

    from services.config import DRAFT_DIR
    import uuid as _uuid

    draft_id = str(_uuid.uuid4())[:8]
    _strip_progress = {"active": True, "message": "Starting...", "done": False, "error": None, "draft_id": draft_id}

    def run():
        global _strip_progress
        try:
            import tempfile
            import shutil
            import subprocess
            from services.separation import separate_stems

            _strip_progress["message"] = "Separating stems (this takes a minute)..."
            tmp = tempfile.mkdtemp(prefix="stems_")
            output = separate_stems(str(mp3), tmp, keep=body.keep)

            _strip_progress["message"] = "Converting to MP3..."
            mp3_out = tmp + "/output.mp3"
            subprocess.run(["ffmpeg", "-y", "-i", output, "-b:a", "192k", mp3_out], capture_output=True)

            # Save as draft for review
            draft_path = DRAFT_DIR / f"{draft_id}.mp3"
            shutil.copy2(mp3_out, str(draft_path))

            # Create draft metadata
            stripped = [s for s in ["drums","bass","other","piano","guitar","vocals"] if s not in body.keep]
            meta = {}
            inputs_src = mp3.with_suffix(".inputs.json")
            if inputs_src.exists():
                meta = json.loads(inputs_src.read_text(encoding="utf-8"))
            meta["title"] = meta.get("title", song_id) + f" (no {', '.join(stripped)})"
            meta["source_song_id"] = song_id
            draft_json = DRAFT_DIR / f"{draft_id}.json"
            draft_json.write_text(json.dumps(meta, indent=2), encoding="utf-8")

            shutil.rmtree(tmp, ignore_errors=True)

            # Create a queue job so it shows in the review queue
            from services.queue import _read_job, _write_job, _lock, READY_FOR_REVIEW
            from datetime import datetime as _dt
            job = {
                "id": draft_id,
                "title": meta["title"],
                "status": READY_FOR_REVIEW,
                "message": "Ready to review",
                "request_params": {
                    "title": meta["title"],
                    "caption": meta.get("caption", ""),
                    "source_song_id": song_id,
                    "keep_stems": body.keep,
                },
                "draft_id": draft_id,
                "created_at": _dt.now().isoformat(),
                "updated_at": _dt.now().isoformat(),
            }
            with _lock:
                _write_job(job)

            _strip_progress.update(active=False, done=True, message="Ready for review!", draft_id=draft_id)
        except Exception as e:
            _strip_progress.update(active=False, done=True, error=str(e), message=f"Error: {e}")

    threading.Thread(target=run, daemon=True).start()
    return {"status": "started", "keep": body.keep, "draft_id": draft_id}


@router.get("/api/songs/strip-progress")
async def strip_progress():
    return _strip_progress
