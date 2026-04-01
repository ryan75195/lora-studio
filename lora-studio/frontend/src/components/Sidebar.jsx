import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

function useIsMobile(breakpoint = 769) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < breakpoint);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [breakpoint]);
  return isMobile;
}

const NAV_ITEMS = [
  {
    path: '/artists',
    label: 'Artists',
    activityKey: 'import',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    path: '/train',
    label: 'Train',
    activityKey: 'train',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
  {
    path: '/generate',
    label: 'Create',
    activityKey: 'generate',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      </svg>
    ),
  },
  {
    path: '/library',
    label: 'Library',
    activityKey: 'library',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    ),
  },
];

// Activity colors
const ACTIVITY_COLORS = {
  train: '#1ed760',
  generate: '#1ed760',
  import: '#ff4500',
  upload: '#ff0000',
  sync: '#ff0000',
};

export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [activity, setActivity] = useState({}); // { train: true, generate: true, ... }
  const pollRef = useRef(null);

  useEffect(() => {
    const poll = async () => {
      const active = {};
      try {
        const r = await fetch('/api/train/progress');
        const d = await r.json();
        if (d.active) active.train = true;
      } catch {}
      try {
        const r = await fetch('/api/youtube-import/progress');
        const d = await r.json();
        if (d.active) active.import = true;
      } catch {}
      try {
        const r = await fetch('/api/youtube-upload/progress');
        const d = await r.json();
        if (d.active) active.upload = true;
      } catch {}
      try {
        const r = await fetch('/api/youtube-sync/progress');
        const d = await r.json();
        if (d.active) active.sync = true;
      } catch {}
      try {
        const r = await fetch('/api/queue');
        const jobs = await r.json();
        if (jobs.some(j => j.status === 'generating' || j.status === 'queued')) active.generate = true;
        if (jobs.some(j => j.status === 'ready_for_review')) active.review = true;
      } catch {}
      setActivity(active);
    };

    poll();
    pollRef.current = setInterval(poll, 4000);
    return () => clearInterval(pollRef.current);
  }, []);

  // Map activityKey to which activities show on that tab
  const getTabActivity = (key) => {
    switch (key) {
      case 'import': return activity.import ? 'import' : null;
      case 'train': return activity.train ? 'train' : null;
      case 'generate': return activity.generate ? 'generate' : activity.review ? 'review' : null;
      case 'library': return activity.upload ? 'upload' : activity.sync ? 'sync' : null;
      default: return null;
    }
  };

  return (
    <nav id="sidebar">
      {NAV_ITEMS.map((item) => {
        const isActive =
          location.pathname === item.path ||
          location.pathname.startsWith(item.path + '/');
        const tabActivity = getTabActivity(item.activityKey);
        const dotColor = tabActivity
          ? (tabActivity === 'review' ? '#f59e0b' : ACTIVITY_COLORS[tabActivity] || '#1ed760')
          : null;

        return (
          <button
            key={item.path}
            className={`nav-item${isActive ? ' active' : ''}`}
            onClick={() => navigate(item.path)}
            title={item.label}
            aria-label={item.label}
            style={{ position: 'relative' }}
          >
            {item.icon}
            <span className="nav-label">{item.label}</span>
            {dotColor && (
              <span
                style={{
                  position: 'absolute',
                  top: isMobile ? 6 : 10,
                  right: isMobile ? 'calc(50% - 14px)' : 10,
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: dotColor,
                  boxShadow: `0 0 6px ${dotColor}80`,
                  animation: 'pulse 1.5s ease-in-out infinite',
                }}
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}
