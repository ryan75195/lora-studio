# Kling Video Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Generate Video Loop" feature to album management that uses Kling AI to create animated backgrounds from cover art for YouTube videos.

**Architecture:** New `services/kling.py` handles API communication and FFmpeg ping-pong loop creation. New route endpoints manage generation/status. New `VideoLoopModal.jsx` provides prompt → generating → preview flow. YouTube upload's `_make_video` uses loops when available.

**Tech Stack:** Kling API (JWT auth, image-to-video), FFmpeg (reverse + concat), React, FastAPI

**Spec:** `docs/superpowers/specs/2026-04-13-kling-video-loop-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `lora-studio/services/config.py` | Modify | Add KLING_ACCESS_KEY, KLING_SECRET_KEY |
| `lora-studio/services/kling.py` | Create | Kling API client: JWT auth, submit job, poll, download, ping-pong loop |
| `lora-studio/routes/ai.py` | Modify | Add video-loop and video-loop-status endpoints |
| `lora-studio/routes/youtube_upload.py` | Modify | Use loop video in _make_video when available |
| `lora-studio/frontend/src/api.js` | Modify | Add generateVideoLoop, getVideoLoopStatus |
| `lora-studio/frontend/src/components/VideoLoopModal.jsx` | Create | Modal with prompt/generating/preview states |
| `lora-studio/frontend/src/components/AlbumDetail.jsx` | Modify | Add menu item + modal trigger |

---

### Task 1: Config — add Kling API keys

**Files:**
- Modify: `lora-studio/services/config.py`

- [ ] **Step 1: Add Kling keys to config loader**

In `services/config.py`, update the `reload_config` function's global declaration and key loading:

Add `KLING_ACCESS_KEY, KLING_SECRET_KEY` to the global line:
```python
global OPENAI_API_KEY, GEMINI_API_KEY, KLING_ACCESS_KEY, KLING_SECRET_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
```

Add after the GEMINI_API_KEY line:
```python
KLING_ACCESS_KEY = keys.get("kling_access_key") or os.environ.get("KLING_ACCESS_KEY", "")
KLING_SECRET_KEY = keys.get("kling_secret_key") or os.environ.get("KLING_SECRET_KEY", "")
```

Add module-level defaults after the existing `GEMINI_API_KEY: str = ""`:
```python
KLING_ACCESS_KEY: str = ""
KLING_SECRET_KEY: str = ""
```

- [ ] **Step 2: Add keys to config.json**

Update `lora-studio/config.json` to include:
```json
"kling_access_key": "YOUR_KLING_ACCESS_KEY",
"kling_secret_key": "YOUR_KLING_SECRET_KEY"
```

- [ ] **Step 3: Commit**

```bash
git add lora-studio/services/config.py lora-studio/config.json
git commit -m "feat: add Kling API key config"
```

---

### Task 2: Kling service

**Files:**
- Create: `lora-studio/services/kling.py`

- [ ] **Step 1: Create the Kling service**

```python
"""Kling AI video loop generation service.

Generates animated video loops from still images using Kling's image-to-video API.
Creates seamless ping-pong loops (forward + reverse) for YouTube video backgrounds.
"""

import base64
import logging
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

import jwt
import requests

import services.config as _cfg

logger = logging.getLogger("lora-studio.kling")

# Module-level progress state
_loop_progress = {
    "active": False,
    "status": "idle",
    "message": "",
    "album_id": "",
    "loop_url": None,
}


def get_progress():
    return dict(_loop_progress)


def _generate_token():
    """Generate a JWT token for Kling API auth."""
    ak = _cfg.KLING_ACCESS_KEY
    sk = _cfg.KLING_SECRET_KEY
    if not ak or not sk:
        raise RuntimeError("Kling API keys not configured")
    payload = {
        "iss": ak,
        "exp": int(time.time()) + 1800,
        "nbf": int(time.time()) - 5,
    }
    return jwt.encode(payload, sk, algorithm="HS256", headers={"alg": "HS256", "typ": "JWT"})


def _submit_image_to_video(token, image_path, prompt):
    """Submit an image-to-video generation task to Kling."""
    img_bytes = Path(image_path).read_bytes()
    img_b64 = base64.b64encode(img_bytes).decode("utf-8")

    resp = requests.post(
        "https://api.klingai.com/v1/videos/image2video",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={
            "model_name": "kling-v2-master",
            "image": img_b64,
            "prompt": f"fixed lens, tripod, no camera movement, {prompt}",
            "negative_prompt": "camera movement, zoom, pan, tilt, shaky, morphing face, distortion",
            "mode": "std",
            "duration": "5",
            "cfg_scale": 0.7,
        },
        timeout=60,
    )

    if resp.status_code != 200:
        raise RuntimeError(f"Kling API error {resp.status_code}: {resp.text[:200]}")

    data = resp.json()
    if data.get("code") != 0:
        raise RuntimeError(f"Kling error: {data.get('message', data)}")

    return data["data"]["task_id"]


