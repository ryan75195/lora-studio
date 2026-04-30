# Kling Video Loop Integration

**Date:** 2026-04-13
**Status:** Approved

## Problem

YouTube videos currently use static album cover images as backgrounds. Subtle animated loops from Kling AI look significantly more professional and increase watch time.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Placement | Separate modal in album menu | Decoupled from cover generation, can regenerate independently |
| Prompt input | Custom text field | User controls the animation style |
| Preview | Video player in modal with accept/regenerate/try different | Iterate without losing context |
| Loop method | Ping-pong (forward + reverse) | Seamless, no visible seam |
| Storage | {album_id}_loop.mp4 in covers dir | Consistent with cover storage |

## New Album Menu Item

"Generate Video Loop" button in the album detail menu, alongside "Generate Cover" and "Upload to YouTube". Only visible when the album has a wide cover image.

## VideoLoopModal Component

Single component: `lora-studio/frontend/src/components/VideoLoopModal.jsx`

### Step 1 — Prompt

- Text input for animation prompt
- Default placeholder: "subtle atmospheric animation, gentle light shifts, soft ambient glow"
- "Generate Loop" button
- If loop already exists (`{album_id}_loop.mp4`), show current loop as a playing video above the prompt input, with option to regenerate

### Step 2 — Generating

- Loading state: "Generating video loop... ~2 minutes"
- Polls `GET /api/library/albums/{album_id}/video-loop-status` every 10 seconds
- Cancel button to abort

### Step 3 — Preview

- HTML5 video player auto-playing the ping-pong loop on repeat
- Three buttons:
  - "Accept" — saves loop URL to album data, closes modal
  - "Try different prompt" — returns to Step 1 with prompt text preserved
  - "Regenerate" — same prompt, triggers new generation

## Backend

### Config

Add to `config.json` api_keys section and `services/config.py`:
- `kling_access_key` — Kling API Access Key
- `kling_secret_key` — Kling API Secret Key

### New service: `lora-studio/services/kling.py`

Handles Kling API communication:
- `generate_video_loop(image_path, prompt, output_path)` — full pipeline:
  1. Read wide cover image, encode as base64
  2. Generate JWT token from AK/SK
  3. POST to `https://api.klingai.com/v1/videos/image2video` with:
     - `model_name`: "kling-v2-master"
     - `image`: base64 encoded
     - `prompt`: "fixed lens, tripod, no camera movement, " + user prompt
     - `negative_prompt`: "camera movement, zoom, pan, tilt, shaky, morphing face, distortion"
     - `mode`: "std"
     - `duration`: "5"
     - `cfg_scale`: 0.7
  4. Poll `GET /v1/videos/image2video/{task_id}` every 10s until "succeed"
  5. Download raw 5s clip to temp file
  6. FFmpeg: create reversed version
  7. FFmpeg: concatenate forward + reversed (trim 1 frame at each join to avoid freeze)
  8. Save as output_path
  9. Clean up temp files

Module-level state for tracking generation progress:
- `_loop_progress = {"active": False, "status": "idle", "message": "", "album_id": ""}`

### New endpoint: `POST /api/library/albums/{album_id}/video-loop`

Request: `{ "prompt": "string" }`

Behavior:
1. Validate album exists and has a wide cover
2. Start background thread calling `generate_video_loop`
3. Save result as `{album_id}_loop.mp4` in COVERS_DIR
4. Update album data with `video_loop` URL
5. Return `{ "status": "started" }`

### New endpoint: `GET /api/library/albums/{album_id}/video-loop-status`

Returns: `{ "active": bool, "status": "idle|submitted|processing|done|failed", "message": "string", "loop_url": "string|null" }`

### New endpoint: serving loop videos

Loop MP4 files are already served by the existing static file mount for COVERS_DIR. URL pattern: `/api/library/covers/{album_id}_loop.mp4`

### YouTube upload integration

In `routes/youtube_upload.py`, update `_make_video` function:
- Before creating a static-image video, check if `{album_id}_loop.mp4` exists
- If it does, use `ffmpeg -stream_loop -1 -i loop.mp4 -i audio.mp3 -shortest` instead of the static image approach
- Falls back to static cover if no loop exists

## Frontend API Functions

Add to `api.js`:
- `generateVideoLoop(albumId, data)` — POST to video-loop endpoint
- `getVideoLoopStatus(albumId)` — GET loop status

## AlbumDetail Changes

- Add "Generate Video Loop" menu item (only when album has a cover)
- Add `VideoLoopModal` component with `triggerOpen` pattern matching `YoutubeUploadPanel`
- Pass `albumId` and existing loop URL to modal

## Cost

- ~$0.07-0.11 per generation (standard 5s clip)
- Regenerating = another $0.07-0.11

## Edge Cases

- **No wide cover:** Button hidden. User must generate a cover first.
- **Kling API down/error:** Show error in modal, keep prompt, allow retry.
- **Generation timeout:** 5 minute timeout on polling, show error if exceeded.
- **Existing loop:** Show current loop in the modal with option to regenerate.
- **No Kling API keys configured:** Button hidden or show "Configure Kling API keys in settings".
