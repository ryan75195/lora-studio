import { useState } from 'react';
import Modal from './Modal.jsx';
import CoverGenerate from './CoverGenerate.jsx';
import CoverExisting from './CoverExisting.jsx';

const TABS = [
  { id: 'generate', label: 'Generate New' },
  { id: 'existing', label: 'Use Existing' },
];

export default function CoverModal({ albumId, open, onClose, onToast, onDone, existingPrompt = '' }) {
  const [tab, setTab] = useState('generate');

  const handleClose = () => {
    setTab('generate');
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Album Cover"
      width={640}
    >
      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid #333', marginBottom: 16 }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 600,
              background: 'none', border: 'none', cursor: 'pointer',
              color: tab === t.id ? '#1ed760' : '#666',
              borderBottom: tab === t.id ? '2px solid #1ed760' : '2px solid transparent',
              transition: 'all 0.15s',
            }}
          >{t.label}</button>
        ))}
      </div>

      {tab === 'generate' && (
        <CoverGenerate
          albumId={albumId}
          existingPrompt={existingPrompt}
          onToast={onToast}
          onDone={onDone}
          onClose={handleClose}
        />
      )}

      {tab === 'existing' && (
        <CoverExisting
          albumId={albumId}
          onToast={onToast}
          onDone={onDone}
          onClose={handleClose}
        />
      )}
    </Modal>
  );
}
