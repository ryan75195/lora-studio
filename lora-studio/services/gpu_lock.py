"""Global GPU lock with priority: generation preempts training."""

import threading
import time

_gpu_lock = threading.Lock()
_gpu_owner = ""  # Description of who holds the lock
_generation_waiting = False  # Flag: a generation job wants the GPU


def acquire_gpu(owner: str, timeout: float = 0) -> bool:
    """Try to acquire the GPU lock. Returns True if acquired."""
    global _gpu_owner
    acquired = _gpu_lock.acquire(timeout=timeout if timeout > 0 else -1 if timeout < 0 else 0)
    if acquired:
        _gpu_owner = owner
    return acquired


def release_gpu():
    """Release the GPU lock."""
    global _gpu_owner
    _gpu_owner = ""
    try:
        _gpu_lock.release()
    except RuntimeError:
        pass


def gpu_owner() -> str:
    """Return description of who currently holds the GPU, or empty string."""
    return _gpu_owner


def generation_is_waiting() -> bool:
    """Check if a generation job is waiting for the GPU."""
    return _generation_waiting


def wait_for_gpu(owner: str, progress_callback=None, timeout: float = 3600) -> bool:
    """Wait for GPU to be free, calling progress_callback with status messages.

    If owner is 'generation', sets a flag so training knows to yield.
    Returns True when acquired, False on timeout.
    """
    global _gpu_owner, _generation_waiting
    deadline = time.monotonic() + timeout

    is_gen = owner == "generation"
    if is_gen:
        _generation_waiting = True

    try:
        # Try immediate acquire
        if _gpu_lock.acquire(blocking=False):
            _gpu_owner = owner
            return True

        # Wait loop
        while time.monotonic() < deadline:
            current_owner = _gpu_owner
            if progress_callback:
                progress_callback(f"Waiting for GPU ({current_owner} in progress)...")
            if _gpu_lock.acquire(timeout=min(1.0, deadline - time.monotonic())):
                _gpu_owner = owner
                if progress_callback:
                    progress_callback(f"GPU acquired by {owner}")
                return True

        return False
    finally:
        if is_gen:
            _generation_waiting = False


def should_training_yield() -> bool:
    """Training should call this periodically. Returns True if it should pause for generation."""
    return _generation_waiting and _gpu_owner == "training"
