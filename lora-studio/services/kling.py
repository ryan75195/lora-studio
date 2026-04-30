"""Kling AI video loop generation service.

Generates animated video loops from still images using Kling's image-to-video API.
Creates seamless ping-pong loops (forward + reverse) for YouTube video backgrounds.
"""

import base64
import logging
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

import jwt
import requests

import services.config as _cfg

logger = logging.getLogger("lora-studio.kling")

_loop_progress = {
    "active": False,
    "status": "idle",
    "message": "",
    "album_id": "",
    "loop_url": None,
}


def get_progress():
    return dict(_loop_progress)


def _generate_token():
    ak = _cfg.KLING_ACCESS_KEY
    sk = _cfg.KLING_SECRET_KEY
    if not ak or not sk:
        raise RuntimeError("Kling API keys not configured")
    payload = {
        "iss": ak,
        "exp": int(time.time()) + 1800,
        "nbf": int(time.time()) - 5,
    }
    return jwt.encode(payload, sk, algorithm="HS256", headers={"alg": "HS256", "typ": "JWT"})


def _submit_image_to_video(token, image_path, prompt):
    img_bytes = Path(image_path).read_bytes()
    img_b64 = base64.b64encode(img_bytes).decode("utf-8")

    resp = requests.post(
        "https://api.klingai.com/v1/videos/image2video",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={
            "model_name": "kling-v2-master",
            "image": img_b64,
            "prompt": f"fixed lens, tripod, no camera movement, {prompt}",
            "negative_prompt": "camera movement, zoom, pan, tilt, shaky, morphing face, distortion",
            "mode": "std",
            "duration": "5",
            "cfg_scale": 0.7,
        },
        timeout=60,
    )

    if resp.status_code != 200:
        raise RuntimeError(f"Kling API error {resp.status_code}: {resp.text[:200]}")

    data = resp.json()
    if data.get("code") != 0:
        raise RuntimeError(f"Kling error: {data.get('message', data)}")

    return data["data"]["task_id"]


def _poll_for_result(token, task_id, timeout=300):
    deadline = time.time() + timeout
    while time.time() < deadline:
        resp = requests.get(
            f"https://api.klingai.com/v1/videos/image2video/{task_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        data = resp.json()
        status = data.get("data", {}).get("task_status", "unknown")

        if status == "succeed":
            videos = data["data"].get("task_result", {}).get("videos", [])
            if videos:
                return videos[0]["url"]
            raise RuntimeError("Task succeeded but no video URL returned")
        elif status in ("failed", "error"):
            msg = data.get("data", {}).get("task_status_msg", "unknown error")
            raise RuntimeError(f"Kling generation failed: {msg}")

        _loop_progress["status"] = "processing"
        _loop_progress["message"] = f"Generating... ({int(deadline - time.time())}s remaining)"
        time.sleep(10)

    raise TimeoutError("Kling video generation timed out after 5 minutes")


def _download_video(url, output_path):
    resp = requests.get(url, stream=True, timeout=60)
    resp.raise_for_status()
    with open(output_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=8192):
            f.write(chunk)


def _make_pingpong_loop(raw_clip, output_path):
    tmp_dir = tempfile.mkdtemp(prefix="kling_loop_")
    try:
        reversed_path = os.path.join(tmp_dir, "reversed.mp4")
        fwd_trimmed = os.path.join(tmp_dir, "fwd.mp4")
        rev_trimmed = os.path.join(tmp_dir, "rev.mp4")

        probe = subprocess.run(
            ["ffprobe", "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", str(raw_clip)],
            capture_output=True, text=True,
        )
        duration = float(probe.stdout.strip())

        subprocess.run(
            ["ffmpeg", "-y", "-i", str(raw_clip), "-vf", "reverse", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", reversed_path],
            capture_output=True,
        )

        trim_end = duration - 0.04
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(raw_clip), "-t", str(trim_end), "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", fwd_trimmed],
            capture_output=True,
        )
        subprocess.run(
            ["ffmpeg", "-y", "-i", reversed_path, "-ss", "0.04", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", rev_trimmed],
            capture_output=True,
        )

        concat_file = os.path.join(tmp_dir, "concat.txt")
        with open(concat_file, "w") as f:
            f.write(f"file '{fwd_trimmed}'\n")
            f.write(f"file '{rev_trimmed}'\n")

        subprocess.run(
            ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concat_file, "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", str(output_path)],
            capture_output=True,
        )

        if not Path(output_path).exists():
            raise RuntimeError("FFmpeg failed to create ping-pong loop")

        logger.info(f"Ping-pong loop created: {output_path}")
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def generate_video_loop(image_path, prompt, output_path):
    global _loop_progress
    tmp_dir = tempfile.mkdtemp(prefix="kling_")

    try:
        _loop_progress["status"] = "submitted"
        _loop_progress["message"] = "Submitting to Kling API..."
        logger.info(f"kling | submitting {image_path} with prompt: {prompt[:60]}")

        token = _generate_token()
        task_id = _submit_image_to_video(token, image_path, prompt)
        logger.info(f"kling | task submitted: {task_id}")

        _loop_progress["status"] = "processing"
        _loop_progress["message"] = "Generating video..."

        video_url = _poll_for_result(token, task_id)

        _loop_progress["message"] = "Downloading video..."
        raw_clip = os.path.join(tmp_dir, "raw.mp4")
        _download_video(video_url, raw_clip)
        logger.info("kling | downloaded raw clip")

        _loop_progress["message"] = "Creating ping-pong loop..."
        _make_pingpong_loop(raw_clip, output_path)

        _loop_progress["status"] = "done"
        _loop_progress["message"] = "Video loop ready!"
        _loop_progress["loop_url"] = f"/api/library/covers/{Path(output_path).name}?v={int(time.time())}"
        logger.info(f"kling | loop saved: {output_path}")

    except Exception as e:
        _loop_progress["status"] = "failed"
        _loop_progress["message"] = f"Error: {e}"
        logger.error(f"kling FAILED | {e}", exc_info=True)
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        _loop_progress["active"] = False
