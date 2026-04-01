import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getQueue } from '../api.js';
import BuildForm from '../components/BuildForm.jsx';
import PlaylistBuilder from '../components/PlaylistBuilder.jsx';
import ReviewPanel from '../components/ReviewPanel.jsx';
import QueueSection from '../components/QueueSection.jsx';

function useIsMobile(breakpoint = 769) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < breakpoint);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [breakpoint]);
  return isMobile;
}

export default function Generate({ onToast }) {
  const [draftId, setDraftId] = useState(null);
  const [queueCount, setQueueCount] = useState(0);
  const [showMobileQueue, setShowMobileQueue] = useState(false);
  const [mode, setMode] = useState('song'); // 'song' | 'album'
  const navigate = useNavigate();
  const params = useParams();
  const reviewId = params.draftId || draftId;
  const isMobile = useIsMobile();

  useEffect(() => {
    const check = async () => {
      try {
        const jobs = await getQueue();
        const active = jobs.filter(j => !['accepted', 'discarded'].includes(j.status));
        setQueueCount(active.length);
      } catch {}
    };
    check();
    const id = setInterval(check, 4000);
    return () => clearInterval(id);
  }, []);

  const handleBack = () => {
    if (params.draftId) navigate('/generate');
    else setDraftId(null);
  };

  const handleAccepted = () => {
    setDraftId(null);
    navigate('/library');
  };

  if (reviewId) {
    return <ReviewPanel draftId={reviewId} onToast={onToast} onBack={handleBack} onAccepted={handleAccepted} />;
  }

  // Mode toggle pill
  const ModeToggle = () => (
    <div style={{
      display: 'flex', gap: 4, padding: 3, background: '#111', borderRadius: 14,
      border: '1px solid rgba(255,255,255,0.06)', alignSelf: 'flex-start',
    }}>
      {[
        { id: 'song', label: 'Song' },
        { id: 'album', label: 'Auto Album' },
      ].map((m) => (
        <button
          key={m.id}
          onClick={() => setMode(m.id)}
          style={{
            padding: '8px 16px', borderRadius: 11, border: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: 600, transition: 'all 0.15s',
            background: mode === m.id ? '#1ed760' : 'transparent',
            color: mode === m.id ? '#000' : '#888',
          }}
        >{m.label}</button>
      ))}
    </div>
  );

  // Mobile layout
  if (isMobile) {
    return (
      <div>
        <ModeToggle />
        <div style={{ height: 12 }} />
        {queueCount > 0 && (
          <button
            onClick={() => setShowMobileQueue(!showMobileQueue)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 14px', marginBottom: 12,
              background: showMobileQueue ? 'rgba(30,215,96,0.1)' : '#181818',
              border: showMobileQueue ? '1px solid rgba(30,215,96,0.3)' : '1px solid #222',
              borderRadius: 20, color: showMobileQueue ? '#1ed760' : '#a7a7a7',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Queue
            <span style={{ background: '#1ed760', color: '#000', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10 }}>
              {queueCount}
            </span>
          </button>
        )}
        {showMobileQueue && <QueueSection onToast={onToast} />}
        {mode === 'song' ? (
          <BuildForm onToast={onToast} />
        ) : (
          <div style={{ background: '#111', borderRadius: 20, border: '1px solid rgba(255,255,255,0.06)', minHeight: 400 }}>
            <PlaylistBuilder onToast={onToast} onDone={() => navigate('/library')} />
          </div>
        )}
      </div>
    );
  }

  // Desktop: 3-column layout
  return (
    <div className="full-vh" style={{ display: 'flex', height: 'calc(100vh - 72px)', overflow: 'hidden' }}>
      {/* Left: Queue panel */}
      {queueCount > 0 && (
        <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid #1a1a1a', overflowY: 'auto', padding: '20px 16px', background: '#0d0d0d' }}>
          <QueueSection onToast={onToast} />
        </div>
      )}

      {/* Main content */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Mode toggle bar */}
        <div style={{ padding: '16px 32px 0', flexShrink: 0 }}>
          <ModeToggle />
        </div>

        {/* Builder */}
        <div style={{ flex: 1, minHeight: 0 }}>
          {mode === 'song' ? (
            <BuildForm onToast={onToast} />
          ) : (
            <div style={{ height: '100%', padding: '16px 32px 24px' }}>
              <div style={{ height: '100%', background: '#111', borderRadius: 20, border: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column' }}>
                <PlaylistBuilder onToast={onToast} onDone={() => navigate('/library')} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
