"""SVD Video Loop Generator — standalone test tool.

Usage:
    python svd_test.py --image path/to/cover.png --prompt "floating particles, gentle drift" --output loop.mp4
    python svd_test.py --image path/to/cover.png  # uses default prompt

Generates a ~4s video clip from a still image using Stable Video Diffusion,
then cross-fades the end into the start for a seamless loop.
"""

import argparse
import os
import sys
import time
from pathlib import Path

import torch
import numpy as np
from PIL import Image


def load_svd_pipeline(device="cuda"):
    """Load SVD img2vid pipeline. Downloads model on first run (~10GB)."""
    from diffusers import StableVideoDiffusionPipeline

    print("Loading SVD pipeline (first run downloads ~10GB)...")
    t0 = time.time()
    pipe = StableVideoDiffusionPipeline.from_pretrained(
        "stabilityai/stable-video-diffusion-img2vid-xt",
        torch_dtype=torch.float16,
        variant="fp16",
    )
    pipe.to(device)

    # Memory optimisations for 16GB GPU
    pipe.enable_model_cpu_offload()

    print(f"SVD loaded in {time.time() - t0:.1f}s")
    return pipe


def generate_clip(pipe, image_path, num_frames=25, fps=6, motion_bucket_id=127, noise_aug_strength=0.02):
    """Generate a video clip from a still image.

    Args:
        pipe: SVD pipeline
        image_path: path to input image
        num_frames: number of frames to generate (25 = ~4s at 6fps)
        fps: frames per second for conditioning
        motion_bucket_id: 1-255, higher = more motion
        noise_aug_strength: how much noise to add to input (lower = closer to original)

    Returns:
        list of PIL Images (frames)
    """
    image = Image.open(image_path).convert("RGB")

    # SVD expects 1024x576 for xt model
    image = image.resize((1024, 576), Image.LANCZOS)

    print(f"Generating {num_frames} frames (motion={motion_bucket_id}, noise={noise_aug_strength})...")
    t0 = time.time()

    with torch.inference_mode():
        frames = pipe(
            image,
            num_frames=num_frames,
            fps=fps,
            motion_bucket_id=motion_bucket_id,
            noise_aug_strength=noise_aug_strength,
            decode_chunk_size=4,
        ).frames[0]

    print(f"Generated {len(frames)} frames in {time.time() - t0:.1f}s")
    return frames


def crossfade_loop(frames, crossfade_frames=6):
    """Cross-fade the end into the start for a seamless loop.

    Takes the last N frames and blends them with the first N frames.
    """
    n = len(frames)
    if crossfade_frames >= n // 2:
        crossfade_frames = n // 4

    looped = list(frames)

    for i in range(crossfade_frames):
        alpha = i / crossfade_frames  # 0 -> 1
        end_idx = n - crossfade_frames + i
        start_idx = i

        end_frame = np.array(frames[end_idx]).astype(float)
        start_frame = np.array(frames[start_idx]).astype(float)

        blended = (end_frame * (1 - alpha) + start_frame * alpha).astype(np.uint8)
        looped[end_idx] = Image.fromarray(blended)

    return looped


def save_video(frames, output_path, fps=6, loop_count=3):
    """Save frames as MP4, optionally looping N times for a longer video."""
    import subprocess
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        # Save frames as PNGs
        for i, frame in enumerate(frames):
            frame.save(os.path.join(tmp, f"frame_{i:04d}.png"))

        # Single clip
        clip_path = os.path.join(tmp, "clip.mp4")
        subprocess.run([
            "ffmpeg", "-y",
            "-framerate", str(fps),
            "-i", os.path.join(tmp, "frame_%04d.png"),
            "-c:v", "libx264",
            "-preset", "medium",
            "-crf", "18",
            "-pix_fmt", "yuv420p",
            clip_path,
        ], capture_output=True)

        if loop_count > 1:
            # Create a concat file to loop
            concat_path = os.path.join(tmp, "concat.txt")
            with open(concat_path, "w") as f:
                for _ in range(loop_count):
                    f.write(f"file '{clip_path}'\n")

            subprocess.run([
                "ffmpeg", "-y",
                "-f", "concat",
                "-safe", "0",
                "-i", concat_path,
                "-c:v", "libx264",
                "-preset", "medium",
                "-crf", "18",
                "-pix_fmt", "yuv420p",
                str(output_path),
            ], capture_output=True)
        else:
            import shutil
            shutil.copy2(clip_path, str(output_path))

    print(f"Saved: {output_path}")


def main():
    parser = argparse.ArgumentParser(description="SVD Video Loop Generator")
    parser.add_argument("--image", required=True, help="Input image path")
    parser.add_argument("--output", default="loop.mp4", help="Output video path")
    parser.add_argument("--motion", type=int, default=80, help="Motion amount 1-255 (default: 80, subtle)")
    parser.add_argument("--noise", type=float, default=0.02, help="Noise augmentation 0-1 (default: 0.02, minimal)")
    parser.add_argument("--frames", type=int, default=25, help="Number of frames (default: 25)")
    parser.add_argument("--fps", type=int, default=6, help="FPS (default: 6)")
    parser.add_argument("--loops", type=int, default=3, help="Loop count for output (default: 3)")
    parser.add_argument("--crossfade", type=int, default=6, help="Cross-fade frames for seamless loop (default: 6)")
    args = parser.parse_args()

    if not Path(args.image).exists():
        print(f"Image not found: {args.image}")
        sys.exit(1)

    pipe = load_svd_pipeline()
    frames = generate_clip(
        pipe,
        args.image,
        num_frames=args.frames,
        fps=args.fps,
        motion_bucket_id=args.motion,
        noise_aug_strength=args.noise,
    )
    frames = crossfade_loop(frames, crossfade_frames=args.crossfade)
    save_video(frames, args.output, fps=args.fps, loop_count=args.loops)

    # Free GPU
    del pipe
    torch.cuda.empty_cache()
    print("Done!")


if __name__ == "__main__":
    main()
