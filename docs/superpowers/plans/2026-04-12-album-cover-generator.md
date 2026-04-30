# Album Cover Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-image cover generator with a 6-candidate picker, landscape generation on selection, and reuse of existing album covers.

**Architecture:** Three new backend endpoints (candidates, select, list-all-covers) replace the old single-image endpoint. Frontend splits into 4 components: CoverModal (shell with tabs), CoverGenerate (prompt → candidates → pick), CoverExisting (browse previous covers), CoverGrid (shared thumbnail grid). Backend generates 6 images in parallel via ThreadPoolExecutor, then generates landscape only for the selected winner.

**Tech Stack:** React (hooks, inline styles + Tailwind), FastAPI, OpenAI gpt-image-1.5, concurrent.futures for parallel generation

**Spec:** `docs/superpowers/specs/2026-04-12-album-cover-generator-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `lora-studio/routes/ai.py` | Modify | Replace old `/cover` endpoint with `/cover-candidates`, `/cover-select`, `/covers/all` |
| `lora-studio/frontend/src/api.js` | Modify | Replace `generateCover` with `generateCandidates`, `selectCover`, `getAllCovers` |
| `lora-studio/frontend/src/components/CoverModal.jsx` | Rewrite | Tab shell: Generate New / Use Existing |
| `lora-studio/frontend/src/components/CoverGenerate.jsx` | Create | Prompt → candidates → pick flow |
| `lora-studio/frontend/src/components/CoverExisting.jsx` | Create | Browse and select from other albums' covers |
| `lora-studio/frontend/src/components/CoverGrid.jsx` | Create | Shared responsive grid with selection state |
| `lora-studio/frontend/src/components/AlbumDetail.jsx` | Modify | Pass `existingPrompt` to CoverModal (already done) |

**Unchanged:** `Modal.jsx`, `describeCover` endpoint, `AlbumCard.jsx`, cover storage location

---

### Task 1: Backend — cover-candidates endpoint

**Files:**
- Modify: `lora-studio/routes/ai.py`

- [ ] **Step 1: Add the cover-candidates endpoint**

Add after the existing `describe_cover` endpoint (and before the old `generate_cover` endpoint) in `lora-studio/routes/ai.py`:

```python
class CoverCandidatesRequest(BaseModel):
    prompt: str


@router.post("/api/library/albums/{album_id}/cover-candidates")
async def generate_cover_candidates(album_id: str, body: CoverCandidatesRequest):
    """Generate 6 square cover candidates in parallel."""
    lib = _load_library()
    album = next((a for a in lib["albums"] if a["id"] == album_id), None)
    if not album:
        raise HTTPException(status_code=404, detail="Album not found")
    if not body.prompt.strip():
        raise HTTPException(status_code=400, detail="Image prompt required")

    import base64
    from concurrent.futures import ThreadPoolExecutor, as_completed
    from openai import OpenAI

    client = OpenAI(api_key=_cfg.OPENAI_API_KEY)
    base_prompt = f"Album cover art: {body.prompt.strip()}. Professional music artwork, absolutely no text or words."

    def generate_one(index):
        try:
            resp = client.images.generate(
                model="gpt-image-1.5",
                prompt=base_prompt,
                size="1024x1024",
                n=1,
                quality="high",
                output_format="png",
            )
            img_data = base64.b64decode(resp.data[0].b64_json)
            path = COVERS_DIR / f"{album_id}_candidate_{index}.png"
            path.write_bytes(img_data)
            return index, str(path), None
        except Exception as e:
            return index, None, str(e)

    candidates = [None] * 6
    errors = []

    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {pool.submit(generate_one, i): i for i in range(6)}
        for future in as_completed(futures):
            idx, path, error = future.result()
            if error:
                errors.append(f"Candidate {idx}: {error}")
            else:
                candidates[idx] = f"/api/library/covers/{album_id}_candidate_{idx}.png"

    candidates = [c for c in candidates if c is not None]

    if not candidates:
        raise HTTPException(status_code=500, detail="All generations failed: " + "; ".join(errors))

    # Save prompt for prepopulation
    album["cover_prompt"] = body.prompt.strip()
    _save_library(lib)

    return {"candidates": candidates, "count": len(candidates), "errors": errors if errors else None}
