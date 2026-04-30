"""YouTube upload route: create videos from album songs and upload to YouTube."""

import asyncio
import json
import os
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

import services.config as _cfg
from services.config import DATA_DIR, OUTPUT_DIR, COVERS_DIR, PROJECT_ROOT, LIBRARY_PATH

router = APIRouter()

# --- Paths ---
CREDENTIALS_FILE = PROJECT_ROOT / "data" / "youtube_credentials.json"

# --- Module-level upload progress ---
_upload_progress: dict = {
    "active": False,
    "message": "",
    "current": 0,
    "total": 0,
    "errors": [],
    "done": False,
    "playlist_url": None,
}

# --- Module-level sync progress ---
_sync_progress: dict = {
    "active": False,
    "message": "",
    "current": 0,
    "total": 0,
    "errors": [],
    "done": False,
}

# --- OAuth2 scopes ---
SCOPES = ["https://www.googleapis.com/auth/youtube.upload",
          "https://www.googleapis.com/auth/youtube"]


# --- Helpers ---

def _get_client_secrets() -> tuple[str, str]:
    client_id = _cfg.GOOGLE_CLIENT_ID or os.environ.get("GOOGLE_CLIENT_ID", "")
    client_secret = _cfg.GOOGLE_CLIENT_SECRET or os.environ.get("GOOGLE_CLIENT_SECRET", "")
    if not client_id or not client_secret:
        raise HTTPException(
            status_code=503,
            detail=(
                "YouTube upload requires Google OAuth credentials. "
                "Set google_client_id and google_client_secret in lora-studio/config.json, "
                "or export GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET as environment variables."
            ),
        )
    return client_id, client_secret


def _ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def _load_credentials():
    """Load stored OAuth2 credentials or return None."""
    if not CREDENTIALS_FILE.exists():
        return None
    try:
        from google.oauth2.credentials import Credentials  # noqa: PLC0415
        data = json.loads(CREDENTIALS_FILE.read_text(encoding="utf-8"))
        return Credentials(
            token=data.get("token"),
            refresh_token=data.get("refresh_token"),
            token_uri=data.get("token_uri", "https://oauth2.googleapis.com/token"),
            client_id=data.get("client_id"),
            client_secret=data.get("client_secret"),
            scopes=data.get("scopes"),
        )
    except Exception:
        return None


def _save_credentials(creds) -> None:
    CREDENTIALS_FILE.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": list(creds.scopes) if creds.scopes else SCOPES,
    }
    CREDENTIALS_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _is_authenticated() -> bool:
    creds = _load_credentials()
    if creds is None:
        return False
    # Try to refresh if expired
    if not creds.valid:
        try:
            from google.auth.transport.requests import Request  # noqa: PLC0415
            creds.refresh(Request())
            _save_credentials(creds)
            return True
        except Exception:
            return False
    return True


def _build_youtube_service():
    from google.auth.transport.requests import Request  # noqa: PLC0415
    from googleapiclient.discovery import build  # noqa: PLC0415
    creds = _load_credentials()
    if creds is None:
        raise RuntimeError("Not authenticated with YouTube")
    if not creds.valid:
        creds.refresh(Request())
        _save_credentials(creds)
    return build("youtube", "v3", credentials=creds)


def _load_library() -> dict:
    if LIBRARY_PATH.exists():
        return json.loads(LIBRARY_PATH.read_text(encoding="utf-8"))
    return {"albums": []}


def _save_library(lib: dict):
    LIBRARY_PATH.write_text(json.dumps(lib, indent=2), encoding="utf-8")


def _find_album_songs(album_id: str) -> tuple[dict, list[dict]]:
    """Return (album, songs_list) for the given album_id."""
    lib = _load_library()
    if not lib.get("albums"):
        raise HTTPException(status_code=404, detail="Library not found")
    album = next((a for a in lib.get("albums", []) if a["id"] == album_id), None)
    if album is None:
        raise HTTPException(status_code=404, detail="Album not found")

    # Resolve songs from OUTPUT_DIR
    songs = []
    for song_id in album.get("song_ids", []):
        audio_file = OUTPUT_DIR / f"{song_id}.mp3"
        if audio_file.exists():
            songs.append({"id": song_id, "path": audio_file})
    return album, songs


