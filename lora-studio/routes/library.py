"""Library, album, and cover-image routes."""

import json
import uuid as _uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from services.config import LIBRARY_PATH, COVERS_DIR, OUTPUT_DIR
from routes.songs import list_songs

router = APIRouter()


# --- Helpers ---

def _load_library() -> dict:
    if LIBRARY_PATH.exists():
        lib = json.loads(LIBRARY_PATH.read_text(encoding="utf-8"))
    else:
        lib = {"albums": []}
    # Ensure favourites key exists
    if "favourites" not in lib:
        lib["favourites"] = []
    return lib


def _save_library(lib: dict):
    LIBRARY_PATH.write_text(json.dumps(lib, indent=2), encoding="utf-8")


# --- Models ---

class CreateAlbum(BaseModel):
    name: str
    lora_name: str = ""


class UpdateAlbum(BaseModel):
    name: Optional[str] = None
    song_ids: Optional[list[str]] = None


class UpdateFavourites(BaseModel):
    song_ids: list[str]


class CoverRequest(BaseModel):
    user_prompt: str = ""


# --- Routes ---

@router.get("/api/library")
async def get_library():
    """Get all albums with their songs, plus ungrouped songs by LoRA."""
    lib = _load_library()
    songs = await list_songs()
    song_map = {s["id"]: s for s in songs}
    assigned: set = set()
    for album in lib["albums"]:
        album["songs_data"] = []
        for sid in album.get("song_ids", []):
            if sid in song_map:
                album["songs_data"].append(song_map[sid])
                assigned.add(sid)
    ungrouped: dict = {}
    for s in songs:
        if s["id"] not in assigned:
            lora = (s.get("inputs") or {}).get("lora_name", "(base model)")
            ungrouped.setdefault(lora, []).append(s)
    # Enrich favourites with song data (preserving order)
    favourites_data = []
    for sid in lib.get("favourites", []):
        if sid in song_map:
            favourites_data.append(song_map[sid])
    return {
        "albums": lib["albums"],
        "ungrouped": ungrouped,
        "favourites": lib.get("favourites", []),
        "favourites_data": favourites_data,
    }


@router.post("/api/library/albums")
async def create_album(body: CreateAlbum):
    lib = _load_library()
    album = {
        "id": str(_uuid.uuid4())[:8],
        "name": body.name,
        "lora_name": body.lora_name,
        "song_ids": [],
        "cover": None,
        "created_at": datetime.now().isoformat(),
    }
    lib["albums"].append(album)
    _save_library(lib)
    return album


@router.put("/api/library/albums/{album_id}")
async def update_album(album_id: str, body: UpdateAlbum):
    lib = _load_library()
    for album in lib["albums"]:
        if album["id"] == album_id:
            if body.name is not None:
                album["name"] = body.name
            if body.song_ids is not None:
                album["song_ids"] = body.song_ids
            _save_library(lib)
            return album
    raise HTTPException(status_code=404, detail="Album not found")


@router.post("/api/library/albums/{album_id}/songs/{song_id}")
async def add_song_to_album(album_id: str, song_id: str):
    lib = _load_library()
    for album in lib["albums"]:
        if album["id"] == album_id:
            if song_id not in album["song_ids"]:
                album["song_ids"].append(song_id)
            _save_library(lib)
            return album
    raise HTTPException(status_code=404, detail="Album not found")


@router.delete("/api/library/albums/{album_id}/songs/{song_id}")
async def remove_song_from_album(album_id: str, song_id: str):
    lib = _load_library()
    for album in lib["albums"]:
        if album["id"] == album_id:
            album["song_ids"] = [s for s in album["song_ids"] if s != song_id]
            _save_library(lib)
            return album
    raise HTTPException(status_code=404, detail="Album not found")


@router.delete("/api/library/albums/{album_id}")
async def delete_album(album_id: str):
    lib = _load_library()
    lib["albums"] = [a for a in lib["albums"] if a["id"] != album_id]
    _save_library(lib)
    return {"deleted": album_id}


@router.put("/api/library/favourites")
async def update_favourites(body: UpdateFavourites):
    """Reorder / replace the entire favourites list."""
    lib = _load_library()
    lib["favourites"] = body.song_ids
    _save_library(lib)
    return {"favourites": lib["favourites"]}


@router.post("/api/library/favourites/{song_id}")
async def add_to_favourites(song_id: str):
    """Add a song to the front of favourites (if not already present)."""
    lib = _load_library()
    if song_id not in lib["favourites"]:
        lib["favourites"].insert(0, song_id)
        _save_library(lib)
    return {"favourites": lib["favourites"]}


@router.delete("/api/library/favourites/{song_id}")
async def remove_from_favourites(song_id: str):
    """Remove a song from favourites."""
    lib = _load_library()
    lib["favourites"] = [s for s in lib["favourites"] if s != song_id]
    _save_library(lib)
    return {"favourites": lib["favourites"]}


@router.get("/api/library/covers/{filename}")
async def serve_cover(filename: str):
    path = COVERS_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="Cover not found")
    return FileResponse(
        path,
        media_type="image/png",
        headers={"Cache-Control": "no-cache, must-revalidate"},
    )
