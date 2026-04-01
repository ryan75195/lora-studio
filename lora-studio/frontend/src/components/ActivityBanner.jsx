import { useState, useEffect, useRef } from 'react';

const TASKS = [
  { key: 'train', url: '/api/train/progress', label: 'Training', color: '#1ed760' },
  { key: 'upload', url: '/api/youtube-upload/progress', label: 'YouTube Upload', color: '#ff0000' },
  { key: 'sync', url: '/api/youtube-sync/progress', label: 'YouTube Sync', color: '#ff0000' },
  { key: 'import', url: '/api/youtube-import/progress', label: 'YouTube Import', color: '#ff4500' },
  { key: 'gpu', url: '/api/gpu-status', label: null, color: null },
];

export default function ActivityBanner() {
  const [activities, setActivities] = useState([]);
  const pollRef = useRef(null);

  useEffect(() => {
    const poll = async () => {
      const active = [];
      for (const task of TASKS) {
        try {
          const res = await fetch(task.url);
          const data = await res.json();

          if (task.key === 'gpu') continue; // gpu-status is just for info

          if (data.active) {
            let progress = '';
            if (data.total > 0 && data.current > 0) {
              progress = ` (${data.current}/${data.total})`;
            } else if (data.phase_total > 0 && data.phase_progress > 0) {
              progress = ` (${Math.round((data.phase_progress / data.phase_total) * 100)}%)`;
            }
            active.push({
              key: task.key,
              label: task.label,
              color: task.color,
              message: data.message || '',
              progress,
            });
          }
        } catch { /* endpoint not available */ }
      }

      // Also check generation queue
      try {
        const res = await fetch('/api/queue');
        const jobs = await res.json();
        const generating = jobs.find(j => j.status === 'generating');
        if (generating) {
          active.push({
            key: 'generate',
            label: 'Generating',
            color: '#1ed760',
            message: generating.message || generating.title,
            progress: '',
          });
        }
        const queued = jobs.filter(j => j.status === 'queued');
        if (queued.length > 0 && !generating) {
          active.push({
            key: 'queued',
            label: 'Queued',
            color: '#a7a7a7',
            message: `${queued.length} job${queued.length > 1 ? 's' : ''} waiting`,
            progress: '',
          });
        }
      } catch {}

      setActivities(active);
    };

    poll();
    pollRef.current = setInterval(poll, 3000);
    return () => clearInterval(pollRef.current);
  }, []);

  if (activities.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 72, // above NowPlaying bar
        left: 0,
        right: 0,
        zIndex: 90,
        padding: '0 8px 4px',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          maxWidth: 480,
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          pointerEvents: 'auto',
        }}
      >
        {activities.map((a) => (
          <div
            key={a.key}
            style={{
              background: 'rgba(24,24,24,0.95)',
              backdropFilter: 'blur(12px)',
              border: `1px solid ${a.color}33`,
              borderRadius: 10,
              padding: '8px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            }}
          >
            {/* Animated dot */}
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: a.color,
                flexShrink: 0,
                animation: 'pulse 1.5s ease-in-out infinite',
              }}
            />
            {/* Label + message */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: a.color }}>
                {a.label}{a.progress}
              </div>
              {a.message && (
                <div
                  style={{
                    fontSize: 11,
                    color: '#a7a7a7',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    marginTop: 1,
                  }}
                >
                  {a.message}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
