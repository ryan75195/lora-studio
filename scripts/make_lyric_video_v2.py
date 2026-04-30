"""Professional lyric video generator v2.

Uses Pillow for text rendering, Whisper timestamps for sync,
FFmpeg for compositing. Much better than ASS subtitles.
"""

import json
import math
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageFilter


# --- Config ---
WIDTH, HEIGHT = 1920, 1080
FPS = 25
FONT_TITLE = "C:/Windows/Fonts/segoeuib.ttf"
FONT_LYRICS = "C:/Windows/Fonts/segoeuib.ttf"
FONT_SECTION = "C:/Windows/Fonts/segoeuib.ttf"
GREEN = (30, 215, 96)
WHITE = (255, 255, 255)
GREY = (160, 160, 160)
DIM_WHITE = (200, 200, 200)


def ease_in_out(t):
    """Smooth ease-in-out curve 0->1."""
    return t * t * (3 - 2 * t)


def make_title_frame(title, album, alpha):
    """Render title card overlay with given alpha (0-1)."""
    img = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    a = int(alpha * 255)

    # Title
    font_title = ImageFont.truetype(FONT_TITLE, 64)
    bbox = draw.textbbox((0, 0), title, font=font_title)
    tw = bbox[2] - bbox[0]
    x = (WIDTH - tw) // 2
    y = HEIGHT // 2 - 60

    # Shadow
    draw.text((x + 2, y + 2), title, fill=(0, 0, 0, int(a * 0.6)), font=font_title)
    draw.text((x, y), title, fill=(*WHITE, a), font=font_title)

    # Album subtitle
    font_album = ImageFont.truetype(FONT_LYRICS, 28)
    bbox2 = draw.textbbox((0, 0), album, font=font_album)
    tw2 = bbox2[2] - bbox2[0]
    x2 = (WIDTH - tw2) // 2
    y2 = y + 80

    draw.text((x2 + 1, y2 + 1), album, fill=(0, 0, 0, int(a * 0.4)), font=font_album)
    draw.text((x2, y2), album, fill=(*GREY, a), font=font_album)

    return img


def make_lyrics_frame(lyric_text, section_text, lyric_alpha, section_alpha):
    """Render lyrics + section label overlay."""
    img = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Semi-transparent dark bar at bottom for lyrics
    if lyric_text and lyric_alpha > 0:
        la = int(lyric_alpha * 255)
        bar_alpha = int(lyric_alpha * 140)

        # Dark gradient bar
        for i in range(120):
            a = int(bar_alpha * (i / 120))
            draw.rectangle([(0, HEIGHT - 120 + i), (WIDTH, HEIGHT - 120 + i + 1)], fill=(0, 0, 0, a))

        # Lyrics text
        font_lyrics = ImageFont.truetype(FONT_LYRICS, 42)
        bbox = draw.textbbox((0, 0), lyric_text, font=font_lyrics)
        tw = bbox[2] - bbox[0]
        x = (WIDTH - tw) // 2
        y = HEIGHT - 80

        # Glow effect
        draw.text((x, y + 2), lyric_text, fill=(0, 0, 0, int(la * 0.5)), font=font_lyrics)
        draw.text((x, y), lyric_text, fill=(*WHITE, la), font=font_lyrics)

    # Section label (above lyrics)
    if section_text and section_alpha > 0:
        sa = int(section_alpha * 255)
        font_section = ImageFont.truetype(FONT_SECTION, 22)
        bbox = draw.textbbox((0, 0), section_text, font=font_section)
        tw = bbox[2] - bbox[0]
        x = (WIDTH - tw) // 2
        y = HEIGHT - 140

        draw.text((x, y), section_text, fill=(*GREEN, sa), font=font_section)

    return img


def make_progress_bar(progress):
    """Thin progress bar at the very bottom."""
    img = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    bar_width = int(WIDTH * progress)
    if bar_width > 0:
        draw.rectangle([(0, HEIGHT - 4), (bar_width, HEIGHT)], fill=(*GREEN, 180))
    return img


def make_vignette():
    """Pre-render a vignette overlay."""
    img = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    cx, cy = WIDTH // 2, HEIGHT // 2
    max_dist = math.sqrt(cx * cx + cy * cy)

    for y in range(0, HEIGHT, 4):
        for x in range(0, WIDTH, 4):
            dist = math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
            factor = dist / max_dist
            alpha = int(min(80, factor * factor * 120))
            if alpha > 0:
                draw.rectangle([(x, y), (x + 4, y + 4)], fill=(0, 0, 0, alpha))

    return img


def match_lyrics_to_timestamps(lyrics_text, whisper_segments):
    """Match original lyrics lines to Whisper timestamps using fuzzy matching."""
    import difflib

    # Parse lyrics into lines (skip section tags)
    lyric_lines = []
    current_section = ""
    for line in lyrics_text.split("\n"):
        line = line.strip()
        if line.startswith("["):
            current_section = line.strip("[]").split(" - ")[0].strip()
        elif line:
            import re
            clean = re.sub(r"^(Sabrina|Eric):\s*", "", line)
            lyric_lines.append({"text": clean, "section": current_section})

    # Match each lyric line to the closest Whisper segment
    matched = []
    used_segments = set()

    for ll in lyric_lines:
        best_ratio = 0
        best_seg = None
        for i, seg in enumerate(whisper_segments):
            if i in used_segments:
                continue
            ratio = difflib.SequenceMatcher(None, ll["text"].lower(), seg["text"].lower()).ratio()
            if ratio > best_ratio:
                best_ratio = ratio
                best_seg = (i, seg)

        if best_seg and best_ratio > 0.3:
            idx, seg = best_seg
            used_segments.add(idx)
            matched.append({
                "text": ll["text"],
                "section": ll["section"],
                "start": seg["start"],
                "end": seg["end"],
            })
        else:
            # No match — estimate based on position
            matched.append({
                "text": ll["text"],
                "section": ll["section"],
                "start": None,
                "end": None,
            })

    # Fill in missing timestamps by interpolation
    for i, m in enumerate(matched):
        if m["start"] is None:
            prev_end = matched[i - 1]["end"] if i > 0 and matched[i - 1]["end"] else 0
            next_start = None
            for j in range(i + 1, len(matched)):
                if matched[j]["start"] is not None:
                    next_start = matched[j]["start"]
                    break
            if next_start is None:
                next_start = prev_end + 5
            gap = next_start - prev_end
            m["start"] = prev_end + 0.5
            m["end"] = prev_end + gap * 0.8

    return matched


