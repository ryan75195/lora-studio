import { useEffect, useRef, useState } from 'react';
import { fmtTime } from '../api.js';

// Module-level audio + playlist state
let globalAudio = null;
let globalListeners = new Set();
let playlist = [];
let playlistIndex = -1;
let shuffled = false;

function getAudio() {
  if (!globalAudio) {
    globalAudio = new Audio();
    window.__globalAudio = globalAudio;
    // Auto-play next on song end
    globalAudio.addEventListener('ended', () => { nextSong(); });
  }
  return globalAudio;
}

export { getAudio };

export function playSong(song) {
  const audio = getAudio();
  audio.src = song.src;
  audio.play();
  // Add to playlist if not already current
  const idx = playlist.findIndex(s => s.src === song.src);
  if (idx >= 0) {
    playlistIndex = idx;
  } else {
    playlist.push(song);
    playlistIndex = playlist.length - 1;
  }
  globalListeners.forEach((fn) => fn({ type: 'load', song }));
}

export function setPlaylist(songs, startIndex = 0) {
  playlist = [...songs];
  playlistIndex = startIndex;
  if (playlist.length > 0) playSong(playlist[playlistIndex]);
}

export function nextSong() {
  if (playlist.length === 0) return;
  if (shuffled) {
    playlistIndex = Math.floor(Math.random() * playlist.length);
  } else {
    playlistIndex = (playlistIndex + 1) % playlist.length;
  }
  playSong(playlist[playlistIndex]);
}

export function prevSong() {
  const audio = getAudio();
  // If past 3 seconds, restart current song
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  if (playlist.length === 0) return;
  playlistIndex = (playlistIndex - 1 + playlist.length) % playlist.length;
  playSong(playlist[playlistIndex]);
}

export function toggleShuffle() {
  shuffled = !shuffled;
  globalListeners.forEach((fn) => fn({ type: 'shuffle', shuffled }));
}

export function isShuffled() { return shuffled; }

export function useNowPlaying() {
  const [state, setState] = useState({
    song: null,
    playing: false,
    currentTime: 0,
    duration: 0,
    shuffled: false,
  });

  useEffect(() => {
    const audio = getAudio();

    function onTimeUpdate() {
      setState((s) => ({ ...s, currentTime: audio.currentTime, duration: audio.duration || 0 }));
    }
    function onPlay() {
      setState((s) => ({ ...s, playing: true }));
    }
    function onPause() {
      setState((s) => ({ ...s, playing: false }));
    }
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);

    const listener = (evt) => {
      if (evt.type === 'load') {
        setState((s) => ({ ...s, song: evt.song, playing: true, currentTime: 0, duration: 0 }));
      } else if (evt.type === 'shuffle') {
        setState((s) => ({ ...s, shuffled: evt.shuffled }));
      }
    };
    globalListeners.add(listener);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      globalListeners.delete(listener);
    };
  }, []);

  const toggle = () => {
    const audio = getAudio();
    if (audio.paused) audio.play();
    else audio.pause();
  };

  const seek = (pct) => {
    const audio = getAudio();
    if (audio.duration) audio.currentTime = pct * audio.duration;
  };

  const setVolume = (v) => {
    getAudio().volume = v;
  };

  return { ...state, toggle, seek, setVolume };
}

// SVG icons
function IconPlay() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 translate-x-px">
      <polygon points="5,3 19,12 5,21" />
    </svg>
  );
}

function IconPause() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </svg>
  );
}

function IconPrev() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
      <polygon points="19,20 9,12 19,4" />
      <rect x="5" y="4" width="2" height="16" />
    </svg>
  );
}

function IconNext() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
      <polygon points="5,4 15,12 5,20" />
      <rect x="17" y="4" width="2" height="16" />
    </svg>
  );
}

function IconVolume({ muted }) {
  return muted ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  );
}