```

- [ ] **Step 2: Verify endpoint works**

Run: `curl -s -X POST http://localhost:8888/api/library/albums/{ALBUM_ID}/cover-candidates -H "Content-Type: application/json" -d '{"prompt":"dark moody silhouette"}'`

Expected: JSON with `candidates` array of 6 URLs (may take ~30s for parallel generation).

- [ ] **Step 3: Commit**

```bash
git add lora-studio/routes/ai.py
git commit -m "feat: add cover-candidates endpoint for 6 parallel image generation"
```

---

### Task 2: Backend — cover-select and covers/all endpoints

**Files:**
- Modify: `lora-studio/routes/ai.py`

- [ ] **Step 1: Add the cover-select endpoint**

Add after the `cover-candidates` endpoint:

```python
class CoverSelectRequest(BaseModel):
    candidate_index: int | None = None
    source_album_id: str | None = None
    prompt: str = ""


@router.post("/api/library/albums/{album_id}/cover-select")
async def select_cover(album_id: str, body: CoverSelectRequest):
    """Select a candidate cover or reuse another album's cover."""
    import base64
    import shutil
    import time as _time

    lib = _load_library()
    album = next((a for a in lib["albums"] if a["id"] == album_id), None)
    if not album:
        raise HTTPException(status_code=404, detail="Album not found")

    if body.source_album_id:
        # Reuse from another album
        source = next((a for a in lib["albums"] if a["id"] == body.source_album_id), None)
        if not source:
            raise HTTPException(status_code=404, detail="Source album not found")
        src_cover = COVERS_DIR / f"{body.source_album_id}.png"
        if not src_cover.exists():
            raise HTTPException(status_code=404, detail="Source album has no cover")

        shutil.copy2(str(src_cover), str(COVERS_DIR / f"{album_id}.png"))
        src_wide = COVERS_DIR / f"{body.source_album_id}_wide.png"
        if src_wide.exists():
            shutil.copy2(str(src_wide), str(COVERS_DIR / f"{album_id}_wide.png"))
        else:
            # Generate landscape from source prompt
            prompt = source.get("cover_prompt", "")
            if prompt:
                try:
                    from openai import OpenAI
                    client = OpenAI(api_key=_cfg.OPENAI_API_KEY)
                    resp = client.images.generate(
                        model="gpt-image-1.5",
                        prompt=f"Wide cinematic music video background: {prompt}. Professional music artwork, absolutely no text or words.",
                        size="1536x1024", n=1, quality="high", output_format="png",
                    )
                    img = base64.b64decode(resp.data[0].b64_json)
                    (COVERS_DIR / f"{album_id}_wide.png").write_bytes(img)
                except Exception:
                    pass  # Wide version is optional

        album["cover_prompt"] = source.get("cover_prompt", "")

    elif body.candidate_index is not None:
        # Select from candidates
        candidate = COVERS_DIR / f"{album_id}_candidate_{body.candidate_index}.png"
        if not candidate.exists():
            raise HTTPException(status_code=404, detail="Candidate not found")

        shutil.copy2(str(candidate), str(COVERS_DIR / f"{album_id}.png"))

        # Generate landscape version
        prompt = body.prompt or album.get("cover_prompt", "")
        if prompt:
            try:
                from openai import OpenAI
                client = OpenAI(api_key=_cfg.OPENAI_API_KEY)
                resp = client.images.generate(
                    model="gpt-image-1.5",
                    prompt=f"Wide cinematic music video background: {prompt}. Professional music artwork, absolutely no text or words.",
                    size="1536x1024", n=1, quality="high", output_format="png",
                )
                img = base64.b64decode(resp.data[0].b64_json)
                (COVERS_DIR / f"{album_id}_wide.png").write_bytes(img)
            except Exception:
                pass

        album["cover_prompt"] = prompt

        # Cleanup candidates
        for i in range(6):
            c = COVERS_DIR / f"{album_id}_candidate_{i}.png"
            if c.exists():
                c.unlink()
    else:
        raise HTTPException(status_code=400, detail="Provide candidate_index or source_album_id")

    ts = int(_time.time())
    album["cover"] = f"/api/library/covers/{album_id}.png?v={ts}"
    wide = COVERS_DIR / f"{album_id}_wide.png"
    if wide.exists():
        album["cover_wide"] = f"/api/library/covers/{album_id}_wide.png?v={ts}"
    _save_library(lib)

    return {"cover": album["cover"], "cover_wide": album.get("cover_wide", "")}
```