def _poll_for_result(token, task_id, timeout=300):
    """Poll Kling API until video is ready. Returns video URL."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        resp = requests.get(
            f"https://api.klingai.com/v1/videos/image2video/{task_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        data = resp.json()
        status = data.get("data", {}).get("task_status", "unknown")

        if status == "succeed":
            videos = data["data"].get("task_result", {}).get("videos", [])
            if videos:
                return videos[0]["url"]
            raise RuntimeError("Task succeeded but no video URL returned")
        elif status in ("failed", "error"):
            msg = data.get("data", {}).get("task_status_msg", "unknown error")
            raise RuntimeError(f"Kling generation failed: {msg}")

        _loop_progress["status"] = "processing"
        _loop_progress["message"] = f"Generating... ({int(deadline - time.time())}s remaining)"
        time.sleep(10)

    raise TimeoutError("Kling video generation timed out after 5 minutes")


def _download_video(url, output_path):
    """Download video from URL."""
    resp = requests.get(url, stream=True, timeout=60)
    resp.raise_for_status()
    with open(output_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=8192):
            f.write(chunk)


def _make_pingpong_loop(raw_clip, output_path):
    """Create a seamless ping-pong loop: forward + reverse, trimmed to avoid freeze frames."""
    tmp_dir = tempfile.mkdtemp(prefix="kling_loop_")
    try:
        reversed_path = os.path.join(tmp_dir, "reversed.mp4")
        fwd_trimmed = os.path.join(tmp_dir, "fwd.mp4")
        rev_trimmed = os.path.join(tmp_dir, "rev.mp4")

        # Get duration
        probe = subprocess.run(
            ["ffprobe", "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", str(raw_clip)],
            capture_output=True, text=True,
        )
        duration = float(probe.stdout.strip())

        # Reverse the clip
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(raw_clip), "-vf", "reverse", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", reversed_path],
            capture_output=True,
        )

        # Trim last frame from forward, first frame from reverse to avoid freeze
        trim_end = duration - 0.04
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(raw_clip), "-t", str(trim_end), "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", fwd_trimmed],
            capture_output=True,
        )
        subprocess.run(
            ["ffmpeg", "-y", "-i", reversed_path, "-ss", "0.04", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", rev_trimmed],
            capture_output=True,
        )

        # Concatenate forward + reverse
        concat_file = os.path.join(tmp_dir, "concat.txt")
        with open(concat_file, "w") as f:
            f.write(f"file '{fwd_trimmed}'\n")
            f.write(f"file '{rev_trimmed}'\n")

        subprocess.run(
            ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concat_file, "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", str(output_path)],
            capture_output=True,
        )

        if not Path(output_path).exists():
            raise RuntimeError("FFmpeg failed to create ping-pong loop")

        logger.info(f"Ping-pong loop created: {output_path}")
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def generate_video_loop(image_path, prompt, output_path):
    """Full pipeline: image → Kling API → download → ping-pong loop.

    This is meant to be called from a background thread.
    Updates _loop_progress as it goes.
    """
    global _loop_progress
    tmp_dir = tempfile.mkdtemp(prefix="kling_")

    try:
        _loop_progress["status"] = "submitted"
        _loop_progress["message"] = "Submitting to Kling API..."
        logger.info(f"kling | submitting {image_path} with prompt: {prompt[:60]}")

        token = _generate_token()
        task_id = _submit_image_to_video(token, image_path, prompt)
        logger.info(f"kling | task submitted: {task_id}")

        _loop_progress["status"] = "processing"
        _loop_progress["message"] = "Generating video..."

        video_url = _poll_for_result(token, task_id)

        _loop_progress["message"] = "Downloading video..."
        raw_clip = os.path.join(tmp_dir, "raw.mp4")
        _download_video(video_url, raw_clip)
        logger.info(f"kling | downloaded raw clip")

        _loop_progress["message"] = "Creating ping-pong loop..."
        _make_pingpong_loop(raw_clip, output_path)

        _loop_progress["status"] = "done"
        _loop_progress["message"] = "Video loop ready!"
        _loop_progress["loop_url"] = f"/api/library/covers/{Path(output_path).name}?v={int(time.time())}"
        logger.info(f"kling | loop saved: {output_path}")

    except Exception as e:
        _loop_progress["status"] = "failed"
        _loop_progress["message"] = f"Error: {e}"
        logger.error(f"kling FAILED | {e}", exc_info=True)
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        _loop_progress["active"] = False
```

- [ ] **Step 2: Commit**

```bash
git add lora-studio/services/kling.py
git commit -m "feat: add Kling video loop generation service"
```

---

### Task 3: Backend endpoints

**Files:**
- Modify: `lora-studio/routes/ai.py`

- [ ] **Step 1: Add video-loop endpoints**

Add at the end of `routes/ai.py`, before the final line:

```python
# ---------------------------------------------------------------------------
# Video Loop (Kling AI)
# ---------------------------------------------------------------------------

class VideoLoopRequest(BaseModel):
    prompt: str = "subtle atmospheric animation, gentle light shifts, soft ambient glow"


@router.post("/api/library/albums/{album_id}/video-loop")
async def generate_video_loop(album_id: str, body: VideoLoopRequest):
    """Start generating a Kling video loop from the album's wide cover."""
    import threading
    from services.kling import _loop_progress, generate_video_loop as _gen_loop

    if _loop_progress["active"]:
        raise HTTPException(status_code=409, detail="A video loop generation is already in progress")

    lib = _load_library()
    album = next((a for a in lib["albums"] if a["id"] == album_id), None)
    if not album:
        raise HTTPException(status_code=404, detail="Album not found")

    wide_cover = COVERS_DIR / f"{album_id}_wide.png"
    if not wide_cover.exists():
        # Fall back to square cover
        wide_cover = COVERS_DIR / f"{album_id}.png"
        if not wide_cover.exists():
            raise HTTPException(status_code=400, detail="Album has no cover image")

    output_path = COVERS_DIR / f"{album_id}_loop.mp4"

    _loop_progress.update({
        "active": True,
        "status": "starting",
        "message": "Starting...",
        "album_id": album_id,
        "loop_url": None,
    })

    def run():
        _gen_loop(str(wide_cover), body.prompt, str(output_path))
        # Update album data
        if _loop_progress["status"] == "done":
            lib2 = _load_library()
            for a in lib2["albums"]:
                if a["id"] == album_id:
                    a["video_loop"] = _loop_progress["loop_url"]
                    break
            _save_library(lib2)

    threading.Thread(target=run, daemon=True).start()
    return {"status": "started"}


