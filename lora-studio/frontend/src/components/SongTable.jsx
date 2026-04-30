import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fmtDuration } from '../api.js';
import { playSong, setPlaylist } from './NowPlaying.jsx';

function getSongDisplay(song) {
  const inp = song.inputs || {};
  const title = inp.title || song.filename || song.id || '';
  const key = inp.key || '';
  const bpm = inp.bpm ? inp.bpm + ' BPM' : '';
  const sub = [key, bpm].filter(Boolean).join(' \u00b7 ');
  // Show LoRA name and caption snippet in the Details column
  const loraName = inp.lora_name || '';
  const captionSnippet = inp.caption ? inp.caption.slice(0, 50) : '';
  const detail = loraName || captionSnippet;
  const dur = inp.duration ? fmtDuration(inp.duration) : '';
  return { title, sub, detail, dur };
}

/* ------------------------------------------------------------------ */
/*  Icons                                                              */
/* ------------------------------------------------------------------ */
function IconPlay({ size = 14 }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width={size} height={size}>
      <polygon points="5,3 19,12 5,21" />
    </svg>
  );
}

function IconDots() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width={16} height={16}>
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

function IconClock() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" width={16} height={16}>
      <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8z" />
      <path d="M8 3.25a.75.75 0 0 1 .75.75v3.25H11a.75.75 0 0 1 0 1.5H7.25V4A.75.75 0 0 1 8 3.25z" />
    </svg>
  );
}

function IconGrip() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" width={14} height={14}>
      <circle cx="5.5" cy="3" r="1.5" />
      <circle cx="10.5" cy="3" r="1.5" />
      <circle cx="5.5" cy="8" r="1.5" />
      <circle cx="10.5" cy="8" r="1.5" />
      <circle cx="5.5" cy="13" r="1.5" />
      <circle cx="10.5" cy="13" r="1.5" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Context menu                                                       */
