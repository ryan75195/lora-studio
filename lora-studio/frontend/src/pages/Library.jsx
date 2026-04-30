import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getLibrary,
  getSongs,
  getLoras,
  createAlbum,
  addSongToAlbum,
  openFolder,
  updateFavourites,
  addToFavourites,
  removeFromFavourites,
  batchDeleteSongs,
} from '../api.js';
import SongTable from '../components/SongTable.jsx';
import SongEditor from '../components/SongEditor.jsx';
import AlbumCard from '../components/AlbumCard.jsx';
import AlbumDetail from '../components/AlbumDetail.jsx';
import QueueSection from '../components/QueueSection.jsx';

const C = {
  elevated: '#181818',
  tinted: '#232323',
  hover: '#2a2a2a',
  green: '#1ed760',
  border: 'rgba(255,255,255,0.1)',
  textPrimary: '#fff',
  textSecondary: '#a7a7a7',
};

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

// ---------------------------------------------------------------------------
// Queue section (extracted to components/QueueSection.jsx)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// LibraryMain
// ---------------------------------------------------------------------------

function LibraryMain({ onToast, onAlbumClick }) {
  const [library, setLibrary] = useState(null);
  const [songs, setSongs] = useState([]);
  const [loras, setLoras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNewAlbum, setShowNewAlbum] = useState(false);
  const [albumName, setAlbumName] = useState('');
  const [albumLora, setAlbumLora] = useState('');
  const [editSong, setEditSong] = useState(null);
  const [view, setView] = useState('favourites'); // 'favourites' | 'all'
  const [selectionMode, setSelectionMode] = useState(false);
  const [showAlbumPicker, setShowAlbumPicker] = useState(null); // null or Set of selectedIds
  // Playlist generation moved to Create tab
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [lib, allSongs, allLoras] = await Promise.all([getLibrary(), getSongs(), getLoras()]);
      setLibrary(lib); setSongs(allSongs); setLoras(allLoras);
    } catch (e) { onToast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [onToast]);

  useEffect(() => { load(); }, [load]);

  const handleCreateAlbum = async (e) => {
    e.preventDefault();
    if (!albumName.trim()) return;
    try {
      await createAlbum({ name: albumName.trim(), lora_name: albumLora });
      onToast('Album created!');
      setShowNewAlbum(false); setAlbumName(''); setAlbumLora('');
      load();
    } catch (e) { onToast(e.message, 'error'); }
  };

  const albums = library?.albums || [];

  return (
    <div>
      {/* ---- Page title ---- */}
      <div className="mb-10">
        <h1
          className="font-bold text-white"
          style={{ fontSize: 32, letterSpacing: '-0.04em', lineHeight: 1.2, marginBottom: 24 }}
        >
          {getGreeting()}
        </h1>

        {/* Filter chips / action buttons */}
        <div className="flex gap-2 items-center flex-wrap">
          <button
            className="rounded-full text-[14px] font-bold transition-all duration-200"
            style={{
              padding: '8px 16px',
              background: showNewAlbum ? '#fff' : C.tinted,
              color: showNewAlbum ? '#000' : '#fff',
              border: 'none',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => { if (!showNewAlbum) e.currentTarget.style.background = C.hover; }}
            onMouseLeave={(e) => { if (!showNewAlbum) e.currentTarget.style.background = C.tinted; }}
            onClick={() => setShowNewAlbum((v) => !v)}
          >
            {showNewAlbum ? '\u2715 Cancel' : '+ New Album'}
          </button>
          <button
            className="rounded-full text-[14px] transition-all duration-200"
            style={{
              padding: '8px 16px',
              background: C.tinted,
              color: C.textSecondary,
              border: 'none',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = C.hover; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = C.tinted; e.currentTarget.style.color = C.textSecondary; }}
            onClick={() => openFolder()}
          >
            Open Folder
          </button>
        </div>
      </div>

      {/* ---- New Album form ---- */}
      {showNewAlbum && (
        <form
          onSubmit={handleCreateAlbum}
          className="rounded-lg p-6 mb-8"
          style={{ background: C.elevated, border: `1px solid ${C.border}` }}
        >
          <div
            className="uppercase font-medium mb-4"
            style={{ fontSize: 11, letterSpacing: '0.1em', color: C.textSecondary }}
          >
            New Album
          </div>
          <div className="flex gap-3 flex-col sm:flex-row">
            <input
              className="flex-1 rounded-md px-4 py-3 text-[14px] text-white placeholder-[#6a6a6a] focus:outline-none transition-colors border"
              style={{ background: C.hover, borderColor: C.border }}
              onFocus={(e) => (e.target.style.borderColor = C.green)}
              onBlur={(e) => (e.target.style.borderColor = C.border)}
              placeholder="Album name"
              value={albumName}
              onChange={(e) => setAlbumName(e.target.value)}
              autoFocus
              required
            />
            <select
              className="rounded-md px-4 py-3 text-[14px] text-white focus:outline-none transition-colors border"
              style={{ background: C.hover, borderColor: C.border }}
              value={albumLora}
              onChange={(e) => setAlbumLora(e.target.value)}
            >
              <option value="">All LoRAs</option>
              {loras.map((l) => (
                <option key={l.name} value={l.name}>{l.name}</option>
              ))}
            </select>
            <button
              type="submit"
              className="px-6 py-3 text-[14px] font-bold rounded-full whitespace-nowrap transition-all"
              style={{
                background: albumName.trim() ? C.green : '#333',
                color: albumName.trim() ? '#000' : '#666',
                border: 'none',
                cursor: albumName.trim() ? 'pointer' : 'not-allowed',
              }}
              disabled={!albumName.trim()}
            >
              Create
            </button>
          </div>
        </form>
      )}

      {/* Auto Playlist moved to Create tab */}

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 rounded-full border-2 border-[#a7a7a7] border-t-transparent animate-spin" />
            <div className="text-[14px] text-[#a7a7a7]">Loading your library...</div>
          </div>
        </div>
      ) : (
        <>
          {/* ---- Queue section ---- */}
          {/* Queue moved to Create tab */}

          {/* ---- Albums section ---- */}
          {albums.length > 0 && (
            <section style={{ marginBottom: 40 }}>
              <div className="flex items-baseline justify-between mb-5">
                <h2
                  className="font-bold text-white"
                  style={{ fontSize: 24, letterSpacing: '-0.02em' }}
                >
                  Your Albums
                </h2>
              </div>
              {/* Mobile: horizontal scroll row. Desktop: grid */}
              <div
                className="hidden sm:grid"
                style={{
                  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                  gap: 20,
                }}
              >
                {albums.map((a) => (
                  <AlbumCard key={a.id} album={a} onClick={() => onAlbumClick(a.id)} />
                ))}
              </div>
              <div
                className="flex sm:hidden overflow-x-auto gap-3 pb-2 -mx-4 px-4"
                style={{ scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch' }}
              >
                {albums.map((a) => (
                  <div key={a.id} style={{ scrollSnapAlign: 'start', flexShrink: 0, width: 130 }}>
                    <AlbumCard album={a} onClick={() => onAlbumClick(a.id)} compact />
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ---- Favourites / All Songs toggle ---- */}
          {songs.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center py-20 rounded-lg gap-4"
              style={{ background: C.elevated }}
            >
              <svg viewBox="0 0 80 80" width={64} height={64} fill="none" opacity={0.15}>
                <path d="M25 60V20l35 20-35 20z" fill="#fff" />
              </svg>
              <div className="text-white font-bold text-[18px]">No songs yet</div>
              <div className="text-[14px] text-center text-[#a7a7a7]" style={{ maxWidth: 300 }}>
                Generate some music first and it will appear here.
              </div>
              <button
                className="mt-2 px-8 py-3 text-[14px] font-bold rounded-full transition-transform hover:scale-105 active:scale-95"
                style={{ background: C.green, color: '#000', border: 'none', cursor: 'pointer' }}
                onClick={() => navigate('/generate')}
              >
                Generate Music
              </button>
            </div>
          ) : (
            <section style={{ marginTop: 8 }}>
              {/* View toggle tabs */}
              <div className="flex items-center gap-3 mb-5">
                <button
                  className="rounded-full text-[14px] font-bold transition-all duration-200"
                  style={{
                    padding: '8px 18px',
                    background: view === 'favourites' ? '#fff' : C.tinted,
                    color: view === 'favourites' ? '#000' : C.textSecondary,
                    border: 'none',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => { if (view !== 'favourites') e.currentTarget.style.background = C.hover; }}
                  onMouseLeave={(e) => { if (view !== 'favourites') e.currentTarget.style.background = C.tinted; }}
                  onClick={() => setView('favourites')}
                >
                  Favourites
                </button>
                <button
                  className="rounded-full text-[14px] font-bold transition-all duration-200"
                  style={{
                    padding: '8px 18px',
                    background: view === 'all' ? '#fff' : C.tinted,
                    color: view === 'all' ? '#000' : C.textSecondary,
                    border: 'none',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => { if (view !== 'all') e.currentTarget.style.background = C.hover; }}
                  onMouseLeave={(e) => { if (view !== 'all') e.currentTarget.style.background = C.tinted; }}
                  onClick={() => setView('all')}
                >
                  All Songs ({songs.length})
                </button>
              </div>

              {view === 'favourites' ? (
                <>
                  <div className="flex items-baseline justify-between mb-5">
                    <h2
                      className="font-bold text-white"
                      style={{ fontSize: 24, letterSpacing: '-0.02em' }}
                    >
                      Favourites
                    </h2>
                    <span className="text-[14px] text-[#a7a7a7]">
                      {(library?.favourites_data || []).length} song{(library?.favourites_data || []).length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  {(library?.favourites_data || []).length === 0 ? (
                    <div
                      className="flex flex-col items-center justify-center py-16 rounded-lg gap-3"
                      style={{ background: C.elevated }}
                    >
                      <div style={{ fontSize: 32, opacity: 0.2 }}>{'\u2665'}</div>
                      <div className="text-[#a7a7a7] text-[14px] text-center" style={{ maxWidth: 280 }}>
                        No favourites yet. New songs are added here automatically, or add songs from the All Songs view.
                      </div>
                    </div>
                  ) : (
                    <SongTable
                      songs={library.favourites_data}
                      albums={albums}
                      favouriteIds={library?.favourites || []}
                      onReorder={async (newOrder) => {
                        await updateFavourites(newOrder.map((s) => s.id));
                        load();
                      }}
                      onRemoveFromFavourites={async (songId) => {
                        await removeFromFavourites(songId);
                        setLibrary(prev => prev ? {
                          ...prev,
                          favourites: (prev.favourites || []).filter(id => id !== songId),
                          favourites_data: (prev.favourites_data || []).filter(s => s.id !== songId),
                        } : prev);
                      }}
                      onReuseSettings={(s) => {
                        sessionStorage.setItem('lora-studio:reuse-settings', JSON.stringify(s.inputs));
                        window.dispatchEvent(new CustomEvent('lora-studio:reuse-settings', { detail: s.inputs }));
                        navigate('/generate');
                      }}
                      onMakeMore={(s) => {
                        const inp = s.inputs || {};
                        sessionStorage.setItem('lora-studio:make-more', JSON.stringify({
                          title: inp.title || '',
                          caption: inp.caption || '',
                          lyrics: inp.lyrics || '',
                          bpm: inp.bpm || null,
                          key: inp.key || '',
                          duration: inp.duration || 180,
                          lora_name: inp.lora_name || '',
                          strength: inp.strength || 1.6,
                        }));
                        navigate('/generate');
                      }}
                      onEditRegenerate={(song) => setEditSong(song)}
                      onAddToAlbum={async (albumId, songId) => {
                        await addSongToAlbum(albumId, songId);
                        onToast('Added to album');
                        load();
                      }}
                    />
                  )}
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-3">
                      <h2
                        className="font-bold text-white"
                        style={{ fontSize: 24, letterSpacing: '-0.02em' }}
                      >
                        All Songs
                      </h2>
                      <button
                        onClick={() => setSelectionMode(v => !v)}
                        className="rounded-full text-[13px] font-bold transition-all duration-200"
                        style={{
                          padding: '5px 14px',
                          background: selectionMode ? '#fff' : C.tinted,
                          color: selectionMode ? '#000' : C.textSecondary,
                          border: 'none',
                          cursor: 'pointer',
                        }}
                      >
                        {selectionMode ? 'Done' : 'Edit'}
                      </button>
                    </div>
                    <span className="text-[14px] text-[#a7a7a7]">
                      {songs.length} song{songs.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <SongTable
                    songs={songs}
                    albums={albums}
                    favouriteIds={library?.favourites || []}
                    selectionMode={selectionMode}
                    batchActions={[
                      {
                        label: 'Add to Favourites',
                        icon: '\u2665',
                        onClick: async (ids) => {
                          try {
                            for (const id of ids) {
                              if (!(library?.favourites || []).includes(id)) {
                                await addToFavourites(id);
                              }
                            }
                            onToast(`Added ${ids.size} song${ids.size !== 1 ? 's' : ''} to favourites`);
                            setSelectionMode(false);
                            load();
                          } catch (e) { onToast(e.message, 'error'); }
                        },
                      },
                      {
                        label: 'Add to Album',
                        icon: '+',
                        onClick: (ids) => {
                          setShowAlbumPicker(ids);
                        },
                      },
                      {
                        label: 'Delete',
                        icon: '\u{1F5D1}',
                        danger: true,
                        onClick: async (ids) => {
                          const count = ids.size;
                          if (!window.confirm(`Delete ${count} song${count !== 1 ? 's' : ''}? This cannot be undone.`)) return;
                          try {
                            await batchDeleteSongs([...ids]);
                            onToast(`Deleted ${count} song${count !== 1 ? 's' : ''}`);
                            setSelectionMode(false);
                            load();
                          } catch (e) { onToast(e.message, 'error'); }
                        },
                      },
                    ]}
                    onAddToFavourites={selectionMode ? undefined : async (songId) => {
                      await addToFavourites(songId);
                      setLibrary(prev => prev ? {
                        ...prev,
                        favourites: [songId, ...(prev.favourites || [])],
                        favourites_data: [songs.find(s => s.id === songId), ...(prev.favourites_data || [])].filter(Boolean),
                      } : prev);
                    }}
                    onRemoveFromFavourites={selectionMode ? undefined : async (songId) => {
                      await removeFromFavourites(songId);
                      setLibrary(prev => prev ? {
                        ...prev,
                        favourites: (prev.favourites || []).filter(id => id !== songId),
                        favourites_data: (prev.favourites_data || []).filter(s => s.id !== songId),
                      } : prev);
                    }}
                    onReuseSettings={(s) => {
                      window.dispatchEvent(new CustomEvent('lora-studio:reuse-settings', { detail: s.inputs }));
                      navigate('/generate');
                    }}
                    onMakeMore={(s) => {
                      const inp = s.inputs || {};
                      sessionStorage.setItem('lora-studio:make-more', JSON.stringify({
                        title: inp.title || '',
                        caption: inp.caption || '',
                        bpm: inp.bpm || null,
                        key: inp.key || '',
                        duration: inp.duration || 180,
                        lora_name: inp.lora_name || '',
                        strength: inp.strength || 1.6,
                      }));
                      navigate('/generate');
                    }}
                    onEditRegenerate={(song) => setEditSong(song)}
                    onAddToAlbum={async (albumId, songId) => {
                      await addSongToAlbum(albumId, songId);
                      onToast('Added to album');
                      load();
                    }}
                  />
                </>
              )}
            </section>
          )}
        </>
      )}
      {/* ---- Album picker modal for batch "Add to Album" ---- */}
      {showAlbumPicker && (
        <div
          className="fixed inset-0 flex items-center justify-center z-[300]"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowAlbumPicker(null); }}
        >
          <div
            className="rounded-xl overflow-hidden"
            style={{
              background: '#1e1e1e',
              border: '1px solid rgba(255,255,255,0.1)',
              width: 340,
              maxWidth: '90vw',
              maxHeight: '60vh',
            }}
          >
            <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Add to Album</div>
              <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>
                {showAlbumPicker.size} song{showAlbumPicker.size !== 1 ? 's' : ''} selected
              </div>
            </div>
            <div style={{ overflowY: 'auto', maxHeight: 'calc(60vh - 80px)' }}>
              {albums.length === 0 ? (
                <div style={{ padding: '24px 20px', textAlign: 'center', color: '#666', fontSize: 14 }}>
                  No albums yet. Create one first.
                </div>
              ) : albums.map((a) => (
                <div
                  key={a.id}
                  onClick={async () => {
                    try {
                      for (const songId of showAlbumPicker) {
                        await addSongToAlbum(a.id, songId);
                      }
                      onToast(`Added ${showAlbumPicker.size} song${showAlbumPicker.size !== 1 ? 's' : ''} to "${a.name}"`);
                      setShowAlbumPicker(null);
                      setSelectionMode(false);
                      load();
                    } catch (e) { onToast(e.message, 'error'); }
                  }}
                  style={{
                    padding: '12px 20px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{ fontSize: 18 }}>{'\uD83D\uDCBF'}</span>
                  <span style={{ fontSize: 14, fontWeight: 500, color: '#fff' }}>{a.name}</span>
                </div>
              ))}
            </div>
            <div style={{ padding: '10px 16px', borderTop: '1px solid rgba(255,255,255,0.08)', textAlign: 'center' }}>
              <button
                onClick={() => setShowAlbumPicker(null)}
                style={{
                  padding: '8px 20px', borderRadius: 20, border: 'none',
                  background: '#333', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {editSong && (
        <SongEditor song={editSong} open={!!editSong} onClose={() => setEditSong(null)} onToast={onToast} />
      )}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default function Library({ onToast }) {
  const [activeAlbumId, setActiveAlbumId] = useState(null);

  if (activeAlbumId) {
    return (
      <AlbumDetail
        albumId={activeAlbumId}
        onToast={onToast}
        onBack={() => setActiveAlbumId(null)}
      />
    );
  }
  return <LibraryMain onToast={onToast} onAlbumClick={setActiveAlbumId} />;
}
