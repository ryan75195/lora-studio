# LoRA Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local web app for managing artists, training LoRAs, and generating music with ACE-Step 1.5.

**Architecture:** FastAPI backend wraps existing ACE-Step handler/trainer/inference code. Vanilla HTML/CSS/JS frontend with hash-based routing and SSE for progress streaming. Flat file storage — no database.

**Tech Stack:** Python (FastAPI, uvicorn), vanilla HTML/CSS/JS, ACE-Step 1.5 internals

**Spec:** `docs/superpowers/specs/2026-03-27-lora-studio-design.md`

---

## File Map

```
lora-studio/
├── server.py          # FastAPI app: all API routes, model state, SSE streams
├── static/
│   ├── index.html     # Shell HTML: sidebar nav, page containers
│   ├── style.css      # Dark theme, layout, components
│   └── app.js         # Routing, API calls, DOM rendering, drag-drop, audio player
```

---

### Task 1: Project Skeleton + FastAPI Server Shell

**Files:**
- Create: `lora-studio/server.py`
- Create: `lora-studio/static/index.html`
- Create: `lora-studio/static/style.css`
- Create: `lora-studio/static/app.js`

- [ ] **Step 1: Create `lora-studio/server.py` with health check**

```python
"""LoRA Studio - FastAPI backend for ACE-Step 1.5."""

import sys
import os
import json
import shutil
import re
import asyncio
import threading
from pathlib import Path
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

# Paths
PROJECT_ROOT = Path(__file__).parent.parent.resolve()
DATA_DIR = PROJECT_ROOT / "data" / "artists"
LORA_DIR = PROJECT_ROOT / "lora-output"
OUTPUT_DIR = PROJECT_ROOT / "acestep_output"
CHECKPOINT_DIR = PROJECT_ROOT / "checkpoints"

# Ensure directories exist
DATA_DIR.mkdir(parents=True, exist_ok=True)
LORA_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="LoRA Studio")

# Serve static files
app.mount("/static", StaticFiles(directory=Path(__file__).parent / "static"), name="static")


@app.get("/")
async def root():
    return FileResponse(Path(__file__).parent / "static" / "index.html")


@app.get("/api/health")
async def health():
    return {"status": "ok"}
```

- [ ] **Step 2: Create minimal `index.html` shell**

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LoRA Studio</title>
    <link rel="stylesheet" href="/static/style.css">
</head>
<body>
    <nav id="sidebar">
        <a href="#artists" class="nav-item active" data-page="artists" title="Artists">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        </a>
        <a href="#train" class="nav-item" data-page="train" title="Train">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
        </a>
        <a href="#generate" class="nav-item" data-page="generate" title="Generate">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
        </a>
        <a href="#output" class="nav-item" data-page="output" title="Output">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        </a>
    </nav>
    <main id="content">
        <div id="page-artists" class="page"></div>
        <div id="page-train" class="page"></div>
        <div id="page-generate" class="page"></div>
        <div id="page-output" class="page"></div>
    </main>
    <div id="toast"></div>
    <script src="/static/app.js"></script>
</body>
</html>
```

- [ ] **Step 3: Create `style.css` with dark theme and layout**

```css
* { margin: 0; padding: 0; box-sizing: border-box; }

:root {
    --bg: #0f0f0f;
    --panel: #161616;
    --border: #222;
    --text: #e8e8e8;
    --text-secondary: #888;
    --text-muted: #666;
    --accent: #6366f1;
    --accent-hover: #818cf8;
    --danger: #ef4444;
    --success: #34d399;
    --input-bg: #161616;
    --radius: 8px;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    background: var(--bg);
    color: var(--text);
    display: flex;
    height: 100vh;
    overflow: hidden;
}

/* Sidebar */
#sidebar {
    width: 56px;
    background: var(--panel);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    align-items: center;
    padding-top: 16px;
    gap: 4px;
    flex-shrink: 0;
}

.nav-item {
    width: 40px;
    height: 40px;
    border-radius: var(--radius);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    text-decoration: none;
    transition: all 0.15s;
}

.nav-item:hover { background: #1c1c1c; color: var(--text-secondary); }
.nav-item.active { background: var(--accent); color: #fff; }

/* Main content */
#content {
    flex: 1;
    overflow-y: auto;
    padding: 24px 32px;
}

.page { display: none; }
.page.active { display: block; }

/* Page header */
.page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
}

.page-title { font-size: 20px; font-weight: 600; }

/* Buttons */
.btn {
    padding: 8px 16px;
    border-radius: 6px;
    border: none;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
}

