import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getQueue, clearQueue, discardAllReviews, discardDraft,
  cancelJob, retryJob,
} from '../api.js';

const C = {
  elevated: '#181818',
  border: '#222',
  textPrimary: '#fff',
  textSecondary: '#a7a7a7',
};

const STATUS_ACTIVE = new Set(['queued', 'generating']);

function statusLabel(job, position) {
  switch (job.status) {
    case 'queued':
      return { text: `Queued #${position}`, color: '#a7a7a7', pulse: false };
    case 'generating':
      return { text: 'Generating...', color: '#1ed760', pulse: true };
    case 'ready_for_review':
      return { text: 'Ready to Review', color: '#1ed760', pulse: false, clickable: true };
    case 'accepted':
      return { text: 'Accepted', color: '#a7a7a7', pulse: false };
    case 'discarded':
      return { text: 'Discarded', color: '#6b7280', pulse: false };
    case 'failed':
      return { text: 'Failed', color: '#f59e0b', pulse: false };
    default:
      return { text: job.status, color: '#a7a7a7', pulse: false };
  }
}

export default function QueueSection({ onToast }) {
  const [jobs, setJobs] = useState([]);
  const [failedCollapsed, setFailedCollapsed] = useState(true);
  const pollRef = useRef(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      const data = await getQueue();
      setJobs(data);
    } catch (_) {}
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const hasActive = jobs.some((j) => STATUS_ACTIVE.has(j.status) || j.status === 'ready_for_review');
    if (hasActive) {
      pollRef.current = setInterval(load, 3000);
    } else {
      clearInterval(pollRef.current);
    }
    return () => clearInterval(pollRef.current);
  }, [jobs, load]);

  const handleCancel = async (jobId) => {
    try { await cancelJob(jobId); onToast('Job cancelled'); load(); }
    catch (e) { onToast(e.message, 'error'); }
  };

  const handleRetry = async (jobId) => {
    try { await retryJob(jobId); onToast('Job re-queued'); load(); }
    catch (e) { onToast(e.message, 'error'); }
  };

  const handleDiscard = async (job) => {
    try { if (job.draft_id) await discardDraft(job.draft_id); onToast('Discarded'); load(); }
    catch (e) { onToast(e.message, 'error'); }
  };

  const visibleJobs = jobs.filter((j) => !['accepted', 'discarded'].includes(j.status));

  const handleClearAll = async () => {
    try {
      const reviewCount = visibleJobs.filter(j => j.status === 'ready_for_review').length;
      if (reviewCount > 0) await discardAllReviews();
      await clearQueue();
      onToast('Queue cleared');
      load();
    } catch (e) { onToast(e.message, 'error'); }
  };

  if (visibleJobs.length === 0) return null;

  const activeJobs = visibleJobs.filter((j) => j.status !== 'failed');
  const failedJobs = visibleJobs.filter((j) => j.status === 'failed');

  const queuedIds = jobs
    .filter((j) => j.status === 'queued')
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((j) => j.id);

  const renderJob = (job, idx, arr) => {
    const pos = queuedIds.indexOf(job.id) + 1;
    const badge = statusLabel(job, pos);
    const isFailed = job.status === 'failed';

    return (
      <div
        key={job.id}
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '11px 16px',
          borderBottom: idx < arr.length - 1 ? `1px solid ${C.border}` : 'none',
          background: isFailed ? 'rgba(245,158,11,0.04)' : 'transparent',
        }}
      >
        <div style={{
          width: 6, height: 6, borderRadius: '50%',
          background: badge.color, flexShrink: 0,
          opacity: isFailed ? 0.7 : 1,
          animation: badge.pulse ? 'pulse 1.5s ease-in-out infinite' : 'none',
        }} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 500,
            color: isFailed ? 'rgba(255,255,255,0.5)' : C.textPrimary,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {job.title}
          </div>
          {isFailed && job.message && (
            <div style={{ fontSize: 11, color: '#d97706', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', opacity: 0.8 }}>
              {job.message}
            </div>
          )}
          {job.status === 'generating' && job.message && (
            <div style={{ fontSize: 11, color: 'rgba(30,215,96,0.7)', marginTop: 2 }}>
              {job.message}
            </div>
          )}
        </div>

        <div
          onClick={badge.clickable && job.draft_id ? () => navigate(`/generate/review/${job.draft_id}`) : undefined}
          style={{
            fontSize: 11, fontWeight: 600, color: badge.color,
            whiteSpace: 'nowrap', cursor: badge.clickable ? 'pointer' : 'default',
            padding: '3px 8px', borderRadius: 12,
            background: badge.clickable ? 'rgba(30,215,96,0.12)' : isFailed ? 'rgba(245,158,11,0.1)' : badge.pulse ? 'rgba(30,215,96,0.1)' : 'transparent',
            border: badge.clickable ? '1px solid rgba(30,215,96,0.3)' : isFailed ? '1px solid rgba(245,158,11,0.2)' : 'none',
          }}
        >
          {badge.text}
        </div>

        {job.status === 'ready_for_review' && (
          <button onClick={(e) => { e.stopPropagation(); handleDiscard(job); }}
            style={{ background: 'none', border: 'none', color: C.textSecondary, cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '2px 4px', opacity: 0.5, minWidth: 28, minHeight: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            title="Discard">&times;</button>
        )}
        {job.status === 'queued' && (
          <button onClick={() => handleCancel(job.id)}
            style={{ background: 'none', border: 'none', color: C.textSecondary, cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '2px 4px', opacity: 0.5, minWidth: 28, minHeight: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            title="Cancel">&times;</button>
        )}
        {isFailed && (
          <button onClick={() => handleRetry(job.id)}
            style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 8, color: '#f59e0b', cursor: 'pointer', fontSize: 11, fontWeight: 600, padding: '4px 10px', whiteSpace: 'nowrap', minHeight: 28 }}>
            Retry
          </button>
        )}
      </div>
    );
  };

  return (
    <section style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.textSecondary }}>
          Generation Queue
        </span>
        <button onClick={handleClearAll}
          style={{ background: 'none', border: 'none', color: C.textSecondary, cursor: 'pointer', fontSize: 11, opacity: 0.6 }}>
          Clear all
        </button>
      </div>

      {activeJobs.length > 0 && (
        <div style={{ background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden', marginBottom: failedJobs.length > 0 ? 8 : 0 }}>
          {activeJobs.map((job, idx) => renderJob(job, idx, activeJobs))}
        </div>
      )}

      {failedJobs.length > 0 && (
        <div style={{ background: 'rgba(245,158,11,0.04)', border: '1px solid rgba(245,158,11,0.12)', borderRadius: 10, overflow: 'hidden' }}>
          <button onClick={() => setFailedCollapsed((v) => !v)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: 'none', border: 'none', cursor: 'pointer', borderBottom: failedCollapsed ? 'none' : '1px solid rgba(245,158,11,0.12)' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 14 }}>&#9888;</span>
              {failedJobs.length} Failed Job{failedJobs.length !== 1 ? 's' : ''}
            </span>
            <span style={{ color: '#f59e0b', fontSize: 12, opacity: 0.7, transform: failedCollapsed ? 'rotate(0deg)' : 'rotate(180deg)', display: 'inline-block', transition: 'transform 0.2s' }}>
              &#9662;
            </span>
          </button>
          {!failedCollapsed && failedJobs.map((job, idx) => renderJob(job, idx, failedJobs))}
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </section>
  );
}