@router.get("/api/library/albums/{album_id}/video-loop-status")
async def video_loop_status(album_id: str):
    """Get the current video loop generation status."""
    from services.kling import get_progress
    progress = get_progress()
    # Also check if a loop already exists
    loop_path = COVERS_DIR / f"{album_id}_loop.mp4"
    if not progress["active"] and progress["status"] == "idle" and loop_path.exists():
        import time as _time
        progress["loop_url"] = f"/api/library/covers/{album_id}_loop.mp4?v={int(_time.time())}"
    return progress
```

- [ ] **Step 2: Commit**

```bash
git add lora-studio/routes/ai.py
git commit -m "feat: add video-loop generation and status endpoints"
```

---

### Task 4: YouTube upload integration

**Files:**
- Modify: `lora-studio/routes/youtube_upload.py`

- [ ] **Step 1: Update _make_video to use loop when available**

Replace the `_make_video` function:

```python
def _make_video(audio_path: Path, cover_path: Path | None, output_path: Path, loop_path: Path | None = None) -> bool:
    """Use ffmpeg to create an MP4 from cover art (or video loop) + audio. Returns True on success."""
    if not _ffmpeg_available():
        return False

    if loop_path and loop_path.exists():
        # Use animated video loop instead of static image
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
    elif cover_path and cover_path.exists():
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

    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.returncode == 0
