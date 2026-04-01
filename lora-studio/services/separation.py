"""Vocal separation and audio mixing service using Demucs.

Provides:
- separate_vocals(): split audio into vocals + instrumentals
- mix_audio(): combine instrumental + vocal tracks
"""

import os
from pathlib import Path
from typing import Optional, Tuple

import torch
import torchaudio

# ---------------------------------------------------------------------------
# Lazy-loaded Demucs model (cached at module level, ~300MB)
# ---------------------------------------------------------------------------

_demucs_model = None
_demucs_lock = __import__("threading").Lock()


def _get_demucs_model():
    """Load the htdemucs model once, cache it, move to GPU if available."""
    global _demucs_model
    if _demucs_model is not None:
        return _demucs_model

    with _demucs_lock:
        # Double-check after acquiring lock
        if _demucs_model is not None:
            return _demucs_model

        from demucs.pretrained import get_model

        print("  Separation: loading htdemucs model...", flush=True)
        model = get_model("htdemucs")
        model.eval()
        # Always run on CPU to avoid GPU memory conflicts with ACE-Step
        model = model.cpu()
        print("  Separation: model loaded on CPU (preserving GPU for ACE-Step)", flush=True)
        _demucs_model = model
        return _demucs_model


def _unload_demucs():
    """Move Demucs model off GPU and free VRAM for ACE-Step."""
    global _demucs_model
    if _demucs_model is not None:
        _demucs_model = _demucs_model.cpu()
        torch.cuda.empty_cache()
        print("  [Demucs] Model moved to CPU, GPU memory freed", flush=True)


# ---------------------------------------------------------------------------
# 6-stem model for guitar separation
# ---------------------------------------------------------------------------

_demucs_6s = None
_demucs_6s_lock = __import__("threading").Lock()


def _get_demucs_6s():
    """Load htdemucs_6s (6-stem) model."""
    global _demucs_6s
    if _demucs_6s is not None:
        return _demucs_6s
    with _demucs_6s_lock:
        if _demucs_6s is not None:
            return _demucs_6s
        from demucs.pretrained import get_model
        print("  Separation: loading htdemucs_6s (6-stem) model...", flush=True)
        model = get_model("htdemucs_6s")
        model.eval().cpu()
        print("  Separation: 6-stem model loaded on CPU", flush=True)
        _demucs_6s = model
        return _demucs_6s


def separate_stems(audio_path: str, output_dir: str, keep: list[str] = None) -> str:
    """Separate audio into 6 stems and mix back only the requested ones.

    Args:
        audio_path: Input audio file.
        output_dir: Directory for output.
        keep: List of stems to keep. Options: drums, bass, other, vocals, guitar, piano.
              Default: ['drums', 'bass', 'other', 'piano'] (strips vocals + guitar).

    Returns:
        Path to the mixed output WAV.
    """
    from demucs.apply import apply_model
    import soundfile as sf
    import numpy as np

    if keep is None:
        keep = ["drums", "bass", "other", "piano"]

    model = _get_demucs_6s()
    device = next(model.parameters()).device

    os.makedirs(output_dir, exist_ok=True)

    print(f"  [Demucs 6s] Loading: {audio_path}", flush=True)
    data, sr = sf.read(audio_path, dtype="float32")
    wav = torch.from_numpy(data).T
    if wav.dim() == 1:
        wav = wav.unsqueeze(0)
    if wav.shape[0] == 1:
        wav = wav.repeat(2, 1)
    elif wav.shape[0] > 2:
        wav = wav[:2]

    if sr != model.samplerate:
        wav = torchaudio.transforms.Resample(sr, model.samplerate)(wav)

    wav = wav.unsqueeze(0).to(device)
    print(f"  [Demucs 6s] Separating into {model.sources}...", flush=True)

    with torch.no_grad():
        sources = apply_model(model, wav)

    # Mix selected stems
    result = torch.zeros_like(sources[0, 0])
    for i, name in enumerate(model.sources):
        if name in keep:
            result += sources[0, i]
            print(f"  [Demucs 6s] Keeping: {name}", flush=True)

    output_path = os.path.join(output_dir, "stems_mix.wav")
    sf.write(output_path, result.cpu().numpy().T, model.samplerate)
    print(f"  [Demucs 6s] Output: {output_path}", flush=True)

    return output_path


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def separate_vocals(audio_path: str, output_dir: str) -> Tuple[str, str]:
    """Separate audio into vocals and instrumentals using Demucs.

    Args:
        audio_path: Path to the input audio file (mp3/wav).
        output_dir: Directory to write output WAV files.

    Returns:
        (vocals_path, instrumentals_path) as WAV files in output_dir.
    """
    from demucs.apply import apply_model

    print(f"  [Demucs] Loading model...", flush=True)
    model = _get_demucs_model()
    device = next(model.parameters()).device
    print(f"  [Demucs] Model on {device}, samplerate={model.samplerate}, sources={model.sources}", flush=True)

    os.makedirs(output_dir, exist_ok=True)

    # Load audio (use soundfile backend — torchcodec not available on Windows)
    print(f"  [Demucs] Loading audio: {audio_path}", flush=True)
    import soundfile as sf
    import numpy as np
    data, sr = sf.read(audio_path, dtype="float32")
    wav = torch.from_numpy(data).T  # (channels, samples)
    if wav.dim() == 1:
        wav = wav.unsqueeze(0)
    print(f"  [Demucs] Loaded: shape={wav.shape}, sr={sr}", flush=True)

    # Resample to model's expected sample rate if needed
    if sr != model.samplerate:
        print(f"  [Demucs] Resampling {sr} -> {model.samplerate}", flush=True)
        wav = torchaudio.transforms.Resample(sr, model.samplerate)(wav)

    # Ensure stereo (model expects 2 channels)
    if wav.shape[0] == 1:
        wav = wav.repeat(2, 1)
    elif wav.shape[0] > 2:
        wav = wav[:2]

    # Add batch dimension: (1, channels, samples)
    wav = wav.unsqueeze(0).to(device)
    print(f"  [Demucs] Running separation on tensor {wav.shape}...", flush=True)

    with torch.no_grad():
        sources = apply_model(model, wav)
    print(f"  [Demucs] Done, sources shape: {sources.shape}", flush=True)

    # No GPU cleanup needed — Demucs runs on CPU

    # sources shape: (batch, num_sources, channels, samples)
    # htdemucs sources are typically: drums, bass, other, vocals
    source_names = model.sources
    vocals_idx = source_names.index("vocals")

    vocals = sources[0, vocals_idx]  # (channels, samples)

    # Sum all non-vocal sources for the instrumental track
    instrumentals = torch.zeros_like(vocals)
    for i, name in enumerate(source_names):
        if name != "vocals":
            instrumentals += sources[0, i]

    vocals_path = os.path.join(output_dir, "vocals.wav")
    instrumentals_path = os.path.join(output_dir, "instrumentals.wav")

    import soundfile as sf_out
    sf_out.write(vocals_path, vocals.cpu().numpy().T, model.samplerate)
    sf_out.write(instrumentals_path, instrumentals.cpu().numpy().T, model.samplerate)

    return vocals_path, instrumentals_path


