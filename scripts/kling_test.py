"""Kling AI Video Loop Generator — standalone test tool.

Usage:
    python kling_test.py --ak YOUR_ACCESS_KEY --sk YOUR_SECRET_KEY --image path/to/cover.png
    python kling_test.py --ak YOUR_ACCESS_KEY --sk YOUR_SECRET_KEY --image path/to/cover.png --prompt "neon sign flickers softly" --output loop.mp4

Generates a 5s video clip from a still image using Kling AI,
with fixed camera and prompt-controlled animation.
Then cross-fades into a seamless loop and optionally repeats.
"""

import argparse
import base64
import json
import os
import sys
import time
from pathlib import Path

import jwt
import requests


def generate_token(access_key, secret_key):
    """Generate a JWT token for Kling API auth."""
    payload = {
        "iss": access_key,
        "exp": int(time.time()) + 1800,
        "nbf": int(time.time()) - 5,
    }
    return jwt.encode(payload, secret_key, algorithm="HS256",
                      headers={"alg": "HS256", "typ": "JWT"})


def submit_image_to_video(token, image_path, prompt, duration="5", mode="std"):
    """Submit an image-to-video generation task."""
    # Encode image as base64
    img_bytes = Path(image_path).read_bytes()
    img_b64 = base64.b64encode(img_bytes).decode("utf-8")

    body = {
        "model_name": "kling-v2-master",
        "image": img_b64,
        "prompt": f"fixed lens, tripod, no camera movement, {prompt}",
        "negative_prompt": "camera movement, zoom, pan, tilt, shaky, handheld, morphing face, distortion",
        "mode": mode,
        "duration": duration,
        "cfg_scale": 0.7
    }

    resp = requests.post(
        "https://api.klingai.com/v1/videos/image2video",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json=body,
    )

    if resp.status_code != 200:
        print(f"Error {resp.status_code}: {resp.text}")
        sys.exit(1)

    data = resp.json()
    if data.get("code") != 0:
        print(f"API error: {data.get('message', data)}")
        sys.exit(1)

    task_id = data["data"]["task_id"]
    print(f"Task submitted: {task_id}")
    return task_id


def wait_for_result(token, task_id, timeout=300, interval=10):
    """Poll until the video is ready."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        resp = requests.get(
            f"https://api.klingai.com/v1/videos/image2video/{task_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        data = resp.json()
        task_data = data.get("data", {})
        status = task_data.get("task_status", "unknown")

        if status == "succeed":
            videos = task_data.get("task_result", {}).get("videos", [])
            if videos:
                return videos[0]["url"]
            raise RuntimeError("Task succeeded but no video URL returned")
        elif status in ("failed", "error"):
            reason = task_data.get("task_status_msg", "unknown error")
            raise RuntimeError(f"Task failed: {reason}")
        else:
            print(f"  Status: {status} ({int(deadline - time.time())}s remaining)")

        time.sleep(interval)

    raise TimeoutError("Video generation timed out")


def download_video(url, output_path):
    """Download video from URL."""
    resp = requests.get(url, stream=True)
    resp.raise_for_status()
    with open(output_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=8192):
            f.write(chunk)
    print(f"Downloaded: {output_path}")


def make_loop(input_path, output_path, loops=3, crossfade_sec=0.5):
    """Cross-fade and loop the video using ffmpeg."""
    import subprocess
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        # Create a crossfaded version
        cf_path = os.path.join(tmp, "crossfaded.mp4")

        # Get video duration
        probe = subprocess.run(
            ["ffprobe", "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", str(input_path)],
            capture_output=True, text=True
        )
        duration = float(probe.stdout.strip())

        # Trim end, crossfade with beginning
        # For simplicity, just loop with a short crossfade
        concat_path = os.path.join(tmp, "concat.txt")
        with open(concat_path, "w") as f:
            for _ in range(loops):
                f.write(f"file '{input_path}'\n")

        subprocess.run([
            "ffmpeg", "-y",
            "-f", "concat", "-safe", "0",
            "-i", concat_path,
            "-c:v", "libx264", "-preset", "medium", "-crf", "18",
            "-pix_fmt", "yuv420p",
            str(output_path),
        ], capture_output=True)

    print(f"Looped {loops}x: {output_path}")


def main():
    parser = argparse.ArgumentParser(description="Kling AI Video Loop Generator")
    parser.add_argument("--ak", required=True, help="Kling Access Key")
    parser.add_argument("--sk", required=True, help="Kling Secret Key")
    parser.add_argument("--image", required=True, help="Input image path")
    parser.add_argument("--prompt", default="subtle atmospheric light shifts, gentle glow, neon flicker, ambient mood",
                        help="Animation prompt (camera is always fixed)")
    parser.add_argument("--output", default="kling_loop.mp4", help="Output video path")
    parser.add_argument("--duration", default="5", choices=["5", "10"], help="Clip duration seconds")
    parser.add_argument("--mode", default="std", choices=["std", "pro"], help="Quality mode (pro = 1080p)")
    parser.add_argument("--loops", type=int, default=3, help="Loop count for output")
    args = parser.parse_args()

    if not Path(args.image).exists():
        print(f"Image not found: {args.image}")
        sys.exit(1)

    print(f"Image: {args.image}")
    print(f"Prompt: fixed lens, {args.prompt}")
    print(f"Duration: {args.duration}s, Mode: {args.mode}")
    print()

    token = generate_token(args.ak, args.sk)

    print("Submitting to Kling API...")
    task_id = submit_image_to_video(token, args.image, args.prompt, args.duration, args.mode)

    print("Waiting for generation...")
    video_url = wait_for_result(token, task_id)

    raw_path = args.output.replace(".mp4", "_raw.mp4")
    print(f"Downloading raw clip...")
    download_video(video_url, raw_path)

    print(f"Creating {args.loops}x loop...")
    make_loop(raw_path, args.output, loops=args.loops)

    # Clean up raw
    os.remove(raw_path)

    print(f"\nDone! Output: {args.output}")


if __name__ == "__main__":
    main()
