import { useState, useEffect, useCallback, useRef } from 'react';
import { getArtists, getLoras, startTrain } from '../api.js';

const LORA_GRADIENTS = [
  ['#0d1f0d', '#132013'],
  ['#0d1520', '#132030'],
  ['#20100d', '#301813'],
  ['#1a0d20', '#281330'],
];

function getLoraGradient(name) {
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i);
    hash |= 0;
  }
  return LORA_GRADIENTS[Math.abs(hash) % LORA_GRADIENTS.length];
}

export default function Train({ onToast }) {
  const [artists, setArtists] = useState([]);
  const [loras, setLoras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedSlugs, setSelectedSlugs] = useState([]);
  const [loraName, setLoraName] = useState('');
  const [training, setTraining] = useState(false);
  const [trainMessage, setTrainMessage] = useState('');
  const [trainProgress, setTrainProgress] = useState(0);
  const evtRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, l] = await Promise.all([getArtists(), getLoras()]);
      setArtists(a);
      setLoras(l);
    } catch (e) {
      onToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  // Poll-based training status (works reliably on mobile/PWA)
  const pollRef = useRef(null);

  const handleTrainData = useCallback((data) => {
    let msg = data.message || '';
    if (data.eta_seconds && data.eta_seconds > 0) {
      const mins = Math.floor(data.eta_seconds / 60);
      const secs = data.eta_seconds % 60;
      msg += ` — ETA: ${mins}m ${secs}s`;
    }
    setTrainMessage(msg);
    if (data.phase_total > 0 && data.phase_progress >= 0) {
      setTrainProgress(Math.round((data.phase_progress / data.phase_total) * 100));
    }
    if (data.error) {
      onToast('Training failed: ' + data.error, 'error');
      stopPolling();
      setTraining(false);
    } else if (!data.active && training) {
      if (data.message === 'Done!') onToast('Training complete!');
      stopPolling();
      setTraining(false);
      setTrainMessage('');
      setTrainProgress(0);
      load();
    }
  }, [onToast, load, training]);

  const startPolling = useCallback(() => {
    stopPolling();
    setTraining(true);
    const poll = async () => {
      try {
        const res = await fetch('/api/train/progress');
        const data = await res.json();
        handleTrainData(data);
      } catch { /* network error, keep polling */ }
    };
    poll();
    pollRef.current = setInterval(poll, 2000);
  }, [handleTrainData]);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  useEffect(() => {
    load();
    // Check if training is already running
    fetch('/api/train/progress').then(r => r.json()).then(data => {
      if (data.active) startPolling();
    }).catch(() => {});
    return () => stopPolling();
  }, [load, startPolling]);

  const toggleChip = (slug) => {
    setSelectedSlugs((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    );
  };

  const handleTrain = async () => {
    if (selectedSlugs.length === 0) {
      onToast('Select at least one artist', 'error');
      return;
    }
    setTraining(true);
    setTrainMessage('Starting...');
    setTrainProgress(0);

    try {
      await startTrain({ artists: selectedSlugs, name: loraName.trim() });
      startPolling();
    } catch (e) {
      onToast(e.message, 'error');
      setTraining(false);
      setTrainMessage('');
    }
  };

  const formatDate = (str) => {
    if (!str) return '';
    return new Date(str).toLocaleDateString();
  };

  const canTrain = !training && selectedSlugs.length > 0;

  return (
    <div>
      {/* Training status pill — always visible when active */}
      {training && (
        <div
          style={{
            background: 'rgba(30,215,96,0.08)',
            border: '1px solid rgba(30,215,96,0.2)',
            borderRadius: 14,
            padding: '12px 16px',
            marginBottom: 16,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#1ed760', animation: 'pulse 1.5s ease-in-out infinite' }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: '#1ed760' }}>Training</span>
            </div>
            {trainProgress > 0 && (
              <span style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>{trainProgress}%</span>
            )}
          </div>
          <div style={{ height: 4, background: '#222', borderRadius: 2, overflow: 'hidden', marginBottom: 6 }}>
            <div
              style={{
                width: trainProgress > 0 ? trainProgress + '%' : '100%',
                height: '100%',
                background: '#1ed760',
                borderRadius: 2,
                transition: 'width 0.5s',
                animation: trainProgress === 0 ? 'pulse 1.5s ease-in-out infinite' : 'none',
              }}
            />
          </div>
          <div style={{ fontSize: 12, color: '#a7a7a7', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {trainMessage || 'Training in progress...'}
          </div>
        </div>
      )}

      <h1 className="page-title" style={{ marginBottom: 20 }}>Train LoRA</h1>

      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading...</div>
      ) : (
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          {/* Left: Train form */}
          <div style={{ flex: 1, minWidth: 280 }}>
            {/* Artist chips section */}
            <div
              style={{
                background: 'linear-gradient(145deg, #181818, #1f1f1f)',
                borderRadius: 16,
                padding: '16px 16px 10px',
                marginBottom: 16,
                border: '1px solid rgba(255,255,255,0.05)',
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: '#666',
                  marginBottom: 12,
                }}
              >
                Select artists to mix
              </div>

              {artists.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: 13, paddingBottom: 6 }}>
                  No artists yet. Add artists first.
                </div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 0 }}>
                  {artists.map((a) => (
                    <span
                      key={a.slug}
                      className={`chip${selectedSlugs.includes(a.slug) ? ' selected' : ''}`}
                      onClick={() => toggleChip(a.slug)}
                    >
                      {a.name}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* LoRA name input */}
            <div
              style={{
                background: 'linear-gradient(145deg, #181818, #1f1f1f)',
                borderRadius: 16,
                padding: '16px',
                marginBottom: 16,
                border: '1px solid rgba(255,255,255,0.05)',
              }}
            >
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">LoRA Name</label>
                <input
                  className="form-input"
                  placeholder="auto-generated if empty"
                  value={loraName}
                  onChange={(e) => setLoraName(e.target.value)}
                  disabled={training}
                />
              </div>
            </div>

            {/* Train button — full width on mobile */}
            <button
              onClick={handleTrain}
              disabled={!canTrain}
              style={{
                width: '100%',
                padding: '14px 20px',
                borderRadius: 28,
                border: 'none',
                background: canTrain ? '#1ed760' : '#2a2a2a',
                color: canTrain ? '#000' : '#555',
                fontSize: 15,
                fontWeight: 700,
                cursor: canTrain ? 'pointer' : 'not-allowed',
                transition: 'all 0.15s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                minHeight: 52,
              }}
            >
              {training ? (
                <>
                  <span style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid rgba(0,0,0,0.3)', borderTopColor: '#000', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />
                  Training...
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                  </svg>
                  Train LoRA
                </>
              )}
            </button>

            {/* Training progress shown at top of page */}
          </div>

          {/* Right: Existing LoRAs */}
          <div style={{ flex: 1, minWidth: 280 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: '#666',
                marginBottom: 12,
              }}
            >
              Trained LoRAs
            </div>

            {loras.length === 0 ? (
              <div
                style={{
                  background: 'linear-gradient(145deg, #181818, #1f1f1f)',
                  borderRadius: 16,
                  padding: '20px 16px',
                  color: 'var(--text-muted)',
                  fontSize: 13,
                  border: '1px solid rgba(255,255,255,0.05)',
                  textAlign: 'center',
                }}
              >
                No LoRAs trained yet.
              </div>
            ) : (
              loras.map((l) => {
                const [g1, g2] = getLoraGradient(l.name);
                return (
                  <div
                    key={l.name}
                    style={{
                      background: `linear-gradient(145deg, ${g1}, ${g2})`,
                      borderRadius: 14,
                      padding: '14px 16px',
                      marginBottom: 10,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      border: '1px solid rgba(30,215,96,0.08)',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 3 }}>
                        {l.name}
                      </div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                        {l.size_mb}MB · {formatDate(l.created_at)}
                      </div>
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '4px 10px',
                        borderRadius: 20,
                        background: 'rgba(30,215,96,0.12)',
                        color: '#1ed760',
                        border: '1px solid rgba(30,215,96,0.2)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Ready
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
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