- [ ] **Step 2: Add the covers/all endpoint**

Add after `cover-select`:

```python
@router.get("/api/library/covers/all")
async def list_all_covers():
    """List all albums that have covers."""
    lib = _load_library()
    result = []
    for album in lib.get("albums", []):
        if album.get("cover"):
            result.append({
                "album_id": album["id"],
                "album_name": album.get("name", ""),
                "cover_url": album["cover"],
            })
    return result
```

- [ ] **Step 3: Remove the old generate_cover endpoint**

Delete the entire `generate_cover` function (the one at `@router.post("/api/library/albums/{album_id}/cover")`). Keep `describe_cover` — it's still used for GPT prompt generation.

- [ ] **Step 4: Commit**

```bash
git add lora-studio/routes/ai.py
git commit -m "feat: add cover-select and covers/all endpoints, remove old single-image endpoint"
```

---

### Task 3: Frontend — API functions

**Files:**
- Modify: `lora-studio/frontend/src/api.js`

- [ ] **Step 1: Replace generateCover with new API functions**

Replace the existing `generateCover` export with three new functions:

```javascript
export const generateCandidates = (albumId, data) =>
  request('/library/albums/' + albumId + '/cover-candidates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
export const selectCover = (albumId, data) =>
  request('/library/albums/' + albumId + '/cover-select', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
export const getAllCovers = () => request('/library/covers/all');
```

Keep `describeCover` and `getCoverUrl` unchanged.

- [ ] **Step 2: Verify build**

Run: `cd F:/ACE-Step-1.5/lora-studio/frontend && npx vite build`

Expected: Build succeeds. (CoverModal still imports the old `generateCover` — update the import in the next task.)

- [ ] **Step 3: Commit**

```bash
git add lora-studio/frontend/src/api.js
git commit -m "feat: add generateCandidates, selectCover, getAllCovers API functions"
```

---

### Task 4: Frontend — CoverGrid component

**Files:**
- Create: `lora-studio/frontend/src/components/CoverGrid.jsx`

- [ ] **Step 1: Create CoverGrid.jsx**

