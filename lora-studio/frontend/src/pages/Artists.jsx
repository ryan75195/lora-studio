import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getArtists, createArtist, getArtist, deleteArtist, uploadTracks, deleteTrack,
  youtubeImport, youtubeImportStatusSSE,
} from '../api.js';

const MusicNoteIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z" />
  </svg>
);

// Palette of subtle gradient pairs for artist cards
const CARD_GRADIENTS = [
  ['#1a1a2e', '#16213e'],
  ['#1a2a1a', '#162616'],
  ['#2a1a1a', '#261616'],
  ['#1a1a2a', '#16162a'],
  ['#1e2218', '#1a2014'],
  ['#221a1e', '#1e161a'],
];

function getGradient(slug) {
  let hash = 0;
  for (let i = 0; i < (slug || '').length; i++) {
    hash = ((hash << 5) - hash) + slug.charCodeAt(i);
    hash |= 0;
  }
  return CARD_GRADIENTS[Math.abs(hash) % CARD_GRADIENTS.length];
}

function ArtistList({ onToast }) {
  const [artists, setArtists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newGenre, setNewGenre] = useState('');
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getArtists();
      setArtists(data);
    } catch (e) {
      onToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await createArtist({ name: newName.trim(), genre: newGenre.trim() });
      onToast('Artist created!');
      setNewName('');
      setNewGenre('');
      setShowForm(false);
      load();
    } catch (err) {
      onToast(err.message, 'error');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Artists</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '9px 18px',
            borderRadius: 24,
            border: showForm ? '1px solid rgba(255,255,255,0.15)' : 'none',
            background: showForm ? 'transparent' : '#1ed760',
            color: showForm ? '#aaa' : '#000',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'all 0.15s',
            minHeight: 40,
          }}
        >
          {showForm ? '✕ Cancel' : '+ New Artist'}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleCreate}
          style={{
            background: 'linear-gradient(145deg, #1a1a1a, #202020)',
            border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 16,
            padding: '16px 16px 12px',
            marginBottom: 20,
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          }}
        >
          <div className="form-row">
            <div className="form-group form-group-inline">
              <label className="form-label">Artist Name</label>
              <input
                className="form-input"
                placeholder="e.g. Stevie Nicks"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoFocus
                required
              />
            </div>
            <div className="form-group form-group-inline">
              <label className="form-label">Genre (optional)</label>
              <input
                className="form-input"
                placeholder="e.g. Blues Rock"
                value={newGenre}
                onChange={(e) => setNewGenre(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, paddingBottom: 14 }}>
              <button
                type="submit"
                disabled={creating || !newName.trim()}
                style={{
                  padding: '10px 20px',
                  borderRadius: 24,
                  border: 'none',
                  background: !creating && newName.trim() ? '#1ed760' : '#333',
                  color: !creating && newName.trim() ? '#000' : '#666',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: creating || !newName.trim() ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s',
                  whiteSpace: 'nowrap',
                  minHeight: 44,
                }}
              >
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </form>
      )}

      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading...</div>
      ) : artists.length === 0 ? (
        <div className="drop-zone">No artists yet. Click &ldquo;+ New Artist&rdquo; to get started.</div>
      ) : (
        <div className="card-grid">
          {artists.map((a) => {
            const [g1, g2] = getGradient(a.slug);
            return (
              <div
                key={a.slug}
                onClick={() => navigate('/artists/' + a.slug)}
                style={{
                  background: `linear-gradient(145deg, ${g1}, ${g2})`,
                  borderRadius: 16,
                  padding: '16px 14px',
                  cursor: 'pointer',
                  transition: 'transform 0.15s, box-shadow 0.15s',
                  boxShadow: '0 2px 12px rgba(0,0,0,0.35)',
                  border: 'none',
                  position: 'relative',
                  overflow: 'hidden',
                  minHeight: 88,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.45)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.35)';
                }}
              >
                {/* Decorative music note - top right */}
                <div
                  style={{
                    position: 'absolute',
                    top: 10,
                    right: 12,
                    color: 'rgba(255,255,255,0.08)',
                    fontSize: 32,
                    lineHeight: 1,
                    pointerEvents: 'none',
                    userSelect: 'none',
                  }}
                >
                  <MusicNoteIcon />
                </div>

                <div>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      color: '#fff',
                      marginBottom: 4,
                      lineHeight: 1.3,
                    }}
                  >
                    {a.name}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: 'rgba(255,255,255,0.45)',
                      fontWeight: 500,
                    }}
                  >
                    {a.track_count} track{a.track_count !== 1 ? 's' : ''}
                    {a.genre ? ' · ' + a.genre : ''}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function YoutubeImportPanel({ slug, onToast, onDone }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(null);
  const sseRef = useRef(null);

  const stopSSE = () => {
    if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
  };

  useEffect(() => {
    // Check if import is already running (e.g. came back after leaving the app)
    fetch('/api/youtube-import/progress').then(r => r.json()).then(data => {
      if (data.active) {
        setOpen(true);
        setImporting(true);
        setProgress(data);
        const pollId = setInterval(async () => {
          try {
            const res = await fetch('/api/youtube-import/progress');
            const d = await res.json();
            setProgress(d);
            if (d.done || !d.active) {
              clearInterval(pollId);
              sseRef.current = null;
              setImporting(false);
              if (d.errors && d.errors.length === 0) onToast('YouTube import complete!');
              else if (d.errors && d.errors.length > 0) onToast(`Import finished with ${d.errors.length} error(s)`, 'error');
              onDone();
            }
          } catch {}
        }, 2000);
        sseRef.current = { close: () => clearInterval(pollId) };
      }
    }).catch(() => {});
    return () => stopSSE();
  }, []);

  const handleImport = async (e) => {
    e.preventDefault();
    if (!url.trim()) return;
    setImporting(true);
    setProgress(null);
    try {
      await youtubeImport(slug, { url: url.trim() });
    } catch (err) {
      onToast(err.message, 'error');
      setImporting(false);
      return;
    }

    // Poll progress (works reliably on mobile/PWA)
    stopSSE();
    const pollId = setInterval(async () => {
      try {
        const res = await fetch('/api/youtube-import/progress');
        const data = await res.json();
        setProgress(data);
        if (data.done || !data.active) {
          clearInterval(pollId);
          sseRef.current = null;
          setImporting(false);
          if (data.errors && data.errors.length === 0) {
            onToast('YouTube import complete!');
          } else if (data.errors && data.errors.length > 0) {
            onToast(`Import finished with ${data.errors.length} error(s)`, 'error');
          }
          onDone();
        }
      } catch { /* keep polling */ }
    }, 2000);
    sseRef.current = { close: () => clearInterval(pollId) };
  };

  if (!open) {
    return (
      <button className="btn btn-ghost" onClick={() => setOpen(true)} style={{ marginLeft: 8 }}>
        &#9654; Import from YouTube
      </button>
    );
  }

  return (
    <div
      style={{
        background: 'linear-gradient(145deg, #1a1a1a, #202020)',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 16,
        padding: 16,
        marginTop: 16,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <strong style={{ fontSize: 14 }}>Import from YouTube Playlist</strong>
        <button className="btn btn-ghost" onClick={() => { setOpen(false); stopSSE(); }}>Cancel</button>
      </div>
      <form onSubmit={handleImport} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          className="form-input"
          style={{ flex: 1, minWidth: 200 }}
          placeholder="https://www.youtube.com/playlist?list=..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={importing}
          required
        />
        <button className="btn btn-primary" type="submit" disabled={importing || !url.trim()}>
          {importing ? 'Importing...' : 'Import'}
        </button>
      </form>

      {progress && (
        <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text-secondary)' }}>
          <div>{progress.message}</div>
          {progress.total > 0 && (
            <div style={{ marginTop: 6 }}>
              <div
                style={{
                  height: 6,
                  background: 'var(--border)',
                  borderRadius: 3,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${Math.round((progress.current / progress.total) * 100)}%`,
                    height: '100%',
                    background: '#1ed760',
                    transition: 'width 0.3s',
                  }}
                />
              </div>
              <div style={{ marginTop: 4, color: 'var(--text-muted)', fontSize: 12 }}>
                {progress.current} / {progress.total}
              </div>
            </div>
          )}
          {progress.errors && progress.errors.length > 0 && (
            <ul style={{ marginTop: 8, paddingLeft: 16, color: '#e91429', fontSize: 12 }}>
              {progress.errors.map((err, i) => <li key={i}>{err}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function ArtistDetail({ slug, onToast }) {
  const [artist, setArtist] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getArtist(slug);
      setArtist(data);
    } catch (e) {
      onToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [slug, onToast]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async () => {
    if (!window.confirm('Delete this artist and all their tracks?')) return;
    try {
      await deleteArtist(slug);
      onToast('Artist deleted');
      navigate('/artists');
    } catch (e) {
      onToast(e.message, 'error');
    }
  };

  const uploadFiles = async (files) => {
    const mp3s = files.filter((f) => f.name.toLowerCase().endsWith('.mp3'));
    if (mp3s.length === 0) { onToast('Only MP3 files accepted', 'error'); return; }
    setUploading(true);
    try {
      await uploadTracks(slug, mp3s);
      onToast(mp3s.length + ' track(s) uploaded');
      load();
    } catch (e) {
      onToast(e.message, 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    uploadFiles([...e.dataTransfer.files]);
  };

  const handleFileInput = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      uploadFiles([...e.target.files]);
    }
  };

  const handleRemoveTrack = async (filename) => {
    try {
      await deleteTrack(slug, filename);
      onToast('Track removed');
      load();
    } catch (e) {
      onToast(e.message, 'error');
    }
  };

  if (loading) return <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading...</div>;
  if (!artist) return null;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">
          <span
            style={{ color: 'var(--text-secondary)', cursor: 'pointer', textDecoration: 'none' }}
            onClick={() => navigate('/artists')}
          >
            Artists
          </span>
          {' / '}
          {artist.name}
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-danger" onClick={handleDelete}>Delete Artist</button>
        </div>
      </div>

      <YoutubeImportPanel slug={slug} onToast={onToast} onDone={load} />

      <div
        className={`drop-zone${dragOver ? ' drag-over' : ''}`}
        style={{ cursor: uploading ? 'wait' : 'pointer', marginTop: 16 }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !uploading && fileInputRef.current?.click()}
      >
        {uploading ? 'Uploading...' : 'Drop MP3 files here to upload, or click to browse'}
        <input
          ref={fileInputRef}
          type="file"
          accept=".mp3,audio/mpeg"
          multiple
          style={{ display: 'none' }}
          onChange={handleFileInput}
        />
      </div>

      {artist.tracks && artist.tracks.length > 0 ? (
        <div style={{ marginTop: 16 }}>
          {artist.tracks.map((t) => (
            <div key={t} className="list-item">
              <div>
                <div className="list-item-title">{t}</div>
              </div>
              <button className="btn btn-ghost" onClick={() => handleRemoveTrack(t)}>Remove</button>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ marginTop: 16, color: 'var(--text-muted)', fontSize: 13 }}>
          No tracks uploaded yet.
        </div>
      )}
    </div>
  );
}

export default function Artists({ onToast }) {
  const { slug } = useParams();

  if (slug) {
    return <ArtistDetail slug={slug} onToast={onToast} />;
  }
  return <ArtistList onToast={onToast} />;
}
