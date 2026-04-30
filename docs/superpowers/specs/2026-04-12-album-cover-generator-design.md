# Album Cover Generator Redesign

**Date:** 2026-04-12
**Status:** Approved

## Problem

The current cover generation flow produces a single image — no choice, no way to browse previous covers, no way to compare candidates. Users want to pick from multiple options and reuse existing art.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Candidate count | 6 images per batch | Enough variety without excessive cost |
| Format flow | Square first, landscape on selection | Cheaper ($0.28 vs $0.48), decision is based on square anyway |
| Previous covers | Tab-based ("Generate New" / "Use Existing") | Clean separation of flows |
| Desktop layout | 3x2 grid | All 6 visible for quick comparison |
| Mobile layout | Large preview + 6 thumbnails | Better use of limited space |
| Variation | Regenerate full batch only | Simpler flow, no "more like this" |

## Modal Structure

### Two Tabs

**Tab 1: Generate New**

Step 1 — Prompt:
- "Your Direction" text input (optional creative direction from user)
- "Generate Prompt" button → calls existing `describeCover` endpoint → GPT analyzes album songs + user direction → fills DALL-E prompt textarea
- If album already has a `cover_prompt` saved, prepopulate the textarea with it on modal open
- "Generate 6 Covers" button → calls new backend endpoint
- Button disabled while generating, shows progress ("Generating 2/6...")

Step 2 — Pick:
- Desktop: 3x2 grid of square candidates with click-to-select (green border + checkmark)
- Mobile: one large preview image with 6 square thumbnails below, tap thumbnail to see it large
- "Use This" button → confirms selection → backend generates landscape version for the winner → saves both → updates album
- "Regenerate" button → goes back to Step 1 with prompt still filled in textarea
- Candidates persist until modal is closed or new batch is generated

**Tab 2: Use Existing**

- Grid of square thumbnails from all albums that have covers
- Album name shown below each thumbnail
- Click to preview larger
- "Use This Cover" button → copies cover files to current album
- Skip albums that are the current album

### Component Structure

```
CoverModal.jsx          — Outer modal shell, tab state, coordinates flow
├── CoverGenerate.jsx   — Generate tab: prompt input → candidate grid → selection
├── CoverExisting.jsx   — Existing tab: browse other albums' covers
└── CoverGrid.jsx       — Shared: renders a grid of cover thumbnails with selection state
```

**CoverModal.jsx** — Manages tab state ('generate' | 'existing'), receives `albumId`, `existingPrompt`, `open`, `onClose`, `onToast`, `onDone`. Renders the two tab components.

**CoverGenerate.jsx** — Two-phase state: 'prompt' and 'pick'. In prompt phase: direction input, generate prompt button, prompt textarea, generate button. In pick phase: renders CoverGrid with candidates, Use This + Regenerate buttons. Tracks `candidates` array of image URLs, `selectedIndex`, `generating` boolean, `generatingProgress` (0-6).

**CoverExisting.jsx** — Fetches list of albums with covers from backend. Renders CoverGrid. On selection, calls cover-select endpoint with `source_album_id`.

**CoverGrid.jsx** — Receives `images` array (of `{url, label?}` objects), `selectedIndex`, `onSelect(index)`, `columns` (default 3). Desktop: CSS grid with specified columns. Mobile: large preview + thumbnail row. Handles green border on selected item.

## Backend Changes

### New: `POST /api/library/albums/{album_id}/cover-candidates`

Request: `{ "prompt": "string" }`

Behavior:
1. Generate 6 square images (1024x1024) using `gpt-image-1.5`
2. Run generations in parallel using `asyncio.gather` (or thread pool) for speed
3. Save as `{album_id}_candidate_0.png` through `{album_id}_candidate_5.png` in `COVERS_DIR`
4. Return: `{ "candidates": ["/api/library/covers/{album_id}_candidate_0.png", ...], "count": 6 }`

Error handling: if some generations fail, return partial results with error info:
`{ "candidates": [...], "count": 4, "errors": ["Candidate 3 failed: content policy"] }`

### New: `POST /api/library/albums/{album_id}/cover-select`

Request: `{ "candidate_index": number }` OR `{ "source_album_id": "string" }`

Behavior for candidate selection:
1. Copy `{album_id}_candidate_{index}.png` → `{album_id}.png`
2. Generate landscape version `{album_id}_wide.png` using the same prompt with "wide cinematic" prefix
3. Delete all `{album_id}_candidate_*.png` files (cleanup)
4. Save `cover_prompt` to album in library.json
5. Return: `{ "cover": "/api/library/covers/{album_id}.png?v=...", "cover_wide": "/api/library/covers/{album_id}_wide.png?v=..." }`

Behavior for reuse:
1. Copy source album's `{source_id}.png` → `{album_id}.png`
2. Copy source album's `{source_id}_wide.png` → `{album_id}_wide.png` (if exists, else generate)
3. Copy source album's `cover_prompt` to current album
4. Return same format as above

### New: `GET /api/library/covers/all`

Returns list of albums that have covers:
```json
[
  { "album_id": "abc123", "album_name": "The Ballad of Life", "cover_url": "/api/library/covers/abc123.png?v=..." },
  ...
]
```

### Removed: `POST /api/library/albums/{album_id}/cover`

The old single-image endpoint is replaced by the candidates + select flow.

### Unchanged

- `POST /api/library/albums/{album_id}/describe-cover` — GPT prompt generation stays as-is
- Cover storage location: `data/covers/`
- Album data structure in `library.json` — adds `cover_prompt` field (already partially implemented)

## Prompt Prepopulation

- When `album.cover_prompt` exists, prepopulate the DALL-E prompt textarea on modal open
- Saved after each generation via `cover-select` endpoint
- If no prompt exists, textarea starts empty (user can auto-generate or type manually)

## Cost

- 6 square candidates: ~$0.24 (6 × $0.04)
- 1 landscape for winner: ~$0.04
- Total per round: ~$0.28
- Regenerating = another $0.28

## Edge Cases

- **Partial generation failure:** Some images fail content policy or API errors. Show successful ones, grey placeholder for failed, allow selection from what succeeded.
- **All fail:** Show error message, keep prompt, let user retry.
- **Modal closed during generation:** Candidates stay on disk. Next open shows them if they exist (check for `_candidate_*.png` files on modal open).
- **Reuse from album with no wide cover:** Generate the wide version on selection.
- **Current album in "Use Existing" list:** Skip it — don't show the album's own cover as a reuse option.
