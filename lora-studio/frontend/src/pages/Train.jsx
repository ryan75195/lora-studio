import { useState, useEffect, useCallback, useRef } from 'react';
import { getArtists, getLoras, startTrain } from '../api.js';

function useIsMobile(breakpoint = 769) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < breakpoint);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [breakpoint]);
  return isMobile;
}

export default function Train({ onToast }) {
  const [artists, setArtists] = useState([]);
  const [loras, setLoras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedSlugs, setSelectedSlugs] = useState([]);
  const [loraName, setLoraName] = useState('');
  const [training, setTraining] = useState(false);
  const [trainData, setTrainData] = useState(null);
  const pollRef = useRef(null);
  const isMobile = useIsMobile();

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

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const handleTrainData = useCallback((data) => {
    setTrainData(data);
    if (data.error) {
      onToast('Training failed: ' + data.error, 'error');
      stopPolling();
      setTraining(false);
    } else if (!data.active && training) {
      if (data.message === 'Done!') onToast('Training complete!');
      stopPolling();
      setTraining(false);
      setTrainData(null);
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
      } catch {}
    };
    poll();
    pollRef.current = setInterval(poll, 2000);
  }, [handleTrainData]);

  useEffect(() => {
    load();
    fetch('/api/train/progress').then(r => r.json()).then(data => {
      if (data.active) startPolling();
    }).catch(() => {});
    return () => stopPolling();
  }, [load, startPolling]);

  const toggleArtist = (slug) => {
    setSelectedSlugs(prev =>
      prev.includes(slug) ? prev.filter(s => s !== slug) : [...prev, slug]
    );
  };

  const handleTrain = async () => {
    if (selectedSlugs.length === 0) { onToast('Select at least one artist', 'error'); return; }

    // Check if a LoRA with this name already exists
    const name = loraName.trim() || selectedSlugs.join('-');
    const existing = loras.find(l => l.name === name);
    if (existing && !confirm(`A LoRA called "${name}" already exists (trained ${new Date(existing.created_at).toLocaleDateString()}). This will retrain from scratch and overwrite it. Continue?`)) {
      return;
    }

    setTraining(true);
    setTrainData({ active: true, message: 'Starting...', phase: 'starting', phase_progress: 0, phase_total: 0 });
    try {
      await startTrain({ artists: selectedSlugs, name: loraName.trim() });
      startPolling();
    } catch (e) {
      onToast(e.message, 'error');
      setTraining(false);
      setTrainData(null);
    }
  };

  const handleCancel = async () => {
    try {
      const res = await fetch('/api/train/cancel', { method: 'POST' });
      const data = await res.json();
      onToast(data.message || 'Cancelling...');
    } catch (e) {
      onToast(e.message, 'error');
    }
  };

  const canTrain = !training && selectedSlugs.length > 0;

  // Phase display helpers
  const phaseLabel = (phase) => {
    switch (phase) {
      case 'starting': return 'Starting';
      case 'loading': return 'Loading models';
      case 'labeling': return 'Labeling tracks';
      case 'preprocessing': return 'Preprocessing audio';
      case 'training': return 'Training LoRA';
      default: return phase || 'Working';
    }
  };

  const phaseIcon = (phase) => {
    switch (phase) {
      case 'starting': return '...';
      case 'loading': return '1';
      case 'labeling': return '2';
      case 'preprocessing': return '3';
      case 'training': return '4';
      default: return '-';
    }
  };

  const phases = ['loading', 'labeling', 'preprocessing', 'training'];

  const formatEta = (seconds) => {
    if (!seconds || seconds <= 0) return '';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s remaining` : `${s}s remaining`;
  };

  const pct = trainData?.phase_total > 0
    ? Math.round((trainData.phase_progress / trainData.phase_total) * 100)
    : 0;

  /* ==================== TRAINING DASHBOARD ==================== */
  const trainingDashboard = training && trainData && (
    <div style={{
      background: '#111', borderRadius: 20, padding: isMobile ? 20 : 28,
      border: '1px solid rgba(30,215,96,0.15)', marginBottom: 24,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 10, height: 10, borderRadius: '50%', background: '#1ed760',
            animation: 'pulse 1.5s ease-in-out infinite',
          }} />
          <span style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Training in Progress</span>
        </div>
        <button
          onClick={handleCancel}
          style={{
            padding: '6px 16px', borderRadius: 10, border: '1px solid rgba(239,68,68,0.3)',
            background: 'rgba(239,68,68,0.08)', color: '#ef4444', fontSize: 12,
            fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.15)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.08)'; }}
        >Cancel</button>
      </div>

      {/* Phase steps */}
      <div style={{
        display: 'flex', gap: isMobile ? 4 : 8, marginBottom: 20,
      }}>
        {phases.map((p) => {
          const currentIdx = phases.indexOf(trainData?.phase);
          const thisIdx = phases.indexOf(p);
          const isActive = p === trainData?.phase;
          const isDone = thisIdx < currentIdx;
          return (
            <div key={p} style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
            }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700,
                background: isDone ? '#1ed760' : isActive ? 'rgba(30,215,96,0.2)' : '#1a1a1a',
                color: isDone ? '#000' : isActive ? '#1ed760' : '#444',
                border: isActive ? '2px solid #1ed760' : '2px solid transparent',
                transition: 'all 0.3s',
              }}>
                {isDone ? (
                  <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 14, height: 14 }}><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>
                ) : phaseIcon(p)}
              </div>
              <span style={{
                fontSize: 10, fontWeight: 600, color: isActive ? '#1ed760' : isDone ? '#555' : '#333',
                textAlign: 'center', lineHeight: 1.2,
              }}>
                {phaseLabel(p)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{phaseLabel(trainData?.phase)}</span>
          {pct > 0 && <span style={{ fontSize: 13, fontWeight: 600, color: '#1ed760' }}>{pct}%</span>}
        </div>
        <div style={{ height: 6, background: '#1a1a1a', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{
            width: pct > 0 ? pct + '%' : '100%',
            height: '100%', background: '#1ed760', borderRadius: 3,
            transition: 'width 0.5s',
            animation: pct === 0 ? 'pulse 1.5s ease-in-out infinite' : 'none',
          }} />
        </div>
      </div>

      {/* Status details */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, color: '#888' }}>
          {trainData?.message || 'Working...'}
        </div>
        {trainData?.eta_seconds > 0 && (
          <div style={{ fontSize: 12, color: '#1ed760', fontWeight: 600 }}>
            {formatEta(trainData.eta_seconds)}
          </div>
        )}
      </div>

      {/* Track count + step info */}
      {(trainData?.track_count > 0 || trainData?.step > 0) && (
        <div style={{
          display: 'flex', gap: 12, marginTop: 14, paddingTop: 14,
          borderTop: '1px solid rgba(255,255,255,0.06)',
        }}>
          {trainData?.track_count > 0 && (
            <div style={{
              background: '#161616', borderRadius: 10, padding: '8px 14px',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
            }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>{trainData.track_count}</span>
              <span style={{ fontSize: 10, color: '#555' }}>tracks</span>
            </div>
          )}
          {trainData?.phase === 'training' && trainData?.step > 0 && (
            <div style={{
              background: '#161616', borderRadius: 10, padding: '8px 14px',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
            }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>
                {trainData.step}<span style={{ fontSize: 12, color: '#555' }}>/{trainData.total}</span>
              </span>
              <span style={{ fontSize: 10, color: '#555' }}>steps</span>
            </div>
          )}
        </div>
      )}
    </div>
  );

  /* ==================== ARTIST SELECTION ==================== */
  const artistSelection = (
    <div style={{ marginBottom: 24 }}>
      <div style={{
        fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
        letterSpacing: '0.08em', color: '#555', marginBottom: 12,
      }}>
        Select artists to train on
      </div>

      {artists.length === 0 ? (
        <div style={{
          background: '#161616', borderRadius: 14, padding: '24px 16px',
          color: '#555', fontSize: 13, textAlign: 'center',
        }}>
          No artists yet. Add some artists with training tracks first.
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: 8,
        }}>
          {artists.map((a) => {
            const selected = selectedSlugs.includes(a.slug);
            return (
              <button
                key={a.slug}
                onClick={() => toggleArtist(a.slug)}
                disabled={training}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 14px', borderRadius: 12, cursor: training ? 'not-allowed' : 'pointer',
                  background: selected ? 'rgba(30,215,96,0.08)' : '#161616',
                  border: selected ? '1px solid rgba(30,215,96,0.3)' : '1px solid rgba(255,255,255,0.06)',
                  transition: 'all 0.15s', textAlign: 'left', width: '100%',
                }}
              >
                {/* Checkbox */}
                <div style={{
                  width: 20, height: 20, borderRadius: 6, flexShrink: 0,
                  background: selected ? '#1ed760' : 'transparent',
                  border: selected ? 'none' : '2px solid #333',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.15s',
                }}>
                  {selected && (
                    <svg viewBox="0 0 24 24" fill="#000" style={{ width: 14, height: 14 }}>
                      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                    </svg>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 14, fontWeight: 600,
                    color: selected ? '#fff' : '#aaa',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{a.name}</div>
                  <div style={{ fontSize: 11, color: '#555' }}>
                    {a.track_count || '?'} tracks
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  /* ==================== TRAIN FORM ==================== */
  const trainForm = (
    <div style={{
      display: 'flex', gap: 12, alignItems: 'center',
      marginBottom: 24,
    }}>
      <input
        className="form-input"
        placeholder="LoRA name (auto if empty)"
        value={loraName}
        onChange={(e) => setLoraName(e.target.value)}
        disabled={training}
        style={{
          flex: 1, maxWidth: isMobile ? 'none' : 300,
          borderRadius: 12, background: '#161616',
        }}
      />
      <button
        onClick={handleTrain}
        disabled={!canTrain}
        style={{
          padding: '12px 28px', borderRadius: 14, border: 'none',
          background: canTrain ? '#1ed760' : '#2a2a2a',
          color: canTrain ? '#000' : '#555',
          fontSize: 14, fontWeight: 700,
          cursor: canTrain ? 'pointer' : 'not-allowed',
          transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 8,
          whiteSpace: 'nowrap', minHeight: 46,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
        Train
      </button>
    </div>
  );

  /* ==================== LORA LIST ==================== */
  const loraList = (
    <div>
      <div style={{
        fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
        letterSpacing: '0.08em', color: '#555', marginBottom: 12,
      }}>
        Trained models ({loras.length})
      </div>

      {loras.length === 0 ? (
        <div style={{
          background: '#161616', borderRadius: 14, padding: '24px 16px',
          color: '#555', fontSize: 13, textAlign: 'center',
        }}>
          No LoRAs trained yet. Select artists above and hit Train.
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 10,
        }}>
          {loras.map((l) => (
            <div
              key={l.name}
              style={{
                background: '#161616', borderRadius: 14, padding: '14px 16px',
                border: '1px solid rgba(255,255,255,0.06)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{
                  fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 3,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {l.name}
                </div>
                <div style={{ fontSize: 11, color: '#555' }}>
                  {l.size_mb}MB · {new Date(l.created_at).toLocaleDateString()}
                </div>
              </div>
              <div style={{
                fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 20,
                background: 'rgba(30,215,96,0.1)', color: '#1ed760',
                border: '1px solid rgba(30,215,96,0.15)', whiteSpace: 'nowrap', flexShrink: 0,
              }}>
                Ready
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  /* ==================== RENDER ==================== */
  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
      <div style={{ width: 24, height: 24, borderRadius: '50%', border: '2px solid #333', borderTopColor: '#1ed760', animation: 'spin 0.7s linear infinite' }} />
    </div>
  );

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#fff', marginBottom: 20 }}>Train</h1>

      {trainingDashboard}
      {!training && artistSelection}
      {!training && trainForm}
      {loraList}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