.btn-primary { background: var(--accent); color: #fff; }
.btn-primary:hover { background: var(--accent-hover); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-danger { background: var(--danger); color: #fff; }
.btn-ghost { background: transparent; color: var(--text-secondary); border: 1px solid var(--border); }
.btn-ghost:hover { border-color: var(--text-muted); color: var(--text); }

/* Cards */
.card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }

.card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 16px;
    cursor: pointer;
    transition: border-color 0.15s;
}

.card:hover { border-color: #333; }
.card-name { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
.card-meta { font-size: 12px; color: var(--text-secondary); }

/* Form elements */
.form-label {
    font-size: 11px;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
    display: block;
}

.form-input, .form-select, .form-textarea {
    width: 100%;
    background: var(--input-bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 10px 12px;
    color: var(--text);
    font-size: 13px;
    font-family: inherit;
    outline: none;
    transition: border-color 0.15s;
}

.form-input:focus, .form-select:focus, .form-textarea:focus { border-color: var(--accent); }
.form-textarea { resize: vertical; min-height: 80px; }
.form-row { display: flex; gap: 12px; }
.form-group { margin-bottom: 14px; }
.form-group-inline { flex: 1; }

/* Chips */
.chip {
    display: inline-flex;
    align-items: center;
    padding: 4px 12px;
    border-radius: 16px;
    font-size: 12px;
    cursor: pointer;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    transition: all 0.15s;
    margin-right: 6px;
    margin-bottom: 6px;
}

.chip.selected { background: var(--accent); color: #fff; border-color: var(--accent); }

/* List items */
.list-item {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 12px 16px;
    margin-bottom: 8px;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.list-item-title { font-size: 13px; font-weight: 500; }
.list-item-meta { font-size: 11px; color: var(--text-secondary); margin-top: 2px; }

/* Status badge */
.badge { font-size: 10px; padding: 2px 8px; border-radius: 10px; }
.badge-ready { background: #064e3b; color: var(--success); }
.badge-training { background: #3b0764; color: #c084fc; }

/* Progress bar */
.progress-wrap { margin: 16px 0; }
.progress-bar { height: 4px; background: #222; border-radius: 2px; overflow: hidden; }
.progress-fill { height: 100%; background: var(--accent); transition: width 0.3s; width: 0%; }
.progress-text { font-size: 12px; color: var(--text-secondary); margin-top: 6px; }

/* Audio player */
.audio-row audio { width: 100%; height: 32px; margin-top: 8px; }

/* Drop zone */
.drop-zone {
    border: 1px dashed #333;
    border-radius: var(--radius);
    padding: 32px;
    text-align: center;
    color: var(--text-muted);
    font-size: 13px;
    transition: all 0.15s;
}

.drop-zone.drag-over { border-color: var(--accent); color: var(--accent); background: rgba(99,102,241,0.05); }

/* Toast */
#toast {
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 12px 16px;
    font-size: 13px;
    display: none;
    z-index: 100;
    max-width: 360px;
}

#toast.error { border-color: var(--danger); color: var(--danger); }
#toast.success { border-color: var(--success); color: var(--success); }
#toast.show { display: block; }

/* Slider */
input[type="range"] {
    -webkit-appearance: none;
    width: 100%;
    height: 4px;
    background: #333;
    border-radius: 2px;
    outline: none;
}

input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
}
```

- [ ] **Step 4: Create `app.js` with routing and API helpers**

```javascript
// LoRA Studio - Client

const API = '/api';

// --- Routing ---
function navigate() {
    const hash = location.hash.slice(1) || 'artists';
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const page = document.getElementById('page-' + hash);
    const nav = document.querySelector(`[data-page="${hash}"]`);
    if (page) page.classList.add('active');
    if (nav) nav.classList.add('active');
    if (hash === 'artists') loadArtists();
    else if (hash === 'train') loadTrain();
    else if (hash === 'generate') loadGenerate();
    else if (hash === 'output') loadOutput();
}

window.addEventListener('hashchange', navigate);
window.addEventListener('load', navigate);

// --- API helpers ---
async function api(path, opts = {}) {
    const res = await fetch(API + path, opts);
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
    }
    return res.json();
}

function toast(msg, type = 'success') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = type + ' show';
    setTimeout(() => el.classList.remove('show'), 3000);
}

// --- Pages (stubs, filled in subsequent tasks) ---
async function loadArtists() {}
async function loadTrain() {}
async function loadGenerate() {}
async function loadOutput() {}
```

- [ ] **Step 5: Test the server starts and serves the page**

Run: `cd F:/ACE-Step-1.5/lora-studio && pip install fastapi uvicorn python-multipart && python -m uvicorn server:app --host 127.0.0.1 --port 8888`

Expected: Server starts, visiting `http://localhost:8888` shows a dark page with sidebar icons.

- [ ] **Step 6: Commit**

```bash
git add lora-studio/
git commit -m "feat: LoRA Studio project skeleton with FastAPI + dark theme shell"
```

---

### Task 2: Artists API + Page

**Files:**
- Modify: `lora-studio/server.py`
- Modify: `lora-studio/static/app.js`

- [ ] **Step 1: Add artist API routes to `server.py`**

Append after the health endpoint:

```python
# --- Helpers ---
def slugify(name: str) -> str:
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')


def get_artist_dir(slug: str) -> Path:
    d = DATA_DIR / slug
    if not d.exists():
        raise HTTPException(status_code=404, detail="Artist not found")
    return d


# --- Artist Models ---
class CreateArtist(BaseModel):
    name: str
    genre: str = ""


# --- Artist Routes ---
@app.get("/api/artists")
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


@app.post("/api/artists")
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


@app.get("/api/artists/{slug}")
async def get_artist(slug: str):
    d = get_artist_dir(slug)
    meta = json.loads((d / "artist.json").read_text(encoding="utf-8"))
    tracks_dir = d / "tracks"
    tracks = [f.name for f in sorted(tracks_dir.glob("*.mp3"))] if tracks_dir.exists() else []
    return {**meta, "slug": slug, "tracks": tracks, "track_count": len(tracks)}


@app.delete("/api/artists/{slug}")
async def delete_artist(slug: str):
    d = get_artist_dir(slug)
    shutil.rmtree(d)
    return {"deleted": slug}


@app.post("/api/artists/{slug}/upload")
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


@app.delete("/api/artists/{slug}/tracks/{filename}")
async def delete_track(slug: str, filename: str):
    d = get_artist_dir(slug)
    track = d / "tracks" / filename
    if not track.exists():
        raise HTTPException(status_code=404, detail="Track not found")
    track.unlink()
    return {"deleted": filename}
```

- [ ] **Step 2: Implement the Artists page in `app.js`**

Replace the `loadArtists` stub with:

```javascript
// --- Artists Page ---
async function loadArtists() {
    const page = document.getElementById('page-artists');
    page.innerHTML = '<div class="page-header"><h1 class="page-title">Artists</h1><button class="btn btn-primary" onclick="showNewArtistForm()">+ New Artist</button></div><div id="artist-grid" class="card-grid"></div>';
    try {
        const artists = await api('/artists');
        const grid = document.getElementById('artist-grid');
        if (artists.length === 0) {
            grid.innerHTML = '<div class="drop-zone" id="global-drop">No artists yet. Click "+ New Artist" to get started.</div>';
            return;
        }
        grid.innerHTML = artists.map(a => `
            <div class="card" onclick="showArtistDetail('${a.slug}')">
                <div class="card-name">${a.name}</div>
                <div class="card-meta">${a.track_count} tracks${a.genre ? ' · ' + a.genre : ''}</div>
            </div>
        `).join('');
    } catch (e) { toast(e.message, 'error'); }
}

function showNewArtistForm() {
    const name = prompt('Artist name:');
    if (!name) return;
    const genre = prompt('Genre (optional):') || '';
    api('/artists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, genre })
    }).then(() => loadArtists()).catch(e => toast(e.message, 'error'));
}

async function showArtistDetail(slug) {
    const page = document.getElementById('page-artists');
    try {
        const artist = await api('/artists/' + slug);
        page.innerHTML = `
            <div class="page-header">
                <h1 class="page-title"><a href="#artists" style="color:var(--text-secondary);text-decoration:none;">Artists</a> / ${artist.name}</h1>
                <button class="btn btn-danger" onclick="deleteArtist('${slug}')">Delete Artist</button>
            </div>
            <div class="drop-zone" id="track-drop" data-slug="${slug}">
                Drop MP3 files here to upload
            </div>
            <div id="track-list" style="margin-top:16px;">
                ${artist.tracks.map(t => `
                    <div class="list-item">
                        <span class="list-item-title">${t}</span>
                        <button class="btn btn-ghost" onclick="deleteTrack('${slug}','${t}')">Remove</button>
                    </div>
                `).join('')}
            </div>
        `;
        setupDropZone('track-drop', slug);
    } catch (e) { toast(e.message, 'error'); }
}

function deleteArtist(slug) {
    if (!confirm('Delete this artist and all their tracks?')) return;
    api('/artists/' + slug, { method: 'DELETE' }).then(() => loadArtists()).catch(e => toast(e.message, 'error'));
}

function deleteTrack(slug, filename) {
    api('/artists/' + slug + '/tracks/' + encodeURIComponent(filename), { method: 'DELETE' })
        .then(() => showArtistDetail(slug)).catch(e => toast(e.message, 'error'));
}

function setupDropZone(id, slug) {
    const zone = document.getElementById(id);
    if (!zone) return;
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', async e => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        const files = [...e.dataTransfer.files].filter(f => f.name.toLowerCase().endsWith('.mp3'));
        if (files.length === 0) { toast('Only MP3 files accepted', 'error'); return; }
        const form = new FormData();
        files.forEach(f => form.append('files', f));
        try {
            await fetch(API + '/artists/' + slug + '/upload', { method: 'POST', body: form });
            toast(files.length + ' track(s) uploaded');
            showArtistDetail(slug);
        } catch (e) { toast(e.message, 'error'); }
    });
}
```

- [ ] **Step 3: Test artists page**

Run: Restart server, open `http://localhost:8888/#artists`. Create an artist, upload MP3s via drag-drop, delete tracks.

- [ ] **Step 4: Commit**

```bash
git add lora-studio/
git commit -m "feat: artists page with CRUD and drag-drop upload"
```

---

### Task 3: Train API + Page

**Files:**
- Modify: `lora-studio/server.py`
- Modify: `lora-studio/static/app.js`

- [ ] **Step 1: Add training state and routes to `server.py`**

Append after artist routes:

```python
# --- Training State ---
train_progress = {"active": False, "message": "", "step": 0, "total": 0, "error": None}


# --- LoRA Routes ---
@app.get("/api/loras")
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


# --- Train Models ---
class TrainRequest(BaseModel):
    artists: list[str]
    name: str = ""


@app.post("/api/train")
async def start_training(body: TrainRequest):
    global train_progress
    if train_progress["active"]:
        raise HTTPException(status_code=409, detail="Training already in progress")

    # Collect audio dirs from selected artists
    audio_dirs = []
    for slug in body.artists:
        tracks_dir = DATA_DIR / slug / "tracks"
        if not tracks_dir.exists():
            raise HTTPException(status_code=404, detail=f"Artist '{slug}' not found")
        audio_dirs.append(str(tracks_dir))

    name = body.name or "-".join(body.artists)

    train_progress = {"active": True, "message": "Starting...", "step": 0, "total": 100, "error": None}

    def run_training():
        global train_progress
        try:
            sys.path.insert(0, str(PROJECT_ROOT))
            os.environ["TOKENIZERS_PARALLELISM"] = "false"

            # Step 1: Scan
            train_progress["message"] = "Scanning audio files..."
            from acestep.training.dataset_builder import DatasetBuilder
            builder = DatasetBuilder()
            all_samples = []
            for audio_dir in audio_dirs:
                samples, status = builder.scan_directory(audio_dir)
                all_samples.extend(samples)
            train_progress["message"] = f"Found {len(all_samples)} tracks"

            # Step 2: Init handler
            train_progress["message"] = "Loading model..."
            from acestep.handler import AceStepHandler
            from acestep.llm_inference import LLMHandler
            handler = AceStepHandler()
            handler.initialize_service(
                project_root=str(PROJECT_ROOT),
                config_path="acestep-v15-turbo",
                device="auto",
                offload_to_cpu=True,
            )
            llm = LLMHandler()
            llm.initialize(
                checkpoint_dir=str(CHECKPOINT_DIR),
                lm_model_path="acestep-5Hz-lm-1.7B",
                backend="pt",
                device="auto",
                offload_to_cpu=True,
            )

            # Step 3: Label
            train_progress["message"] = "Auto-labeling tracks..."
            builder.label_all_samples(
                dit_handler=handler,
                llm_handler=llm,
                format_lyrics=False,
                transcribe_lyrics=False,
                skip_metas=False,
                only_unlabeled=False,
            )

            # Step 4: Preprocess
            train_progress["message"] = "Preprocessing to tensors..."
            tensor_dir = str(LORA_DIR / name / "preprocessed")
            builder.preprocess_to_tensors(
                dit_handler=handler,
                output_dir=tensor_dir,
                preprocess_mode="lora",
            )

            # Step 5: Train
            train_progress["message"] = "Training LoRA..."
            from acestep.training.trainer import LoRATrainer
            from acestep.training.configs import LoRAConfig, TrainingConfig
            lora_config = LoRAConfig(r=8, alpha=16, dropout=0.1, target_modules=["q_proj", "k_proj", "v_proj", "o_proj"])
            training_config = TrainingConfig(
                learning_rate=5e-4, batch_size=2, gradient_accumulation_steps=2,
                max_epochs=10, save_every_n_epochs=5, warmup_steps=20,
                output_dir=str(LORA_DIR / name), mixed_precision="bf16",
                num_workers=0, pin_memory=True, prefetch_factor=None,
                persistent_workers=False, pin_memory_device="cuda", log_every_n_steps=1,
            )
            training_state = {"is_training": True, "should_stop": False}
            trainer = LoRATrainer(dit_handler=handler, lora_config=lora_config, training_config=training_config)
            for step, loss, status in trainer.train_from_preprocessed(tensor_dir, training_state):
                train_progress["message"] = f"Step {step} | Loss: {loss:.4f}"
                train_progress["step"] = step

            train_progress["message"] = "Done!"
            train_progress["active"] = False

        except Exception as e:
            train_progress["error"] = str(e)
            train_progress["message"] = f"Error: {e}"
            train_progress["active"] = False

    thread = threading.Thread(target=run_training, daemon=True)
    thread.start()
    return {"status": "started", "name": name}


@app.get("/api/train/status")
async def train_status():
    async def stream():
        while True:
            yield f"data: {json.dumps(train_progress)}\n\n"
            if not train_progress["active"]:
                break
            await asyncio.sleep(1)
    return StreamingResponse(stream(), media_type="text/event-stream")
```

- [ ] **Step 2: Implement the Train page in `app.js`**

Replace the `loadTrain` stub:

```javascript
// --- Train Page ---
async function loadTrain() {
    const page = document.getElementById('page-train');
    try {
        const [artists, loras] = await Promise.all([api('/artists'), api('/loras')]);
        page.innerHTML = `
            <h1 class="page-title" style="margin-bottom:20px;">Train LoRA</h1>
            <div style="display:flex;gap:24px;">
                <div style="flex:1;">
                    <div class="form-group">
                        <label class="form-label">Select artists to mix</label>
                        <div id="artist-chips">
                            ${artists.map(a => `<span class="chip" data-slug="${a.slug}" onclick="this.classList.toggle('selected')">${a.name}</span>`).join('')}
                        </div>
                    </div>
                    <div class="form-group">
                        <label class="form-label">LoRA Name</label>
                        <input class="form-input" id="lora-name" placeholder="auto-generated if empty">
                    </div>
                    <button class="btn btn-primary" id="train-btn" onclick="startTraining()">Train LoRA</button>
                    <div class="progress-wrap" id="train-progress" style="display:none;">
                        <div class="progress-bar"><div class="progress-fill" id="train-fill"></div></div>
                        <div class="progress-text" id="train-text"></div>
                    </div>
                </div>
                <div style="flex:1;">
                    <label class="form-label">Trained LoRAs</label>
                    ${loras.length === 0 ? '<div style="color:var(--text-muted);font-size:13px;">No LoRAs trained yet.</div>' :
                    loras.map(l => `
                        <div class="list-item">
                            <div>
                                <div class="list-item-title">${l.name}</div>
                                <div class="list-item-meta">${l.size_mb}MB · ${new Date(l.created_at).toLocaleDateString()}</div>
                            </div>
                            <span class="badge badge-ready">Ready</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    } catch (e) { toast(e.message, 'error'); }
}

async function startTraining() {
    const selected = [...document.querySelectorAll('#artist-chips .chip.selected')].map(c => c.dataset.slug);
    if (selected.length === 0) { toast('Select at least one artist', 'error'); return; }
    const name = document.getElementById('lora-name').value.trim();
    document.getElementById('train-btn').disabled = true;
    document.getElementById('train-progress').style.display = 'block';

    try {
        await api('/train', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ artists: selected, name })
        });

        const evtSource = new EventSource(API + '/train/status');
        evtSource.onmessage = e => {
            const data = JSON.parse(e.data);
            document.getElementById('train-text').textContent = data.message;
            if (data.error) {
                toast('Training failed: ' + data.error, 'error');
                evtSource.close();
                document.getElementById('train-btn').disabled = false;
            }
            if (!data.active && !data.error) {
                toast('Training complete!');
                evtSource.close();
                document.getElementById('train-btn').disabled = false;
                loadTrain();
            }
        };
    } catch (e) {
        toast(e.message, 'error');
        document.getElementById('train-btn').disabled = false;
    }
}
```

- [ ] **Step 3: Test training page**

Run: Restart server, go to `#train`, select artists, start training. Verify SSE progress updates.

- [ ] **Step 4: Commit**

```bash
git add lora-studio/
git commit -m "feat: train page with one-click LoRA training and SSE progress"
```

---

### Task 4: Generate API + Page

**Files:**
- Modify: `lora-studio/server.py`
- Modify: `lora-studio/static/app.js`

- [ ] **Step 1: Add generation state and routes to `server.py`**

Append after training routes:

```python
# --- Generation State ---
gen_progress = {"active": False, "message": "", "error": None, "song_path": None}
_handler = None
_llm = None
_loaded_lora = None


def _ensure_models():
    """Initialize handler and LLM if not already loaded."""
    global _handler, _llm
    if _handler is None:
        sys.path.insert(0, str(PROJECT_ROOT))
        os.environ["TOKENIZERS_PARALLELISM"] = "false"
        from acestep.handler import AceStepHandler
        _handler = AceStepHandler()
        _handler.initialize_service(
            project_root=str(PROJECT_ROOT),
            config_path="acestep-v15-turbo",
            device="auto",
            offload_to_cpu=True,
        )
    if _llm is None:
        from acestep.llm_inference import LLMHandler
        _llm = LLMHandler()
        _llm.initialize(
            checkpoint_dir=str(CHECKPOINT_DIR),
            lm_model_path="acestep-5Hz-lm-1.7B",
            backend="pt",
            device="auto",
            offload_to_cpu=True,
        )


# --- Generate Models ---
class GenerateRequest(BaseModel):
    lora_name: str
    strength: float = 1.0
    caption: str
    lyrics: str = ""
    bpm: Optional[int] = None
    key: str = ""
    duration: float = 120.0


@app.post("/api/generate")
async def start_generation(body: GenerateRequest):
    global gen_progress, _loaded_lora
    if gen_progress["active"]:
        raise HTTPException(status_code=409, detail="Generation already in progress")

    lora_path = LORA_DIR / body.lora_name / "final" / "adapter"
    if not (lora_path / "adapter_model.safetensors").exists():
        raise HTTPException(status_code=404, detail="LoRA not found")

    gen_progress = {"active": True, "message": "Initializing...", "error": None, "song_path": None}

    def run_generation():
        global gen_progress, _loaded_lora
        try:
            gen_progress["message"] = "Loading models..."
            _ensure_models()

            # Load/switch LoRA
            if _loaded_lora != body.lora_name:
                if _loaded_lora is not None:
                    _handler.unload_lora()
                gen_progress["message"] = f"Loading LoRA: {body.lora_name}..."
                _handler.load_lora(str(lora_path))
                _loaded_lora = body.lora_name

            _handler.set_lora_scale(body.strength)

            gen_progress["message"] = "Generating song..."
            from acestep.inference import generate_music, GenerationParams, GenerationConfig
            params = GenerationParams(
                task_type="text2music",
                caption=body.caption,
                lyrics=body.lyrics,
                duration=body.duration,
                bpm=body.bpm,
                keyscale=body.key,
                timesignature="4/4",
                vocal_language="en",
                inference_steps=8,
                guidance_scale=9.0,
                thinking=True,
            )
            config = GenerationConfig(batch_size=1, use_random_seed=True, audio_format="mp3")
            result = generate_music(
                dit_handler=_handler,
                llm_handler=_llm,
                params=params,
                config=config,
                save_dir=str(OUTPUT_DIR),
            )

            if result.success and result.audios:
                gen_progress["song_path"] = result.audios[0].get("path", "")
                gen_progress["message"] = "Done!"
            else:
                gen_progress["error"] = result.error or "Generation failed"
                gen_progress["message"] = gen_progress["error"]

            gen_progress["active"] = False

        except Exception as e:
            gen_progress["error"] = str(e)
            gen_progress["message"] = f"Error: {e}"
            gen_progress["active"] = False

    thread = threading.Thread(target=run_generation, daemon=True)
    thread.start()
    return {"status": "started"}


@app.get("/api/generate/status")
async def gen_status():
    async def stream():
        while True:
            yield f"data: {json.dumps(gen_progress)}\n\n"
            if not gen_progress["active"]:
                break
            await asyncio.sleep(1)
    return StreamingResponse(stream(), media_type="text/event-stream")
```

- [ ] **Step 2: Implement the Generate page in `app.js`**

Replace the `loadGenerate` stub:

```javascript
// --- Generate Page ---
async function loadGenerate() {
    const page = document.getElementById('page-generate');
    try {
        const loras = await api('/loras');
        page.innerHTML = `
            <h1 class="page-title" style="margin-bottom:20px;">Generate</h1>
            <div style="max-width:600px;">
                <div class="form-row">
                    <div class="form-group form-group-inline">
                        <label class="form-label">LoRA</label>
                        <select class="form-select" id="gen-lora">
                            ${loras.length === 0 ? '<option value="">No LoRAs available</option>' :
                            loras.map(l => `<option value="${l.name}">${l.name}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group" style="width:120px;">
                        <label class="form-label">Strength: <span id="strength-val">1.0</span></label>
                        <input type="range" id="gen-strength" min="0" max="2" step="0.1" value="1.0" oninput="document.getElementById('strength-val').textContent=this.value">
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">Caption</label>
                    <textarea class="form-textarea" id="gen-caption" rows="2" placeholder="e.g. Emotional blues rock ballad, female vocal, electric guitar..."></textarea>
                </div>
                <div class="form-group">
                    <label class="form-label">Lyrics</label>
                    <textarea class="form-textarea" id="gen-lyrics" rows="8" placeholder="[Verse 1]\nYour lyrics here..."></textarea>
                </div>
                <div class="form-row">
                    <div class="form-group form-group-inline">
                        <label class="form-label">BPM</label>
                        <input class="form-input" id="gen-bpm" type="number" value="120" min="30" max="300">
                    </div>
                    <div class="form-group form-group-inline">
                        <label class="form-label">Key</label>
                        <select class="form-select" id="gen-key">
                            <option value="">Auto</option>
                            ${['C major','C minor','D major','D minor','E major','E minor','F major','F minor','G major','G minor','A major','A minor','B major','B minor'].map(k => `<option value="${k}">${k}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group form-group-inline">
                        <label class="form-label">Duration (s)</label>
                        <input class="form-input" id="gen-duration" type="number" value="180" min="30" max="480">
                    </div>
                </div>
                <button class="btn btn-primary" id="gen-btn" onclick="startGeneration()" ${loras.length === 0 ? 'disabled' : ''}>Generate Song</button>
                <div class="progress-wrap" id="gen-progress" style="display:none;">
                    <div class="progress-bar"><div class="progress-fill" id="gen-fill"></div></div>
                    <div class="progress-text" id="gen-text"></div>
                </div>
            </div>
        `;
    } catch (e) { toast(e.message, 'error'); }
}

async function startGeneration() {
    const lora = document.getElementById('gen-lora').value;
    const caption = document.getElementById('gen-caption').value.trim();
    if (!lora) { toast('Select a LoRA', 'error'); return; }
    if (!caption) { toast('Enter a caption', 'error'); return; }

    document.getElementById('gen-btn').disabled = true;
    document.getElementById('gen-progress').style.display = 'block';

    try {
        await api('/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                lora_name: lora,
                strength: parseFloat(document.getElementById('gen-strength').value),
                caption: caption,
                lyrics: document.getElementById('gen-lyrics').value,
                bpm: parseInt(document.getElementById('gen-bpm').value) || null,
                key: document.getElementById('gen-key').value,
                duration: parseFloat(document.getElementById('gen-duration').value) || 180,
            })
        });

        const evtSource = new EventSource(API + '/generate/status');
        evtSource.onmessage = e => {
            const data = JSON.parse(e.data);
            document.getElementById('gen-text').textContent = data.message;
            if (data.error) {
                toast('Generation failed: ' + data.error, 'error');
                evtSource.close();
                document.getElementById('gen-btn').disabled = false;
            }
            if (!data.active && !data.error) {
                toast('Song generated!');
                evtSource.close();
                document.getElementById('gen-btn').disabled = false;
                location.hash = 'output';
            }
        };
    } catch (e) {
        toast(e.message, 'error');
        document.getElementById('gen-btn').disabled = false;
    }
}
```

- [ ] **Step 3: Test generation page**

Run: Restart server, go to `#generate`, select LoRA, enter caption, generate. Verify SSE progress and redirect to output.

- [ ] **Step 4: Commit**

```bash
git add lora-studio/
git commit -m "feat: generate page with LoRA selection, params, and SSE progress"
```

---

### Task 5: Songs API + Output Page

**Files:**
- Modify: `lora-studio/server.py`
- Modify: `lora-studio/static/app.js`

- [ ] **Step 1: Add songs routes to `server.py`**

Append after generation routes:

```python
# --- Songs Routes ---
@app.get("/api/songs")
async def list_songs():
    songs = []
    if OUTPUT_DIR.exists():
        for mp3 in sorted(OUTPUT_DIR.glob("*.mp3"), key=lambda f: f.stat().st_mtime, reverse=True):
            json_path = mp3.with_suffix(".json")
            meta = {}
            if json_path.exists():
                try:
                    data = json.loads(json_path.read_text(encoding="utf-8"))
                    # Extract from the nested structure ACE-Step writes
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
            songs.append({
                "id": mp3.stem,
                "filename": mp3.name,
                "size_mb": round(mp3.stat().st_size / (1024 * 1024), 1),
                "created_at": datetime.fromtimestamp(mp3.stat().st_mtime).isoformat(),
                **meta,
            })
    return songs


@app.get("/api/songs/{song_id}/audio")
async def serve_audio(song_id: str):
    mp3 = OUTPUT_DIR / f"{song_id}.mp3"
    if not mp3.exists():
        raise HTTPException(status_code=404, detail="Song not found")
    return FileResponse(mp3, media_type="audio/mpeg")
```

- [ ] **Step 2: Implement the Output page in `app.js`**

Replace the `loadOutput` stub:

```javascript
// --- Output Page ---
async function loadOutput() {
    const page = document.getElementById('page-output');
    try {
        const songs = await api('/songs');
        page.innerHTML = `
            <h1 class="page-title" style="margin-bottom:20px;">Output</h1>
            ${songs.length === 0 ? '<div style="color:var(--text-muted);font-size:13px;">No songs generated yet.</div>' :
            songs.map(s => `
                <div class="list-item audio-row" style="flex-direction:column;align-items:stretch;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <div>
                            <div class="list-item-title">${s.filename}</div>
                            <div class="list-item-meta">
                                ${s.duration ? Math.floor(s.duration / 60) + ':' + String(Math.floor(s.duration % 60)).padStart(2, '0') : ''}
                                ${s.key ? ' · ' + s.key : ''}
                                ${s.bpm ? ' · ' + s.bpm + ' BPM' : ''}
                                ${s.lora_used ? ' · ' + s.lora_used : ''}
                                · ${new Date(s.created_at).toLocaleString()}
                            </div>
                        </div>
                        <div style="font-size:12px;color:var(--text-muted);">${s.size_mb}MB</div>
                    </div>
                    <audio controls preload="none" src="/api/songs/${s.id}/audio"></audio>
                </div>
            `).join('')}
        `;
    } catch (e) { toast(e.message, 'error'); }
}
```

- [ ] **Step 3: Test output page**

Run: Restart server, go to `#output`. Verify songs from previous generations are listed with metadata and audio plays.

- [ ] **Step 4: Commit**

```bash
git add lora-studio/
git commit -m "feat: output page with song list and inline audio player"
```

---

### Task 6: Polish + Final Testing

**Files:**
- Modify: `lora-studio/server.py` (add startup message)
- Modify: `lora-studio/static/app.js` (edge cases)

- [ ] **Step 1: Add startup banner and `__main__` to `server.py`**

Append at the bottom of `server.py`:

```python
if __name__ == "__main__":
    import uvicorn
    print("=" * 50)
    print("  LoRA Studio")
    print(f"  http://127.0.0.1:8888")
    print(f"  Artists: {DATA_DIR}")
    print(f"  LoRAs:   {LORA_DIR}")
    print(f"  Output:  {OUTPUT_DIR}")
    print("=" * 50)
    uvicorn.run(app, host="127.0.0.1", port=8888)
```

- [ ] **Step 2: Add empty-state handling to `loadGenerate` in `app.js`**

In the existing `loadGenerate` function (Task 4), after `const loras = await api('/loras');`, add this early return before the existing `page.innerHTML`:

```javascript
        if (loras.length === 0) {
            page.innerHTML = `
                <h1 class="page-title" style="margin-bottom:20px;">Generate</h1>
                <div style="color:var(--text-muted);font-size:14px;">
                    No trained LoRAs yet. <a href="#train" style="color:var(--accent);">Train one first</a>.
                </div>
            `;
            return;
        }
```

- [ ] **Step 3: Full end-to-end test**

Run: `cd F:/ACE-Step-1.5/lora-studio && python server.py`

Test flow:
1. `#artists` — create "Test Artist", drag-drop an MP3
2. `#train` — select artist, train LoRA (verify SSE progress)
3. `#generate` — select LoRA, enter caption, generate song (verify SSE progress)
4. `#output` — verify song appears, plays in browser

- [ ] **Step 4: Final commit**

```bash
git add lora-studio/
git commit -m "feat: LoRA Studio polish and startup banner"
```
