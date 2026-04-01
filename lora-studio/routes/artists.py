"""Artist CRUD and track upload routes."""

import json
import re
import shutil
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from services.config import DATA_DIR

router = APIRouter()


# --- Helpers ---

def slugify(name: str) -> str:
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')


def get_artist_dir(slug: str) -> Path:
    d = DATA_DIR / slug
    if not d.exists():
        raise HTTPException(status_code=404, detail="Artist not found")
    return d


# --- Models ---

class CreateArtist(BaseModel):
    name: str
    genre: str = ""


# --- Routes ---

@router.get("/api/artists")
async def list_artists():
    artists = []
    if DATA_DIR.exists():
        for d in sorted(DATA_DIR.iterdir()):
            meta_path = d / "artist.json"
            if meta_path.exists():
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                tracks_dir = d / "tracks"
                track_count = len(list(tracks_dir.glob("*.mp3"))) if tracks_dir.exists() else 0
                artists.append({**meta, "slug": d.name, "track_count": track_count})
    return artists


@router.post("/api/artists")
async def create_artist(body: CreateArtist):
    slug = slugify(body.name)
    artist_dir = DATA_DIR / slug
    if artist_dir.exists():
        raise HTTPException(status_code=409, detail="Artist already exists")
    artist_dir.mkdir(parents=True)
    (artist_dir / "tracks").mkdir()
    meta = {"name": body.name, "genre": body.genre, "created_at": datetime.now().isoformat()}
    (artist_dir / "artist.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return {**meta, "slug": slug, "track_count": 0}


@router.get("/api/artists/{slug}")
async def get_artist(slug: str):
    d = get_artist_dir(slug)
    meta = json.loads((d / "artist.json").read_text(encoding="utf-8"))
    tracks_dir = d / "tracks"
    tracks = [f.name for f in sorted(tracks_dir.glob("*.mp3"))] if tracks_dir.exists() else []
    return {**meta, "slug": slug, "tracks": tracks, "track_count": len(tracks)}


@router.delete("/api/artists/{slug}")
async def delete_artist(slug: str):
    d = get_artist_dir(slug)
    shutil.rmtree(d)
    return {"deleted": slug}


@router.post("/api/artists/{slug}/upload")
async def upload_tracks(slug: str, files: list[UploadFile] = File(...)):
    d = get_artist_dir(slug)
    tracks_dir = d / "tracks"
    tracks_dir.mkdir(exist_ok=True)
    uploaded = []
    for f in files:
        if not f.filename.lower().endswith(".mp3"):
            continue
        dest = tracks_dir / f.filename
        with open(dest, "wb") as out:
            content = await f.read()
            out.write(content)
        uploaded.append(f.filename)
    return {"uploaded": uploaded}


@router.delete("/api/artists/{slug}/tracks/{filename}")
async def delete_track(slug: str, filename: str):
    d = get_artist_dir(slug)
    track = d / "tracks" / filename
    if not track.exists():
        raise HTTPException(status_code=404, detail="Track not found")
    track.unlink()
    return {"deleted": filename}
