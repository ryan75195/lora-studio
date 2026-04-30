"""Lyrics transcription and key detection for training tracks.

Pipeline: Demucs vocal separation → Whisper large on clean vocals → librosa key detection.
Results cached in .labels.json files next to each track.
"""

import json
import logging
import os
import tempfile
import time
from pathlib import Path

logger = logging.getLogger("lora-studio.transcribe")

_whisper_model = None


def _get_whisper():
    """Lazy-load Whisper medium model on GPU (good quality, fits alongside Demucs)."""
    global _whisper_model
    if _whisper_model is None:
        import whisper
        logger.info("Loading Whisper medium model...")
        _whisper_model = whisper.load_model("medium", device="cuda")
        logger.info("Whisper medium loaded")
    return _whisper_model


def _unload_whisper():
    """Free Whisper from GPU memory."""
    global _whisper_model
    if _whisper_model is not None:
        import torch
        del _whisper_model
        _whisper_model = None
        torch.cuda.empty_cache()


def _separate_vocals(mp3_path):
    """Use Demucs on GPU to extract clean vocals. Returns path to vocals WAV (temp file)."""
    tmp_dir = tempfile.mkdtemp(prefix="transcribe_")
    try:
        import torch
        import soundfile as sf
        import numpy as np
        from demucs.pretrained import get_model
        from demucs.apply import apply_model

        model = get_model("htdemucs")
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        model.to(device)

        data, sr = sf.read(str(mp3_path), dtype="float32")
        wav = torch.from_numpy(data).T
        if wav.dim() == 1:
            wav = wav.unsqueeze(0)
        if sr != model.samplerate:
            import torchaudio
            wav = torchaudio.transforms.Resample(sr, model.samplerate)(wav)

        ref = wav.mean(0)
        wav = (wav - ref.mean()) / ref.std()
        sources = apply_model(model, wav[None].to(device), progress=False)[0]
        sources = sources * ref.std() + ref.mean()

        vocals_idx = model.sources.index("vocals")
        vocals = sources[vocals_idx].cpu().numpy().T
        vocals_path = os.path.join(tmp_dir, "vocals.wav")
        sf.write(vocals_path, vocals, model.samplerate)

        model.cpu()
        torch.cuda.empty_cache()

        return vocals_path, tmp_dir
    except Exception as e:
        logger.warning(f"Demucs separation failed, falling back to raw audio: {e}")
        return str(mp3_path), tmp_dir


def _detect_key(audio_path):
    """Detect musical key using librosa. Returns e.g. 'C major' or ''."""
    try:
        import librosa
        import numpy as np
        y, sr = librosa.load(str(audio_path), duration=60, sr=22050)
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
        chroma_avg = np.mean(chroma, axis=1)
        pitch_classes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
        major_profile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
        minor_profile = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
        best_corr = -1
        best_key = ''
        for i in range(12):
            rotated = np.roll(chroma_avg, -i)
            maj_corr = np.corrcoef(rotated, major_profile)[0, 1]
            min_corr = np.corrcoef(rotated, minor_profile)[0, 1]
            if maj_corr > best_corr:
                best_corr = maj_corr
                best_key = f"{pitch_classes[i]} major"
            if min_corr > best_corr:
                best_corr = min_corr
                best_key = f"{pitch_classes[i]} minor"
        return best_key
    except Exception:
        return ''


def _format_lyrics(text):
    """Format raw transcription into verse blocks."""
    sentences = text.split('. ')
    lines = [s.strip() + ('.' if not s.strip().endswith('.') else '') for s in sentences if s.strip()]
    formatted = '[Verse 1]\n'
    verse_num = 1
    line_count = 0
    for line in lines:
        formatted += line + '\n'
        line_count += 1
        if line_count >= 4:
            verse_num += 1
            formatted += f'\n[Verse {verse_num}]\n'
            line_count = 0
    return formatted.strip()


def transcribe_track(mp3_path, label_path=None, force=False):
    """Transcribe a single track: Demucs → Whisper large → key detection.

    Returns True if the label was updated, False if skipped.
    Only transcribes if lyrics are missing/instrumental, unless force=True.
    """
    mp3_path = Path(mp3_path)
    if label_path is None:
        label_path = mp3_path.with_suffix('.labels.json')
    else:
        label_path = Path(label_path)

    if label_path.exists():
        labels = json.loads(label_path.read_text(encoding='utf-8'))
    else:
        labels = {}

    lyrics = (labels.get('lyrics') or '').strip()
    needs_lyrics = not lyrics or lyrics == '[Instrumental]'
    needs_key = not labels.get('key')

    if not force and not needs_lyrics and not needs_key:
        return False

    tmp_dir = None
    try:
        if needs_lyrics:
            # Step 1: Separate vocals with Demucs
            vocals_path, tmp_dir = _separate_vocals(mp3_path)

            # Step 2: Transcribe clean vocals with Whisper large
            model = _get_whisper()
            result = model.transcribe(vocals_path, language='en', task='transcribe')
            text = result['text'].strip()

            if len(text) > 20:
                labels['lyrics'] = _format_lyrics(text)
                labels['language'] = 'en'

        if needs_key:
            key = _detect_key(mp3_path)
            if key:
                labels['key'] = key

        label_path.write_text(json.dumps(labels, indent=2, ensure_ascii=False), encoding='utf-8')
        return True
    finally:
        if tmp_dir:
            import shutil
            shutil.rmtree(tmp_dir, ignore_errors=True)


def transcribe_artist_tracks(tracks_dir, progress_callback=None):
    """Transcribe all tracks in a directory that need it.

    Returns (updated_count, total_count).
    """
    tracks_dir = Path(tracks_dir)
    mp3s = sorted(tracks_dir.glob('*.mp3'))
    total = len(mp3s)
    updated = 0

    for i, mp3 in enumerate(mp3s):
        name = mp3.stem
        if progress_callback:
            progress_callback(f"Transcribing {i+1}/{total}: {name[:50]}")

        try:
            t0 = time.time()
            was_updated = transcribe_track(mp3)
            elapsed = time.time() - t0
            if was_updated:
                updated += 1
                logger.info(f"transcribe | {name[:50]} | {elapsed:.1f}s | updated")
            else:
                logger.debug(f"transcribe | {name[:50]} | skipped")
        except Exception as e:
            logger.error(f"transcribe FAILED | {name}: {e}", exc_info=True)

    logger.info(f"transcribe DONE | {updated}/{total} updated in {tracks_dir}")
    return updated, total
