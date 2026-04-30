"""Professional lyric video generator v3.

Uses Whisper timestamps directly, Pillow for text rendering.
Text positioned on left side to avoid person in image.
"""

import json
import math
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


WIDTH, HEIGHT = 1920, 1080
FPS = 25
FONT_PATH = "C:/Windows/Fonts/segoeuib.ttf"
GREEN = (30, 215, 96)
WHITE = (255, 255, 255)
GREY = (140, 140, 140)


def ease(t):
    return t * t * (3 - 2 * t)


def render_text_with_shadow(draw, x, y, text, font, fill, shadow_offset=2, shadow_alpha=0.5):
    """Draw text with a drop shadow."""
    r, g, b = fill[:3]
    a = fill[3] if len(fill) > 3 else 255
    sa = int(a * shadow_alpha)
    draw.text((x + shadow_offset, y + shadow_offset), text, fill=(0, 0, 0, sa), font=font)
    draw.text((x, y), text, fill=(r, g, b, a), font=font)


def make_frame(t, duration, title, album, whisper_segments):
    """Render a single overlay frame at time t."""
    img = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # --- Vignette (dark edges) ---
    # Simple radial darkening using rectangles at edges
    for i in range(60):
        a = int(50 * (1 - i / 60))
        # Top
        draw.rectangle([(0, i * 2), (WIDTH, i * 2 + 2)], fill=(0, 0, 0, a))
        # Bottom
        draw.rectangle([(0, HEIGHT - i * 2 - 2), (WIDTH, HEIGHT - i * 2)], fill=(0, 0, 0, a))
        # Left
        draw.rectangle([(i * 3, 0), (i * 3 + 3, HEIGHT)], fill=(0, 0, 0, a))
        # Right
        draw.rectangle([(WIDTH - i * 3 - 3, 0), (WIDTH - i * 3, HEIGHT)], fill=(0, 0, 0, a))

    # --- Title card (0-7s) ---
    if t < 7:
        if t < 1.5:
            alpha = ease(t / 1.5)
        elif t > 5.5:
            alpha = ease((7 - t) / 1.5)
        else:
            alpha = 1.0

        a = int(alpha * 255)

        # Centered, upper third
        font_title = ImageFont.truetype(FONT_PATH, 72)
        font_album = ImageFont.truetype(FONT_PATH, 30)

        # Title
        bbox = draw.textbbox((0, 0), title, font=font_title)
        tw = bbox[2] - bbox[0]
        tx = (WIDTH - tw) // 2
        ty = HEIGHT // 3 - 40

        render_text_with_shadow(draw, tx, ty, title, font_title, (255, 255, 255, a), shadow_offset=3)

        # Album
        bbox2 = draw.textbbox((0, 0), album, font=font_album)
        tw2 = bbox2[2] - bbox2[0]
        tx2 = (WIDTH - tw2) // 2
        ty2 = ty + 90

        render_text_with_shadow(draw, tx2, ty2, album, font_album, (140, 140, 140, a), shadow_offset=2)

    # --- Lyrics (bottom area with dark bar) ---
    # Find current segment
    current_seg = None
    for seg in whisper_segments:
        if seg["start"] - 0.2 <= t <= seg["end"] + 0.1:
            current_seg = seg
            break

    if current_seg and t > 5:
        text = current_seg["text"].strip()
        if text:
            # Fade in/out
            fade_in = min(1.0, (t - current_seg["start"] + 0.2) / 0.4)
            fade_out = min(1.0, (current_seg["end"] + 0.1 - t) / 0.4)
            alpha = min(fade_in, fade_out)
            a = int(alpha * 255)

            # Dark gradient bar at bottom
            bar_h = 100
            for i in range(bar_h):
                ba = int(alpha * 160 * (i / bar_h))
                draw.rectangle([(0, HEIGHT - bar_h + i), (WIDTH, HEIGHT - bar_h + i + 1)], fill=(0, 0, 0, ba))

            # Lyrics text — centered at bottom
            font_lyrics = ImageFont.truetype(FONT_PATH, 44)

            # Word wrap if too long
            bbox = draw.textbbox((0, 0), text, font=font_lyrics)
            tw = bbox[2] - bbox[0]

            if tw > WIDTH - 160:
                # Split roughly in half
                words = text.split()
                mid = len(words) // 2
                line1 = " ".join(words[:mid])
                line2 = " ".join(words[mid:])

                bbox1 = draw.textbbox((0, 0), line1, font=font_lyrics)
                bbox2 = draw.textbbox((0, 0), line2, font=font_lyrics)
                tw1, tw2 = bbox1[2] - bbox1[0], bbox2[2] - bbox2[0]

                y1 = HEIGHT - 85
                y2 = HEIGHT - 42
                render_text_with_shadow(draw, (WIDTH - tw1) // 2, y1, line1, font_lyrics, (255, 255, 255, a), shadow_offset=2)
                render_text_with_shadow(draw, (WIDTH - tw2) // 2, y2, line2, font_lyrics, (255, 255, 255, a), shadow_offset=2)
            else:
                lx = (WIDTH - tw) // 2
                ly = HEIGHT - 55
                render_text_with_shadow(draw, lx, ly, text, font_lyrics, (255, 255, 255, a), shadow_offset=2)

    # --- Progress bar ---
    progress = t / duration
    bar_w = int(WIDTH * progress)
    if bar_w > 0:
        draw.rectangle([(0, HEIGHT - 3), (bar_w, HEIGHT)], fill=(*GREEN, 200))

    return img


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--video-loop", required=True)
    parser.add_argument("--audio", required=True)
    parser.add_argument("--metadata", required=True)
    parser.add_argument("--timestamps", required=True)
    parser.add_argument("--album", default="")
    parser.add_argument("--output", default="lyric_video_v3.mp4")
    parser.add_argument("--preview", action="store_true")
    args = parser.parse_args()

    meta = json.loads(Path(args.metadata).read_text(encoding="utf-8"))
    title = meta.get("title", "Untitled")
    duration = meta.get("duration", 180)
    album = args.album or ""
    segments = json.loads(Path(args.timestamps).read_text(encoding="utf-8"))

    total_frames = int(duration * FPS)
    print(f"Title: {title}")
    print(f"Duration: {duration}s ({total_frames} frames)")
    print(f"Segments: {len(segments)}")

    with tempfile.TemporaryDirectory() as tmp:
        print(f"Rendering {total_frames} frames...", flush=True)

        for i in range(total_frames):
            t = i / FPS
            overlay = make_frame(t, duration, title, album, segments)
            overlay.save(os.path.join(tmp, f"frame_{i:06d}.png"))

            if i % (FPS * 15) == 0:
                print(f"  {i}/{total_frames} ({t:.0f}s)", flush=True)

        print("  All frames rendered", flush=True)
        print("Compositing...", flush=True)

        cmd = [
            "ffmpeg", "-y",
            "-stream_loop", "-1",
            "-i", str(args.video_loop),
            "-framerate", str(FPS),
            "-f", "image2",
            "-i", os.path.join(tmp, "frame_%06d.png"),
            "-i", str(args.audio),
            "-filter_complex",
            "[0:v]scale=1920:1080[bg];"
            "[1:v]format=rgba[fg];"
            "[bg][fg]overlay=0:0:format=auto[out]",
            "-map", "[out]", "-map", "2:a",
            "-c:v", "libx264", "-preset", "medium", "-crf", "18",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k",
            "-t", str(duration),
            str(args.output),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            print(f"FFmpeg error: {result.stderr[-500:]}")
            sys.exit(1)

    print(f"Done: {args.output}", flush=True)

    if args.preview:
        print("Generating previews...", flush=True)
        for t in [3, 15, 30, 60, 120, 200]:
            out = f"{Path(args.output).stem}_preview_{t}s.png"
            out_path = Path(args.output).parent / out
            subprocess.run([
                "ffmpeg", "-y", "-ss", str(t),
                "-i", str(args.output),
                "-frames:v", "1", "-q:v", "2", str(out_path),
            ], capture_output=True)
            print(f"  {out_path}", flush=True)


if __name__ == "__main__":
    main()
