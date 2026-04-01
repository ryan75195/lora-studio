# LoRA Studio - Design Spec

**Date:** 2026-03-27
**Status:** Approved

## Overview

A local web app for managing artists, training LoRAs, and generating music with ACE-Step 1.5. Runs on localhost, single user, no auth.

## Tech Stack

- **Frontend:** Vanilla HTML/CSS/JS — no build step, no framework. Single `index.html` with inline or co-located CSS/JS.
- **Backend:** Python FastAPI server wrapping the existing ACE-Step handler, trainer, and inference code.
- **Storage:** Flat files and JSON on disk. No database.

## Directory Structure

```
F:/ACE-Step-1.5/
├── lora-studio/
│   ├── server.py              # FastAPI backend
│   ├── static/
│   │   ├── index.html         # Single page app
│   │   ├── style.css          # Dark theme styling
│   │   └── app.js             # Client-side logic (routing, API calls, UI)
│   └── README.md
├── data/
│   └── artists/
│       ├── sabrina-carpenter/
│       │   ├── artist.json    # { "name": "Sabrina Carpenter", "genre": "Pop" }
│       │   └── tracks/
│       │       ├── Taste.mp3
│       │       └── Espresso.mp3
│       └── eric-clapton/
│           ├── artist.json
│           └── tracks/
│               ├── Layla.mp3
│               └── Wonderful Tonight.mp3
├── lora-output/               # Existing directory, trained LoRAs live here
│   └── sabrina-clapton-mix/
│       └── final/adapter/
└── acestep_output/            # Existing directory, generated songs live here
```

## Pages

### 1. Artists

**Purpose:** Manage artist profiles and their training audio.

**Features:**
- Grid of artist cards showing name, genre, track count
- "New Artist" button — prompts for name and genre, creates directory
- Click artist card to see track list
- Drag-and-drop MP3 upload onto artist card or into artist detail view
- Delete artist (with confirmation)
- Delete individual tracks

**Data model — `artist.json`:**
```json
{
  "name": "Sabrina Carpenter",
  "genre": "Pop",
  "created_at": "2026-03-27T12:00:00"
}
```

Track list derived by scanning the `tracks/` directory for `.mp3` files.

### 2. Train

**Purpose:** Select artists, name a LoRA, train with one click.

**Features:**
- Artist selector — toggle chips for each artist to include in the mix
- LoRA name text field (auto-slugified from selected artists if left blank)
- "Train LoRA" button — kicks off the full pipeline (scan → label → preprocess → train)
- Progress bar with status messages streamed via SSE
- List of trained LoRAs below, showing: name, epoch count, final loss, file size, status (Ready/Training)

**Training defaults (not exposed in UI):**
- LoRA rank: 8, alpha: 16
- Learning rate: 5e-4
- Batch size: 2, gradient accumulation: 2
- Epochs: 10
- Mixed precision: bf16
- 8-bit AdamW optimizer

**Training pipeline (automated, matches what we did manually):**
1. Scan all selected artists' track directories
2. Initialize handler + LLM for auto-labeling
3. Auto-label all samples
4. Preprocess to tensors
5. Train LoRA
6. Save to `lora-output/{name}/final/adapter/`

### 3. Generate

**Purpose:** Generate songs using a trained LoRA.

**Features:**
- LoRA dropdown — populated from `lora-output/` directory (only dirs with `adapter_model.safetensors`)
- Strength slider — 0.0 to 2.0, default 1.0
- Caption text area
- Lyrics text area (larger)
- Parameter row: BPM (number input), Key (dropdown), Duration (number input in seconds)
- "Generate Song" button
- Progress indicator via SSE (LLM generating → DiT diffusing → VAE decoding → Done)
- On completion: auto-navigate to Output page or show inline play button

**Generation pipeline (matches our existing `test_lora_generation.py` flow):**
1. Initialize handler if not already running
2. Initialize LLM if not already running
3. Load selected LoRA at specified strength
4. Call `generate_music()` with user parameters
5. Save output to `acestep_output/`

**Key dropdown options:** C major, C minor, D major, D minor, E major, E minor, F major, F minor, G major, G minor, A major, A minor, B major, B minor

### 4. Output

**Purpose:** Browse and play generated songs.

**Features:**
- List of generated songs sorted by newest first
- Each row shows: filename, duration, key, BPM, LoRA used, timestamp
- Play button — HTML5 audio player inline
- Metadata sourced from the JSON files ACE-Step already writes alongside each MP3

## Backend API

All endpoints prefixed with `/api`.

### Artists

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/artists` | List all artists with track counts |
| `POST` | `/api/artists` | Create artist `{ "name": "...", "genre": "..." }` |
| `GET` | `/api/artists/{slug}` | Get artist detail + track list |
| `DELETE` | `/api/artists/{slug}` | Delete artist and all tracks |
| `POST` | `/api/artists/{slug}/upload` | Upload MP3 files (multipart) |
| `DELETE` | `/api/artists/{slug}/tracks/{filename}` | Delete a track |

### Training

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/loras` | List trained LoRAs with metadata |
| `POST` | `/api/train` | Start training `{ "artists": [...], "name": "..." }` |
| `GET` | `/api/train/status` | SSE stream of training progress |

### Generation

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/generate` | Start generation with params |
| `GET` | `/api/generate/status` | SSE stream of generation progress |

### Songs

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/songs` | List generated songs with metadata |
| `GET` | `/api/songs/{id}/audio` | Serve the MP3 file |

## Visual Design

- **Theme:** Dark + indigo accent (#6366f1). Near-black background (#0f0f0f), dark gray panels (#161616), subtle borders (#222).
- **Layout:** Slim icon sidebar (56px) on the left. Active page icon highlighted with indigo background. Content fills remaining space.
- **Typography:** System font stack. White (#e8e8e8) for headings, gray (#888) for labels, dark gray (#666) for secondary text.
- **Buttons:** Primary actions use indigo fill with white text. Destructive actions use red.
- **Cards:** Dark gray background, subtle border, slight border-radius (8px).
- **Inputs:** Dark background (#161616), subtle border (#222), white text.

## State Management

**Backend keeps models warm.** After first generation, the handler, LLM, and LoRA stay loaded in GPU memory. Subsequent generations reuse them. If a different LoRA is selected, the backend unloads the current one and loads the new one.

**Frontend state** is purely client-side. Page routing via hash (`#artists`, `#train`, `#generate`, `#output`). No localStorage persistence needed — all data comes from the API on each page load.

**Training and generation are blocking.** Only one operation at a time (single GPU). The UI disables the Train/Generate buttons while an operation is running and shows progress.

## Error Handling

- **Upload errors:** File too large, wrong format → toast notification
- **Training errors:** GPU OOM, missing data → error message in progress area, training stops
- **Generation errors:** Model load failure, OOM → error message, generation stops
- **API errors:** Standard HTTP status codes, JSON error bodies `{ "error": "message" }`

## Out of Scope

- Multi-user / authentication
- Multiple simultaneous training or generation jobs
- Audio playback waveform visualization
- LoRA stacking (multiple LoRAs at once)
- Audio repainting / partial regeneration
- Advanced training config in the UI
- Database / persistent storage beyond flat files
