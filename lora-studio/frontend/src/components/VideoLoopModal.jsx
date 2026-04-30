import { useState, useEffect, useRef } from 'react';
import Modal from './Modal.jsx';
import { generateVideoLoop, getVideoLoopStatus } from '../api.js';

export default function VideoLoopModal({ albumId, open, onClose, onToast, onDone, existingLoopUrl }) {
  const [phase, setPhase] = useState('prompt');
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [loopUrl, setLoopUrl] = useState(existingLoopUrl || '');
  const [error, setError] = useState('');
  const pollRef = useRef(null);

  useEffect(() => {
    if (open && existingLoopUrl) setLoopUrl(existingLoopUrl);
  }, [open, existingLoopUrl]);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const handleGenerate = async () => {
    if (!prompt.trim()) { onToast('Enter an animation prompt', 'error'); return; }
    setGenerating(true);
    setError('');
    setPhase('generating');

    try {
      await generateVideoLoop(albumId, { prompt: prompt.trim() });
    } catch (e) {
      setError(e.message);
      setGenerating(false);
      setPhase('prompt');
      return;
    }

    pollRef.current = setInterval(async () => {
      try {
        const status = await getVideoLoopStatus(albumId);
        if (status.status === 'done' && status.loop_url) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setLoopUrl(status.loop_url);
          setGenerating(false);
          setPhase('preview');
          onToast('Video loop generated!');
        } else if (status.status === 'failed') {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setError(status.message || 'Generation failed');
          setGenerating(false);
          setPhase('prompt');
          onToast(status.message || 'Generation failed', 'error');
        }
      } catch {}
    }, 10000);
  };

  const handleAccept = () => {
    onDone();
    handleClose();
  };

  const handleClose = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    setPhase('prompt');
    setGenerating(false);
    setError('');
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} title="Video Loop" width={560}>

      {phase === 'prompt' && loopUrl && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#666', fontWeight: 600, marginBottom: 8 }}>
            Current loop
          </div>
          <video
            src={loopUrl}
            autoPlay loop muted playsInline
            style={{ width: '100%', borderRadius: 12, background: '#111' }}
          />
        </div>
      )}

      {phase === 'prompt' && (
        <div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#a7a7a7', marginBottom: 6, fontWeight: 600 }}>
              Animation Prompt
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="subtle atmospheric animation, gentle light shifts, soft ambient glow"
              style={{
                width: '100%', background: '#2a2a2a', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8, padding: '10px 14px', fontSize: 14, color: '#fff',
                outline: 'none', fontFamily: 'inherit', resize: 'vertical', minHeight: 80,
                boxSizing: 'border-box',
              }}
            />
            <p style={{ fontSize: 12, color: '#555', marginTop: 6 }}>
              Describe the subtle animation you want. Camera stays fixed — only the scene animates.
            </p>
          </div>
          {error && <div style={{ color: '#ef4444', fontSize: 13, marginBottom: 12 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={handleClose} style={{ padding: '10px 20px', borderRadius: 20, border: '1px solid #333', background: 'none', color: '#a7a7a7', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
            <button
              onClick={handleGenerate}
              disabled={!prompt.trim()}
              style={{
                padding: '10px 24px', borderRadius: 20, border: 'none',
                background: prompt.trim() ? '#1ed760' : '#2a2a2a',
                color: prompt.trim() ? '#000' : '#555',
                fontSize: 14, fontWeight: 700, cursor: prompt.trim() ? 'pointer' : 'not-allowed',
              }}
            >Generate Loop</button>
          </div>
        </div>
      )}

      {phase === 'generating' && (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <div style={{
            width: 48, height: 48, borderRadius: '50%', border: '3px solid #333', borderTopColor: '#1ed760',
            animation: 'spin 1s linear infinite', margin: '0 auto 20px',
          }} />
          <div style={{ fontSize: 16, color: '#fff', fontWeight: 600, marginBottom: 8 }}>
            Generating video loop...
          </div>
          <div style={{ fontSize: 13, color: '#666' }}>
            This takes about 2 minutes. You can leave this open.
          </div>
        </div>
      )}

      {phase === 'preview' && loopUrl && (
        <div>
          <video
            src={loopUrl + '&t=' + Date.now()}
            autoPlay loop muted playsInline
            style={{ width: '100%', borderRadius: 12, background: '#111', marginBottom: 16 }}
          />
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={() => setPhase('prompt')} style={{ padding: '10px 20px', borderRadius: 20, border: '1px solid #333', background: 'none', color: '#a7a7a7', fontSize: 13, cursor: 'pointer' }}>Try different prompt</button>
            <button onClick={handleGenerate} style={{ padding: '10px 20px', borderRadius: 20, border: '1px solid #333', background: 'none', color: '#a7a7a7', fontSize: 13, cursor: 'pointer' }}>Regenerate</button>
            <button onClick={handleAccept} style={{ padding: '10px 24px', borderRadius: 20, border: 'none', background: '#1ed760', color: '#000', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Accept</button>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Modal>
  );
}