def render_overlay_frames(title, album, matched_lyrics, duration, tmp_dir):
    """Render all overlay frames as PNGs."""
    total_frames = int(duration * FPS)
    print(f"Rendering {total_frames} overlay frames...")

    # Pre-render vignette (slow to compute per-frame)
    print("  Pre-rendering vignette...", flush=True)
    vignette = make_vignette()

    for frame_idx in range(total_frames):
        t = frame_idx / FPS

        # Start with transparent
        overlay = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))

        # Vignette (always on)
        overlay = Image.alpha_composite(overlay, vignette)

        # Title card (0-7s)
        if t < 7:
            if t < 1.5:
                alpha = ease_in_out(t / 1.5)
            elif t > 5.5:
                alpha = ease_in_out((7 - t) / 1.5)
            else:
                alpha = 1.0
            title_img = make_title_frame(title, album, alpha)
            overlay = Image.alpha_composite(overlay, title_img)

        # Find current lyric + section
        current_lyric = ""
        current_section = ""
        lyric_alpha = 0.0
        section_alpha = 0.0

        for m in matched_lyrics:
            if m["start"] <= t <= m["end"]:
                current_lyric = m["text"]
                current_section = m["section"]
                # Fade in/out
                fade_in = min(1.0, (t - m["start"]) / 0.3)
                fade_out = min(1.0, (m["end"] - t) / 0.3)
                lyric_alpha = min(fade_in, fade_out)
                section_alpha = lyric_alpha * 0.8
                break

        if current_lyric:
            lyrics_img = make_lyrics_frame(current_lyric, current_section, lyric_alpha, section_alpha)
            overlay = Image.alpha_composite(overlay, lyrics_img)

        # Progress bar
        progress = t / duration
        bar_img = make_progress_bar(progress)
        overlay = Image.alpha_composite(overlay, bar_img)

        # Save frame
        frame_path = os.path.join(tmp_dir, f"overlay_{frame_idx:06d}.png")
        overlay.save(frame_path)

        if frame_idx % (FPS * 10) == 0:
            print(f"  Frame {frame_idx}/{total_frames} ({t:.0f}s)", flush=True)

    print(f"  All {total_frames} frames rendered")


def composite_video(video_loop, audio, overlay_dir, output, duration):
    """Composite overlay frames onto the video loop with audio."""
    print("Compositing final video...", flush=True)

    cmd = [
        "ffmpeg", "-y",
        "-stream_loop", "-1",
        "-i", str(video_loop),
        "-framerate", str(FPS),
        "-i", os.path.join(overlay_dir, "overlay_%06d.png"),
        "-i", str(audio),
        "-filter_complex",
        "[0:v][1:v]overlay=format=auto:shortest=1[out]",
        "-map", "[out]",
        "-map", "2:a",
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
        "-t", str(duration),
        str(output),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"FFmpeg error: {result.stderr[-500:]}")
        sys.exit(1)
    print(f"Done: {output}")


def screenshot_frames(video_path, times, output_dir):
    """Extract frames at specific times for preview."""
    for t in times:
        out = os.path.join(output_dir, f"preview_{t}s.png")
        subprocess.run([
            "ffmpeg", "-y", "-ss", str(t), "-i", str(video_path),
            "-frames:v", "1", "-q:v", "2", out,
        ], capture_output=True)
        print(f"  Preview: {out}")


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Professional lyric video generator v2")
    parser.add_argument("--video-loop", required=True)
    parser.add_argument("--audio", required=True)
    parser.add_argument("--metadata", required=True)
    parser.add_argument("--timestamps", required=True, help="Whisper timestamps JSON")
    parser.add_argument("--album", default="")
    parser.add_argument("--output", default="lyric_video_v2.mp4")
    parser.add_argument("--preview", action="store_true", help="Generate preview screenshots")
    args = parser.parse_args()

    meta = json.loads(Path(args.metadata).read_text(encoding="utf-8"))
    title = meta.get("title", "Untitled")
    lyrics = meta.get("lyrics", "")
    duration = meta.get("duration", 180)
    album = args.album or ""

    whisper_segments = json.loads(Path(args.timestamps).read_text(encoding="utf-8"))

    print(f"Title: {title}")
    print(f"Duration: {duration}s")
    print(f"Whisper segments: {len(whisper_segments)}")

    # Match lyrics to timestamps
    matched = match_lyrics_to_timestamps(lyrics, whisper_segments)
    print(f"Matched {len(matched)} lyric lines to timestamps")

    with tempfile.TemporaryDirectory() as tmp:
        # Render overlay frames
        render_overlay_frames(title, album, matched, duration, tmp)

        # Composite
        composite_video(args.video_loop, args.audio, tmp, args.output, duration)

    # Preview screenshots
    if args.preview:
        preview_dir = str(Path(args.output).parent)
        screenshot_frames(args.output, [3, 30, 60, 120, 200], preview_dir)


if __name__ == "__main__":
    main()