def mix_audio(
    instrumental_path: str,
    vocal_path: str,
    output_path: str,
    vocal_volume: float = 1.0,
    format: str = "mp3",
) -> str:
    """Mix instrumental and vocal tracks together.

    If the vocal track is shorter than the instrumental, it is zero-padded.
    If longer, it is trimmed to match the instrumental length.

    Args:
        instrumental_path: Path to the instrumental WAV file.
        vocal_path: Path to the vocal WAV file.
        output_path: Path to write the mixed output.
        vocal_volume: Volume multiplier for vocals (1.0 = unchanged).
        format: Output format, "mp3" or "wav".

    Returns:
        output_path
    """
    import soundfile as sf
    import numpy as np
    data, inst_sr = sf.read(instrumental_path, dtype="float32")
    inst_wav = torch.from_numpy(data).T
    if inst_wav.dim() == 1:
        inst_wav = inst_wav.unsqueeze(0)
    data, vocal_sr = sf.read(vocal_path, dtype="float32")
    vocal_wav = torch.from_numpy(data).T
    if vocal_wav.dim() == 1:
        vocal_wav = vocal_wav.unsqueeze(0)

    # Resample vocals to match instrumental sample rate if needed
    if vocal_sr != inst_sr:
        vocal_wav = torchaudio.transforms.Resample(vocal_sr, inst_sr)(vocal_wav)

    # Match channel count
    if vocal_wav.shape[0] != inst_wav.shape[0]:
        if vocal_wav.shape[0] == 1 and inst_wav.shape[0] == 2:
            vocal_wav = vocal_wav.repeat(2, 1)
        elif vocal_wav.shape[0] == 2 and inst_wav.shape[0] == 1:
            inst_wav = inst_wav.repeat(2, 1)

    inst_len = inst_wav.shape[1]
    vocal_len = vocal_wav.shape[1]

    # Pad or trim vocals to match instrumental length
    if vocal_len < inst_len:
        padding = torch.zeros(vocal_wav.shape[0], inst_len - vocal_len)
        vocal_wav = torch.cat([vocal_wav, padding], dim=1)
    elif vocal_len > inst_len:
        vocal_wav = vocal_wav[:, :inst_len]

    # Mix
    mixed = inst_wav + vocal_wav * vocal_volume

    # Clamp to prevent clipping
    peak = mixed.abs().max()
    if peak > 1.0:
        mixed = mixed / peak

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

    import soundfile as sf_mix

    if format == "mp3":
        # Save as wav first, then convert with ffmpeg
        wav_tmp = output_path + ".tmp.wav"
        sf_mix.write(wav_tmp, mixed.numpy().T, inst_sr)
        import subprocess
        subprocess.run(
            ["ffmpeg", "-y", "-i", wav_tmp, "-b:a", "192k", output_path],
            capture_output=True,
        )
        if os.path.exists(wav_tmp):
            os.remove(wav_tmp)
    else:
        sf_mix.write(output_path, mixed.numpy().T, inst_sr)

    return output_path
