import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getLoras, startGenerate, aiBuild } from '../api.js';

function useIsMobile(breakpoint = 769) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < breakpoint);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [breakpoint]);
  return isMobile;
}

const KEYS = [
  'C major', 'C minor', 'D major', 'D minor', 'E major', 'E minor',
  'F major', 'F minor', 'G major', 'G minor', 'A major', 'A minor',
  'B major', 'B minor',
];

export default function BuildForm({ onToast }) {
  const [loras, setLoras] = useState([]);
  const [lora, setLora] = useState('');
  const [strength, setStrength] = useState(1.0);
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [bpm, setBpm] = useState(120);
  const [key, setKey] = useState('');
  const [duration, setDuration] = useState(180);
  const [queuing, setQueuing] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  // Chat state
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  const [conversationId] = useState(() => Math.random().toString(36).slice(2, 10));
  const [turnCount, setTurnCount] = useState(0);
  const chatEndRef = useRef(null);
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  useEffect(() => { getLoras().then(setLoras).catch(() => {}); }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Reuse settings from library
  const applySettings = useCallback((inp) => {
    if (!inp) return;
    if (inp.title !== undefined) setTitle(inp.title || '');
    if (inp.caption !== undefined) setCaption(inp.caption || '');
    if (inp.lyrics !== undefined) setLyrics(inp.lyrics || '');
    if (inp.bpm !== undefined) setBpm(inp.bpm || 120);
    if (inp.key !== undefined) setKey(inp.key || '');
    if (inp.duration !== undefined) setDuration(inp.duration || 180);
    if (inp.lora_name && inp.lora_name !== '(base model)') setLora(inp.lora_name);
    if (inp.strength !== undefined) setStrength(inp.strength || 1.0);
    // Restore chat history if available
    if (inp.chat_history && Array.isArray(inp.chat_history) && inp.chat_history.length > 0) {
      setChatMessages(inp.chat_history);
    }
    setShowDetails(true);
  }, []);

  // Check sessionStorage on mount (handles cross-page navigation)
  useEffect(() => {
    const stored = sessionStorage.getItem('lora-studio:reuse-settings');
    if (stored) {
      try {
        applySettings(JSON.parse(stored));
        onToast('Settings loaded');
      } catch {}
      sessionStorage.removeItem('lora-studio:reuse-settings');
    }
  }, [applySettings, onToast]);

  // Also listen for live events (same-page)
  useEffect(() => {
    const handler = (e) => {
      applySettings(e.detail);
      onToast('Settings loaded');
      sessionStorage.removeItem('lora-studio:reuse-settings');
    };
    window.addEventListener('lora-studio:reuse-settings', handler);
    return () => window.removeEventListener('lora-studio:reuse-settings', handler);
  }, [applySettings, onToast]);

  // Auto-show details if fields are filled
  useEffect(() => {
    if (caption || lyrics || title) setShowDetails(true);
  }, [caption, lyrics, title]);

  const handleChatSend = async () => {
    const msg = chatInput.trim();
    if (!msg || chatLoading) return;

    const newMessages = [...chatMessages, { role: 'user', content: msg }];
    setChatMessages(newMessages);
    setChatInput('');
    setChatLoading(true);

    const hasExisting = caption || lyrics;
    const current = hasExisting ? { title, caption, lyrics, bpm, key, duration } : null;

    try {
      const turn = turnCount + 1;
      setTurnCount(turn);
      const result = await aiBuild({ prompt: msg, current, chat_history: chatHistory, conversation_id: conversationId, turn, lora_name: lora || '' });

      // Check if it's a chat response vs song build
      const isChat = !!result._chat || (!result.title && !result.caption && !result.lyrics);

      // Only update song fields if it's NOT a chat-only response
      if (!isChat) {
        if (result.title) setTitle(result.title);
        if (result.caption) setCaption(result.caption);
        if (result.lyrics !== undefined) setLyrics(result.lyrics);
        if (result.bpm) setBpm(result.bpm);
        if (result.key) setKey(result.key);
        if (result.duration) setDuration(result.duration);
      }

      let summary;
      if (isChat) {
        summary = result._chat || 'Song settings updated. Check the details below.';
      } else {
        summary = hasExisting
          ? `Updated: ${result.title || 'song'} — ${result.bpm} BPM, ${result.key}, ${result.duration}s`
          : `Built: "${result.title}" — ${result.caption?.slice(0, 60)}... | ${result.bpm} BPM, ${result.key}, ${result.duration}s`;
        setShowDetails(true);
      }

      const assistantMsg = { role: 'assistant', content: summary };
      setChatMessages([...newMessages, assistantMsg]);

      setChatHistory([
        ...chatHistory,
        { role: 'user', content: msg },
        { role: 'assistant', content: result._ai_response || JSON.stringify(result) },
      ]);

      if (!isChat) onToast(hasExisting ? 'Song updated!' : 'Song built!');
    } catch (e) {
      setChatMessages([...newMessages, { role: 'assistant', content: `Error: ${e.message}` }]);
      onToast(e.message, 'error');
    } finally {
      setChatLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (!caption.trim()) { onToast('Enter a caption or use the AI builder', 'error'); return; }
    setQueuing(true);
    try {
      const result = await startGenerate({
        title: title.trim(), lora_name: lora, strength: parseFloat(strength) || 1.0,
        caption: caption.trim(), lyrics, bpm: parseInt(bpm) || null, key,
        duration: parseFloat(duration) || 180,
        ai_prompt: chatMessages.filter(m => m.role === 'user').map(m => m.content).join(' → '),
        chat_history: chatMessages,
      });
      onToast(`Queued! Position: ${result.position || 1}`);
    } catch (e) { onToast(e.message, 'error'); }
    finally { setQueuing(false); }
  };

  const handleClearChat = () => {
    setChatMessages([]);
    setChatHistory([]);
    setTitle(''); setCaption(''); setLyrics('');
    setBpm(120); setKey(''); setDuration(180);
    setShowDetails(false);
  };

  const hasContent = caption.trim();

  // Desktop: show details always open
  const desktopShowDetails = !isMobile || showDetails;

  /* ---- Chat panel (shared between mobile & desktop) ---- */
  const chatPanel = (
    <div
      style={{
        background: '#111',
        borderRadius: 20,
        marginBottom: isMobile ? 16 : 0,
        overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.06)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: isMobile ? (chatMessages.length > 0 ? 360 : 'auto') : 0,
        ...(isMobile ? {} : { flex: '1 1 55%', minWidth: 0, height: '100%' }),
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '14px 18px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #1ed760, #169d46)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <svg viewBox="0 0 24 24" fill="#000" style={{ width: 14, height: 14 }}>
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>Song Builder</div>
            <div style={{ fontSize: 11, color: '#666' }}>Plan, discuss, or create songs</div>
          </div>
        </div>
        {chatMessages.length > 0 && (
          <button
            onClick={handleClearChat}
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: 'none',
              color: '#666',
              fontSize: 11,
              cursor: 'pointer',
              padding: '5px 12px',
              borderRadius: 12,
            }}
          >
            New chat
          </button>
        )}
      </div>

      {/* Welcome state */}
      {chatMessages.length === 0 && (
        <div style={{ padding: '32px 20px', textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontSize: 24, marginBottom: 12, opacity: 0.3 }}>&#9835;</div>
          <div style={{ fontSize: 14, color: '#888', marginBottom: 6 }}>What do you want to create?</div>
          <div style={{ fontSize: 12, color: '#555', lineHeight: 1.6 }}>
            Describe a song idea, ask for help planning, or just chat about music.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 16 }}>
            {['Write a sad ballad', 'Help me plan a duet', 'Suggest a genre for...', 'Create an instrumental'].map((s) => (
              <button
                key={s}
                onClick={() => { setChatInput(s); }}
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 16,
                  padding: '7px 14px',
                  color: '#888',
                  fontSize: 12,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(30,215,96,0.3)'; e.currentTarget.style.color = '#aaa'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#888'; }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      {chatMessages.length > 0 && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px', minHeight: 200, maxHeight: isMobile ? 400 : 'none' }}>
          {chatMessages.map((msg, i) => (
            <div
              key={i}
              style={{
                marginBottom: 12,
                display: 'flex',
                justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
              }}
            >
              <div
                style={{
                  padding: '10px 16px',
                  borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                  background: msg.role === 'user' ? '#1ed760' : '#1a1a1a',
                  color: msg.role === 'user' ? '#000' : (msg.content.startsWith('Error') ? '#f87171' : '#c0c0c0'),
                  fontSize: 14,
                  maxWidth: 420,
                  lineHeight: 1.5,
                  fontWeight: msg.role === 'user' ? 600 : 400,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {msg.content}
              </div>
            </div>
          ))}
          {chatLoading && (
            <div style={{ display: 'flex', marginBottom: 12 }}>
              <div style={{
                padding: '10px 16px',
                borderRadius: '18px 18px 18px 4px',
                background: '#1a1a1a',
                color: '#555',
                fontSize: 14,
                display: 'flex',
                gap: 4,
              }}>
                <span style={{ animation: 'pulse 1s infinite 0s' }}>.</span>
                <span style={{ animation: 'pulse 1s infinite 0.2s' }}>.</span>
                <span style={{ animation: 'pulse 1s infinite 0.4s' }}>.</span>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
      )}

      {/* Input */}
      <div style={{
        padding: '12px 12px',
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        flexShrink: 0,
      }}>
        <input
          style={{
            flex: 1,
            background: '#0a0a0a',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 24,
            padding: '12px 18px',
            color: '#fff',
            fontSize: 15,
            outline: 'none',
            minHeight: 48,
            fontFamily: 'inherit',
            transition: 'border-color 0.15s',
          }}
          onFocus={(e) => (e.target.style.borderColor = 'rgba(30,215,96,0.4)')}
          onBlur={(e) => (e.target.style.borderColor = 'rgba(255,255,255,0.08)')}
          placeholder={chatMessages.length === 0 ? 'Describe your song idea...' : 'Ask for changes or chat...'}
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleChatSend()}
          disabled={chatLoading}
        />
        <button
          onClick={handleChatSend}
          disabled={chatLoading || !chatInput.trim()}
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: chatInput.trim() ? '#1ed760' : '#1a1a1a',
            border: 'none',
            cursor: chatInput.trim() ? 'pointer' : 'default',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background 0.15s',
            flexShrink: 0,
          }}
        >
          <svg viewBox="0 0 24 24" fill={chatInput.trim() ? '#000' : '#444'} style={{ width: 18, height: 18 }}>
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </div>
    </div>
  );

  /* ---- Song details + LoRA + generate (shared) ---- */
  const detailsPanel = (
    <div style={isMobile ? {} : { flex: '0 0 45%', minWidth: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* LoRA selector - compact pill style */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          className="form-select"
          value={lora}
          onChange={(e) => setLora(e.target.value)}
          style={{
            flex: '1 1 auto',
            minWidth: 0,
            maxWidth: 220,
            minHeight: 40,
            borderRadius: 20,
            padding: '8px 16px',
            fontSize: 13,
            background: lora ? 'rgba(30,215,96,0.1)' : '#161616',
            border: lora ? '1px solid rgba(30,215,96,0.3)' : '1px solid #222',
            color: lora ? '#1ed760' : '#888',
          }}
        >
          <option value="">Base Model</option>
          {loras.map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
        </select>
        {lora && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: '#666', whiteSpace: 'nowrap' }}>
              {parseFloat(strength).toFixed(1)}x
            </span>
            <input
              type="range" min="0" max="2" step="0.1"
              value={strength}
              onChange={(e) => setStrength(e.target.value)}
              style={{ width: 80, accentColor: '#1ed760' }}
            />
          </div>
        )}
      </div>

      {/* Song details section header (collapsible on mobile, always visible on desktop) */}
      {isMobile ? (
        <button
          onClick={() => setShowDetails(!showDetails)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            background: '#161616',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: showDetails ? '16px 16px 0 0' : 16,
            color: '#999',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            marginBottom: showDetails ? 0 : 16,
          }}
        >
          <span>
            Song Details
            {hasContent && !showDetails && (
              <span style={{ color: '#1ed760', marginLeft: 8, textTransform: 'none', fontWeight: 400, fontSize: 11 }}>
                {title || caption.slice(0, 30) + '...'}
              </span>
            )}
          </span>
          <svg
            viewBox="0 0 24 24" fill="currentColor" width={14} height={14}
            style={{ transform: showDetails ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
          >
            <path d="M7 10l5 5 5-5z" />
          </svg>
        </button>
      ) : (
        <div
          style={{
            padding: '10px 16px',
            background: '#161616',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '16px 16px 0 0',
            color: '#999',
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          Song Details
        </div>
      )}

      {desktopShowDetails && (
        <div
          style={{
            background: '#161616',
            border: '1px solid rgba(255,255,255,0.06)',
            borderTop: 'none',
            borderRadius: '0 0 16px 16px',
            padding: '16px',
            marginBottom: 16,
            ...(isMobile ? {} : { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto' }),
          }}
        >
          <div className="form-group">
            <label className="form-label">Title</label>
            <input
              className="form-input"
              placeholder="Song title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={{ maxWidth: 'none' }}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Caption</label>
            <textarea
              className="form-textarea"
              rows="2"
              placeholder="Genre, mood, instruments, vocal style..."
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              style={{ maxWidth: 'none' }}
            />
          </div>

          <div className="form-group" style={isMobile ? {} : { flex: 1, display: 'flex', flexDirection: 'column' }}>
            <label className="form-label">Lyrics</label>
            <textarea
              className="form-textarea"
              rows="6"
              style={{ fontFamily: 'monospace', fontSize: 13, maxWidth: 'none', ...(isMobile ? {} : { flex: 1, minHeight: 120 }) }}
              placeholder={`[Verse 1]\nYour lyrics here...\n\n[Chorus]\n...`}
              value={lyrics}
              onChange={(e) => setLyrics(e.target.value)}
            />
          </div>

          {/* Compact param row */}
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label className="form-label">BPM</label>
              <input
                className="form-input"
                type="number" min="30" max="300"
                value={bpm}
                onChange={(e) => setBpm(e.target.value)}
                style={{ maxWidth: 'none' }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label className="form-label">Key</label>
              <select
                className="form-select"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                style={{ maxWidth: 'none' }}
              >
                <option value="">Auto</option>
                {KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label className="form-label">Duration</label>
              <input
                className="form-input"
                type="number" min="30" max="480"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="s"
                style={{ maxWidth: 'none' }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Generate button */}
      <div style={{ marginTop: 8, marginBottom: isMobile ? 24 : 0 }}>
        <button
          onClick={handleGenerate}
          disabled={queuing || !hasContent}
          style={{
            width: '100%',
            padding: '15px 20px',
            borderRadius: 28,
            border: 'none',
            background: !queuing && hasContent ? '#1ed760' : '#2a2a2a',
            color: !queuing && hasContent ? '#000' : '#555',
            fontSize: 15,
            fontWeight: 700,
            cursor: !queuing && hasContent ? 'pointer' : 'not-allowed',
            transition: 'all 0.15s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            minHeight: 52,
          }}
        >
          {queuing ? (
            <>
              <span
                style={{
                  width: 16, height: 16, borderRadius: '50%',
                  border: '2px solid rgba(0,0,0,0.3)', borderTopColor: '#000',
                  animation: 'spin 0.7s linear infinite', display: 'inline-block',
                }}
              />
              Queuing...
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 16, height: 16 }}>
                <path d="M8 5v14l11-7z" />
              </svg>
              Generate
            </>
          )}
        </button>
      </div>
    </div>
  );

  return (
    <div style={isMobile ? { paddingBottom: 100 } : { height: '100%', overflow: 'hidden', padding: '24px 32px' }}>
      {isMobile ? (
        <>
          {/* Mobile: LoRA selector at top, then chat, then collapsible details, then generate */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <select
              className="form-select"
              value={lora}
              onChange={(e) => setLora(e.target.value)}
              style={{
                flex: '1 1 auto',
                minWidth: 0,
                maxWidth: 220,
                minHeight: 40,
                borderRadius: 20,
                padding: '8px 16px',
                fontSize: 13,
                background: lora ? 'rgba(30,215,96,0.1)' : '#161616',
                border: lora ? '1px solid rgba(30,215,96,0.3)' : '1px solid #222',
                color: lora ? '#1ed760' : '#888',
              }}
            >
              <option value="">Base Model</option>
              {loras.map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
            </select>
            {lora && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: '#666', whiteSpace: 'nowrap' }}>
                  {parseFloat(strength).toFixed(1)}x
                </span>
                <input
                  type="range" min="0" max="2" step="0.1"
                  value={strength}
                  onChange={(e) => setStrength(e.target.value)}
                  style={{ width: 80, accentColor: '#1ed760' }}
                />
              </div>
            )}
          </div>
          {chatPanel}
          {/* Collapsible song details */}
          <button
            onClick={() => setShowDetails(!showDetails)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              background: '#161616',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: showDetails ? '16px 16px 0 0' : 16,
              color: '#999',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              marginBottom: showDetails ? 0 : 16,
            }}
          >
            <span>
              Song Details
              {hasContent && !showDetails && (
                <span style={{ color: '#1ed760', marginLeft: 8, textTransform: 'none', fontWeight: 400, fontSize: 11 }}>
                  {title || caption.slice(0, 30) + '...'}
                </span>
              )}
            </span>
            <svg
              viewBox="0 0 24 24" fill="currentColor" width={14} height={14}
              style={{ transform: showDetails ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
            >
              <path d="M7 10l5 5 5-5z" />
            </svg>
          </button>

          {showDetails && (
            <div
              style={{
                background: '#161616',
                border: '1px solid rgba(255,255,255,0.06)',
                borderTop: 'none',
                borderRadius: '0 0 16px 16px',
                padding: '16px',
                marginBottom: 16,
              }}
            >
              <div className="form-group">
                <label className="form-label">Title</label>
                <input className="form-input" placeholder="Song title" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Caption</label>
                <textarea className="form-textarea" rows="2" placeholder="Genre, mood, instruments, vocal style..." value={caption} onChange={(e) => setCaption(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Lyrics</label>
                <textarea className="form-textarea" rows="6" style={{ fontFamily: 'monospace', fontSize: 13 }} placeholder={`[Verse 1]\nYour lyrics here...\n\n[Chorus]\n...`} value={lyrics} onChange={(e) => setLyrics(e.target.value)} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label className="form-label">BPM</label>
                  <input className="form-input" type="number" min="30" max="300" value={bpm} onChange={(e) => setBpm(e.target.value)} />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="form-label">Key</label>
                  <select className="form-select" value={key} onChange={(e) => setKey(e.target.value)}>
                    <option value="">Auto</option>
                    {KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label className="form-label">Duration</label>
                  <input className="form-input" type="number" min="30" max="480" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="s" />
                </div>
              </div>
            </div>
          )}

          {/* Generate button */}
          <div style={{ marginTop: 16, marginBottom: 24 }}>
            <button
              onClick={handleGenerate}
              disabled={queuing || !hasContent}
              style={{
                width: '100%', padding: '15px 20px', borderRadius: 28, border: 'none',
                background: !queuing && hasContent ? '#1ed760' : '#2a2a2a',
                color: !queuing && hasContent ? '#000' : '#555',
                fontSize: 15, fontWeight: 700,
                cursor: !queuing && hasContent ? 'pointer' : 'not-allowed',
                transition: 'all 0.15s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 52,
              }}
            >
              {queuing ? (
                <>
                  <span style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid rgba(0,0,0,0.3)', borderTopColor: '#000', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />
                  Queuing...
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 16, height: 16 }}><path d="M8 5v14l11-7z" /></svg>
                  Generate
                </>
              )}
            </button>
          </div>
        </>
      ) : (
        /* Desktop: two-column layout, full viewport height */
        <div style={{ display: 'flex', gap: 24, height: '100%' }}>
          {chatPanel}
          {detailsPanel}
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