export default function NowPlaying({ onExpand }) {
  const { song, playing, currentTime, duration, toggle, seek } = useNowPlaying();
  const [volume, setVolumeState] = useState(1);
  const [dragging, setDragging] = useState(false);
  const barRef = useRef(null);

  const pct = duration ? (currentTime / duration) * 100 : 0;

  const getSeekPct = (e, rect) => {
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  };

  const handleBarMouseDown = (e) => {
    if (!barRef.current || !duration) return;
    e.preventDefault();
    setDragging(true);
    const rect = barRef.current.getBoundingClientRect();
    seek(getSeekPct(e, rect));
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e) => {
      if (!barRef.current) return;
      const rect = barRef.current.getBoundingClientRect();
      seek(getSeekPct(e, rect));
    };
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);

  const handleVolume = (e) => {
    const v = parseFloat(e.target.value);
    setVolumeState(v);
    getAudio().volume = v;
  };

  if (!song) return null;

  return (
    <div
      id="now-playing"
      className="fixed left-0 right-0 z-50 flex items-center px-4 gap-2"
      style={{
        height: 72,
        background: '#181818',
        borderTop: '1px solid #282828',
        bottom: 0,
      }}
    >
      {/* Left: art + info (tap to expand) */}
      <div className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer" onClick={() => onExpand && onExpand()}>
        {/* Mini album art placeholder */}
        <div
          className="flex-shrink-0 rounded-sm overflow-hidden"
          style={{
            width: 44,
            height: 44,
            background: 'linear-gradient(135deg, #333, #1a1a1a)',
          }}
        >
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-xs opacity-30 text-white select-none">♫</span>
          </div>
        </div>
        <div className="min-w-0 hidden sm:block">
          <div
            className="text-white font-medium truncate"
            style={{ fontSize: 13, maxWidth: 180 }}
          >
            {song.title}
          </div>
          <div
            className="truncate"
            style={{ fontSize: 11, color: '#b3b3b3', maxWidth: 180 }}
          >
            {song.meta}
          </div>
        </div>
        {/* Mobile-only title */}
        <div className="min-w-0 block sm:hidden flex-1">
          <div className="text-white font-medium truncate text-xs">{song.title}</div>
          <div className="truncate" style={{ fontSize: 10, color: '#b3b3b3' }}>{song.meta}</div>
        </div>
      </div>

      {/* Center: controls + progress */}
      <div className="flex flex-col items-center gap-1 flex-shrink-0" style={{ minWidth: 0, flex: '0 0 auto', width: '40%', maxWidth: 480 }}>
        {/* Playback buttons */}
        <div className="flex items-center gap-4">
          {/* Prev - hidden on mobile */}
          <button
            className="hidden sm:flex items-center justify-center text-[#b3b3b3] hover:text-white transition-colors"
            onClick={prevSong}
            aria-label="Previous"
          >
            <IconPrev />
          </button>

          {/* Play/Pause */}
          <button
            onClick={toggle}
            aria-label={playing ? 'Pause' : 'Play'}
            className="flex items-center justify-center text-black rounded-full transition-transform hover:scale-105 active:scale-95"
            style={{
              width: 32,
              height: 32,
              background: '#fff',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            {playing ? <IconPause /> : <IconPlay />}
          </button>

          {/* Next - hidden on mobile */}
          <button
            className="hidden sm:flex items-center justify-center text-[#b3b3b3] hover:text-white transition-colors"
            onClick={nextSong}
            aria-label="Next"
          >
            <IconNext />
          </button>
        </div>

        {/* Progress bar - hidden on mobile */}
        <div className="hidden sm:flex items-center gap-2 w-full">
          <span style={{ fontSize: 10, color: '#b3b3b3', minWidth: 30, textAlign: 'right' }}>
            {fmtTime(currentTime)}
          </span>
          <div
            ref={barRef}
            onMouseDown={handleBarMouseDown}
            role="slider"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct)}
            className="group flex-1 flex items-center cursor-pointer"
            style={{ height: 16 }}
          >
            <div
              className="w-full relative rounded-full"
              style={{ height: 4, background: '#4d4d4d' }}
            >
              <div
                className="absolute left-0 top-0 h-full rounded-full group-hover:bg-[#1DB954] transition-colors"
                style={{ width: pct + '%', background: '#fff' }}
              />
              {/* Scrubber knob */}
              <div
                className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ left: `calc(${pct}% - 6px)` }}
              />
            </div>
          </div>
          <span style={{ fontSize: 10, color: '#b3b3b3', minWidth: 30 }}>
            {fmtTime(duration)}
          </span>
        </div>
      </div>

      {/* Right: volume - hidden on mobile */}
      <div className="hidden sm:flex items-center justify-end gap-2 flex-1">
        <button
          className="text-[#b3b3b3] hover:text-white transition-colors"
          onClick={() => {
            const newVol = volume > 0 ? 0 : 1;
            setVolumeState(newVol);
            getAudio().volume = newVol;
          }}
          aria-label="Toggle mute"
        >
          <IconVolume muted={volume === 0} />
        </button>
        <div className="group flex items-center" style={{ width: 80 }}>
          <input
            type="range"
            min="0"
            max="1"
            step="0.02"
            value={volume}
            onChange={handleVolume}
            style={{ width: 80, accentColor: '#1DB954' }}
            aria-label="Volume"
            className="cursor-pointer"
          />
        </div>
      </div>
    </div>
  );
}
