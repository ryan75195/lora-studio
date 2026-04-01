import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getGenerateStatus,
  getDraft,
  getDraftAudioUrl,
  acceptDraft,
  discardDraft,
  repaintDraft,
  startGenerate,
  aiBuild,
  fmtTime,
} from '../api.js';
import Waveform from './Waveform.jsx';

function useIsMobile(breakpoint = 769) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < breakpoint);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [breakpoint]);
  return isMobile;
}

export default function ReviewPanel({ draftId, onToast, onBack, onAccepted }) {
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [tab, setTab] = useState('info'); // 'info' | 'repaint' | 'stems'
  const [repaintStart, setRepaintStart] = useState(0);
  const [repaintEnd, setRepaintEnd] = useState(60);
  const [repaintCaption, setRepaintCaption] = useState('');
  const [repaintMode, setRepaintMode] = useState('balanced');
  const [repainting, setRepainting] = useState(false);
  const [repaintMessage, setRepaintMessage] = useState('');
  const [stripping, setStripping] = useState(false);
  const [stripMessage, setStripMessage] = useState('');
  const [tweakInput, setTweakInput] = useState('');
  const [tweakLoading, setTweakLoading] = useState(false);
  const [tweakMessages, setTweakMessages] = useState([]);
  const audioRef = useRef(null);
  const barRef = useRef(null);
  const pollRef = useRef(null);
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const loadDraft = useCallback(async () => {
    setLoading(true);
    try {
      const d = await getDraft(draftId);
      setDraft(d);
      setRepaintEnd(d.duration || 60);
    } catch (e) {
      onToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [draftId, onToast]);

  useEffect(() => {
    loadDraft();
    return () => {
      clearInterval(pollRef.current);
      if (audioRef.current) audioRef.current.pause();
    };
  }, [loadDraft]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (audioRef.current.paused) audioRef.current.play();
    else audioRef.current.pause();
  };

  const handleBarClick = (e) => {
    if (!barRef.current || !audioRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audioRef.current.currentTime = pct * audioRef.current.duration;
  };

  const sourceSongId = draft?.source_song_id || '';

  const handleAccept = async (overwriteId) => {
    try {
      const result = await acceptDraft(draftId, overwriteId || undefined);
      onToast(overwriteId ? 'Original overwritten!' : 'Saved: ' + result.filename);
      onAccepted();
    } catch (e) {
      onToast(e.message, 'error');
    }
  };

  const handleDiscard = async () => {
    try { await discardDraft(draftId).catch(() => {}); } catch {}
    onBack();
  };

  const handleRepaint = async () => {
    const start = parseFloat(repaintStart) || 0;
    const end = parseFloat(repaintEnd) || 60;
    if (end <= start) { onToast('End must be after start', 'error'); return; }
    setRepainting(true);
    setRepaintMessage('Repainting...');
    clearInterval(pollRef.current);
    try {
      await repaintDraft({ draft_id: draftId, start, end, caption: repaintCaption, mode: repaintMode });
      pollRef.current = setInterval(async () => {
        try {
          const status = await getGenerateStatus();
          setRepaintMessage(status.message || 'Repainting...');
          if (!status.active) {
            clearInterval(pollRef.current);
            setRepainting(false);
            setRepaintMessage('');
            if (status.error) {
              onToast('Repaint failed: ' + status.message, 'error');
            } else {
              onToast('Section repainted!');
              if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current.src = getDraftAudioUrl(draftId) + '?t=' + Date.now();
              }
              loadDraft();
            }
          }
        } catch (err) {
          clearInterval(pollRef.current);
          setRepainting(false);
          onToast(err.message, 'error');
        }
      }, 2000);
    } catch (e) {
      onToast(e.message, 'error');
      setRepainting(false);
    }
  };

  const handleStrip = async (keep) => {
    setStripping(true);
    setStripMessage('Separating stems...');
    try {
      const res = await fetch(`/api/drafts/${draftId}/strip-stems`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keep }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || 'Failed');
      const poll = setInterval(async () => {
        try {
          const p = await fetch('/api/drafts/strip-progress').then(r => r.json());
          setStripMessage(p.message || 'Processing...');
          if (!p.active) {
            clearInterval(poll);
            setStripping(false);
            setStripMessage('');
            if (p.error) {
              onToast('Strip failed: ' + p.error, 'error');
            } else {
              onToast('Stems stripped!');
              if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current.src = getDraftAudioUrl(draftId) + '?t=' + Date.now();
              }
            }
          }
        } catch { clearInterval(poll); setStripping(false); setStripMessage(''); }
      }, 2000);
    } catch (e) {
      onToast(e.message, 'error');
      setStripping(false);
      setStripMessage('');
    }
  };

  const handleTweak = async () => {
    const msg = tweakInput.trim();
    if (!msg || tweakLoading || !draft) return;
    const newMsgs = [...tweakMessages, { role: 'user', content: msg }];
    setTweakMessages(newMsgs);
    setTweakInput('');
    setTweakLoading(true);
    try {
      const current = {
        title: draft.title || '',
        caption: draft.caption || '',
        lyrics: draft.lyrics || '',
        bpm: draft.bpm || 120,
        key: draft.key || '',
        duration: draft.duration || 180,
      };
      const result = await aiBuild({
        prompt: msg,
        current,
        chat_history: tweakMessages.map(m => ({ role: m.role, content: m.content })),
        lora_name: (draft.lora_name && draft.lora_name !== '(base model)') ? draft.lora_name : '',
      });
      if (result._chat) {
        setTweakMessages([...newMsgs, { role: 'assistant', content: result._chat }]);
      } else {
        const summary = `Updated: ${result.title || 'song'} — ${result.bpm} BPM, ${result.key}`;
        setTweakMessages([...newMsgs, { role: 'assistant', content: summary }]);
        // Queue regeneration with new settings
        await startGenerate({
          title: result.title || draft.title || '',
          lora_name: (draft.lora_name && draft.lora_name !== '(base model)') ? draft.lora_name : '',
          strength: draft.strength || 1.0,
          caption: result.caption || draft.caption || '',
          lyrics: result.lyrics !== undefined ? result.lyrics : (draft.lyrics || ''),
          bpm: result.bpm || draft.bpm || null,
          key: result.key || draft.key || '',
          duration: result.duration || draft.duration || 180,
          ai_prompt: msg,
          chat_history: newMsgs,
        });
        onToast('Regenerating with changes — check the queue');
        await discardDraft(draftId).catch(() => {});
        onBack();
      }
    } catch (e) {
      setTweakMessages([...newMsgs, { role: 'assistant', content: `Error: ${e.message}` }]);
    } finally {
      setTweakLoading(false);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <div className="w-8 h-8 rounded-full border-2 border-[#a7a7a7] border-t-transparent animate-spin" />
    </div>
  );
  if (!draft) return null;

  const pct = audioDuration ? (currentTime / audioDuration) * 100 : 0;

  const TabBtn = ({ id, label }) => (
    <button
      onClick={() => setTab(id)}
      style={{
        flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 600,
        background: 'none', border: 'none', cursor: 'pointer',
        color: tab === id ? '#1ed760' : '#666',
        borderBottom: tab === id ? '2px solid #1ed760' : '2px solid transparent',
        transition: 'all 0.15s',
      }}
    >{label}</button>
  );

  /* ---- Waveform + player + actions (left on desktop) ---- */
  const playerSection = (
    <div style={isMobile ? {} : { flex: '0 0 58%', minWidth: 0 }}>
      {/* Waveform + Player */}
      <div style={{ background: '#161616', borderRadius: 16, padding: 16, marginBottom: 16 }}>
        <Waveform
          audioUrl={getDraftAudioUrl(draftId)}
          selection={[repaintStart, repaintEnd]}
          onSelectionChange={([s, e]) => { setRepaintStart(Math.round(s)); setRepaintEnd(Math.round(e)); }}
          currentTime={currentTime}
          duration={audioDuration}
          onSeek={(t) => { if (audioRef.current) audioRef.current.currentTime = t; }}
          height={80}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
          <button
            onClick={togglePlay}
            style={{
              width: 44, height: 44, borderRadius: '50%', border: 'none',
              background: '#1ed760', cursor: 'pointer', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <svg viewBox="0 0 24 24" fill="#000" width={18} height={18} style={{ marginLeft: playing ? 0 : 2 }}>
              {playing
                ? <><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></>
                : <polygon points="5,3 19,12 5,21" />
              }
            </svg>
          </button>
          <button
            onClick={() => {
              if (audioRef.current) {
                audioRef.current.currentTime = repaintStart;
                audioRef.current.play();
                const checkEnd = setInterval(() => {
                  if (audioRef.current && audioRef.current.currentTime >= repaintEnd) {
                    audioRef.current.pause();
                    clearInterval(checkEnd);
                  }
                }, 100);
              }
            }}
            style={{
              padding: '8px 14px', borderRadius: 10, border: '1px solid #f59e0b33',
              background: 'rgba(249,158,11,0.08)', color: '#f59e0b',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Play Selection
          </button>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: '#666' }}>{fmtTime(currentTime)} / {fmtTime(audioDuration)}</span>
        </div>
        <audio
          ref={audioRef}
          src={getDraftAudioUrl(draftId)}
          preload="auto"
          onTimeUpdate={() => { if (audioRef.current) setCurrentTime(audioRef.current.currentTime); }}
          onDurationChange={() => { if (audioRef.current) setAudioDuration(audioRef.current.duration); }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8, marginBottom: isMobile ? 16 : 0 }}>
        {sourceSongId ? (
          <>
            <button onClick={() => handleAccept()} style={{ flex: 1, padding: '14px 12px', borderRadius: 14, border: 'none', background: '#1ed760', color: '#000', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
              Save as New
            </button>
            <button onClick={() => handleAccept(sourceSongId)} style={{ flex: 1, padding: '14px 12px', borderRadius: 14, border: 'none', background: '#f59e0b', color: '#000', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
              Overwrite
            </button>
          </>
        ) : (
          <button onClick={() => handleAccept()} style={{ flex: 1, padding: '14px 12px', borderRadius: 14, border: 'none', background: '#1ed760', color: '#000', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
            Accept & Save
          </button>
        )}
        <button
          onClick={async () => {
            if (!draft) return;
            try {
              await startGenerate({
                title: draft.title || '',
                lora_name: (draft.lora_name && draft.lora_name !== '(base model)') ? draft.lora_name : '',
                strength: draft.strength || 1.0,
                caption: draft.caption || '',
                lyrics: draft.lyrics || '',
                bpm: draft.bpm || null,
                key: draft.key || '',
                duration: draft.duration || 180,
                ai_prompt: draft.ai_prompt || '',
                chat_history: draft.chat_history || [],
                source_song_id: draft.source_song_id || '',
                generation_mode: draft.generation_mode || 'fresh',
              });
              onToast('Regenerating — check the queue');
              await discardDraft(draftId).catch(() => {});
              onBack();
            } catch (e) { onToast(e.message, 'error'); }
          }}
          style={{ padding: '14px 16px', borderRadius: 14, border: '1px solid rgba(30,215,96,0.3)', background: 'rgba(30,215,96,0.08)', color: '#1ed760', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
        >
          Regenerate
        </button>
        <button onClick={handleDiscard} style={{ padding: '14px 16px', borderRadius: 14, border: '1px solid #333', background: 'none', color: '#a7a7a7', fontSize: 14, cursor: 'pointer' }}>
          Discard
        </button>
      </div>
    </div>
  );

  /* ---- Tabs + tab content (right on desktop) ---- */
  const tabsSection = (
    <div style={isMobile ? {} : { flex: '0 0 40%', minWidth: 0, overflowY: 'auto', maxHeight: 'calc(100vh - 200px)' }}>
      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #222', marginBottom: 16 }}>
        <TabBtn id="info" label="Info" />
        <TabBtn id="tweak" label="Tweak" />
        <TabBtn id="repaint" label="Edit Section" />
        <TabBtn id="stems" label="Strip Stems" />
      </div>

      {/* Info tab */}
      {tab === 'info' && (
        <div>
          {draft.ai_prompt && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', marginBottom: 6, fontWeight: 600 }}>Original Prompt</div>
              <div style={{ fontSize: 14, color: '#1ed760', lineHeight: 1.5 }}>{draft.ai_prompt}</div>
            </div>
          )}
          {draft.chat_history && draft.chat_history.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', marginBottom: 6, fontWeight: 600 }}>Chat History</div>
              <div style={{ background: '#111', borderRadius: 12, padding: 12, maxHeight: 200, overflowY: 'auto' }}>
                {draft.chat_history.map((msg, i) => (
                  <div key={i} style={{ marginBottom: 8, display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                    <div style={{
                      padding: '6px 12px', borderRadius: 12, maxWidth: 380, fontSize: 13, lineHeight: 1.4,
                      background: msg.role === 'user' ? '#1ed760' : '#1a1a1a',
                      color: msg.role === 'user' ? '#000' : '#aaa',
                    }}>{msg.content}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {draft.caption && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', marginBottom: 6, fontWeight: 600 }}>Caption</div>
              <div style={{ fontSize: 14, color: '#ccc', lineHeight: 1.5 }}>{draft.caption}</div>
            </div>
          )}
          {draft.lyrics && (
            <div>
              <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', marginBottom: 6, fontWeight: 600 }}>Lyrics</div>
              <pre style={{ fontSize: 13, color: '#aaa', whiteSpace: 'pre-wrap', lineHeight: 1.6, background: '#111', borderRadius: 12, padding: 14, maxHeight: 300, overflowY: 'auto' }}>
                {draft.lyrics}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Tweak tab — AI chat to modify and regenerate */}
      {tab === 'tweak' && (
        <div style={{ display: 'flex', flexDirection: 'column', height: isMobile ? 'auto' : '100%' }}>
          <div style={{ fontSize: 13, color: '#888', marginBottom: 12 }}>
            Describe changes and regenerate with the AI. Your current settings are preserved.
          </div>

          {/* Chat messages */}
          {tweakMessages.length > 0 && (
            <div style={{ flex: 1, overflowY: 'auto', marginBottom: 12, maxHeight: isMobile ? 200 : 'none' }}>
              {tweakMessages.map((msg, i) => (
                <div key={i} style={{ marginBottom: 8, display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  <div style={{
                    padding: '8px 14px', borderRadius: msg.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                    background: msg.role === 'user' ? '#1ed760' : '#1a1a1a',
                    color: msg.role === 'user' ? '#000' : '#c0c0c0',
                    fontSize: 13, maxWidth: 380, lineHeight: 1.4, fontWeight: msg.role === 'user' ? 600 : 400,
                  }}>{msg.content}</div>
                </div>
              ))}
            </div>
          )}

          {/* Input */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              value={tweakInput}
              onChange={(e) => setTweakInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && tweakInput.trim() && !tweakLoading && handleTweak()}
              placeholder="e.g. make it faster, change key to E minor, more guitar..."
              disabled={tweakLoading}
              style={{
                flex: 1, background: '#111', border: '1px solid #333', borderRadius: 12,
                padding: '12px 14px', color: '#fff', fontSize: 14, outline: 'none', fontFamily: 'inherit',
              }}
            />
            <button
              onClick={handleTweak}
              disabled={tweakLoading || !tweakInput.trim()}
              style={{
                width: 44, height: 44, borderRadius: '50%', border: 'none', flexShrink: 0,
                background: tweakInput.trim() && !tweakLoading ? '#1ed760' : '#1a1a1a',
                cursor: tweakInput.trim() && !tweakLoading ? 'pointer' : 'default',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {tweakLoading ? (
                <div style={{ width: 16, height: 16, border: '2px solid #333', borderTopColor: '#1ed760', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
              ) : (
                <svg viewBox="0 0 24 24" fill={tweakInput.trim() ? '#000' : '#444'} style={{ width: 16, height: 16 }}><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Repaint tab */}
      {tab === 'repaint' && (() => {
        // Parse sections from lyrics for quick-select buttons
        const sections = [];
        if (draft.lyrics) {
          const totalDur = draft.duration || audioDuration || 180;
          const matches = [...draft.lyrics.matchAll(/\[([^\]]+)\]/g)];
          if (matches.length > 0) {
            const secDur = totalDur / matches.length;
            matches.forEach((m, i) => {
              sections.push({
                label: m[1].split(' - ')[0].trim(),
                start: Math.round(i * secDur),
                end: Math.round((i + 1) * secDur),
              });
            });
          }
        }

        return (
          <div>
            {/* Section quick-select buttons */}
            {sections.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', fontWeight: 600, marginBottom: 8 }}>
                  Jump to section
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {sections.map((sec, i) => {
                    const isSelected = Math.abs(repaintStart - sec.start) < 2 && Math.abs(repaintEnd - sec.end) < 2;
                    return (
                      <button
                        key={i}
                        onClick={() => {
                          setRepaintStart(sec.start);
                          setRepaintEnd(sec.end);
                          if (audioRef.current) audioRef.current.currentTime = sec.start;
                        }}
                        style={{
                          padding: '6px 12px', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                          background: isSelected ? 'rgba(249,158,11,0.15)' : '#111',
                          border: isSelected ? '1px solid #f59e0b' : '1px solid #333',
                          color: isSelected ? '#f59e0b' : '#aaa',
                          transition: 'all 0.15s',
                        }}
                      >
                        {sec.label}
                        <span style={{ fontSize: 10, color: '#666', marginLeft: 4 }}>{sec.start}s</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Selected range + Play Selection */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ background: '#111', borderRadius: 10, padding: '8px 14px', fontSize: 14, color: '#f59e0b', fontWeight: 600 }}>
                {Math.floor(repaintStart)}s — {Math.floor(repaintEnd)}s
                <span style={{ fontSize: 12, color: '#888', marginLeft: 6 }}>({Math.floor(repaintEnd - repaintStart)}s)</span>
              </div>
              <button
                onClick={() => {
                  if (audioRef.current) {
                    audioRef.current.currentTime = repaintStart;
                    audioRef.current.play();
                    const checkEnd = setInterval(() => {
                      if (audioRef.current && audioRef.current.currentTime >= repaintEnd) {
                        audioRef.current.pause();
                        clearInterval(checkEnd);
                      }
                    }, 100);
                  }
                }}
                style={{ padding: '6px 12px', borderRadius: 10, border: '1px solid #f59e0b33', background: 'rgba(249,158,11,0.08)', color: '#f59e0b', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
              >
                Preview
              </button>
            </div>

            {/* Blend strength */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', fontWeight: 600, marginBottom: 8 }}>
                How much to change
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {[
                  { id: 'conservative', label: 'Subtle', desc: 'Small tweaks' },
                  { id: 'balanced', label: 'Balanced', desc: 'Moderate changes' },
                  { id: 'aggressive', label: 'Rewrite', desc: 'Major changes' },
                ].map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setRepaintMode(m.id)}
                    style={{
                      flex: 1, padding: '10px 8px', borderRadius: 10, cursor: 'pointer', textAlign: 'center',
                      background: repaintMode === m.id ? 'rgba(249,158,11,0.12)' : '#111',
                      border: repaintMode === m.id ? '1px solid #f59e0b' : '1px solid #333',
                      color: repaintMode === m.id ? '#f59e0b' : '#aaa',
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{m.label}</div>
                    <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>{m.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Quick actions */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', fontWeight: 600, marginBottom: 8 }}>
                Quick fix
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {[
                  'Fix vocal clarity',
                  'Add guitar solo',
                  'More energy',
                  'Strip to instrumental',
                  'Change melody',
                  'Add harmonies',
                ].map((s) => (
                  <button
                    key={s}
                    onClick={() => setRepaintCaption(s)}
                    style={{
                      padding: '6px 12px', borderRadius: 10, fontSize: 12, cursor: 'pointer',
                      background: repaintCaption === s ? 'rgba(249,158,11,0.12)' : 'rgba(255,255,255,0.04)',
                      border: repaintCaption === s ? '1px solid #f59e0b' : '1px solid rgba(255,255,255,0.08)',
                      color: repaintCaption === s ? '#f59e0b' : '#888',
                    }}
                  >{s}</button>
                ))}
              </div>
            </div>

            {/* Custom instructions */}
            <div style={{ marginBottom: 14 }}>
              <textarea
                value={repaintCaption} onChange={(e) => setRepaintCaption(e.target.value)}
                placeholder="Or describe exactly what to change..."
                style={{ width: '100%', background: '#111', border: '1px solid #333', borderRadius: 12, padding: '14px', color: '#fff', fontSize: 14, minHeight: 60, resize: 'vertical', outline: 'none', fontFamily: 'inherit', lineHeight: 1.5 }}
              />
            </div>

            {/* Repaint button */}
            <button
              onClick={handleRepaint}
              disabled={repainting}
              style={{
                width: '100%', padding: '14px', borderRadius: 14, border: 'none',
                background: repainting ? '#333' : '#f59e0b', color: repainting ? '#666' : '#000',
                fontSize: 15, fontWeight: 700, cursor: repainting ? 'not-allowed' : 'pointer',
              }}
            >
              {repainting ? (repaintMessage || 'Repainting...') : 'Repaint Selected Section'}
            </button>
          </div>
        );
      })()}

      {/* Stems tab */}
      {tab === 'stems' && (
        <div>
          <div style={{ fontSize: 13, color: '#888', marginBottom: 14 }}>
            Uses AI to separate and remove parts of the audio. Listen to the result before saving.
          </div>
          {[
            { label: 'Remove Vocals Only', sub: 'Keep all instruments', keep: ['drums','bass','other','piano','guitar'], icon: '\uD83C\uDFA4' },
            { label: 'Remove Guitar + Vocals', sub: 'Piano, bass & drums only', keep: ['drums','bass','other','piano'], icon: '\uD83C\uDFB8' },
            { label: 'Drums + Bass Only', sub: 'Minimal rhythm bed', keep: ['drums','bass'], icon: '\uD83E\uDD41' },
            { label: 'Vocals Only', sub: 'Strip all instruments', keep: ['vocals'], icon: '\uD83C\uDF99' },
          ].map((p) => (
            <button
              key={p.label}
              disabled={stripping}
              onClick={() => handleStrip(p.keep)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 14,
                padding: '14px 16px', marginBottom: 8, borderRadius: 14,
                background: '#161616', border: '1px solid #222',
                cursor: stripping ? 'not-allowed' : 'pointer', textAlign: 'left',
              }}
            >
              <span style={{ fontSize: 20 }}>{p.icon}</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: stripping ? '#555' : '#fff' }}>{p.label}</div>
                <div style={{ fontSize: 12, color: '#666' }}>{p.sub}</div>
              </div>
            </button>
          ))}
          {stripping && (
            <div style={{ fontSize: 13, color: '#1ed760', marginTop: 8, textAlign: 'center' }}>{stripMessage}</div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div style={{ paddingBottom: 100 }}>
      {/* Back button */}
      <button
        onClick={handleDiscard}
        style={{ background: 'none', border: 'none', color: '#a7a7a7', cursor: 'pointer', fontSize: 14, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}
      >
        <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2}><polyline points="15 18 9 12 15 6" /></svg>
        Back
      </button>

      {/* Title */}
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#fff', marginBottom: 4 }}>
        {draft.title || draftId}
      </h1>
      <div style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>
        {[draft.key, draft.bpm ? draft.bpm + ' BPM' : '', draft.lora_name].filter(Boolean).join(' \u00b7 ')}
      </div>

      {isMobile ? (
        <>
          {playerSection}
          {tabsSection}
        </>
      ) : (
        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
          {playerSection}
          {tabsSection}
        </div>
      )}
    </div>
  );
}
