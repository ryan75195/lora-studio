"""YouTube playlist import route: download all videos as MP3 into an artist's tracks/ dir."""

import asyncio
import json
import logging
import re
import threading
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from services.config import DATA_DIR

logger = logging.getLogger("lora-studio.youtube")
router = APIRouter()

# --- Module-level state for import progress ---

_import_progress: dict = {
    "active": False,
    "message": "",
    "current": 0,
    "total": 0,
    "errors": [],
    "done": False,
}


# --- Helpers ---

_YOUTUBE_PLAYLIST_RE = re.compile(
    r"https?://(www\.)?youtube\.com/playlist\?.*list=[\w\-]+"
)
_YOUTUBE_VIDEO_RE = re.compile(
    r"https?://((www\.)?youtube\.com/(watch\?.*v=|shorts/)|youtu\.be/)[\w\-]+"
)


def is_valid_youtube_url(url: str) -> bool:
    """Return True if the URL looks like a YouTube playlist or video URL (http/https only)."""
    return bool(_YOUTUBE_PLAYLIST_RE.search(url) or _YOUTUBE_VIDEO_RE.search(url))


def sanitize_filename(name: str) -> str:
    """Remove characters that are unsafe in filenames, collapse whitespace."""
    name = re.sub(r'[\\/*?:"<>|]', "", name)
    name = re.sub(r"[^\w\s\-.]", "", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name or "track"


# --- Models ---

class YoutubeImportRequest(BaseModel):
    url: str


# --- Routes ---

@router.post("/api/artists/{slug}/youtube-import")
async def youtube_import(slug: str, body: YoutubeImportRequest):
    """Start a background YouTube playlist/video import for the given artist."""
    global _import_progress

    if _import_progress["active"]:
        raise HTTPException(status_code=409, detail="An import is already in progress")

    artist_dir = DATA_DIR / slug
    if not artist_dir.exists():
        raise HTTPException(status_code=404, detail="Artist not found")

    url = body.url.strip()
    if not is_valid_youtube_url(url):
        raise HTTPException(status_code=422, detail="Invalid YouTube URL")

    tracks_dir = artist_dir / "tracks"
    tracks_dir.mkdir(exist_ok=True)

    _import_progress = {
        "active": True,
        "message": "Starting download...",
        "current": 0,
        "total": 0,
        "errors": [],
        "done": False,
    }

    logger.info(f"yt-import START | artist={slug} url={url}")

    thread = threading.Thread(
        target=_run_import,
        args=(url, tracks_dir),
        daemon=True,
    )
    thread.start()

    return {"status": "started", "slug": slug}


@router.get("/api/youtube-import/status")
async def youtube_import_status():
    """SSE stream of current import progress."""
    async def _stream():
        while True:
            yield f"data: {json.dumps(_import_progress)}\n\n"
            if not _import_progress["active"]:
                break
            await asyncio.sleep(0.8)

    return StreamingResponse(_stream(), media_type="text/event-stream")


@router.get("/api/youtube-import/progress")
async def youtube_import_progress():
    """Plain JSON endpoint for polling (mobile-friendly)."""
    return _import_progress


# --- Background worker ---

def _run_import(url: str, tracks_dir: Path) -> None:
    global _import_progress

    try:
        import yt_dlp  # noqa: PLC0415
    except ImportError:
        logger.error("yt-import FAILED | yt-dlp not installed")
        _import_progress.update(
            active=False,
            done=True,
            message="Error: yt-dlp is not installed. Run: pip install yt-dlp",
        )
        return

    # Collect entries first so we can report "X/Y"
    _import_progress["message"] = "Fetching playlist info..."

    ydl_opts_info = {
        "quiet": True,
        "extract_flat": True,
        "ignoreerrors": True,
    }

    entries = []
    try:
        with yt_dlp.YoutubeDL(ydl_opts_info) as ydl:
            info = ydl.extract_info(url, download=False)
            if info is None:
                raise ValueError("Could not retrieve playlist/video info")
            if "entries" in info:
                # Playlist
                entries = [e for e in (info.get("entries") or []) if e]
            else:
                # Single video
                entries = [info]
    except Exception as exc:
        logger.error(f"yt-import FAILED | fetch info: {exc}", exc_info=True)
        _import_progress.update(
            active=False,
            done=True,
            message=f"Failed to fetch info: {exc}",
        )
        return

    total = len(entries)
    logger.info(f"yt-import | found {total} entries")
    if total == 0:
        _import_progress.update(
            active=False,
            done=True,
            message="No videos found in playlist",
        )
        return

    _import_progress["total"] = total
    errors: list[str] = []

    for idx, entry in enumerate(entries, start=1):
        entry_id = entry.get("id") or entry.get("url", "")
        title = entry.get("title") or entry_id
        safe_title = sanitize_filename(title)

        _import_progress["message"] = f"Downloading {idx}/{total}: {title}"
        _import_progress["current"] = idx

        video_url = (
            f"https://www.youtube.com/watch?v={entry_id}"
            if not entry.get("url", "").startswith("http")
            else entry["url"]
        )

        output_template = str(tracks_dir / f"{safe_title}.%(ext)s")

        ydl_opts_dl = {
            "quiet": True,
            "ignoreerrors": True,
            "format": "bestaudio/best",
            "outtmpl": output_template,
            "postprocessors": [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "mp3",
                    "preferredquality": "192",
                }
            ],
            "noplaylist": True,
        }

        try:
            with yt_dlp.YoutubeDL(ydl_opts_dl) as ydl:
                ret = ydl.download([video_url])
                if ret != 0:
                    logger.warning(f"yt-import | failed download {idx}/{total}: {title}")
                    errors.append(f"Failed: {title}")
                else:
                    logger.info(f"yt-import | downloaded {idx}/{total}: {title}")
        except Exception as exc:
            logger.error(f"yt-import | error on {idx}/{total} {title}: {exc}", exc_info=True)
            errors.append(f"{title}: {exc}")

    _import_progress["errors"] = errors
    _import_progress["active"] = False
    _import_progress["done"] = True
    _import_progress["message"] = (
        f"Done! {total - len(errors)}/{total} tracks downloaded."
        + (f" {len(errors)} error(s)." if errors else "")
    )
    logger.info(f"yt-import DONE | {total - len(errors)}/{total} ok, {len(errors)} errors")
