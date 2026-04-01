"""Retrain all existing LoRAs with improved config, one after another."""

import time
import requests

BASE = "http://127.0.0.1:8888"

LORAS_TO_TRAIN = [
    {"artists": ["sabrina-carpenter", "eric-clapton"], "name": "sabrina-clapton-mix"},
    {"artists": ["sabrina-carpenter", "eric-clapton", "pink-floyd"], "name": "sabrina-clapton-floyd-mix"},
    {"artists": ["oasis", "catfish-and-the-bottlemen"], "name": "oasis-catfish-and-the-bottlemen"},
]


def wait_for_training():
    """Poll until training finishes."""
    while True:
        try:
            r = requests.get(f"{BASE}/api/train/progress")
            data = r.json()
            if not data.get("active"):
                if data.get("error"):
                    print(f"  ERROR: {data['error']}")
                    return False
                return True
            msg = data.get("message", "")
            phase = data.get("phase", "")
            progress = data.get("phase_progress", 0)
            total = data.get("phase_total", 0)
            eta = data.get("eta_seconds")
            eta_str = f" ETA: {eta // 60}m {eta % 60}s" if eta and eta > 0 else ""
            print(f"  [{phase}] {msg} ({progress}/{total}){eta_str}", end="\r", flush=True)
        except Exception as e:
            print(f"  Poll error: {e}")
        time.sleep(5)


def start_training(artists, name):
    """Start a training job."""
    r = requests.post(f"{BASE}/api/train", json={"artists": artists, "name": name})
    if r.status_code == 409:
        print(f"  Training already in progress, waiting...")
        wait_for_training()
        r = requests.post(f"{BASE}/api/train", json={"artists": artists, "name": name})
    r.raise_for_status()
    return r.json()


if __name__ == "__main__":
    print(f"Retraining {len(LORAS_TO_TRAIN)} LoRAs with improved config (r=16, 7 modules, 15 epochs)")
    print(f"This will run overnight. Each LoRA takes ~30-60 minutes.\n")

    for i, lora in enumerate(LORAS_TO_TRAIN, 1):
        name = lora["name"]
        artists = lora["artists"]
        print(f"[{i}/{len(LORAS_TO_TRAIN)}] Training: {name}")
        print(f"  Artists: {', '.join(artists)}")

        try:
            result = start_training(artists, name)
            print(f"  Started: {result}")
            time.sleep(2)  # Let it initialize
            success = wait_for_training()
            print()  # newline after \r
            if success:
                print(f"  Done! {name} retrained successfully.\n")
            else:
                print(f"  Failed! Continuing to next...\n")
        except Exception as e:
            print(f"  Error starting: {e}\n")
            continue

    print("All LoRA retraining complete!")
