"""Generate a professional lyric video from a Kling video loop + audio + lyrics.

Adds: title card, section labels, timed lyrics, vignette, progress bar.
"""

import json
import re
import subprocess
import sys
from pathlib import Path


def fmt_time(s):
    h = int(s // 3600)
    m = int((s % 3600) // 60)
    sec = int(s % 60)
    cs = int((s % 1) * 100)
    return f"{h}:{m:02d}:{sec:02d}.{cs:02d}"


def parse_lyrics(lyrics_text):
    """Parse lyrics into [(section_name, [lines]), ...]"""
    sections = []
    current_tag = None
    current_lines = []

    for line in lyrics_text.split("\n"):
        line = line.strip()
        if line.startswith("["):
            if current_tag is not None:
                sections.append((current_tag, current_lines))
            tag = line.strip("[]")
            clean_tag = tag.split(" - ")[0].strip()
            current_tag = clean_tag
            current_lines = []
        elif line:
            line = re.sub(r"^(Sabrina|Eric):\s*", "", line)
            current_lines.append(line)

    if current_tag is not None:
        sections.append((current_tag, current_lines))

    return sections


def build_ass(title, album, sections, duration, output_path):
    """Build an ASS subtitle file with title card + timed lyrics."""
    lines = []
    lines.append("[Script Info]")
    lines.append(f"Title: {title}")
    lines.append("ScriptType: v4.00+")
    lines.append("WrapStyle: 0")
    lines.append("PlayResX: 1920")
    lines.append("PlayResY: 1080")
    lines.append("")
    lines.append("[V4+ Styles]")
    lines.append("Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding")
    # Title: large white, top center
    lines.append("Style: Title,Arial,68,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,3,0,1,3,2,8,30,30,60,1")
    # Album: smaller grey, below title
    lines.append("Style: Album,Arial,30,&H0090A0A0,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,1,0,1,2,1,8,30,30,130,1")
    # Lyrics: white on dark semi-transparent bar, bottom center
    lines.append("Style: Lyrics,Arial,46,&H00FFFFFF,&H000000FF,&H00000000,&HB0000000,0,0,0,0,100,100,1,0,3,2,0,2,80,80,60,1")
    # Section label: green, above lyrics
    lines.append("Style: Section,Arial,26,&H0060D71E,&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,2,0,1,2,1,2,80,80,115,1")
    lines.append("")
    lines.append("[Events]")
    lines.append("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text")

    # Title card: 0-6s
    lines.append(f"Dialogue: 0,{fmt_time(0)},{fmt_time(6)},Title,,0,0,0,,{{\\fad(1500,1500)}}{title}")
    lines.append(f"Dialogue: 0,{fmt_time(0.5)},{fmt_time(5.5)},Album,,0,0,0,,{{\\fad(1500,1500)}}{album}")

    # Calculate timing
    total_lyric_lines = sum(len(ls) for _, ls in sections)
    if total_lyric_lines == 0:
        Path(output_path).write_text("\n".join(lines), encoding="utf-8")
        return

    sec_per_line = (duration - 12) / total_lyric_lines  # buffer for intro/outro
    t = 6.0

    for tag, lyric_lines in sections:
        if not lyric_lines:
            # Instrumental section — just show label for a fixed time
            section_dur = sec_per_line * 4
            lines.append(f"Dialogue: 1,{fmt_time(t)},{fmt_time(t + section_dur)},Section,,0,0,0,,{{\\fad(500,500)}}{tag}")
            t += section_dur
            continue

        section_dur = len(lyric_lines) * sec_per_line

        # Section label
        label_dur = min(3.0, section_dur)
        lines.append(f"Dialogue: 1,{fmt_time(t)},{fmt_time(t + label_dur)},Section,,0,0,0,,{{\\fad(500,500)}}{tag}")

        # Lyric lines
        line_dur = section_dur / len(lyric_lines)
        for i, lyric in enumerate(lyric_lines):
            start = t + i * line_dur
            end = start + line_dur
            lines.append(f"Dialogue: 0,{fmt_time(start)},{fmt_time(end)},Lyrics,,0,0,0,,{{\\fad(300,300)}}{lyric}")

        t += section_dur

    Path(output_path).write_text("\n".join(lines), encoding="utf-8")
    print(f"ASS subtitles: {len(sections)} sections, {total_lyric_lines} lyric lines")


def make_video(video_loop, audio_path, ass_path, output_path, duration):
    """Combine video loop + audio + subtitles + vignette + progress bar."""
    cmd = [
        "ffmpeg", "-y",
        "-stream_loop", "-1",
        "-i", str(video_loop),
        "-i", str(audio_path),
        "-filter_complex",
        # Vignette + subtitles + progress bar
        f"[0:v]vignette=PI/5[vig];"
        f"[vig]ass='{str(ass_path).replace(chr(92), '/').replace(':', chr(92)+':')}'[sub];"
        # Progress bar: thin green line at the very bottom
        f"[sub]drawbox=x=0:y=ih-4:w=iw*t/{duration}:h=4:color=0x1ed76080:t=fill[out]",
        "-map", "[out]",
        "-map", "1:a",
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
        "-shortest",
        str(output_path),
    ]
    print(f"Rendering video...")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"FFmpeg error: {result.stderr[-500:]}")
        sys.exit(1)
    print(f"Done: {output_path}")


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Make a lyric video")
    parser.add_argument("--video-loop", required=True, help="Kling ping-pong loop MP4")
    parser.add_argument("--audio", required=True, help="Song MP3")
    parser.add_argument("--metadata", required=True, help="Song .inputs.json")
    parser.add_argument("--album", default="", help="Album name")
    parser.add_argument("--output", default="lyric_video.mp4", help="Output path")
    args = parser.parse_args()

    meta = json.loads(Path(args.metadata).read_text(encoding="utf-8"))
    title = meta.get("title", "Untitled")
    lyrics = meta.get("lyrics", "")
    duration = meta.get("duration", 180)
    album = args.album or "Unknown Album"

    sections = parse_lyrics(lyrics)
    ass_path = Path(args.output).with_suffix(".ass")
    build_ass(title, album, sections, duration, ass_path)
    make_video(args.video_loop, args.audio, ass_path, args.output, duration)


if __name__ == "__main__":
    main()
