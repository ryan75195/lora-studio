import { useRef } from 'react';
import { fmtTime } from '../api.js';
import { useNowPlaying, getAudio, nextSong, prevSong, toggleShuffle, isShuffled } from './NowPlaying.jsx';

export default function FullPlayer({ open, onClose }) {
  const { song, playing, currentTime, duration, shuffled } = useNowPlaying();
  const barRef = useRef(null);

  if (!open || !song) return null;

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

  const toggle = () => {
    const a = getAudio();
    if (!a) return;
    if (a.paused) a.play(); else a.pause();
  };

  const seekFromEvent = (e) => {
    if (!barRef.current || !duration) return;
    const rect = barRef.current.getBoundingClientRect();
    const touch = e.touches ? e.touches[0] : e;
    const frac = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
    getAudio().currentTime = frac * duration;
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'linear-gradient(180deg, #2a2a2a 0%, #0a0a0a 50%)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header with close button - safe area for PWA status bar */}
      <div style={{ padding: '12px 20px', paddingTop: 'max(12px, env(safe-area-inset-top, 12px))', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 12, margin: -12, WebkitTapHighlightColor: 'transparent' }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} style={{ width: 22, height: 22 }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        <span style={{ fontSize: 11, color: '#a7a7a7', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>
          Now Playing
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 12, margin: -12, WebkitTapHighlightColor: 'transparent' }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} style={{ width: 20, height: 20 }}>
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Album Art */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 40px' }}>
        <div style={{
          width: '100%', maxWidth: 340, aspectRatio: '1', borderRadius: 12,
          background: song.cover ? `url('${song.cover}') center/cover no-repeat` : 'linear-gradient(135deg, #333, #1a1a1a)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {!song.cover && <span style={{ fontSize: 72, opacity: 0.1, color: '#fff' }}>♫</span>}
        </div>
      </div>

      {/* Song Info */}
      <div style={{ padding: '28px 32px 0' }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#fff', marginBottom: 4, lineHeight: 1.2 }}>{song.title}</div>
        <div style={{ fontSize: 14, color: '#a7a7a7' }}>{song.meta}</div>
      </div>

      {/* Progress Bar */}
      <div style={{ padding: '24px 32px 0' }}>
        <div
          ref={barRef}
          onClick={seekFromEvent}
          onTouchMove={seekFromEvent}
          onTouchStart={seekFromEvent}
          style={{ height: 28, display: 'flex', alignItems: 'center', cursor: 'pointer', touchAction: 'none' }}
        >
          <div style={{ width: '100%', height: 4, background: '#4d4d4d', borderRadius: 2, position: 'relative' }}>
            <div style={{ width: pct + '%', height: '100%', background: '#1ed760', borderRadius: 2 }} />
            <div style={{
              position: 'absolute', top: '50%', left: `calc(${pct}% - 8px)`, transform: 'translateY(-50%)',
              width: 16, height: 16, borderRadius: '50%', background: '#fff',
              boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
            }} />
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
          <span style={{ fontSize: 11, color: '#a7a7a7' }}>{fmtTime(currentTime)}</span>
          <span style={{ fontSize: 11, color: '#a7a7a7' }}>{fmtTime(duration)}</span>
        </div>
      </div>

      {/* Controls */}
      <div style={{ padding: '28px 32px', paddingBottom: 'max(56px, calc(32px + env(safe-area-inset-bottom, 24px)))', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {/* Shuffle */}
        <button onClick={toggleShuffle} style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: 8,
          color: isShuffled() ? '#1ed760' : '#a7a7a7', WebkitTapHighlightColor: 'transparent',
        }}>
          <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 22, height: 22 }}>
            <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z" />
          </svg>
          {isShuffled() && <div style={{ width: 4, height: 4, borderRadius: 2, background: '#1ed760', margin: '4px auto 0' }} />}
        </button>

        {/* Previous */}
        <button onClick={prevSong} style={{
          background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 8,
          WebkitTapHighlightColor: 'transparent',
        }}>
          <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 32, height: 32 }}>
            <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
          </svg>
        </button>

        {/* Play/Pause */}
        <button onClick={toggle} style={{
          width: 68, height: 68, borderRadius: '50%', background: '#fff',
          border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          WebkitTapHighlightColor: 'transparent',
        }}>
          {playing ? (
            <svg viewBox="0 0 24 24" fill="#000" style={{ width: 30, height: 30 }}>
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="#000" style={{ width: 30, height: 30, marginLeft: 3 }}>
              <polygon points="5,3 19,12 5,21" />
            </svg>
          )}
        </button>

        {/* Next */}
        <button onClick={nextSong} style={{
          background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 8,
          WebkitTapHighlightColor: 'transparent',
        }}>
          <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 32, height: 32 }}>
            <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
          </svg>
        </button>

        {/* Repeat placeholder */}
        <div style={{ width: 38 }} />
      </div>
    </div>
  );
}