```

- [ ] **Step 2: Update all _make_video call sites to pass loop_path**

Find all calls to `_make_video` and add the loop_path parameter. The loop file is `COVERS_DIR / f"{album_id}_loop.mp4"`. There are 3 call sites — at each one add:

```python
loop_path = COVERS_DIR / f"{album_id}_loop.mp4" if COVERS_DIR else None
ok = _make_video(audio_path, cover_path, video_path, loop_path=loop_path)
```

The album_id is available in the enclosing function scope at each call site.

- [ ] **Step 3: Commit**

```bash
git add lora-studio/routes/youtube_upload.py
git commit -m "feat: use Kling video loop in YouTube video creation when available"
```

---

### Task 5: Frontend — API functions + VideoLoopModal

**Files:**
- Modify: `lora-studio/frontend/src/api.js`
- Create: `lora-studio/frontend/src/components/VideoLoopModal.jsx`

- [ ] **Step 1: Add API functions**

Add to `api.js` after the existing cover functions:

```javascript
export const generateVideoLoop = (albumId, data) =>
  request('/library/albums/' + albumId + '/video-loop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
export const getVideoLoopStatus = (albumId) =>
  request('/library/albums/' + albumId + '/video-loop-status');
```

- [ ] **Step 2: Create VideoLoopModal.jsx**

```jsx
import { useState, useEffect, useRef } from 'react';
import Modal from './Modal.jsx';
import { generateVideoLoop, getVideoLoopStatus } from '../api.js';

export default function VideoLoopModal({ albumId, open, onClose, onToast, onDone, existingLoopUrl }) {
  const [phase, setPhase] = useState('prompt'); // 'prompt' | 'generating' | 'preview'
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [loopUrl, setLoopUrl] = useState(existingLoopUrl || '');
  const [error, setError] = useState('');
  const pollRef = useRef(null);
  const videoRef = useRef(null);

  useEffect(() => {
    if (open && existingLoopUrl) {
      setLoopUrl(existingLoopUrl);
    }
  }, [open, existingLoopUrl]);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      onToast('Enter an animation prompt', 'error');
      return;
    }
    setGenerating(true);
    setError('');
    setPhase('generating');

    try {
      await generateVideoLoop(albumId, { prompt: prompt.trim() });
    } catch (e) {
      setError(e.message);
      setGenerating(false);
      setPhase('prompt');
      return;
    }

    // Poll for status
    pollRef.current = setInterval(async () => {
      try {
        const status = await getVideoLoopStatus(albumId);
        if (status.status === 'done' && status.loop_url) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setLoopUrl(status.loop_url);
          setGenerating(false);
          setPhase('preview');
          onToast('Video loop generated!');
        } else if (status.status === 'failed') {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setError(status.message || 'Generation failed');
          setGenerating(false);
          setPhase('prompt');
          onToast(status.message || 'Generation failed', 'error');
        }
      } catch {}
    }, 10000);
  };

  const handleAccept = () => {
    onDone();
    handleClose();
  };

  const handleClose = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    setPhase('prompt');
    setGenerating(false);
    setError('');
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} title="Video Loop" width={560}>

      {/* Existing loop preview */}
      {phase === 'prompt' && loopUrl && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#666', fontWeight: 600, marginBottom: 8 }}>
            Current loop
          </div>
          <video
            src={loopUrl}
            autoPlay
            loop
            muted
            playsInline
            style={{ width: '100%', borderRadius: 12, background: '#111' }}
          />
        </div>
      )}

      {/* Step 1: Prompt */}
      {phase === 'prompt' && (
        <div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#a7a7a7', marginBottom: 6, fontWeight: 600 }}>
              Animation Prompt
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="subtle atmospheric animation, gentle light shifts, soft ambient glow"
              style={{
                width: '100%', background: '#2a2a2a', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8, padding: '10px 14px', fontSize: 14, color: '#fff',
                outline: 'none', fontFamily: 'inherit', resize: 'vertical', minHeight: 80,
                boxSizing: 'border-box',
              }}
            />
            <p style={{ fontSize: 12, color: '#555', marginTop: 6 }}>
              Describe the subtle animation you want. Camera stays fixed — only the scene animates.
            </p>
          </div>
          {error && (
            <div style={{ color: '#ef4444', fontSize: 13, marginBottom: 12 }}>{error}</div>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              onClick={handleClose}
              style={{ padding: '10px 20px', borderRadius: 20, border: '1px solid #333', background: 'none', color: '#a7a7a7', fontSize: 13, cursor: 'pointer' }}
            >Cancel</button>
            <button
              onClick={handleGenerate}
              disabled={!prompt.trim()}
              style={{
                padding: '10px 24px', borderRadius: 20, border: 'none',
                background: prompt.trim() ? '#1ed760' : '#2a2a2a',
                color: prompt.trim() ? '#000' : '#555',
                fontSize: 14, fontWeight: 700, cursor: prompt.trim() ? 'pointer' : 'not-allowed',
              }}
            >Generate Loop</button>
          </div>
        </div>
      )}

      {/* Step 2: Generating */}
      {phase === 'generating' && (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <div style={{
            width: 48, height: 48, borderRadius: '50%', border: '3px solid #333', borderTopColor: '#1ed760',
            animation: 'spin 1s linear infinite', margin: '0 auto 20px',
          }} />
          <div style={{ fontSize: 16, color: '#fff', fontWeight: 600, marginBottom: 8 }}>
            Generating video loop...
          </div>
          <div style={{ fontSize: 13, color: '#666' }}>
            This takes about 2 minutes. You can leave this open.
          </div>
        </div>
      )}

      {/* Step 3: Preview */}
      {phase === 'preview' && loopUrl && (
        <div>
          <video
            ref={videoRef}
            src={loopUrl + '&t=' + Date.now()}
            autoPlay
            loop
            muted
            playsInline
            style={{ width: '100%', borderRadius: 12, background: '#111', marginBottom: 16 }}
          />
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              onClick={() => setPhase('prompt')}
              style={{ padding: '10px 20px', borderRadius: 20, border: '1px solid #333', background: 'none', color: '#a7a7a7', fontSize: 13, cursor: 'pointer' }}
            >Try different prompt</button>
            <button
              onClick={handleGenerate}
              style={{ padding: '10px 20px', borderRadius: 20, border: '1px solid #333', background: 'none', color: '#a7a7a7', fontSize: 13, cursor: 'pointer' }}
            >Regenerate</button>
            <button
              onClick={handleAccept}
              style={{
                padding: '10px 24px', borderRadius: 20, border: 'none',
                background: '#1ed760', color: '#000', fontSize: 14, fontWeight: 700, cursor: 'pointer',
              }}
            >Accept</button>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Modal>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add lora-studio/frontend/src/api.js lora-studio/frontend/src/components/VideoLoopModal.jsx
git commit -m "feat: add VideoLoopModal component and API functions"
```

---

### Task 6: AlbumDetail — menu item + modal

**Files:**
- Modify: `lora-studio/frontend/src/components/AlbumDetail.jsx`

- [ ] **Step 1: Add import and state**

Add to the imports at top of AlbumDetail.jsx:
```jsx
import VideoLoopModal from './VideoLoopModal.jsx';
```

Add state in the AlbumDetail component (near the other modal states):
```jsx
const [videoLoopOpen, setVideoLoopOpen] = useState(false);
```

- [ ] **Step 2: Add menu item**

In the album menu dropdown, after the "Generate Cover" item and before the YouTube item, add:

```jsx
{album.cover && (
  <div
    onClick={() => { setVideoLoopOpen(true); setMenuOpen(false); }}
    style={{ padding: '12px 16px', fontSize: 14, color: '#fff', cursor: 'pointer' }}
    onMouseEnter={e => e.currentTarget.style.background = '#3a3a3a'}
    onMouseLeave={e => e.currentTarget.style.background = ''}
  >
    🎬 Generate Video Loop
  </div>
)}
```

- [ ] **Step 3: Add modal render**

Near the other modals at the bottom of the JSX (near CoverModal), add:

```jsx
<VideoLoopModal
  albumId={albumId}
  open={videoLoopOpen}
  onClose={() => setVideoLoopOpen(false)}
  onToast={onToast}
  onDone={load}
  existingLoopUrl={album?.video_loop || ''}
/>
```

- [ ] **Step 4: Build and verify**

Run: `cd F:/ACE-Step-1.5/lora-studio/frontend && npx vite build`

Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add lora-studio/frontend/src/components/AlbumDetail.jsx
git commit -m "feat: add Video Loop menu item and modal to album detail"
```

---

### Task 7: Verify and test

- [ ] **Step 1: Restart server**

Kill and restart to pick up all backend changes.

- [ ] **Step 2: Test the full flow**

1. Open an album with a cover in the app
2. Click album menu → "Generate Video Loop"
3. Enter a prompt → click "Generate Loop"
4. Wait ~2 min for Kling to process
5. Preview the ping-pong loop in the modal
6. Click "Accept"
7. Verify `{album_id}_loop.mp4` exists in data/covers/

- [ ] **Step 3: Test YouTube upload uses loop**

Generate a test upload — verify the resulting MP4 uses the animated loop instead of a static image.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A lora-studio/
git commit -m "fix: polish video loop integration"
```

---

## Summary

| File | Lines (approx) | What changed |
|------|----------------|--------------|
| `services/config.py` | +6 | Kling API key loading |
| `services/kling.py` | ~200 (new) | Full Kling API client + ping-pong loop creation |
| `routes/ai.py` | +50 | video-loop and video-loop-status endpoints |
| `routes/youtube_upload.py` | +15, -5 | _make_video uses loop when available |
| `api.js` | +6 | generateVideoLoop, getVideoLoopStatus |
| `VideoLoopModal.jsx` | ~180 (new) | Modal with prompt/generating/preview states |
| `AlbumDetail.jsx` | +15 | Menu item + modal |

Total: ~470 lines across 7 files.
