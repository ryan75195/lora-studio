import { useState, useEffect } from 'react';
import { getAllCovers, selectCover } from '../api.js';
import CoverGrid from './CoverGrid.jsx';

export default function CoverExisting({ albumId, onToast, onDone, onClose }) {
  const [covers, setCovers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [selecting, setSelecting] = useState(false);

  useEffect(() => {
    getAllCovers()
      .then((data) => setCovers(data.filter((c) => c.album_id !== albumId)))
      .catch((e) => onToast(e.message, 'error'))
      .finally(() => setLoading(false));
  }, [albumId, onToast]);

  const handleSelect = async () => {
    if (selectedIndex === null) return;
    const cover = covers[selectedIndex];
    setSelecting(true);
    try {
      await selectCover(albumId, { source_album_id: cover.album_id });
      onToast('Cover applied!');
      onDone();
      onClose();
    } catch (e) {
      onToast(e.message, 'error');
    } finally {
      setSelecting(false);
    }
  };

  if (loading) {
    return <div style={{ padding: '40px 0', textAlign: 'center', color: '#555', fontSize: 13 }}>Loading covers...</div>;
  }

  if (covers.length === 0) {
    return <div style={{ padding: '40px 0', textAlign: 'center', color: '#555', fontSize: 13 }}>No other albums have covers yet. Generate one first!</div>;
  }

  const images = covers.map((c) => ({ url: c.cover_url, label: c.album_name }));

  return (
    <div>
      <CoverGrid images={images} selectedIndex={selectedIndex} onSelect={setSelectedIndex} columns={3} />
      <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
        <button
          onClick={onClose}
          style={{ padding: '10px 20px', borderRadius: 20, border: '1px solid #333', background: 'none', color: '#a7a7a7', fontSize: 13, cursor: 'pointer' }}
        >Cancel</button>
        <button
          onClick={handleSelect}
          disabled={selectedIndex === null || selecting}
          style={{
            padding: '10px 24px', borderRadius: 20, border: 'none',
            background: selectedIndex !== null && !selecting ? '#1ed760' : '#2a2a2a',
            color: selectedIndex !== null && !selecting ? '#000' : '#555',
            fontSize: 14, fontWeight: 700, cursor: selectedIndex !== null && !selecting ? 'pointer' : 'not-allowed',
          }}
        >{selecting ? 'Applying...' : 'Use This Cover'}</button>
      </div>
    </div>
  );
}
