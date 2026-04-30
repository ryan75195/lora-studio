import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Waveform display with drag-to-select region.
 * Props:
 *   audioUrl: string
 *   selection: [start, end] in seconds
 *   onSelectionChange: ([start, end]) => void
 *   currentTime: number (playback position in seconds)
 *   duration: number
 *   onSeek: (time) => void
 *   height: number (default 80)
 */
export default function Waveform({ audioUrl, selection, onSelectionChange, currentTime, duration, onSeek, height = 80 }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [peaks, setPeaks] = useState(null);
  const [dragging, setDragging] = useState(null); // 'start' | 'end' | 'region' | 'new' | null
  const dragStartRef = useRef(null);

  // Decode audio and extract peaks
  useEffect(() => {
    if (!audioUrl) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    fetch(audioUrl)
      .then(r => r.arrayBuffer())
      .then(buf => ctx.decodeAudioData(buf))
      .then(decoded => {
        const raw = decoded.getChannelData(0);
        const buckets = 200;
        const step = Math.floor(raw.length / buckets);
        const p = [];
        for (let i = 0; i < buckets; i++) {
          let max = 0;
          for (let j = i * step; j < (i + 1) * step && j < raw.length; j++) {
            const v = Math.abs(raw[j]);
            if (v > max) max = v;
          }
          p.push(max);
        }
        setPeaks(p);
        ctx.close();
      })
      .catch(() => {});
  }, [audioUrl]);

  // Draw waveform
  useEffect(() => {
    if (!peaks || !canvasRef.current || !containerRef.current) return;
    const canvas = canvasRef.current;
    const w = containerRef.current.clientWidth;
    const h = height;
    canvas.width = w * 2; // retina
    canvas.height = h * 2;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(2, 2);

    const barW = w / peaks.length;
    const maxPeak = Math.max(...peaks, 0.01);

    // Background
    ctx.clearRect(0, 0, w, h);

    // Selection highlight
    if (selection && duration > 0) {
      const x1 = (selection[0] / duration) * w;
      const x2 = (selection[1] / duration) * w;
      ctx.fillStyle = 'rgba(249, 158, 11, 0.12)';
      ctx.fillRect(x1, 0, x2 - x1, h);
    }

    // Waveform bars
    for (let i = 0; i < peaks.length; i++) {
      const x = i * barW;
      const barH = Math.max(2, (peaks[i] / maxPeak) * (h - 8));
      const y = (h - barH) / 2;

      // Color: played = green, selected = amber, else grey
      const t = (i / peaks.length) * (duration || 1);
      if (selection && t >= selection[0] && t <= selection[1]) {
        ctx.fillStyle = t <= currentTime ? '#f59e0b' : 'rgba(249, 158, 11, 0.5)';
      } else if (t <= currentTime) {
        ctx.fillStyle = '#1ed760';
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
      }

      ctx.beginPath();
      ctx.roundRect(x + 0.5, y, Math.max(1, barW - 1), barH, 1);
      ctx.fill();
    }

    // Playhead
    if (duration > 0) {
      const px = (currentTime / duration) * w;
      ctx.fillStyle = '#fff';
      ctx.fillRect(px - 0.5, 0, 1, h);
    }

    // Selection handles
    if (selection && duration > 0) {
      const drawHandle = (time, color) => {
        const x = (time / duration) * w;
        ctx.fillStyle = color;
        ctx.fillRect(x - 1.5, 0, 3, h);
        // Handle grip
        ctx.beginPath();
        ctx.arc(x, h / 2, 8, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.fillStyle = '#000';
        ctx.fillRect(x - 2, h / 2 - 4, 1, 8);
        ctx.fillRect(x + 1, h / 2 - 4, 1, 8);
      };
      drawHandle(selection[0], '#f59e0b');
      drawHandle(selection[1], '#f59e0b');
    }
  }, [peaks, selection, currentTime, duration, height]);

  // Convert pixel X to time
  const xToTime = useCallback((clientX) => {
    if (!containerRef.current || !duration) return 0;
    const rect = containerRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return pct * duration;
  }, [duration]);

  // Mouse/touch handlers — tap to seek, drag to select
  const DRAG_THRESHOLD = 5; // px before a click becomes a drag

  const handlePointerDown = useCallback((e) => {
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const t = xToTime(clientX);

    if (selection && duration > 0) {
      const handleRadius = (8 / (containerRef.current?.clientWidth || 300)) * duration;
      if (Math.abs(t - selection[0]) < handleRadius) {
        setDragging('start');
        dragStartRef.current = { x: clientX, origSel: [...selection], moved: false };
        e.preventDefault();
        return;
      }
      if (Math.abs(t - selection[1]) < handleRadius) {
        setDragging('end');
        dragStartRef.current = { x: clientX, origSel: [...selection], moved: false };
        e.preventDefault();
        return;
      }
      if (t > selection[0] && t < selection[1]) {
        setDragging('region');
        dragStartRef.current = { x: clientX, origSel: [...selection], startTime: t, moved: false };
        e.preventDefault();
        return;
      }
    }

    // Start as pending — will become 'new' selection if dragged, otherwise seek on release
    setDragging('pending');
    dragStartRef.current = { x: clientX, startTime: t, moved: false };
    e.preventDefault();
  }, [selection, duration, xToTime]);

  const handlePointerMove = useCallback((e) => {
    if (!dragging || !dragStartRef.current) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const t = xToTime(clientX);
    const dx = Math.abs(clientX - dragStartRef.current.x);

    // Mark as moved once past threshold
    if (dx > DRAG_THRESHOLD) dragStartRef.current.moved = true;

    if (dragging === 'pending') {
      // Only start a new selection after exceeding drag threshold
      if (dx > DRAG_THRESHOLD) {
        setDragging('new');
      }
      return;
    }

    if (dragging === 'start') {
      const newStart = Math.max(0, Math.min(t, selection[1] - 1));
      onSelectionChange([newStart, selection[1]]);
    } else if (dragging === 'end') {
      const newEnd = Math.min(duration, Math.max(t, selection[0] + 1));
      onSelectionChange([selection[0], newEnd]);
    } else if (dragging === 'region') {
      const delta = t - dragStartRef.current.startTime;
      let s = dragStartRef.current.origSel[0] + delta;
      let en = dragStartRef.current.origSel[1] + delta;
      if (s < 0) { en -= s; s = 0; }
      if (en > duration) { s -= (en - duration); en = duration; }
      onSelectionChange([Math.max(0, s), Math.min(duration, en)]);
    } else if (dragging === 'new') {
      const start = dragStartRef.current.startTime;
      const s = Math.min(start, t);
      const en = Math.max(start, t);
      if (en - s > 1) {
        onSelectionChange([s, en]);
      }
    }
  }, [dragging, selection, duration, xToTime, onSelectionChange]);

  const handlePointerUp = useCallback(() => {
    // If we never exceeded the drag threshold, treat it as a seek (tap)
    if (dragStartRef.current && !dragStartRef.current.moved) {
      if (onSeek) onSeek(dragStartRef.current.startTime);
    }
    setDragging(null);
    dragStartRef.current = null;
  }, [onSeek]);

  // Global move/up listeners
  useEffect(() => {
    if (!dragging) return;
    const move = (e) => handlePointerMove(e);
    const up = () => handlePointerUp();
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', up);
    };
  }, [dragging, handlePointerMove, handlePointerUp]);

  return (
    <div
      ref={containerRef}
      onMouseDown={handlePointerDown}
      onTouchStart={handlePointerDown}
      style={{
        width: '100%',
        height,
        background: '#0a0a0a',
        borderRadius: 12,
        overflow: 'hidden',
        cursor: dragging ? 'grabbing' : 'crosshair',
        touchAction: 'none',
        position: 'relative',
      }}
    >
      {!peaks && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333', fontSize: 12 }}>
          Loading waveform...
        </div>
      )}
      <canvas ref={canvasRef} style={{ display: 'block' }} />
      {selection && duration > 0 && (
        <div style={{
          position: 'absolute', bottom: 4, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.7)', borderRadius: 8, padding: '2px 10px',
          fontSize: 11, color: '#f59e0b', whiteSpace: 'nowrap',
        }}>
          {Math.floor(selection[0])}s — {Math.floor(selection[1])}s ({Math.floor(selection[1] - selection[0])}s)
        </div>
      )}
    </div>
  );
}
