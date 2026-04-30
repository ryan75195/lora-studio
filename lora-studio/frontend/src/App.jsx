import { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import './App.css';
import { useToast } from './hooks/useToast.js';
import Sidebar from './components/Sidebar.jsx';
import NowPlaying from './components/NowPlaying.jsx';
import FullPlayer from './components/FullPlayer.jsx';
import Toast from './components/Toast.jsx';
import Artists from './pages/Artists.jsx';
import Train from './pages/Train.jsx';
import Generate from './pages/Generate.jsx';
import Library from './pages/Library.jsx';
import Setup from './pages/Setup.jsx';

function ModelLoadingScreen({ message }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#0f0f0f', zIndex: 9999,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 20,
    }}>
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#1ed760" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      </svg>
      <div style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>LoRA Studio</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 20, height: 20, borderRadius: '50%',
          border: '2px solid #333', borderTopColor: '#1ed760',
          animation: 'spin 0.8s linear infinite',
        }} />
        <div style={{ fontSize: 14, color: '#888' }}>{message}</div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function RvcDemo() {
  const tracks = [
    { id: 'original', label: 'ORIGINAL', title: 'Last Dance Home — Full Song', desc: 'Original ACE-Step generation', green: false },
    { id: 'vocals-before', label: 'EXTRACTED', title: 'Vocals Only (before conversion)', desc: 'Demucs-separated vocals', green: false },
    { id: 'vocals-after-v1', label: 'V1 (98 epochs)', title: 'Vocals — First Attempt', desc: '98 epochs, 11 tracks — barely trained', green: false },
    { id: 'vocals-after', label: 'V2 (800 epochs)', title: 'Vocals — Proper Training', desc: '800 epochs, 24 tracks, GPU trained', green: true },
    { id: 'final-v1', label: 'V1 FINAL MIX', title: 'V1 Mix (98 epochs)', desc: 'First attempt remixed', green: false },
    { id: 'final', label: 'V2 FINAL MIX', title: 'V2 Mix (800 epochs)', desc: 'Proper training remixed', green: true },
  ];
  return (
    <div style={{ maxWidth: 700, margin: '0 auto' }}>
      <h1 style={{ color: '#1ed760', fontSize: 24, marginBottom: 8 }}>RVC Voice Conversion PoC</h1>
      <p style={{ color: '#888', fontSize: 13, marginBottom: 24 }}>Clapton voice model. Compare original vs converted vocals.</p>
      {tracks.map(t => (
        <div key={t.id} style={{ background: '#1a1a1a', borderRadius: 16, padding: 16, marginBottom: 12 }}>
          <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 10, fontSize: 11, fontWeight: 600, marginBottom: 8, background: t.green ? 'rgba(30,215,96,0.15)' : 'rgba(255,255,255,0.1)', color: t.green ? '#1ed760' : '#888' }}>{t.label}</span>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#fff', marginBottom: 4 }}>{t.title}</div>
          <div style={{ fontSize: 12, color: '#666', marginBottom: 10 }}>{t.desc}</div>
          <audio controls preload="none" src={`/api/rvc-poc/${t.id}`} style={{ width: '100%', height: 40 }} />
        </div>
      ))}
    </div>
  );
}

function SetupGate({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [checked, setChecked] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [modelsReady, setModelsReady] = useState(false);
  const [modelMessage, setModelMessage] = useState('Starting...');

  useEffect(() => {
    if (location.pathname === '/setup') {
      setChecked(true);
      return;
    }

    fetch('/api/setup/status')
      .then(r => r.json())
      .then(data => {
        if (!data.setup_complete) {
          setNeedsSetup(true);
          navigate('/setup', { replace: true });
        }
        setChecked(true);
      })
      .catch(() => { setChecked(true); });
  }, [location.pathname, navigate]);

  // Poll model status
  useEffect(() => {
    if (needsSetup || location.pathname === '/setup') return;

    const poll = () => {
      fetch('/api/model-status')
        .then(r => r.json())
        .then(data => {
          setModelMessage(data.message || 'Loading...');
          if (data.ready) setModelsReady(true);
        })
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, [needsSetup, location.pathname]);

  if (!checked) return null;
  if (needsSetup && location.pathname !== '/setup') return null;
  if (checked && !needsSetup && !modelsReady && location.pathname !== '/setup') {
    return <ModelLoadingScreen message={modelMessage} />;
  }
  return children;
}

function AppLayout() {
  const { toast, showToast } = useToast();
  const [fullPlayerOpen, setFullPlayerOpen] = useState(false);
  const location = useLocation();

  const isSetup = location.pathname === '/setup';

  if (isSetup) {
    return (
      <Routes>
        <Route path="/setup" element={<Setup />} />
      </Routes>
    );
  }

  return (
    <>
      <Sidebar />
      <div id="content">
        <Routes>
          <Route path="/" element={<Navigate to="/artists" replace />} />
          <Route path="/artists" element={<Artists onToast={showToast} />} />
          <Route path="/artists/:slug" element={<Artists onToast={showToast} />} />
          <Route path="/train" element={<Train onToast={showToast} />} />
          <Route path="/generate" element={<Generate onToast={showToast} />} />
          <Route path="/generate/review/:draftId" element={<Generate onToast={showToast} />} />
          <Route path="/library" element={<Library onToast={showToast} />} />
          {/* RVC demo shelved */}
          <Route path="/setup" element={<Setup />} />
          <Route path="*" element={<Navigate to="/artists" replace />} />
        </Routes>
      </div>
      <NowPlaying onExpand={() => setFullPlayerOpen(true)} />
      <FullPlayer open={fullPlayerOpen} onClose={() => setFullPlayerOpen(false)} />
      <Toast toast={toast} />
    </>
  );
}

export default function App() {
  return (
    <HashRouter>
      <SetupGate>
        <AppLayout />
      </SetupGate>
    </HashRouter>
  );
}