def _make_video(audio_path: Path, cover_path: Path | None, output_path: Path, loop_path: Path | None = None) -> bool:
    """Use ffmpeg to create an MP4 from cover art + audio. Returns True on success."""
    if not _ffmpeg_available():
        return False

    if loop_path and loop_path.exists():
        cmd = [
            "ffmpeg", "-y",
            "-stream_loop", "-1",
            "-i", str(loop_path),
            "-i", str(audio_path),
            "-c:v", "libx264",
            "-preset", "medium",
            "-crf", "18",
            "-c:a", "aac",
            "-b:a", "192k",
            "-shortest",
            "-pix_fmt", "yuv420p",
            str(output_path),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        return result.returncode == 0

    if cover_path and cover_path.exists():
        cmd = [
            "ffmpeg", "-y",
            "-loop", "1",
            "-i", str(cover_path),
            "-i", str(audio_path),
            "-c:v", "libx264",
            "-tune", "stillimage",
            "-c:a", "aac",
            "-b:a", "192k",
            "-shortest",
            "-pix_fmt", "yuv420p",
            str(output_path),
        ]
    else:
        # No cover: generate a black frame
        cmd = [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", "color=c=black:s=1280x720:r=1",
            "-i", str(audio_path),
            "-c:v", "libx264",
            "-tune", "stillimage",
            "-c:a", "aac",
            "-b:a", "192k",
            "-shortest",
            "-pix_fmt", "yuv420p",
            str(output_path),
        ]

    result = subprocess.run(cmd, capture_output=True)
    return result.returncode == 0


# --- Routes ---

_auth_thread = None
_auth_url_holder: dict = {"url": None, "event": None}


@router.get("/api/youtube/auth-url")
async def get_auth_url():
    """Start a local OAuth server on port 8089 and return the auth URL."""
    global _auth_thread

    client_id, client_secret = _get_client_secrets()
    if not client_id or not client_secret:
        raise HTTPException(status_code=503, detail="YouTube API credentials not configured.")

    os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = "1"

    _auth_url_holder["url"] = None
    _auth_url_holder["event"] = threading.Event()

    def run_auth():
        try:
            import webbrowser  # noqa: PLC0415
            from google_auth_oauthlib.flow import InstalledAppFlow  # noqa: PLC0415

            flow = InstalledAppFlow.from_client_config(
                {"installed": {
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "redirect_uris": ["http://localhost"],
                }},
                scopes=SCOPES,
            )

            # Intercept the URL that run_local_server generates (has correct state)
            _orig_open = webbrowser.open
            def _capture(url, *a, **kw):
                _auth_url_holder["url"] = url
                _auth_url_holder["event"].set()
            webbrowser.open = _capture

            try:
                creds = flow.run_local_server(
                    port=8089,
                    open_browser=True,
                    prompt="consent",
                    success_message=(
                        "<html><body style='font-family:system-ui;background:#121212;color:#fff;"
                        "display:flex;align-items:center;justify-content:center;height:100vh'>"
                        "<div style='text-align:center'>"
                        "<div style='font-size:48px;margin-bottom:16px'>&#10003;</div>"
                        "<h2 style='color:#1ed760'>YouTube Connected!</h2>"
                        "<p style='color:#a7a7a7'>You can close this tab and return to LoRA Studio.</p>"
                        "</div></body></html>"
                    ),
                )
                _save_credentials(creds)
                print(f"[YouTube Auth] Credentials saved to {CREDENTIALS_FILE}", flush=True)
            finally:
                webbrowser.open = _orig_open
        except Exception as e:
            print(f"[YouTube Auth] Error: {e}", flush=True)
            _auth_url_holder["event"].set()

    _auth_thread = threading.Thread(target=run_auth, daemon=True)
    _auth_thread.start()

    # Wait for the thread to capture the URL (up to 10s)
    _auth_url_holder["event"].wait(timeout=10)

    url = _auth_url_holder["url"]
    if not url:
        raise HTTPException(status_code=500, detail="Failed to start auth server")

    print(f"[YouTube Auth] Auth URL ready (localhost:8089 server listening)", flush=True)
    return {
        "auth_url": url,
        "note": "Complete sign-in, then close the tab and check again in LoRA Studio.",
    }


@router.get("/api/youtube/auth-status")
async def auth_status():
    """Return whether the user is authenticated with YouTube."""
    result = {"authenticated": _is_authenticated()}
    if result["authenticated"]:
        # Include current channel info if available
        channel_id = _get_selected_channel()
        if channel_id:
            result["channel_id"] = channel_id
    return result


@router.get("/api/youtube/channels")
async def list_channels():
    """List all YouTube channels accessible to the authenticated user."""
    if not _is_authenticated():
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        youtube = _build_youtube_service()
        resp = youtube.channels().list(part="snippet", mine=True).execute()
        channels = []
        for ch in resp.get("items", []):
            channels.append({
                "id": ch["id"],
                "title": ch["snippet"]["title"],
                "thumbnail": ch["snippet"]["thumbnails"].get("default", {}).get("url", ""),
            })
        # Also check for brand accounts / managed channels
        resp2 = youtube.channels().list(part="snippet", managedByMe=True).execute()
        existing_ids = {c["id"] for c in channels}
        for ch in resp2.get("items", []):
            if ch["id"] not in existing_ids:
                channels.append({
                    "id": ch["id"],
                    "title": ch["snippet"]["title"],
                    "thumbnail": ch["snippet"]["thumbnails"].get("default", {}).get("url", ""),
                })
        selected = _get_selected_channel()
        return {"channels": channels, "selected": selected}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/youtube/select-channel")
async def select_channel(body: dict):
    """Select which YouTube channel to upload to."""
    channel_id = body.get("channel_id", "")
    if not channel_id:
        raise HTTPException(status_code=400, detail="channel_id required")
    # Store selection
    channel_file = CREDENTIALS_FILE.parent / "youtube_channel.json"
    channel_file.write_text(json.dumps({"channel_id": channel_id}), encoding="utf-8")
    return {"selected": channel_id}


@router.post("/api/youtube/logout")
async def youtube_logout():
    """Clear YouTube credentials and channel selection."""
    if CREDENTIALS_FILE.exists():
        CREDENTIALS_FILE.unlink()
    channel_file = CREDENTIALS_FILE.parent / "youtube_channel.json"
    if channel_file.exists():
        channel_file.unlink()
    return {"status": "logged_out"}


def _get_selected_channel() -> str:
    """Return the selected channel ID, or empty string."""
    channel_file = CREDENTIALS_FILE.parent / "youtube_channel.json"
    if channel_file.exists():
        try:
            return json.loads(channel_file.read_text(encoding="utf-8")).get("channel_id", "")
        except Exception:
            pass
    return ""


@router.post("/api/library/albums/{album_id}/youtube-upload")
async def youtube_upload(album_id: str):
    """Upload all songs in an album to YouTube as unlisted videos, then create a playlist."""
    global _upload_progress

    if _upload_progress["active"]:
        raise HTTPException(status_code=409, detail="An upload is already in progress")

    if not _is_authenticated():
        raise HTTPException(
            status_code=401,
            detail="Not authenticated with YouTube. Call /api/youtube/auth-url first.",
        )

    if not _ffmpeg_available():
        raise HTTPException(
            status_code=503,
            detail=(
                "ffmpeg is not available. Install it and ensure it is on your PATH. "
                "See https://ffmpeg.org/download.html"
            ),
        )

    # Resolve album + songs eagerly (raises HTTPException on bad data before thread starts)
    album, songs = _find_album_songs(album_id)

    if not songs:
        raise HTTPException(
            status_code=422, detail="Album has no songs with audio files on disk"
        )

    _upload_progress = {
        "active": True,
        "message": "Preparing upload...",
        "current": 0,
        "total": len(songs),
        "errors": [],
        "done": False,
        "playlist_url": None,
    }

    thread = threading.Thread(
        target=_run_upload,
        args=(album, songs),
        daemon=True,
    )
    thread.start()
    return {"status": "started", "album_id": album_id, "total": len(songs)}


@router.get("/api/youtube-upload/status")
async def youtube_upload_status():
    """SSE stream of current upload progress."""
    async def _stream():
        while True:
            yield f"data: {json.dumps(_upload_progress)}\n\n"
            if not _upload_progress["active"]:
                break
            await asyncio.sleep(1)

    return StreamingResponse(_stream(), media_type="text/event-stream")


@router.get("/api/youtube-upload/progress")
async def youtube_upload_progress():
    """Plain JSON endpoint for polling (mobile-friendly)."""
    return _upload_progress


# --- Background upload worker ---

def _run_upload(album: dict, songs: list[dict]) -> None:
    global _upload_progress

    errors: list[str] = []
    video_ids: list[str] = []
    uploaded_songs: list[tuple[str, str]] = []  # (song_id, video_id) pairs
    total = len(songs)

    # Determine cover path — prefer wide version for video backgrounds
    cover_path = _resolve_cover_path(album, prefer_wide=True)

    try:
        youtube = _build_youtube_service()
    except Exception as exc:
        _upload_progress.update(
            active=False,
            done=True,
            message=f"Authentication error: {exc}",
        )
        return

    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp_dir:
        tmp = Path(tmp_dir)

        for idx, song in enumerate(songs, start=1):
            song_id = song["id"]
            audio_path: Path = song["path"]
            title = song_id  # Fallback; will be overridden if metadata is available

            # Try to read better title from song metadata JSON
            meta_json = OUTPUT_DIR / f"{song_id}.inputs.json"
            song_meta = {}
            if meta_json.exists():
                try:
                    song_meta = json.loads(meta_json.read_text(encoding="utf-8"))
                    title = song_meta.get("title") or title
                except Exception:
                    pass

            _upload_progress["message"] = f"Creating video {idx}/{total}: {title}"
            _upload_progress["current"] = idx

            video_path = tmp / f"{song_id}.mp4"
            ok = _make_video(audio_path, cover_path, video_path, loop_path=COVERS_DIR / f"{album.get('id', '')}_loop.mp4")
            if not ok:
                errors.append(f"{title}: ffmpeg failed to create video")
                continue

            # Upload to YouTube
            _upload_progress["message"] = f"Uploading {idx}/{total}: {title}"
            try:
                from googleapiclient.http import MediaFileUpload  # noqa: PLC0415

                request_body = _build_video_metadata(song_id, album, songs)
                media = MediaFileUpload(str(video_path), chunksize=-1, resumable=True)
                insert_request = youtube.videos().insert(
                    part="snippet,status",
                    body=request_body,
                    media_body=media,
                )
                response = None
                while response is None:
                    _, response = insert_request.next_chunk()
                video_ids.append(response["id"])
                uploaded_songs.append((song_id, response["id"]))
            except Exception as exc:
                errors.append(f"{title}: {exc}")

    # Create playlist and add all uploaded videos
    playlist_url: str | None = None
    if video_ids:
        try:
            _upload_progress["message"] = "Creating YouTube playlist..."
            pl_response = youtube.playlists().insert(
                part="snippet,status",
                body={
                    "snippet": {
                        "title": album["name"],
                        "description": f'{album["name"]} — full album\n\n#newmusic #originalsong #album',
                    },
                    "status": {"privacyStatus": "public"},
                },
            ).execute()
            playlist_id = pl_response["id"]
            playlist_url = f"https://www.youtube.com/playlist?list={playlist_id}"

            for vid_id in video_ids:
                youtube.playlistItems().insert(
                    part="snippet",
                    body={
                        "snippet": {
                            "playlistId": playlist_id,
                            "resourceId": {"kind": "youtube#video", "videoId": vid_id},
                        }
                    },
                ).execute()
        except Exception as exc:
            errors.append(f"Playlist creation: {exc}")

    # Post-upload: update descriptions with actual video links to recommendations
    # Post-upload: replace [LINK:id:title] placeholders with actual YouTube URLs
    if uploaded_songs and len(uploaded_songs) > 1:
        import re
        _upload_progress["message"] = "Adding video links to descriptions..."
        video_map = {sid: vid for sid, vid in uploaded_songs}
        for sid, vid_id in uploaded_songs:
            try:
                vid_resp = youtube.videos().list(part="snippet", id=vid_id).execute()
                if not vid_resp.get("items"):
                    continue
                snippet = vid_resp["items"][0]["snippet"]
                desc = snippet.get("description", "")

                # Replace [LINK:song_id:title] with actual YouTube URL
                def replace_link(m):
                    link_sid = m.group(1)
                    if link_sid in video_map:
                        return f"https://www.youtube.com/watch?v={video_map[link_sid]}"
                    return m.group(0)

                desc = re.sub(r"\[LINK:([^:]+):[^\]]+\]", replace_link, desc)

                # Also add playlist URL if not already there
                if playlist_url and "playlist?list=" not in desc:
                    desc = desc.replace("\n#", f"\nFull album: {playlist_url}\n\n#")

                youtube.videos().update(
                    part="snippet",
                    body={
                        "id": vid_id,
                        "snippet": {
                            "title": snippet["title"],
                            "description": desc,
                            "tags": snippet.get("tags", []),
                            "categoryId": snippet.get("categoryId", "10"),
                        },
                    },
                ).execute()
            except Exception as exc:
                errors.append(f"Link update {_get_song_title(sid)}: {exc}")

    # Persist youtube_playlist_id and youtube_videos mapping to library.json
    if uploaded_songs:
        try:
            lib = _load_library()
            for a in lib.get("albums", []):
                if a["id"] == album["id"]:
                    if playlist_url:
                        a["youtube_playlist_id"] = playlist_id
                    video_map = a.get("youtube_videos") or {}
                    for sid, vid in uploaded_songs:
                        video_map[sid] = vid
                    a["youtube_videos"] = video_map
                    # Store cover+loop hash for change detection in future syncs
                    import hashlib as _hl
                    _cp = _resolve_cover_path(album, prefer_wide=True)
                    _hash = ""
                    if _cp and _cp.exists():
                        _hash = _hl.md5(_cp.read_bytes()).hexdigest()
                    _lp = COVERS_DIR / f"{album['id']}_loop.mp4"
                    if _lp.exists():
                        _hash += "_" + _hl.md5(_lp.read_bytes()).hexdigest()
                    if _hash:
                        a["youtube_cover_hash"] = _hash
                    break
            _save_library(lib)
        except Exception as exc:
            errors.append(f"Failed to save YouTube data to library: {exc}")

    uploaded = len(video_ids)
    _upload_progress.update(
        active=False,
        done=True,
        errors=errors,
        playlist_url=playlist_url,
        message=(
            f"Done! {uploaded}/{total} video(s) uploaded."
            + (f" Playlist: {playlist_url}" if playlist_url else "")
            + (f" {len(errors)} error(s)." if errors else "")
        ),
    )


# ---------------------------------------------------------------------------
# YouTube Sync
# ---------------------------------------------------------------------------


def _get_song_title(song_id: str) -> str:
    """Read the title from a song's metadata JSON, falling back to song_id."""
    meta_json = OUTPUT_DIR / f"{song_id}.inputs.json"
    if meta_json.exists():
        try:
            meta = json.loads(meta_json.read_text(encoding="utf-8"))
            return meta.get("title") or song_id
        except Exception:
            pass
    return song_id


def _build_video_metadata(song_id: str, album: dict, all_songs: list[dict]) -> dict:
    """Build YouTube video snippet with clean description, tags, and recommendations."""
    import random

    meta_json = OUTPUT_DIR / f"{song_id}.inputs.json"
    song_meta = {}
    if meta_json.exists():
        try:
            song_meta = json.loads(meta_json.read_text(encoding="utf-8"))
        except Exception:
            pass

    title = song_meta.get("title", song_id)
    caption = song_meta.get("caption", "")
    bpm = song_meta.get("bpm", "")
    key = song_meta.get("key", "")
    album_name = album.get("name", "")

    # Pick 2 random other songs for "More from this album" links
    # Note: actual YouTube URLs will be patched in the post-upload step
    other_songs = [s for s in all_songs if s["id"] != song_id]
    recs = random.sample(other_songs, min(2, len(other_songs)))
    rec_ids = [r["id"] for r in recs]

    # Build description — clean format matching what we settled on
    description = f'{title} — from the album "{album_name}"\n\n'
    description += "More from this album:\n"
    # Placeholder — will be replaced with actual URLs in post-upload step
    for rid in rec_ids:
        rec_title = _get_song_title(rid)
        description += f"[LINK:{rid}:{rec_title}]\n"
    playlist_id = album.get("youtube_playlist_id", "")
    if playlist_id:
        description += f"\nFull album: https://www.youtube.com/playlist?list={playlist_id}\n"
    description += "\n#newmusic #originalsong #pop #blues #indiemusic"

    # Tags
    caption_tags = [t.strip() for t in caption.split(",") if t.strip()]
    genre_tags = [t.strip().lower() for t in caption_tags if any(g in t.strip().lower() for g in ["pop", "rock", "blues", "folk", "jazz", "acoustic", "indie", "soul", "electronic"])]
    tags = ["new music", "original song", "music video", "lyrics", album_name]
    tags.extend(genre_tags[:5])
    tags.extend(["indie music", "new artist", "original music"])
    if bpm:
        tags.append(f"{bpm} bpm")
    if key:
        tags.append(key)
    tags = list(dict.fromkeys(tags))[:15]

    return {
        "snippet": {
            "title": title,
            "description": description,
            "tags": tags,
            "categoryId": "10",
        },
        "status": {
            "privacyStatus": "public",
        },
    }


def _resolve_cover_path(album: dict, prefer_wide=False) -> Path | None:
    """Return the cover image Path for an album, or None.

    If prefer_wide=True, returns the landscape version for video backgrounds.
    """
    album_id = album.get("id", "")

    if prefer_wide:
        wide = COVERS_DIR / f"{album_id}_wide.png"
        if wide.exists():
            return wide

    album_cover = album.get("cover")
    if album_cover:
        cover_filename = album_cover.split("/")[-1].split("?")[0]
        candidate = COVERS_DIR / cover_filename
        if candidate.exists():
            return candidate
    return None


@router.post("/api/library/albums/{album_id}/youtube-sync")
async def youtube_sync(album_id: str):
    """Sync album state with YouTube: add new songs, remove deleted, rename changed, reorder."""
    global _sync_progress

    if _sync_progress["active"]:
        raise HTTPException(status_code=409, detail="A sync is already in progress")

    if _upload_progress["active"]:
        raise HTTPException(status_code=409, detail="An upload is already in progress")

    if not _is_authenticated():
        raise HTTPException(
            status_code=401,
            detail="Not authenticated with YouTube. Call /api/youtube/auth-url first.",
        )

    if not _ffmpeg_available():
        raise HTTPException(
            status_code=503,
            detail="ffmpeg is not available. Install it and ensure it is on your PATH.",
        )

    album, songs = _find_album_songs(album_id)

    playlist_id = album.get("youtube_playlist_id")
    if not playlist_id:
        raise HTTPException(status_code=400, detail="Upload to YouTube first")

    # Check if the playlist is accessible on the current channel
    # If not (e.g. user switched channels), clear old data and redirect to fresh upload
    try:
        yt = _build_youtube_service()
        pl_resp = yt.playlists().list(part="id", id=playlist_id).execute()
        if not pl_resp.get("items"):
            raise ValueError("Playlist not found")
    except Exception:
        lib = _load_library()
        for a in lib["albums"]:
            if a["id"] == album_id:
                a["youtube_playlist_id"] = ""
                a["youtube_videos"] = {}
                a["youtube_cover_hash"] = ""
                break
        _save_library(lib)
        raise HTTPException(status_code=400, detail="Playlist not found on current channel. Use Upload instead — it will create a new playlist.")

    youtube_videos = album.get("youtube_videos") or {}

    _sync_progress = {
        "active": True,
        "message": "Preparing sync...",
        "current": 0,
        "total": 0,
        "errors": [],
        "done": False,
    }

    thread = threading.Thread(
        target=_run_sync,
        args=(album, songs, playlist_id, youtube_videos),
        daemon=True,
    )
    thread.start()
    return {"status": "started", "album_id": album_id}


@router.get("/api/youtube-sync/status")
async def youtube_sync_status():
    """SSE stream of current sync progress."""
    async def _stream():
        while True:
            yield f"data: {json.dumps(_sync_progress)}\n\n"
            if not _sync_progress["active"]:
                break
            await asyncio.sleep(1)

    return StreamingResponse(_stream(), media_type="text/event-stream")


@router.get("/api/youtube-sync/progress")
async def youtube_sync_progress():
    """Plain JSON endpoint for polling (mobile-friendly)."""
    return _sync_progress


def _run_sync(
    album: dict,
    songs: list[dict],
    playlist_id: str,
    youtube_videos: dict[str, str],
) -> None:
    """Background worker: sync album with YouTube playlist."""
    global _sync_progress

    errors: list[str] = []
    current_song_ids: list[str] = [s["id"] for s in songs]
    yt_song_ids = set(youtube_videos.keys())
    local_song_ids = set(current_song_ids)

    new_song_ids = [sid for sid in current_song_ids if sid not in yt_song_ids]
    removed_song_ids = [sid for sid in yt_song_ids if sid not in local_song_ids]

    # Count total operations for progress
    total_ops = len(new_song_ids) + len(removed_song_ids) + 1  # +1 for rename/reorder check
    _sync_progress["total"] = total_ops
    step = 0

    try:
        youtube = _build_youtube_service()
    except Exception as exc:
        _sync_progress.update(
            active=False, done=True,
            message=f"Authentication error: {exc}",
        )
        return

    cover_path = _resolve_cover_path(album, prefer_wide=True)

    # --- 1. Upload new songs ---
    if new_song_ids:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp_dir:
            tmp = Path(tmp_dir)
            for sid in new_song_ids:
                step += 1
                title = _get_song_title(sid)
                _sync_progress["current"] = step
                _sync_progress["message"] = f"Uploading new song: {title}"

                audio_file = OUTPUT_DIR / f"{sid}.mp3"
                if not audio_file.exists():
                    errors.append(f"{title}: audio file not found")
                    continue

                video_path = tmp / f"{sid}.mp4"
                ok = _make_video(audio_file, cover_path, video_path, loop_path=COVERS_DIR / f"{album.get('id', '')}_loop.mp4")
                if not ok:
                    errors.append(f"{title}: ffmpeg failed to create video")
                    continue

                try:
                    from googleapiclient.http import MediaFileUpload  # noqa: PLC0415

                    request_body = _build_video_metadata(sid, album, songs)
                    media = MediaFileUpload(str(video_path), chunksize=-1, resumable=True)
                    insert_req = youtube.videos().insert(
                        part="snippet,status",
                        body=request_body,
                        media_body=media,
                    )
                    response = None
                    while response is None:
                        _, response = insert_req.next_chunk()
                    vid_id = response["id"]
                    youtube_videos[sid] = vid_id

                    # Add to playlist
                    youtube.playlistItems().insert(
                        part="snippet",
                        body={
                            "snippet": {
                                "playlistId": playlist_id,
                                "resourceId": {"kind": "youtube#video", "videoId": vid_id},
                            }
                        },
                    ).execute()
                except Exception as exc:
                    errors.append(f"{title}: {exc}")

    # --- 2. Remove deleted songs ---
    for sid in removed_song_ids:
        step += 1
        _sync_progress["current"] = step
        _sync_progress["message"] = f"Removing video for: {sid}"

        vid_id = youtube_videos.get(sid)
        if vid_id:
            # Remove from playlist first (prevents "hidden video" ghost entries)
            try:
                pi_resp = youtube.playlistItems().list(
                    part="id,snippet", playlistId=playlist_id, maxResults=50,
                ).execute()
                for pi in pi_resp.get("items", []):
                    if pi["snippet"]["resourceId"]["videoId"] == vid_id:
                        youtube.playlistItems().delete(id=pi["id"]).execute()
                        break
            except Exception:
                pass

            # Then delete the video itself
            try:
                youtube.videos().delete(id=vid_id).execute()
            except Exception as exc:
                errors.append(f"Delete video {sid}: {exc}")
            del youtube_videos[sid]

    # --- 3. Rename changed titles ---
    step += 1
    _sync_progress["current"] = step
    _sync_progress["message"] = "Checking for title changes and reordering..."

    # Fetch current video titles from YouTube for songs still in the album
    remaining_vid_ids = [youtube_videos[sid] for sid in current_song_ids if sid in youtube_videos]
    yt_titles: dict[str, str] = {}  # video_id -> current YouTube title

    # Fetch in batches of 50
    for i in range(0, len(remaining_vid_ids), 50):
        batch = remaining_vid_ids[i:i + 50]
        try:
            resp = youtube.videos().list(
                part="snippet",
                id=",".join(batch),
            ).execute()
            for item in resp.get("items", []):
                yt_titles[item["id"]] = item["snippet"]["title"]
        except Exception as exc:
            errors.append(f"Fetch video titles: {exc}")

    # Check and rename
    for sid in current_song_ids:
        if sid not in youtube_videos:
            continue
        vid_id = youtube_videos[sid]
        local_title = _get_song_title(sid)
        yt_title = yt_titles.get(vid_id)

        if yt_title and yt_title != local_title:
            _sync_progress["message"] = f"Renaming: {yt_title} -> {local_title}"
            try:
                youtube.videos().update(
                    part="snippet",
                    body={
                        "id": vid_id,
                        "snippet": {
                            "title": local_title,
                            "categoryId": "10",
                        },
                    },
                ).execute()
            except Exception as exc:
                errors.append(f"Rename {local_title}: {exc}")

    # --- 4. Re-upload videos if album cover or video loop changed ---
    cover_path = _resolve_cover_path(album, prefer_wide=True)
    import hashlib
    current_cover_hash = ""
    if cover_path and cover_path.exists():
        current_cover_hash = hashlib.md5(cover_path.read_bytes()).hexdigest()
    # Also hash the video loop if it exists
    loop_path = COVERS_DIR / f"{album.get('id', '')}_loop.mp4"
    if loop_path.exists():
        current_cover_hash += "_" + hashlib.md5(loop_path.read_bytes()).hexdigest()
    stored_cover_hash = album.get("youtube_cover_hash", "")

    cover_changed = current_cover_hash and current_cover_hash != stored_cover_hash
    remaining_vids = {sid: youtube_videos[sid] for sid in current_song_ids if sid in youtube_videos}

    if cover_changed and remaining_vids:
        _sync_progress["message"] = "Cover changed — re-uploading all videos..."
        _sync_progress["total"] += len(remaining_vids)
        print(f"  [YouTube Sync] Cover changed ({stored_cover_hash[:8]} -> {current_cover_hash[:8]}), re-uploading {len(remaining_vids)} videos", flush=True)

        from googleapiclient.http import MediaFileUpload as _MFU  # noqa: PLC0415

        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp_dir:
            tmp = Path(tmp_dir)
            for sid, old_vid_id in list(remaining_vids.items()):
                step += 1
                title = _get_song_title(sid)
                _sync_progress["current"] = step
                _sync_progress["message"] = f"Re-uploading: {title}"

                audio_file = OUTPUT_DIR / f"{sid}.mp3"
                if not audio_file.exists():
                    errors.append(f"Re-upload {title}: audio not found")
                    continue

                # Create new video with updated cover
                video_path = tmp / f"{sid}.mp4"
                ok = _make_video(audio_file, cover_path, video_path, loop_path=COVERS_DIR / f"{album.get('id', '')}_loop.mp4")
                if not ok:
                    errors.append(f"Re-upload {title}: ffmpeg failed")
                    continue

                try:
                    # Upload new video with SEO metadata
                    media = _MFU(str(video_path), chunksize=-1, resumable=True)
                    insert_req = youtube.videos().insert(
                        part="snippet,status",
                        body=_build_video_metadata(sid, album, songs),
                        media_body=media,
                    )
                    resp = None
                    while resp is None:
                        _, resp = insert_req.next_chunk()
                    new_vid_id = resp["id"]

                    # Remove old video from playlist
                    try:
                        pi_resp = youtube.playlistItems().list(
                            part="id,snippet", playlistId=playlist_id, maxResults=50,
                        ).execute()
                        for pi in pi_resp.get("items", []):
                            if pi["snippet"]["resourceId"]["videoId"] == old_vid_id:
                                youtube.playlistItems().delete(id=pi["id"]).execute()
                                break
                    except Exception:
                        pass

                    # Delete old video
                    try:
                        youtube.videos().delete(id=old_vid_id).execute()
                    except Exception:
                        pass

                    # Add new video to playlist
                    try:
                        youtube.playlistItems().insert(
                            part="snippet",
                            body={
                                "snippet": {
                                    "playlistId": playlist_id,
                                    "resourceId": {"kind": "youtube#video", "videoId": new_vid_id},
                                },
                            },
                        ).execute()
                    except Exception as pi_exc:
                        errors.append(f"Add to playlist {title}: {pi_exc}")

                    # Update mapping
                    youtube_videos[sid] = new_vid_id
                    print(f"  [YouTube Sync] Re-uploaded {title}: {old_vid_id} -> {new_vid_id}", flush=True)
                except Exception as exc:
                    errors.append(f"Re-upload {title}: {exc}")

        # Store the new cover hash
        album["youtube_cover_hash"] = current_cover_hash
    elif not cover_changed and current_cover_hash:
        # No change — store hash for future comparison if not already stored
        if not stored_cover_hash:
            album["youtube_cover_hash"] = current_cover_hash

    # --- 5. Reorder playlist items ---
    _sync_progress["message"] = "Reordering playlist..."

    # Fetch all playlist items
    playlist_items: list[dict] = []
    page_token = None
    while True:
        try:
            resp = youtube.playlistItems().list(
                part="snippet",
                playlistId=playlist_id,
                maxResults=50,
                pageToken=page_token,
            ).execute()
            playlist_items.extend(resp.get("items", []))
            page_token = resp.get("nextPageToken")
            if not page_token:
                break
        except Exception as exc:
            errors.append(f"Fetch playlist items: {exc}")
            break

    # Build a map of video_id -> playlistItem id
    pi_by_vid: dict[str, str] = {}
    for item in playlist_items:
        vid_id = item["snippet"]["resourceId"]["videoId"]
        pi_by_vid[vid_id] = item["id"]

    # Reorder: set position for each item according to album song_ids order
    desired_order = [youtube_videos[sid] for sid in current_song_ids if sid in youtube_videos]
    for position, vid_id in enumerate(desired_order):
        pi_id = pi_by_vid.get(vid_id)
        if not pi_id:
            continue
        try:
            youtube.playlistItems().update(
                part="snippet",
                body={
                    "id": pi_id,
                    "snippet": {
                        "playlistId": playlist_id,
                        "resourceId": {"kind": "youtube#video", "videoId": vid_id},
                        "position": position,
                    },
                },
            ).execute()
        except Exception as exc:
            errors.append(f"Reorder position {position}: {exc}")

    # --- 6. Persist updated youtube_videos to library.json ---
    try:
        lib = _load_library()
        for a in lib.get("albums", []):
            if a["id"] == album["id"]:
                a["youtube_videos"] = youtube_videos
                a["youtube_playlist_id"] = playlist_id
                a["youtube_cover_hash"] = album.get("youtube_cover_hash", "")
                break
        _save_library(lib)
    except Exception as exc:
        errors.append(f"Failed to save sync data: {exc}")

    _sync_progress.update(
        active=False,
        done=True,
        errors=errors,
        message=(
            "Sync complete!"
            + (f" Added {len(new_song_ids)} song(s)." if new_song_ids else "")
            + (f" Removed {len(removed_song_ids)} song(s)." if removed_song_ids else "")
            + (f" {len(errors)} error(s)." if errors else "")
        ),
    )
