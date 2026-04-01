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

function SetupGate({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [checked, setChecked] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    // Don't redirect if already on the setup page
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
      .catch(() => {
        // If the endpoint fails, don't block — proceed normally
        setChecked(true);
      });
  }, [location.pathname, navigate]);

  if (!checked) return null;
  if (needsSetup && location.pathname !== '/setup') return null;
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
