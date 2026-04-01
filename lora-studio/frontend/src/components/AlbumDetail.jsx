import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getLibrary, getSongs, deleteAlbum, removeSongFromAlbum, updateAlbum,
  getYoutubeAuthUrl, getYoutubeAuthStatus,
  youtubeUploadAlbum, youtubeUploadStatusSSE,
  youtubeSyncAlbum, youtubeSyncStatusSSE,
} from '../api.js';
import SongTable from './SongTable.jsx';
import SongEditor from './SongEditor.jsx';
import CoverModal from './CoverModal.jsx';
import { playSong } from './NowPlaying.jsx';

const C = {
  elevated: '#181818',
  green: '#1ed760',
  red: '#e91429',
  textPrimary: '#fff',
  textSecondary: '#a7a7a7',
};

// ---------------------------------------------------------------------------
// YouTube Upload Panel
// ---------------------------------------------------------------------------

function YoutubeUploadPanel({ albumId, onToast, triggerOpen, onTriggerClose, hasPlaylist, onDone }) {
  const [open, setOpen] = useState(false);
  const isSync = hasPlaylist;

  // Allow parent to trigger open
  useEffect(() => {
    if (triggerOpen) {
      setOpen(true);
      checkAuth();
      if (onTriggerClose) onTriggerClose();
    }
  }, [triggerOpen]);
  const [authStatus, setAuthStatus] = useState(null); // null | 'checking' | 'authed' | 'unauthed' | 'unavailable'
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(null);
  const sseRef = useRef(null);

  const stopSSE = () => {
    if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
  };

  useEffect(() => {
    // Check if upload/sync is already running (e.g. after minimizing)
    const endpoint = isSync ? '/api/youtube-sync/progress' : '/api/youtube-upload/progress';
    fetch(endpoint).then(r => r.json()).then(data => {
      if (data.active) {
        setUploading(true);
        setProgress(data);
        const pollId = setInterval(async () => {
          try {
            const res = await fetch(endpoint);
            const d = await res.json();
            setProgress(d);
            if (d.done || !d.active) {
              clearInterval(pollId);
              sseRef.current = null;
              setUploading(false);
              if (onDone) onDone();
            }
          } catch {}
        }, 2000);
        sseRef.current = { close: () => clearInterval(pollId) };
      }
    }).catch(() => {});
    return () => stopSSE();
  }, []);

  const checkAuth = async () => {
    setAuthStatus('checking');
    try {
      const res = await getYoutubeAuthStatus();
      setAuthStatus(res.authenticated ? 'authed' : 'unauthed');
    } catch {
      setAuthStatus('unavailable');
    }
  };

  const handleOpen = async () => {
    setOpen(true);
    setProgress(null);
    await checkAuth();
  };

  const handleUpload = async () => {
    setUploading(true);
    setProgress(null);
    try {
      if (isSync) {
        await youtubeSyncAlbum(albumId);
      } else {
        await youtubeUploadAlbum(albumId);
      }
    } catch (err) {
      onToast(err.message, 'error');
      setUploading(false);
      return;
    }

    // Poll progress (works reliably on mobile/PWA)
    stopSSE();
    const endpoint = isSync ? '/api/youtube-sync/progress' : '/api/youtube-upload/progress';
    const pollId = setInterval(async () => {
      try {
        const res = await fetch(endpoint);
        const data = await res.json();
        setProgress(data);
        if (data.done || !data.active) {
          clearInterval(pollId);
          sseRef.current = null;
          setUploading(false);
          if (onDone) onDone();
          if (isSync) {
            if (data.errors && data.errors.length > 0) {
              onToast(`Sync finished with ${data.errors.length} error(s)`, 'error');
            } else {
              onToast('Sync complete!');
            }
          } else {
            if (data.playlist_url) {
              onToast('Upload complete! Playlist created.');
            } else if (data.errors && data.errors.length > 0) {
              onToast(`Upload finished with ${data.errors.length} error(s)`, 'error');
            } else {
              onToast('Upload complete!');
            }
          }
        }
      } catch { /* keep polling */ }
    }, 2000);
    sseRef.current = { close: () => clearInterval(pollId) };
  };

  if (!open) {
    return null; // Trigger handled by parent menu
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        zIndex: 300,
        paddingBottom: 80,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#282828',
          borderRadius: 16,
          padding: 24,
          maxWidth: 480,
          width: '92%',
          boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', margin: 0 }}>
            {isSync ? 'Sync with YouTube' : 'Upload to YouTube'}
          </h2>
          <button
            onClick={() => setOpen(false)}
            style={{ background: 'none', border: 'none', color: '#a7a7a7', cursor: 'pointer', fontSize: 20 }}
          >
            {uploading ? '−' : '×'}
          </button>
        </div>

        {authStatus === 'checking' && (
          <div style={{ color: '#a7a7a7', fontSize: 14 }}>Checking YouTube connection...</div>
        )}

        {authStatus === 'unavailable' && (
          <div style={{ color: '#e91429', fontSize: 14 }}>
            YouTube API not configured. Add <code>GOOGLE_CLIENT_ID</code> and{' '}
            <code>GOOGLE_CLIENT_SECRET</code> to your <code>.env</code> file.
          </div>
        )}

        {authStatus === 'unauthed' && (
          <div>
            <p style={{ color: '#a7a7a7', fontSize: 14, marginBottom: 16 }}>
              Connect your YouTube account to upload videos. You'll be redirected
              to Google — after signing in, come back here.
            </p>
            <a
              href="#"
              id="yt-sign-in"
              style={{
                display: 'block', textAlign: 'center',
                padding: '14px 24px', fontSize: 16, borderRadius: 24,
                background: '#fff', color: '#000', fontWeight: 700,
                textDecoration: 'none', WebkitTapHighlightColor: 'rgba(0,0,0,0.1)',
              }}
              onClick={(e) => {
                e.preventDefault();
                getYoutubeAuthUrl().then(res => {
                  if (res && res.auth_url) {
                    window.location.href = res.auth_url;
                  }
                }).catch(err => onToast(err.message, 'error'));
              }}
            >
              Sign in with Google
            </a>
          </div>
        )}

        {authStatus === 'authed' && !uploading && !progress && (
          <div>
            <p style={{ color: '#a7a7a7', fontSize: 14, marginBottom: 16 }}>
              {isSync
                ? 'Sync will upload new songs, remove deleted ones, update renamed titles, and reorder the playlist to match your album.'
                : 'Each song will be uploaded as an unlisted video (cover art + audio). A private playlist will be created for the album.'}
            </p>
            <div style={{ display: 'flex', gap: 12 }}>
              <button className="btn btn-primary" onClick={handleUpload}>
                {isSync ? 'Start Sync' : 'Start Upload'}
              </button>
              <button
                style={{ fontSize: 13, color: '#a7a7a7', background: 'none', border: 'none', cursor: 'pointer' }}
                onClick={checkAuth}
              >
                Re-check auth
              </button>
            </div>
          </div>
        )}

        {(uploading || progress) && (
          <div>
            <div style={{ color: '#fff', fontSize: 14, marginBottom: 8 }}>
              {progress?.message || 'Uploading...'}
            </div>
            {progress && progress.total > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ height: 6, background: '#404040', borderRadius: 3, overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${Math.round((progress.current / progress.total) * 100)}%`,
                      height: '100%',
                      background: '#ff0000',
                      transition: 'width 0.4s',
                    }}
                  />
                </div>
                <div style={{ marginTop: 4, color: '#a7a7a7', fontSize: 12 }}>
                  {progress.current} / {progress.total}
                </div>
              </div>
            )}
            {progress?.playlist_url && (
              <a
                href={progress.playlist_url}
                target="_blank"
                rel="noreferrer"
                style={{ color: '#1ed760', fontSize: 13 }}
              >
                View playlist on YouTube
              </a>
            )}
            {progress?.errors && progress.errors.length > 0 && (
              <ul style={{ marginTop: 8, paddingLeft: 16, color: '#e91429', fontSize: 12 }}>
                {progress.errors.map((err, i) => <li key={i}>{err}</li>)}
              </ul>
            )}
            {progress?.done && !uploading && (
              <button
                className="btn btn-ghost"
                style={{ marginTop: 12 }}
                onClick={() => { setOpen(false); setProgress(null); }}
              >
                Close
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AlbumDetail
// ---------------------------------------------------------------------------

export default function AlbumDetail({ albumId, onToast, onBack }) {
  const [library, setLibrary] = useState(null);
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [coverModalOpen, setCoverModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [ytUploadOpen, setYtUploadOpen] = useState(false);
  const [editSong, setEditSong] = useState(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [lib, allSongs] = await Promise.all([getLibrary(), getSongs()]);
      setLibrary(lib); setSongs(allSongs);
    } catch (e) { onToast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [albumId, onToast]);

  useEffect(() => { load(); }, [load]);

  const album = library?.albums?.find((a) => a.id === albumId);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-[#a7a7a7] border-t-transparent animate-spin" />
          <div className="text-[14px] text-[#a7a7a7]">Loading...</div>
        </div>
      </div>
    );
  }
  if (!album) {
    return (
      <div className="text-[14px] py-12 text-[#a7a7a7]">Album not found.</div>
    );
  }

  const albumSongs = album.songs_data || [];
  const hasCover = !!album.cover;

  const handlePlayAll = () => {
    if (albumSongs.length === 0) return;
    const first = albumSongs[0];
    const inp = first.inputs || {};
    playSong({
      src: `/api/songs/${encodeURIComponent(first.id)}/audio`,
      title: inp.title || first.filename || first.id,
      meta: [inp.key, inp.bpm ? inp.bpm + ' BPM' : ''].filter(Boolean).join(' \u00b7 '),
    });
  };

  return (
    <div>
      {/* Back button */}
      <button
        onClick={onBack}
        className="inline-flex items-center gap-2 mb-6 text-[14px] text-[#a7a7a7] hover:text-white transition-colors group"
        style={{ background: 'none', border: 'none', cursor: 'pointer' }}
      >
        <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2} className="transition-transform group-hover:-translate-x-0.5">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Your Library
      </button>

      {/* Hero header with gradient */}
      <div
        className="rounded-lg overflow-hidden mb-6"
        style={{
          background: 'linear-gradient(180deg, rgba(80,80,80,0.6) 0%, #121212 100%)',
          padding: 'clamp(24px, 4vw, 40px)',
          paddingTop: 'clamp(32px, 5vw, 56px)',
        }}
      >
        <div className="flex flex-col sm:flex-row items-center sm:items-end gap-6">
          {/* Cover art */}
          <div
            className="flex-shrink-0 rounded overflow-hidden"
            style={{
              width: 'clamp(160px, 20vw, 232px)',
              height: 'clamp(160px, 20vw, 232px)',
              boxShadow: '0 4px 60px rgba(0,0,0,.5)',
              background: hasCover
                ? `url('${album.cover}') center/cover no-repeat`
                : 'linear-gradient(135deg, #404040, #282828)',
            }}
          >
            {!hasCover && (
              <div className="w-full h-full flex items-center justify-center">
                <svg viewBox="0 0 80 80" width={56} height={56} fill="none" opacity={0.2}>
                  <path d="M25 60V20l35 20-35 20z" fill="#fff" />
                </svg>
              </div>
            )}
          </div>

          {/* Info */}
          <div className="text-center sm:text-left flex-1 min-w-0">
            <div
              className="uppercase font-medium"
              style={{ fontSize: 11, letterSpacing: '0.1em', color: C.textPrimary, marginBottom: 8 }}
            >
              Album
            </div>
            <h1
              className="font-bold text-white truncate"
              style={{
                fontSize: 'clamp(24px, 5vw, 48px)',
                lineHeight: 1.1,
                letterSpacing: '-0.04em',
                marginBottom: 12,
              }}
            >
              {album.name}
            </h1>
            <div style={{ fontSize: 14, color: C.textSecondary }}>
              {albumSongs.length} song{albumSongs.length !== 1 ? 's' : ''}
            </div>
            {album.youtube_playlist_id && (
              <a
                href={`https://www.youtube.com/playlist?list=${album.youtube_playlist_id}`}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  marginTop: 8,
                  fontSize: 13,
                  color: '#ff0000',
                  textDecoration: 'none',
                }}
              >
                <svg viewBox="0 0 24 24" width={16} height={16} fill="currentColor">
                  <path d="M23.5 6.2a3 3 0 00-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 00.5 6.2 31.5 31.5 0 000 12a31.5 31.5 0 00.5 5.8 3 3 0 002.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 002.1-2.1c.4-1.9.5-5.8.5-5.8s0-3.9-.5-5.8zM9.5 15.5v-7l6.3 3.5-6.3 3.5z"/>
                </svg>
                View on YouTube
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Actions row */}
      <div className="flex items-center gap-4 mb-8">

        <div style={{ flex: 1 }} />

        {/* Album menu */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setMenuOpen(v => !v)}
            style={{
              background: 'none', border: 'none', color: '#a7a7a7', cursor: 'pointer',
              padding: 8, WebkitTapHighlightColor: 'transparent',
            }}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 24, height: 24 }}>
              <circle cx="5" cy="12" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="19" cy="12" r="2" />
            </svg>
          </button>
          {menuOpen && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setMenuOpen(false)} />
              <div style={{
                position: 'absolute', right: 0, top: '100%', zIndex: 100,
                background: '#282828', border: '1px solid #3a3a3a', borderRadius: 8,
                padding: '4px 0', minWidth: 200, boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
              }}>
                <div
                  onClick={() => { setCoverModalOpen(true); setMenuOpen(false); }}
                  style={{ padding: '12px 16px', fontSize: 14, color: '#fff', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#3a3a3a'}
                  onMouseLeave={e => e.currentTarget.style.background = ''}
                >
                  🎨 Generate Cover
                </div>
                <div
                  onClick={() => { setMenuOpen(false); setYtUploadOpen(true); }}
                  style={{ padding: '12px 16px', fontSize: 14, color: '#fff', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#3a3a3a'}
                  onMouseLeave={e => e.currentTarget.style.background = ''}
                >
                  {album.youtube_playlist_id ? '\uD83D\uDD04 Sync with YouTube' : '\uD83D\uDCFA Upload to YouTube'}
                </div>
                <div style={{ height: 1, background: '#3a3a3a', margin: '4px 0' }} />
                <div
                  onClick={async () => {
                    setMenuOpen(false);
                    if (window.confirm('Delete this album? Songs are not deleted.')) {
                      await deleteAlbum(albumId);
                      onToast('Deleted');
                      onBack();
                    }
                  }}
                  style={{ padding: '12px 16px', fontSize: 14, color: '#e91429', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#3a3a3a'}
                  onMouseLeave={e => e.currentTarget.style.background = ''}
                >
                  🗑 Delete Album
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Track list */}
      {albumSongs.length === 0 ? (
        <div
          className="py-12 text-center rounded-lg"
          style={{ background: C.elevated, color: C.textSecondary, fontSize: 14 }}
        >
          No songs yet. Add from the Library using the <span className="text-white">\u22ef</span> menu.
        </div>
      ) : (
        <SongTable
          songs={albumSongs}
          albums={[]}
          coverUrl={album.cover || null}
          onReuseSettings={(s) => {
            sessionStorage.setItem('lora-studio:reuse-settings', JSON.stringify(s.inputs));
            window.dispatchEvent(new CustomEvent('lora-studio:reuse-settings', { detail: s.inputs }));
            navigate('/generate');
          }}
          onEditRegenerate={(song) => setEditSong(song)}
          onRemoveFromAlbum={async (songId) => {
            await removeSongFromAlbum(albumId, songId);
            onToast('Removed');
            load();
          }}
          onReorder={async (newSongs) => {
            try {
              await updateAlbum(albumId, { song_ids: newSongs.map(s => s.id) });
              load();
            } catch (e) {
              onToast(e.message, 'error');
            }
          }}
        />
      )}

      <CoverModal
        albumId={albumId}
        open={coverModalOpen}
        onClose={() => setCoverModalOpen(false)}
        onToast={onToast}
        onDone={load}
      />
      <YoutubeUploadPanel
        albumId={albumId}
        onToast={onToast}
        triggerOpen={ytUploadOpen}
        onTriggerClose={() => setYtUploadOpen(false)}
        hasPlaylist={!!album.youtube_playlist_id}
        onDone={load}
      />
      {editSong && (
        <SongEditor song={editSong} open={!!editSong} onClose={() => setEditSong(null)} onToast={onToast} />
      )}
    </div>
  );
}