/* ------------------------------------------------------------------ */
function SongMenu({ song, albums, onPlay, onViewDetails, onReuseSettings, onMakeMore, onEditRegenerate, onAddToAlbum, onRemoveFromAlbum, onRemoveFromFavourites, onAddToFavourites, onClose, isMobile }) {
  const ref = useRef(null);
  const menuNavigate = useNavigate();
  const [view, setView] = useState('main'); // 'main' | 'strip' | 'album' | 'confirmDelete'

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const timer = setTimeout(() => document.addEventListener('click', handler), 0);
    return () => { clearTimeout(timer); document.removeEventListener('click', handler); };
  }, [onClose]);

  const doStrip = async (keep) => {
    try {
      const res = await fetch(`/api/songs/${encodeURIComponent(song.id)}/strip-stems`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keep }),
      });
      if (res.ok) {
        const data = await res.json();
        onClose();
        if (data.draft_id) menuNavigate(`/generate/review/${data.draft_id}`);
        return;
      }
    } catch {}
    onClose();
  };

  const doDelete = async () => {
    try {
      const res = await fetch(`/api/songs/${encodeURIComponent(song.id)}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert('Delete failed: ' + (err.detail || res.statusText));
        return;
      }
      onClose();
      window.location.reload();
    } catch (e) {
      alert('Delete failed: ' + e.message);
    }
  };

  const songTitle = (song.inputs || {}).title || song.filename || song.id;
  const inp = song.inputs || {};
  const sub = [inp.key, inp.bpm ? inp.bpm + ' BPM' : ''].filter(Boolean).join(' · ');

  // Shared item style
  const Item = ({ icon, label, color = '#fff', sub: itemSub, arrow, onClick, danger }) => (
    <div
      onClick={onClick}
      className="active:bg-[#ffffff0a]"
      style={{
        display: 'flex', alignItems: 'center', gap: isMobile ? 14 : 10,
        padding: isMobile ? '14px 20px' : '10px 14px',
        cursor: 'pointer',
      }}
    >
      {icon && <span style={{ fontSize: isMobile ? 18 : 15, width: 22, textAlign: 'center', flexShrink: 0, opacity: 0.8 }}>{icon}</span>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: isMobile ? 15 : 13, fontWeight: 500, color: danger ? '#e91429' : color, lineHeight: 1.3 }}>{label}</div>
        {itemSub && <div style={{ fontSize: isMobile ? 12 : 11, color: '#666', lineHeight: 1.3, marginTop: 1 }}>{itemSub}</div>}
      </div>
      {arrow && <svg viewBox="0 0 24 24" fill="#555" width={14} height={14}><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg>}
    </div>
  );

  const Divider = () => <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />;

  const BackHeader = ({ title, onBack }) => (
    <div
      onClick={onBack}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: isMobile ? '12px 16px' : '8px 12px',
        cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <svg viewBox="0 0 24 24" fill="#a7a7a7" width={16} height={16}><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
      <span style={{ fontSize: isMobile ? 14 : 12, fontWeight: 600, color: '#a7a7a7' }}>{title}</span>
    </div>
  );

  return (
    <>
      {isMobile && <div className="fixed inset-0 bg-black/70 z-[199]" onClick={onClose} />}
      <div
        ref={ref}
        data-menu="true"
        onClick={(e) => e.stopPropagation()}
        className={isMobile
          ? 'fixed bottom-[72px] left-2 right-2 z-[200] rounded-2xl shadow-2xl'
          : 'absolute right-0 top-full z-[200] min-w-[220px] rounded-xl shadow-2xl'
        }
        style={{
          background: '#1e1e1e',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 20px 60px rgba(0,0,0,.8)',
          overflow: 'hidden',
          maxHeight: isMobile ? '70vh' : 'none',
          overflowY: 'auto',
        }}
      >
        {/* --- MAIN VIEW --- */}
        {view === 'main' && (<>
          {/* Song header */}
          <div style={{ padding: isMobile ? '16px 20px 12px' : '12px 14px 8px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: isMobile ? 16 : 14, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {songTitle}
            </div>
            {sub && <div style={{ fontSize: isMobile ? 12 : 11, color: '#666', marginTop: 2 }}>{sub}</div>}
          </div>

          <Item icon="&#9654;" label="Play" onClick={() => { onPlay(song); onClose(); }} />
          <Item icon="&#9776;" label="View Details" onClick={() => { onViewDetails(song); onClose(); }} />
          {onEditRegenerate && <Item icon="&#9998;" label="Edit & Regenerate" onClick={() => { onEditRegenerate(song); onClose(); }} />}
          {song.inputs && onReuseSettings && <Item icon="&#8634;" label="Reuse Settings" color="#a7a7a7" onClick={() => { onReuseSettings(song); onClose(); }} />}
          {song.inputs && onMakeMore && <Item icon="&#10024;" label="Make More Like This" sub="New song, same vibe" color="#1ed760" onClick={() => { onMakeMore(song); onClose(); }} />}

          <Divider />

          <Item icon="&#9835;" label="Strip Stems" sub="Remove vocals, guitar, etc." arrow onClick={() => setView('strip')} />
          <Item icon="&#9999;" label="Edit Song" sub="Repaint sections, strip stems, review" onClick={async () => {
            try {
              const res = await fetch(`/api/songs/${encodeURIComponent(song.id)}/to-draft`, { method: 'POST' });
              if (!res.ok) throw new Error((await res.json()).detail || 'Failed');
              const { draft_id } = await res.json();
              onClose();
              menuNavigate(`/generate/review/${draft_id}`);
            } catch (e) {
              alert('Failed: ' + e.message);
            }
          }} />
          {albums && albums.length > 0 && <Item icon="&#43;" label="Add to Album" arrow color="#1ed760" onClick={() => setView('album')} />}

          {onRemoveFromAlbum && (<>
            <Divider />
            <Item icon="&#10005;" label="Remove from Album" danger onClick={() => { onRemoveFromAlbum(song.id); onClose(); }} />
          </>)}

          {onRemoveFromFavourites && (<>
            <Divider />
            <Item icon="&#9829;" label="Remove from Favourites" danger onClick={() => { onRemoveFromFavourites(song.id); onClose(); }} />
          </>)}

          {onAddToFavourites && (<>
            <Divider />
            <Item icon="&#9825;" label="Add to Favourites" color="#1ed760" onClick={() => { onAddToFavourites(song.id); onClose(); }} />
          </>)}

          <Divider />
          <Item icon="&#128465;" label="Delete Song" danger onClick={() => setView('confirmDelete')} />

          {isMobile && (<>
            <Divider />
            <div onClick={onClose} style={{ padding: '14px 20px', textAlign: 'center', fontSize: 15, color: '#666', cursor: 'pointer' }}>Cancel</div>
          </>)}
        </>)}

        {/* --- STRIP STEMS VIEW --- */}
        {view === 'strip' && (<>
          <BackHeader title="Strip Stems" onBack={() => setView('main')} />
          <div style={{ padding: isMobile ? '8px 8px' : '6px 6px' }}>
            {[
              { icon: '&#127908;', label: 'Remove Vocals Only', sub: 'Keep all instruments', keep: ['drums','bass','other','piano','guitar'] },
              { icon: '&#127928;', label: 'Remove Guitar + Vocals', sub: 'Piano, bass & drums only', keep: ['drums','bass','other','piano'] },
              { icon: '&#129345;', label: 'Drums + Bass Only', sub: 'Minimal rhythm bed', keep: ['drums','bass'] },
              { icon: '&#127897;', label: 'Vocals Only', sub: 'Strip all instruments', keep: ['vocals'] },
            ].map((p) => (
              <div
                key={p.label}
                onClick={() => doStrip(p.keep)}
                className="active:bg-[#ffffff0a]"
                style={{
                  display: 'flex', alignItems: 'center', gap: isMobile ? 14 : 10,
                  padding: isMobile ? '14px 16px' : '10px 12px',
                  cursor: 'pointer', borderRadius: 10,
                }}
              >
                <span style={{ fontSize: isMobile ? 20 : 16, width: 28, textAlign: 'center' }} dangerouslySetInnerHTML={{ __html: p.icon }} />
                <div>
                  <div style={{ fontSize: isMobile ? 15 : 13, fontWeight: 500, color: '#fff' }}>{p.label}</div>
                  <div style={{ fontSize: isMobile ? 12 : 11, color: '#666', marginTop: 1 }}>{p.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </>)}

        {/* --- ADD TO ALBUM VIEW --- */}
        {view === 'album' && (<>
          <BackHeader title="Add to Album" onBack={() => setView('main')} />
          {(albums || []).map((a) => (
            <Item key={a.id} icon="&#128191;" label={a.name} color="#1ed760"
              onClick={() => { onAddToAlbum && onAddToAlbum(a.id, song.id); onClose(); }} />
          ))}
        </>)}

        {/* --- CONFIRM DELETE VIEW --- */}
        {view === 'confirmDelete' && (<>
          <div style={{ padding: isMobile ? '24px 20px' : '16px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: isMobile ? 16 : 14, fontWeight: 600, color: '#fff', marginBottom: 6 }}>
              Delete "{songTitle}"?
            </div>
            <div style={{ fontSize: isMobile ? 13 : 12, color: '#888', marginBottom: 20 }}>
              This will permanently remove the song and its files.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setView('main')}
                style={{
                  flex: 1, padding: isMobile ? '14px' : '10px', borderRadius: 12,
                  background: '#2a2a2a', border: 'none', color: '#fff',
                  fontSize: isMobile ? 15 : 13, fontWeight: 600, cursor: 'pointer',
                }}
              >Cancel</button>
              <button
                onClick={doDelete}
                style={{
                  flex: 1, padding: isMobile ? '14px' : '10px', borderRadius: 12,
                  background: '#e91429', border: 'none', color: '#fff',
                  fontSize: isMobile ? 15 : 13, fontWeight: 600, cursor: 'pointer',
                }}
              >Delete</button>
            </div>
          </div>
        </>)}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Song detail modal                                                  */
/* ------------------------------------------------------------------ */
function SongDetailModal({ song, onClose }) {
  const inp = song.inputs || {};

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-[300]"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="rounded-lg overflow-y-auto"
        style={{
          background: '#282828',
          border: '1px solid rgba(255,255,255,0.1)',
          width: 480,
          maxWidth: '90vw',
          maxHeight: '80vh',
          padding: 24,
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-white font-bold text-[16px] truncate pr-4">
            {inp.title || song.filename || song.id}
          </h3>
          <button
            onClick={onClose}
            className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full text-[#a7a7a7] hover:text-white hover:bg-[#ffffff1a] transition-colors text-sm"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width={16} height={16}>
              <path d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z" />
            </svg>
          </button>
        </div>

        {/* Fields */}
        {inp.ai_prompt && (
          <div className="mb-5">
            <div className="text-[11px] uppercase tracking-[0.1em] text-[#a7a7a7] mb-1.5 font-medium">AI Prompt</div>
            <div className="text-[14px] text-[#1ed760] leading-relaxed">{inp.ai_prompt}</div>
          </div>
        )}
        {inp.caption && (
          <div className="mb-5">
            <div className="text-[11px] uppercase tracking-[0.1em] text-[#a7a7a7] mb-1.5 font-medium">Caption</div>
            <div className="text-[14px] text-[#a7a7a7] leading-relaxed">{inp.caption}</div>
          </div>
        )}
        {inp.lyrics && (
          <div className="mb-5">
            <div className="text-[11px] uppercase tracking-[0.1em] text-[#a7a7a7] mb-1.5 font-medium">Lyrics</div>
            <pre
              className="text-[12px] text-[#a7a7a7] whitespace-pre-wrap rounded-md p-4 overflow-y-auto leading-relaxed"
              style={{ background: '#121212', maxHeight: 200 }}
            >
              {inp.lyrics}
            </pre>
          </div>
        )}

        <div className="flex flex-wrap gap-3 mb-6">
          {inp.lora_name && <Tag label="LoRA" value={inp.lora_name} />}
          {inp.strength && <Tag label="Strength" value={inp.strength} />}
          {inp.bpm && <Tag label="BPM" value={inp.bpm} />}
          {inp.key && <Tag label="Key" value={inp.key} />}
          {inp.duration && <Tag label="Duration" value={inp.duration + 's'} />}
        </div>

        <audio
          controls
          preload="none"
          src={`/api/songs/${encodeURIComponent(song.id)}/audio`}
          className="w-full"
          style={{ height: 36, borderRadius: 8 }}
        />
      </div>
    </div>
  );
}

function Tag({ label, value }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] px-3 py-1 rounded-full" style={{ background: '#ffffff0d', color: '#a7a7a7' }}>
      <span className="text-[#6a6a6a]">{label}</span>
      <span className="text-white">{value}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Main SongTable                                                     */
/* ------------------------------------------------------------------ */
export default function SongTable({ songs, albums, onReuseSettings, onMakeMore, onEditRegenerate, onAddToAlbum, onRemoveFromAlbum, onRemoveFromFavourites, onAddToFavourites, activeSongId, coverUrl, onReorder, favouriteIds = [], selectionMode = false, batchActions = [], showPlayControls = true }) {
  const [openMenuId, setOpenMenuId] = useState(null);
  const [detailSong, setDetailSong] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 640);
  const [selectedIds, setSelectedIds] = useState(new Set());

  // Clear selection when exiting selection mode
  useEffect(() => {
    if (!selectionMode) setSelectedIds(new Set());
  }, [selectionMode]);

  const toggleSelection = useCallback((songId) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(songId)) next.delete(songId);
      else next.add(songId);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(songs.map(s => s.id)));
  }, [songs]);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  // Drag-to-reorder state
  const [dragIndex, setDragIndex] = useState(null);
  const [dropTarget, setDropTarget] = useState(null); // index where the drop indicator shows (insert BEFORE this index)
  const tableRef = useRef(null);
  const rowRefs = useRef([]);
  const touchState = useRef(null); // { startIndex, currentY, scrollStartY }

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  const songToPlayable = (s) => {
    const inp = s.inputs || {};
    return {
      src: `/api/songs/${encodeURIComponent(s.id)}/audio`,
      title: inp.title || s.filename || s.id,
      meta: [inp.key, inp.bpm ? inp.bpm + ' BPM' : ''].filter(Boolean).join(' \u00b7 '),
      cover: coverUrl || null,
    };
  };

  const handlePlay = (song) => {
    const allPlayable = songs.map(songToPlayable);
    const idx = songs.findIndex(s => s.id === song.id);
    setPlaylist(allPlayable, idx >= 0 ? idx : 0);
  };

  const handlePlayAll = () => {
    if (!songs || songs.length === 0) return;
    setPlaylist(songs.map(songToPlayable), 0);
  };

  const handleShuffle = () => {
    if (!songs || songs.length === 0) return;
    const shuffled = [...songs];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    setPlaylist(shuffled.map(songToPlayable), 0);
  };

  /* ---- Drag helpers ---- */
  const reorder = useCallback((fromIndex, toIndex) => {
    if (fromIndex === toIndex || fromIndex === toIndex - 1) return; // no-op: dropped in same spot
    const arr = [...songs];
    const [moved] = arr.splice(fromIndex, 1);
    // If toIndex is after the removed item, adjust
    const insertAt = toIndex > fromIndex ? toIndex - 1 : toIndex;
    arr.splice(insertAt, 0, moved);
    onReorder(arr);
  }, [songs, onReorder]);

  const getDropIndex = useCallback((clientY) => {
    for (let i = 0; i < rowRefs.current.length; i++) {
      const el = rowRefs.current[i];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (clientY < midY) return i;
    }
    return songs.length; // after last row
  }, [songs.length]);

  /* ---- HTML5 DnD handlers (desktop) ---- */
  const handleDragStart = useCallback((e, index) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    // Use a transparent image so the default ghost doesn't obscure the drop line
    const ghost = document.createElement('div');
    ghost.style.width = '1px';
    ghost.style.height = '1px';
    ghost.style.opacity = '0.01';
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 0, 0);
    requestAnimationFrame(() => document.body.removeChild(ghost));
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget(getDropIndex(e.clientY));
  }, [getDropIndex]);

  const handleDragEnd = useCallback(() => {
    if (dragIndex !== null && dropTarget !== null) {
      reorder(dragIndex, dropTarget);
    }
    setDragIndex(null);
    setDropTarget(null);
  }, [dragIndex, dropTarget, reorder]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    // handleDragEnd covers the actual reorder
  }, []);

  /* ---- Touch handlers (mobile) ---- */
  const handleTouchStart = useCallback((e, index) => {
    const touch = e.touches[0];
    touchState.current = {
      startIndex: index,
      startY: touch.clientY,
      active: false,
      timer: setTimeout(() => {
        // Long press to activate drag on mobile
        if (touchState.current) {
          touchState.current.active = true;
          setDragIndex(index);
          setDropTarget(index);
        }
      }, 200),
    };
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (!touchState.current) return;
    const touch = e.touches[0];
    const dy = Math.abs(touch.clientY - touchState.current.startY);

    // If moved > 10px before the long-press timer fires, start immediately
    if (!touchState.current.active && dy > 10) {
      clearTimeout(touchState.current.timer);
      touchState.current.active = true;
      setDragIndex(touchState.current.startIndex);
    }

    if (!touchState.current.active) return;
    e.preventDefault();
    setDropTarget(getDropIndex(touch.clientY));
  }, [getDropIndex]);

  const handleTouchEnd = useCallback(() => {
    if (!touchState.current) return;
    clearTimeout(touchState.current.timer);
    if (touchState.current.active && dragIndex !== null && dropTarget !== null) {
      reorder(dragIndex, dropTarget);
    }
    touchState.current = null;
    setDragIndex(null);
    setDropTarget(null);
  }, [dragIndex, dropTarget, reorder]);

  if (!songs || songs.length === 0) {
    return (
      <div className="text-[14px] py-10 text-center text-[#a7a7a7]">
        No songs yet. Generate some first!
      </div>
    );
  }

  const canDrag = !!onReorder;

  // Grid column definitions — wider details column on desktop
  const desktopCols = canDrag
    ? '28px 48px 1fr minmax(160px, 1.2fr) 80px 48px'
    : '48px 1fr minmax(160px, 1.2fr) 80px 48px';
  const mobileCols = canDrag
    ? '28px 36px 1fr 36px'
    : '36px 1fr 36px';

  return (
    <>
      {/* Play / Shuffle controls */}
      {showPlayControls && songs.length > 0 && !selectionMode && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <button
            onClick={handlePlayAll}
            style={{
              width: 44, height: 44, borderRadius: '50%', border: 'none',
              background: '#1ed760', cursor: 'pointer', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(30,215,96,0.3)',
            }}
            title="Play all"
          >
            <svg viewBox="0 0 24 24" fill="#000" width={18} height={18} style={{ marginLeft: 2 }}>
              <polygon points="5,3 19,12 5,21" />
            </svg>
          </button>
          <button
            onClick={handleShuffle}
            style={{
              width: 36, height: 36, borderRadius: '50%', border: 'none',
              background: 'transparent', cursor: 'pointer', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#a7a7a7',
            }}
            title="Shuffle play"
            onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#a7a7a7'; }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width={20} height={20} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 3 21 3 21 8" />
              <line x1="4" y1="20" x2="21" y2="3" />
              <polyline points="21 16 21 21 16 21" />
              <line x1="15" y1="15" x2="21" y2="21" />
              <line x1="4" y1="4" x2="9" y2="9" />
            </svg>
          </button>
          <span style={{ fontSize: 13, color: '#666', marginLeft: 4 }}>
            {songs.length} song{songs.length !== 1 ? 's' : ''}
          </span>
        </div>
      )}
      <div
        className="w-full select-none"
        ref={tableRef}
        onDragOver={canDrag ? handleDragOver : undefined}
        onDrop={canDrag ? handleDrop : undefined}
      >
        {/* ---- Table header (desktop only) ---- */}
        {!isMobile && (
          <div
            className="grid items-center mb-px"
            style={{
              gridTemplateColumns: desktopCols,
              padding: '0 16px',
              height: 36,
              borderBottom: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            {canDrag && <div />}
            <div className="text-[11px] text-[#6a6a6a] uppercase tracking-[0.1em] text-center">
              {selectionMode ? (
                <div
                  onClick={selectedIds.size === songs.length ? deselectAll : selectAll}
                  style={{
                    width: 18, height: 18, borderRadius: '50%', margin: '0 auto',
                    border: selectedIds.size === songs.length ? '2px solid #1ed760' : '2px solid #666',
                    background: selectedIds.size === songs.length ? '#1ed760' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                >
                  {selectedIds.size === songs.length && (
                    <svg viewBox="0 0 24 24" fill="#000" width={10} height={10}>
                      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                    </svg>
                  )}
                </div>
              ) : '#'}
            </div>
            <div className="text-[11px] text-[#6a6a6a] uppercase tracking-[0.1em] pl-2">Title</div>
            <div className="text-[11px] text-[#6a6a6a] uppercase tracking-[0.1em]">Details</div>
            <div className="flex justify-end pr-2">
              <span className="text-[#6a6a6a]"><IconClock /></span>
            </div>
            <div />
          </div>
        )}

        {/* ---- Rows ---- */}
        {songs.map((song, i) => {
          const { title, sub, detail, dur } = getSongDisplay(song);
          const isMenuOpen = openMenuId === song.id;
          const isHovered = hoveredId === song.id;
          const isActive = activeSongId && activeSongId === song.id;
          const isDragging = dragIndex === i;
          const showDropBefore = canDrag && dropTarget === i && dragIndex !== null && dragIndex !== i && dragIndex !== i - 1;
          const showDropAfter = canDrag && dropTarget === songs.length && i === songs.length - 1 && dragIndex !== null && dragIndex !== songs.length - 1;

          return (
            <div key={song.id} style={{ position: 'relative' }}>
              {/* Drop indicator line BEFORE this row */}
              {showDropBefore && (
                <div
                  style={{
                    position: 'absolute',
                    top: -1,
                    left: 16,
                    right: 16,
                    height: 2,
                    background: '#1ed760',
                    borderRadius: 1,
                    zIndex: 10,
                    pointerEvents: 'none',
                  }}
                />
              )}

              <div
                ref={(el) => { rowRefs.current[i] = el; }}
                onMouseEnter={() => setHoveredId(song.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={(e) => {
                  if (openMenuId || e.target.closest('[data-menu]')) return;
                  if (selectionMode) {
                    toggleSelection(song.id);
                    return;
                  }
                  if (e.target.closest('button')) return;
                  handlePlay(song);
                }}
                className="group transition-colors duration-75"
                style={{
                  display: 'grid',
                  gridTemplateColumns: isMobile ? mobileCols : desktopCols,
                  alignItems: 'center',
                  height: isMobile ? 48 : 56,
                  padding: isMobile ? '0 8px' : '0 16px',
                  borderRadius: 6,
                  background: isDragging ? '#1a1a1a' : isHovered ? 'rgba(255,255,255,0.06)' : 'transparent',
                  opacity: isDragging ? 0.4 : 1,
                  cursor: 'default',
                  transition: 'background 0.1s ease',
                }}
              >
                {/* ---- Drag handle ---- */}
                {canDrag && (
                  <div
                    className="flex items-center justify-center"
                    draggable
                    onDragStart={(e) => { e.stopPropagation(); handleDragStart(e, i); }}
                    onDragEnd={handleDragEnd}
                    onTouchStart={(e) => handleTouchStart(e, i)}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      cursor: 'grab',
                      color: '#666',
                      opacity: isMobile ? 1 : undefined,
                      touchAction: 'none',
                    }}
                  >
                    <span
                      className={isMobile ? '' : 'opacity-0 group-hover:opacity-100'}
                      style={{ transition: 'opacity 150ms', display: 'flex', alignItems: 'center' }}
                    >
                      <IconGrip />
                    </span>
                  </div>
                )}

                {/* ---- Checkbox (selection) / Heart / # ---- */}
                <div className="flex items-center justify-center w-full">
                  {selectionMode ? (() => {
                    const isSelected = selectedIds.has(song.id);
                    return (
                      <div
                        onClick={(e) => { e.stopPropagation(); toggleSelection(song.id); }}
                        style={{
                          width: 24, height: 24, borderRadius: '50%',
                          border: isSelected ? '2px solid #1ed760' : '2px solid #666',
                          background: isSelected ? '#1ed760' : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          cursor: 'pointer', transition: 'all 0.15s ease', flexShrink: 0,
                        }}
                      >
                        {isSelected && (
                          <svg viewBox="0 0 24 24" fill="#000" width={14} height={14}>
                            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                          </svg>
                        )}
                      </div>
                    );
                  })() : (onAddToFavourites || onRemoveFromFavourites) ? (() => {
                    const isFav = favouriteIds.includes(song.id);
                    return (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isFav && onRemoveFromFavourites) onRemoveFromFavourites(song.id);
                          else if (!isFav && onAddToFavourites) onAddToFavourites(song.id);
                        }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
                        aria-label={isFav ? 'Remove from favourites' : 'Add to favourites'}
                      >
                        <svg viewBox="0 0 24 24" width={isMobile ? 18 : 16} height={isMobile ? 18 : 16}
                          fill={isFav ? '#1ed760' : 'none'}
                          stroke={isFav ? '#1ed760' : '#666'}
                          strokeWidth="2"
                        >
                          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                        </svg>
                      </button>
                    );
                  })() : isActive ? (
                    <span className="flex items-center justify-center">
                      <svg width={14} height={14} viewBox="0 0 14 14">
                        <rect x="1" y="6" width="2" height="8" rx="1" fill="#1ed760">
                          <animate attributeName="height" values="8;4;8" dur="0.8s" repeatCount="indefinite" />
                          <animate attributeName="y" values="6;10;6" dur="0.8s" repeatCount="indefinite" />
                        </rect>
                        <rect x="5" y="2" width="2" height="12" rx="1" fill="#1ed760">
                          <animate attributeName="height" values="12;6;12" dur="0.6s" repeatCount="indefinite" />
                          <animate attributeName="y" values="2;8;2" dur="0.6s" repeatCount="indefinite" />
                        </rect>
                        <rect x="9" y="4" width="2" height="10" rx="1" fill="#1ed760">
                          <animate attributeName="height" values="10;3;10" dur="0.7s" repeatCount="indefinite" />
                          <animate attributeName="y" values="4;11;4" dur="0.7s" repeatCount="indefinite" />
                        </rect>
                      </svg>
                    </span>
                  ) : (
                    <span className="tabular-nums" style={{ fontSize: 14, color: '#a7a7a7' }}>
                      {i + 1}
                    </span>
                  )}
                </div>

                {/* ---- Title + subtitle ---- */}
                <div className="min-w-0 pl-2">
                  <div
                    className="truncate"
                    style={{
                      fontSize: isMobile ? 14 : 16,
                      fontWeight: 400,
                      color: isActive ? '#1ed760' : '#fff',
                      lineHeight: 1.3,
                    }}
                  >
                    {title}
                  </div>
                  {sub && (
                    <div
                      className="truncate"
                      style={{
                        fontSize: isMobile ? 12 : 14,
                        color: isActive ? '#1ed760' : '#a7a7a7',
                        lineHeight: 1.3,
                        marginTop: 1,
                      }}
                    >
                      {sub}
                    </div>
                  )}
                </div>

                {/* ---- Details column (desktop only) - shows LoRA name like Spotify's album column ---- */}
                {!isMobile && (
                  <div
                    className="truncate hover:underline cursor-pointer"
                    style={{ fontSize: 14, color: '#a7a7a7' }}
                  >
                    {detail}
                  </div>
                )}

                {/* ---- Duration (desktop only) ---- */}
                {!isMobile && (
                  <div
                    className="text-right tabular-nums pr-2"
                    style={{ fontSize: 14, color: '#a7a7a7' }}
                  >
                    {dur}
                  </div>
                )}

                {/* ---- Menu button ---- */}
                <div className="relative flex items-center justify-center">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenMenuId(isMenuOpen ? null : song.id);
                    }}
                    aria-label="More options"
                    className="flex items-center justify-center rounded-full w-8 h-8 transition-opacity hover:bg-[#ffffff1a]"
                    style={{
                      opacity: isMobile ? 1 : (isHovered || isMenuOpen ? 1 : 0),
                      color: '#a7a7a7',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    <IconDots />
                  </button>

                  {isMenuOpen && (
                    <SongMenu
                      song={song}
                      albums={albums}
                      onPlay={handlePlay}
                      onViewDetails={setDetailSong}
                      onReuseSettings={onReuseSettings}
                      onMakeMore={onMakeMore}
                      onEditRegenerate={onEditRegenerate}
                      onAddToAlbum={onAddToAlbum}
                      onRemoveFromAlbum={onRemoveFromAlbum ? (id) => onRemoveFromAlbum(id) : null}
                      onRemoveFromFavourites={onRemoveFromFavourites ? (id) => onRemoveFromFavourites(id) : null}
                      onAddToFavourites={onAddToFavourites ? (id) => onAddToFavourites(id) : null}
                      onClose={() => setOpenMenuId(null)}
                      isMobile={isMobile}
                    />
                  )}
                </div>
              </div>

              {/* Drop indicator line AFTER last row */}
              {showDropAfter && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: -1,
                    left: 16,
                    right: 16,
                    height: 2,
                    background: '#1ed760',
                    borderRadius: 1,
                    zIndex: 10,
                    pointerEvents: 'none',
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {detailSong && (
        <SongDetailModal song={detailSong} onClose={() => setDetailSong(null)} />
      )}

      {/* ---- Floating selection action bar ---- */}
      {selectionMode && selectedIds.size > 0 && (
        <div
          style={{
            position: 'fixed',
            bottom: 80,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 150,
            background: 'rgba(24, 24, 24, 0.92)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            borderRadius: 16,
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
            padding: isMobile ? '10px 12px' : '10px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: isMobile ? 8 : 12,
            maxWidth: isMobile ? 'calc(100vw - 24px)' : 600,
            width: 'auto',
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', flexShrink: 0 }}>
            {selectedIds.size} selected
          </span>

          <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.12)', flexShrink: 0 }} />

          <button
            onClick={selectAll}
            style={{
              padding: '6px 12px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.15)',
              background: 'transparent', color: '#a7a7a7', fontSize: 12, fontWeight: 600,
              cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
            }}
          >
            Select All
          </button>
          <button
            onClick={deselectAll}
            style={{
              padding: '6px 12px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.15)',
              background: 'transparent', color: '#a7a7a7', fontSize: 12, fontWeight: 600,
              cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
            }}
          >
            Deselect
          </button>

          {batchActions.map((action) => (
            <button
              key={action.label}
              onClick={() => action.onClick(selectedIds)}
              style={{
                padding: '6px 14px', borderRadius: 20, border: 'none',
                background: action.danger ? '#e91429' : '#1ed760',
                color: action.danger ? '#fff' : '#000',
                fontSize: 12, fontWeight: 700,
                cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                display: 'flex', alignItems: 'center', gap: 5,
              }}
            >
              {action.icon && <span style={{ fontSize: 14 }}>{action.icon}</span>}
              {action.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