```jsx
import { useState, useEffect } from 'react';

function useIsMobile(breakpoint = 769) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < breakpoint);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [breakpoint]);
  return isMobile;
}

export default function CoverGrid({ images, selectedIndex, onSelect, columns = 3 }) {
  const isMobile = useIsMobile();
  const selected = images[selectedIndex] || null;

  if (isMobile) {
    // Mobile: large preview + thumbnail row
    return (
      <div>
        {/* Large preview */}
        <div style={{
          width: '100%', aspectRatio: '1', borderRadius: 12, overflow: 'hidden',
          marginBottom: 12, background: '#1a1a1a',
        }}>
          {selected ? (
            <img
              src={selected.url + '?t=' + Date.now()}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444', fontSize: 13 }}>
              Select an image
            </div>
          )}
        </div>
        {/* Thumbnail row */}
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
          {images.map((img, i) => (
            <div
              key={i}
              onClick={() => onSelect(i)}
              style={{
                width: 56, height: 56, borderRadius: 8, overflow: 'hidden', cursor: 'pointer',
                border: i === selectedIndex ? '2px solid #1ed760' : '2px solid transparent',
                flexShrink: 0, background: '#1a1a1a',
              }}
            >
              {img.url ? (
                <img src={img.url + '?t=' + Date.now()} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{ width: '100%', height: '100%', background: '#222', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444', fontSize: 10 }}>
                  Failed
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Desktop: grid
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${columns}, 1fr)`,
      gap: 10,
    }}>
      {images.map((img, i) => (
        <div
          key={i}
          onClick={() => img.url && onSelect(i)}
          style={{
            aspectRatio: '1', borderRadius: 10, overflow: 'hidden', cursor: img.url ? 'pointer' : 'default',
            border: i === selectedIndex ? '3px solid #1ed760' : '3px solid transparent',
            position: 'relative', background: '#1a1a1a',
            transition: 'border-color 0.15s',
          }}
        >
          {img.url ? (
            <img src={img.url + '?t=' + Date.now()} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: 12 }}>
              Failed
            </div>
          )}
          {i === selectedIndex && (
            <div style={{
              position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: '50%',
              background: '#1ed760', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg viewBox="0 0 24 24" fill="#000" style={{ width: 14, height: 14 }}>
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
              </svg>
            </div>
          )}
          {img.label && (
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              padding: '4px 8px', background: 'rgba(0,0,0,0.7)',
              fontSize: 11, color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {img.label}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add lora-studio/frontend/src/components/CoverGrid.jsx
git commit -m "feat: add CoverGrid component with desktop grid and mobile preview+thumbnails"
```

---

### Task 5: Frontend — CoverGenerate component

**Files:**
- Create: `lora-studio/frontend/src/components/CoverGenerate.jsx`

- [ ] **Step 1: Create CoverGenerate.jsx**

```jsx
import { useState } from 'react';
import { describeCover, generateCandidates, selectCover } from '../api.js';
import CoverGrid from './CoverGrid.jsx';

export default function CoverGenerate({ albumId, existingPrompt, onToast, onDone, onClose }) {
  const [phase, setPhase] = useState('prompt'); // 'prompt' | 'pick'
  const [userIdea, setUserIdea] = useState('');
  const [promptText, setPromptText] = useState(existingPrompt || '');
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [selecting, setSelecting] = useState(false);

  const handleGenPrompt = async () => {
    setGeneratingPrompt(true);
    setPromptText('Analyzing songs and generating prompt...');
    try {
      const result = await describeCover(albumId, { user_prompt: userIdea });
      setPromptText(result.prompt || '');
    } catch (e) {
      setPromptText('');
      onToast(e.message, 'error');
    } finally {
      setGeneratingPrompt(false);
    }
  };

  const handleGenerate = async () => {
    if (!promptText.trim()) { onToast('Enter an image prompt', 'error'); return; }
    setGenerating(true);
    setCandidates([]);
    setSelectedIndex(null);
    try {
      const result = await generateCandidates(albumId, { prompt: promptText.trim() });
      const imgs = (result.candidates || []).map((url) => ({ url }));
      setCandidates(imgs);
      setPhase('pick');
      if (result.errors && result.errors.length > 0) {
        onToast(`${result.errors.length} image(s) failed`, 'error');
      }
    } catch (e) {
      onToast(e.message, 'error');
    } finally {
      setGenerating(false);
    }
  };

  const handleSelect = async () => {
    if (selectedIndex === null) { onToast('Select an image first', 'error'); return; }
    setSelecting(true);
    try {
      await selectCover(albumId, { candidate_index: selectedIndex, prompt: promptText.trim() });
      onToast('Cover saved!');
      onDone();
      onClose();
    } catch (e) {
      onToast(e.message, 'error');
    } finally {
      setSelecting(false);
    }
  };

  if (phase === 'pick' && candidates.length > 0) {
    return (
      <div>
        <CoverGrid
          images={candidates}
          selectedIndex={selectedIndex}
          onSelect={setSelectedIndex}
          columns={3}
        />
        <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
          <button
            onClick={() => { setPhase('prompt'); setCandidates([]); setSelectedIndex(null); }}
            style={{
              padding: '10px 20px', borderRadius: 20, border: '1px solid #333',
              background: 'none', color: '#a7a7a7', fontSize: 13, cursor: 'pointer',
            }}
          >Regenerate</button>
          <button
            onClick={handleSelect}
            disabled={selectedIndex === null || selecting}
            style={{
              padding: '10px 24px', borderRadius: 20, border: 'none',
              background: selectedIndex !== null && !selecting ? '#1ed760' : '#2a2a2a',
              color: selectedIndex !== null && !selecting ? '#000' : '#555',
              fontSize: 14, fontWeight: 700, cursor: selectedIndex !== null && !selecting ? 'pointer' : 'not-allowed',
            }}
          >{selecting ? 'Saving...' : 'Use This'}</button>
        </div>
      </div>
    );
  }

  // Prompt phase
  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#a7a7a7', marginBottom: 6, fontWeight: 600 }}>
          Your Direction
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            style={{
              flex: 1, background: '#2a2a2a', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8, padding: '10px 14px', fontSize: 14, color: '#fff',
              outline: 'none', fontFamily: 'inherit',
            }}
            placeholder="e.g. dark moody, silhouette on a highway"
            value={userIdea}
            onChange={(e) => setUserIdea(e.target.value)}
            autoFocus
          />
          <button
            onClick={handleGenPrompt}
            disabled={generatingPrompt}
            style={{
              padding: '10px 16px', borderRadius: 20, border: 'none',
              background: '#1ed760', color: '#000', fontSize: 13, fontWeight: 700,
              cursor: generatingPrompt ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
              opacity: generatingPrompt ? 0.5 : 1,
            }}
          >{generatingPrompt ? 'Thinking...' : 'Generate Prompt'}</button>
        </div>
        <p style={{ fontSize: 12, color: '#555', marginTop: 6 }}>
          AI combines your direction with song context. Leave empty for fully auto.
        </p>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#a7a7a7', marginBottom: 6, fontWeight: 600 }}>
          Image Prompt
        </label>
        <textarea
          style={{
            width: '100%', background: '#2a2a2a', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8, padding: '10px 14px', fontSize: 14, color: '#fff',
            outline: 'none', fontFamily: 'inherit', resize: 'vertical', minHeight: 120,
            boxSizing: 'border-box',
          }}
          rows={5}
          placeholder="Click 'Generate Prompt' or type your own..."
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          disabled={generatingPrompt}
        />
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button
          onClick={onClose}
          style={{
            padding: '10px 20px', borderRadius: 20, border: '1px solid #333',
            background: 'none', color: '#a7a7a7', fontSize: 13, cursor: 'pointer',
          }}
        >Cancel</button>
        <button
          onClick={handleGenerate}
          disabled={generating || !promptText.trim()}
          style={{
            padding: '10px 24px', borderRadius: 20, border: 'none',
            background: !generating && promptText.trim() ? '#1ed760' : '#2a2a2a',
            color: !generating && promptText.trim() ? '#000' : '#555',
            fontSize: 14, fontWeight: 700,
            cursor: !generating && promptText.trim() ? 'pointer' : 'not-allowed',
          }}
        >{generating ? 'Generating 6 covers...' : 'Generate 6 Covers'}</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add lora-studio/frontend/src/components/CoverGenerate.jsx
git commit -m "feat: add CoverGenerate component with prompt and candidate pick phases"
```

---

### Task 6: Frontend — CoverExisting component

**Files:**
- Create: `lora-studio/frontend/src/components/CoverExisting.jsx`

- [ ] **Step 1: Create CoverExisting.jsx**

```jsx
import { useState, useEffect } from 'react';
import { getAllCovers, selectCover } from '../api.js';
import CoverGrid from './CoverGrid.jsx';

export default function CoverExisting({ albumId, onToast, onDone, onClose }) {
  const [covers, setCovers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [selecting, setSelecting] = useState(false);

  useEffect(() => {
    getAllCovers()
      .then((data) => {
        // Filter out current album
        setCovers(data.filter((c) => c.album_id !== albumId));
      })
      .catch((e) => onToast(e.message, 'error'))
      .finally(() => setLoading(false));
  }, [albumId, onToast]);

  const handleSelect = async () => {
    if (selectedIndex === null) return;
    const cover = covers[selectedIndex];
    setSelecting(true);
    try {
      await selectCover(albumId, { source_album_id: cover.album_id });
      onToast('Cover applied!');
      onDone();
      onClose();
    } catch (e) {
      onToast(e.message, 'error');
    } finally {
      setSelecting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', color: '#555', fontSize: 13 }}>
        Loading covers...
      </div>
    );
  }

  if (covers.length === 0) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', color: '#555', fontSize: 13 }}>
        No other albums have covers yet. Generate one first!
      </div>
    );
  }

  const images = covers.map((c) => ({ url: c.cover_url, label: c.album_name }));

  return (
    <div>
      <CoverGrid
        images={images}
        selectedIndex={selectedIndex}
        onSelect={setSelectedIndex}
        columns={3}
      />
      <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
        <button
          onClick={onClose}
          style={{
            padding: '10px 20px', borderRadius: 20, border: '1px solid #333',
            background: 'none', color: '#a7a7a7', fontSize: 13, cursor: 'pointer',
          }}
        >Cancel</button>
        <button
          onClick={handleSelect}
          disabled={selectedIndex === null || selecting}
          style={{
            padding: '10px 24px', borderRadius: 20, border: 'none',
            background: selectedIndex !== null && !selecting ? '#1ed760' : '#2a2a2a',
            color: selectedIndex !== null && !selecting ? '#000' : '#555',
            fontSize: 14, fontWeight: 700, cursor: selectedIndex !== null && !selecting ? 'pointer' : 'not-allowed',
          }}
        >{selecting ? 'Applying...' : 'Use This Cover'}</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add lora-studio/frontend/src/components/CoverExisting.jsx
git commit -m "feat: add CoverExisting component for browsing previous album covers"
```

---

### Task 7: Frontend — Rewrite CoverModal with tabs

**Files:**
- Rewrite: `lora-studio/frontend/src/components/CoverModal.jsx`

- [ ] **Step 1: Rewrite CoverModal.jsx**

Replace the entire contents with:

```jsx
import { useState } from 'react';
import Modal from './Modal.jsx';
import CoverGenerate from './CoverGenerate.jsx';
import CoverExisting from './CoverExisting.jsx';

const TABS = [
  { id: 'generate', label: 'Generate New' },
  { id: 'existing', label: 'Use Existing' },
];

export default function CoverModal({ albumId, open, onClose, onToast, onDone, existingPrompt = '' }) {
  const [tab, setTab] = useState('generate');

  const handleClose = () => {
    setTab('generate');
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Album Cover"
      width={640}
    >
      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid #333', marginBottom: 16 }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 600,
              background: 'none', border: 'none', cursor: 'pointer',
              color: tab === t.id ? '#1ed760' : '#666',
              borderBottom: tab === t.id ? '2px solid #1ed760' : '2px solid transparent',
              transition: 'all 0.15s',
            }}
          >{t.label}</button>
        ))}
      </div>

      {tab === 'generate' && (
        <CoverGenerate
          albumId={albumId}
          existingPrompt={existingPrompt}
          onToast={onToast}
          onDone={onDone}
          onClose={handleClose}
        />
      )}

      {tab === 'existing' && (
        <CoverExisting
          albumId={albumId}
          onToast={onToast}
          onDone={onDone}
          onClose={handleClose}
        />
      )}
    </Modal>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `cd F:/ACE-Step-1.5/lora-studio/frontend && npx vite build`

Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add lora-studio/frontend/src/components/CoverModal.jsx
git commit -m "feat: rewrite CoverModal with Generate New / Use Existing tabs"
```

---

### Task 8: Verify and polish

**Files:**
- Potentially modify: any of the above files for fixes

- [ ] **Step 1: Restart backend**

Kill and restart the server to pick up the new endpoints:
```bash
# Kill existing server
netstat -ano | grep ":8888.*LISTEN" | awk '{print $5}' | while read pid; do taskkill //PID $pid //F; done
# Start fresh
cd F:/ACE-Step-1.5/lora-studio && F:/ACE-Step-1.5/.venv/Scripts/python.exe server.py
```

- [ ] **Step 2: Test the full flow**

1. Open an album in the app
2. Click "Generate Cover" from the album menu
3. Tab should default to "Generate New" with existing prompt prepopulated (if any)
4. Type a direction or click "Generate Prompt"
5. Click "Generate 6 Covers" — wait ~30s for parallel generation
6. 3x2 grid should appear with 6 options
7. Click one — green border + checkmark
8. Click "Use This" — landscape generates, cover saves
9. Switch to "Use Existing" tab — should show other albums' covers
10. Select one — "Use This Cover" applies it

- [ ] **Step 3: Build final static**

Run: `cd F:/ACE-Step-1.5/lora-studio/frontend && npx vite build`

Expected: Build succeeds.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A lora-studio/
git commit -m "fix: polish cover generator flow"
```

---

## Summary of Changes

| File | Lines (approx) | What changed |
|------|----------------|--------------|
| `routes/ai.py` | +100, -40 | New endpoints (candidates, select, covers/all), old endpoint removed |
| `api.js` | +10, -5 | New API functions replace generateCover |
| `CoverModal.jsx` | ~40 (rewrite) | Tab shell with Generate New / Use Existing |
| `CoverGenerate.jsx` | ~130 (new) | Prompt → 6 candidates → pick flow |
| `CoverExisting.jsx` | ~75 (new) | Browse and select from other albums |
| `CoverGrid.jsx` | ~110 (new) | Shared responsive grid with selection |

Total: ~465 lines new/changed across 6 files.
