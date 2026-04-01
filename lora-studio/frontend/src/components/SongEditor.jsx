import { useState, useEffect } from 'react';
import { startGenerate } from '../api.js';

const KEYS = [
  'C major', 'C minor', 'D major', 'D minor', 'E major', 'E minor',
  'F major', 'F minor', 'G major', 'G minor', 'A major', 'A minor',
  'B major', 'B minor',
];

export default function SongEditor({ song, open, onClose, onToast }) {
  const inp = song?.inputs || {};

  const [title, setTitle] = useState(inp.title || '');
  const [caption, setCaption] = useState(inp.caption || '');
  const [lyrics, setLyrics] = useState(inp.lyrics || '');
  const [bpm, setBpm] = useState(inp.bpm || 120);
  const [key, setKey] = useState(inp.key || '');
  const [duration, setDuration] = useState(inp.duration || 180);
  const [mode, setMode] = useState('fresh');
  const [queuing, setQueuing] = useState(false);
  const lyricsChanged = lyrics !== (inp.lyrics || '');

  // Sync fields when a different song is opened
  useEffect(() => {
    if (!song) return;
    const i = song.inputs || {};
    setTitle(i.title || '');
    setCaption(i.caption || '');
    setLyrics(i.lyrics || '');
    setBpm(i.bpm || 120);
    setKey(i.key || '');
    setDuration(i.duration || 180);
    setMode('fresh');
    setQueuing(false);
  }, [song]);

  // Auto-switch mode when lyrics change:
  // - If in cover mode, switch to remix (cover ignores lyrics)
  // - If lyrics just changed and we're in fresh, suggest remix
  useEffect(() => {
    if (lyricsChanged && mode === 'cover') setMode('remix');
    if (lyricsChanged && mode === 'fresh') setMode('remix');
  }, [lyricsChanged]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open || !song) return null;

  const handleGenerate = async () => {
    if (!caption.trim()) { onToast('Caption is required', 'error'); return; }
    setQueuing(true);
    try {
      const payload = {
        title: title.trim(),
        lora_name: inp.lora_name && inp.lora_name !== '(base model)' ? inp.lora_name : '',
        strength: inp.strength || 1.0,
        caption: caption.trim(),
        lyrics,
        bpm: parseInt(bpm) || null,
        key,
        duration: parseFloat(duration) || 180,
        source_song_id: (mode === 'cover' || mode === 'remix') ? song.id : '',
        generation_mode: mode,
      };
      await startGenerate(payload);
      onToast('Queued for regeneration');
      onClose();
    } catch (e) {
      onToast(e.message, 'error');
    } finally {
      setQueuing(false);
    }
  };

  const inputStyle = {
    width: '100%',
    background: '#1a1a1a',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    padding: '10px 14px',
    color: '#fff',
    fontSize: 14,
    outline: 'none',
    fontFamily: 'inherit',
    transition: 'border-color 0.15s',
    boxSizing: 'border-box',
  };

  const labelStyle = {
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: '#a7a7a7',
    marginBottom: 6,
    display: 'block',
  };

  const handleFocus = (e) => { e.target.style.borderColor = 'rgba(30,215,96,0.5)'; };
  const handleBlur = (e) => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-[300]"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="rounded-xl overflow-y-auto"
        style={{
          background: '#282828',
          border: '1px solid rgba(255,255,255,0.1)',
          width: 520,
          maxWidth: '92vw',
          maxHeight: '85vh',
          padding: 24,
          boxShadow: '0 16px 48px rgba(0,0,0,.7)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-white font-bold text-[18px]">
            Edit & Regenerate
          </h3>
          <button
            onClick={onClose}
            className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full text-[#a7a7a7] hover:text-white hover:bg-[#ffffff1a] transition-colors"
            style={{ background: 'none', border: 'none', cursor: 'pointer' }}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width={16} height={16}>
              <path d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z" />
            </svg>
          </button>
        </div>

        {/* Title */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Title</label>
          <input
            style={inputStyle}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Song title"
            onFocus={handleFocus}
            onBlur={handleBlur}
          />
        </div>

        {/* Caption */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Caption</label>
          <textarea
            style={{ ...inputStyle, resize: 'vertical', minHeight: 60 }}
            rows={3}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Describe the style, mood, instruments..."
            onFocus={handleFocus}
            onBlur={handleBlur}
          />
        </div>

        {/* Lyrics */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Lyrics</label>
          <textarea
            style={{ ...inputStyle, resize: 'vertical', minHeight: 140, fontFamily: 'monospace', fontSize: 13 }}
            rows={8}
            value={lyrics}
            onChange={(e) => setLyrics(e.target.value)}
            placeholder={'[Verse 1]\nYour lyrics here...'}
            onFocus={handleFocus}
            onBlur={handleBlur}
          />
        </div>

        {/* BPM / Key / Duration row */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>BPM</label>
            <input
              style={inputStyle}
              type="number"
              min="30"
              max="300"
              value={bpm}
              onChange={(e) => setBpm(e.target.value)}
              onFocus={handleFocus}
              onBlur={handleBlur}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Key</label>
            <select
              style={{ ...inputStyle, cursor: 'pointer' }}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onFocus={handleFocus}
              onBlur={handleBlur}
            >
              <option value="">Auto</option>
              {KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Duration (s)</label>
            <input
              style={inputStyle}
              type="number"
              min="10"
              max="600"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              onFocus={handleFocus}
              onBlur={handleBlur}
            />
          </div>
        </div>

        {/* Mode toggle */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ ...labelStyle, marginBottom: 10 }}>Regeneration Mode</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {/* Fresh */}
            <button
              onClick={() => setMode('fresh')}
              style={{
                flex: '1 1 140px',
                padding: '12px 14px',
                borderRadius: 10,
                border: mode === 'fresh' ? '2px solid #1ed760' : '1px solid rgba(255,255,255,0.1)',
                background: mode === 'fresh' ? 'rgba(30,215,96,0.08)' : '#1a1a1a',
                color: mode === 'fresh' ? '#1ed760' : '#a7a7a7',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.15s',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                Fresh
              </div>
              <div style={{ fontSize: 11, opacity: 0.7, lineHeight: 1.4 }}>
                New audio from your settings. Use this for major changes.
              </div>
            </button>

            {/* Remix */}
            <button
              onClick={() => setMode('remix')}
              style={{
                flex: '1 1 140px',
                padding: '12px 14px',
                borderRadius: 10,
                border: mode === 'remix' ? '2px solid #1ed760' : '1px solid rgba(255,255,255,0.1)',
                background: mode === 'remix' ? 'rgba(30,215,96,0.08)' : '#1a1a1a',
                color: mode === 'remix' ? '#1ed760' : '#a7a7a7',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.15s',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                Remix
                {lyricsChanged && (
                  <span style={{ fontSize: 10, marginLeft: 6, color: '#1ed760', fontWeight: 400, verticalAlign: 'middle' }}>
                    recommended
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, opacity: 0.7, lineHeight: 1.4 }}>
                Keeps original instrumentals, regenerates vocals with new lyrics.
              </div>
            </button>

            {/* Cover */}
            <button
              onClick={() => setMode('cover')}
              style={{
                flex: '1 1 140px',
                padding: '12px 14px',
                borderRadius: 10,
                border: mode === 'cover' ? '2px solid #1ed760' : '1px solid rgba(255,255,255,0.1)',
                background: mode === 'cover' ? 'rgba(30,215,96,0.08)' : '#1a1a1a',
                color: mode === 'cover' ? '#1ed760' : '#a7a7a7',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.15s',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                Cover
              </div>
              <div style={{ fontSize: 11, opacity: 0.7, lineHeight: 1.4 }}>
                Preserves entire audio including vocals. For style changes only.
              </div>
              {lyricsChanged && mode === 'cover' && (
                <div style={{ fontSize: 11, color: '#e91429', marginTop: 4 }}>
                  Lyrics changed — use Remix mode instead
                </div>
              )}
            </button>
          </div>
        </div>

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={queuing || !caption.trim()}
          style={{
            width: '100%',
            padding: '14px 20px',
            borderRadius: 24,
            border: 'none',
            background: !queuing && caption.trim() ? '#1ed760' : '#2a2a2a',
            color: !queuing && caption.trim() ? '#000' : '#555',
            fontSize: 15,
            fontWeight: 700,
            cursor: !queuing && caption.trim() ? 'pointer' : 'not-allowed',
            transition: 'all 0.15s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            minHeight: 50,
          }}
        >
          {queuing ? (
            <>
              <span
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  border: '2px solid rgba(0,0,0,0.3)',
                  borderTopColor: '#000',
                  animation: 'spin 0.7s linear infinite',
                  display: 'inline-block',
                }}
              />
              Queuing...
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 16, height: 16 }}>
                <path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
              </svg>
              Regenerate
            </>
          )}
        </button>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
