import { useState, useEffect, useRef, useCallback } from 'react';
import { getLoras, getArtistTracks, startGenerate, aiBuild } from '../api.js';

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

const TABS = [
  { id: 'sound', label: 'Sound' },
  { id: 'lyrics', label: 'Lyrics' },
  { id: 'settings', label: 'Settings' },
];

const STARTERS = [
  { icon: '🎸', text: 'Acoustic ballad with raw vocals', sub: 'Folk / Singer-songwriter' },
  { icon: '🎹', text: 'Upbeat synth-pop anthem', sub: 'Electronic / Pop' },
  { icon: '🎤', text: 'Help me write a duet', sub: 'Collaborative songwriting' },
  { icon: '🎵', text: 'Instrumental — no vocals', sub: 'Cinematic / Ambient' },
];

export default function BuildForm({ onToast }) {
  const [loras, setLoras] = useState([]);
  const [lora, setLora] = useState('');
  const [strength, setStrength] = useState(1.6);
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [bpm, setBpm] = useState(120);
  const [key, setKey] = useState('');
  const [duration, setDuration] = useState(180);
  const [queuing, setQueuing] = useState(false);

  const [canvasOpen, setCanvasOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('sound');
  const [tabDirty, setTabDirty] = useState({});

  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  const [conversationId] = useState(() => Math.random().toString(36).slice(2, 10));
  const [turnCount, setTurnCount] = useState(0);
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);
  const isMobile = useIsMobile();

  const [mobileView, setMobileView] = useState('chat');
  const [unreadChat, setUnreadChat] = useState(false);
  const [showLoraPopover, setShowLoraPopover] = useState(false);
  const [showTrackPicker, setShowTrackPicker] = useState(false);
  const [artistTracks, setArtistTracks] = useState([]);
  const [trackSearch, setTrackSearch] = useState('');

  useEffect(() => { getLoras().then(setLoras).catch(() => {}); }, []);

  // Load artist tracks when LoRA changes (LoRA name = artist slug)
  useEffect(() => {
    if (lora) {
      getArtistTracks(lora).then(setArtistTracks).catch(() => setArtistTracks([]));
    } else {
      setArtistTracks([]);
    }
    setShowTrackPicker(false);
  }, [lora]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const applySettings = useCallback((inp) => {
    if (!inp) return;
    if (inp.title !== undefined) setTitle(inp.title || '');
    if (inp.caption !== undefined) setCaption(inp.caption || '');
    if (inp.lyrics !== undefined) setLyrics(inp.lyrics || '');
    if (inp.bpm !== undefined) setBpm(inp.bpm || 120);
    if (inp.key !== undefined) setKey(inp.key || '');
    if (inp.duration !== undefined) setDuration(inp.duration || 180);
    if (inp.lora_name && inp.lora_name !== '(base model)') setLora(inp.lora_name);
    if (inp.strength !== undefined) setStrength(inp.strength || 1.6);
    if (inp.chat_history && Array.isArray(inp.chat_history) && inp.chat_history.length > 0) {
      setChatMessages(inp.chat_history);
    }
    setCanvasOpen(true);
  }, []);

  useEffect(() => {
    const stored = sessionStorage.getItem('lora-studio:reuse-settings');
    if (stored) {
      try {
        applySettings(JSON.parse(stored));
        onToast('Settings loaded');
      } catch {}
      sessionStorage.removeItem('lora-studio:reuse-settings');
    }

    // "Make More Like This" — auto-send a prompt based on an existing song
    const makeMore = sessionStorage.getItem('lora-studio:make-more');
    if (makeMore) {
      try {
        const src = JSON.parse(makeMore);
        if (src.lora_name && src.lora_name !== '(base model)') setLora(src.lora_name);
        if (src.strength) setStrength(src.strength);
        let prompt = `Write a new song inspired by "${src.title}".\n\nStyle: ${src.caption}`;
        if (src.bpm) prompt += `\nBPM: ${src.bpm}`;
        if (src.key) prompt += `\nKey: ${src.key}`;
        if (src.duration) prompt += `\nDuration: ~${Math.round(src.duration)}s`;
        if (src.lyrics && src.lyrics !== '[Instrumental]') {
          prompt += `\n\nReference lyrics below for STRUCTURE and THEME only. Do NOT copy any lines — write completely original lyrics with similar verse/chorus structure, mood, and subject matter:\n${src.lyrics}`;
        }
        prompt += `\n\nCreate a completely original song — new title, entirely new lyrics (no copied lines), same vibe and production style.`;
        // Auto-send immediately — prompt is too long for the input field
        setChatInput(prompt);
        setTimeout(() => {
          const fakeEvent = { key: 'Enter', shiftKey: false };
          // Trigger send directly
          setChatInput('');
          const newMessages = [{ role: 'user', content: prompt }];
          setChatMessages(newMessages);
          setChatLoading(true);
          const current = null;
          aiBuild({ prompt, current, chat_history: [], conversation_id: conversationId, turn: 1, lora_name: src.lora_name || '' })
            .then(result => {
              const isChat = !!result._chat || (!result.title && !result.caption && !result.lyrics);
              if (!isChat) {
                if (result.title) setTitle(result.title);
                if (result.caption) setCaption(result.caption);
                if (result.lyrics !== undefined) setLyrics(result.lyrics);
                if (result.bpm) setBpm(result.bpm);
                if (result.key) setKey(result.key);
                if (result.duration) setDuration(result.duration);
                setCanvasOpen(true);
              }
              const summary = isChat
                ? (result._chat || 'Song settings updated.')
                : `Built: "${result.title}" — ${result.caption?.slice(0, 60)}... | ${result.bpm} BPM, ${result.key}, ${result.duration}s`;
              setChatMessages([...newMessages, { role: 'assistant', content: summary }]);
              setChatHistory([
                { role: 'user', content: prompt },
                { role: 'assistant', content: result._ai_response || JSON.stringify(result) },
              ]);
              setTurnCount(1);
              if (!isChat) onToast('Song built!');
            })
            .catch(e => {
              setChatMessages([...newMessages, { role: 'assistant', content: `Error: ${e.message}` }]);
              onToast(e.message, 'error');
            })
            .finally(() => setChatLoading(false));
        }, 100);
      } catch {}
      sessionStorage.removeItem('lora-studio:make-more');
    }
  }, [applySettings, onToast]);

  useEffect(() => {
    const handler = (e) => {
      applySettings(e.detail);
      onToast('Settings loaded');
      sessionStorage.removeItem('lora-studio:reuse-settings');
    };
    window.addEventListener('lora-studio:reuse-settings', handler);
    return () => window.removeEventListener('lora-studio:reuse-settings', handler);
  }, [applySettings, onToast]);

  const handleTabClick = (tabId) => {
    setActiveTab(tabId);
    setTabDirty(prev => ({ ...prev, [tabId]: false }));
  };

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

      const isChat = !!result._chat || (!result.title && !result.caption && !result.lyrics);
      const dirtyTabs = {};

      if (!isChat) {
        if (result.caption || result.bpm || result.key || result.duration) dirtyTabs.sound = true;
        if (result.lyrics !== undefined) dirtyTabs.lyrics = true;

        if (result.title) setTitle(result.title);
        if (result.caption) setCaption(result.caption);
        if (result.lyrics !== undefined) setLyrics(result.lyrics);
        if (result.bpm) setBpm(result.bpm);
        if (result.key) setKey(result.key);
        if (result.duration) setDuration(result.duration);

        if (!canvasOpen) setCanvasOpen(true);

        setTabDirty(prev => {
          const next = { ...prev };
          for (const tab of Object.keys(dirtyTabs)) {
            if (tab !== activeTab) next[tab] = true;
          }
          return next;
        });
      }

      let summary;
      if (isChat) {
        summary = result._chat || 'Song settings updated.';
      } else {
        summary = hasExisting
          ? `Updated: ${result.title || title || 'song'} — ${result.bpm || bpm} BPM, ${result.key || key}, ${result.duration || duration}s`
          : `Built: "${result.title}" — ${result.caption?.slice(0, 60)}... | ${result.bpm} BPM, ${result.key}, ${result.duration}s`;
      }

      setChatMessages([...newMessages, { role: 'assistant', content: summary }]);
      setChatHistory([
        ...chatHistory,
        { role: 'user', content: msg },
        { role: 'assistant', content: result._ai_response || JSON.stringify(result) },
      ]);

      if (isMobile && mobileView === 'song' && !isChat) setUnreadChat(true);
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
    if (queuing) return; // prevent double-tap
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
      // Keep button disabled — don't re-enable until user starts a new chat
    } catch (e) {
      onToast(e.message, 'error');
      setQueuing(false);
    }
  };

  const handleClearChat = () => {
    setChatMessages([]);
    setChatHistory([]);
    setTitle(''); setCaption(''); setLyrics('');
    setBpm(120); setKey(''); setDuration(180);
    setCanvasOpen(false);
    setActiveTab('sound');
    setTabDirty({});
    setMobileView('chat');
  };

  const handleStarterClick = (text) => {
    setChatInput(text);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const hasContent = caption.trim();

  /* ---- Welcome state (empty chat) ---- */
  const welcomeState = (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      justifyContent: 'flex-end', padding: isMobile ? '20px 16px' : '40px 20px',
      gap: isMobile ? 20 : 32,
    }}>
      {/* Greeting */}
      <div style={{ textAlign: 'center' }}>
        <div style={{
          fontSize: isMobile ? 22 : 28, fontWeight: 700, color: '#fff',
          marginBottom: 6, letterSpacing: '-0.02em',
        }}>
          What do you want to create?
        </div>
        <div style={{ fontSize: isMobile ? 13 : 14, color: '#555' }}>
          Describe a song and the AI will build everything for you
        </div>
      </div>

      {/* Starter cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)',
        gap: isMobile ? 8 : 10,
        maxWidth: 700,
        alignSelf: 'center',
        width: '100%',
      }}>
        {STARTERS.map((s) => (
          <button
            key={s.text}
            onClick={() => handleStarterClick(s.text)}
            style={{
              background: '#161616',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 14,
              padding: isMobile ? '14px 12px' : '16px 14px',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.15s',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'rgba(30,215,96,0.3)';
              e.currentTarget.style.background = '#1a1a1a';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)';
              e.currentTarget.style.background = '#161616';
            }}
          >
            <span style={{ fontSize: isMobile ? 18 : 20 }}>{s.icon}</span>
            <span style={{ fontSize: isMobile ? 12 : 13, color: '#ccc', fontWeight: 500, lineHeight: 1.3 }}>
              {s.text}
            </span>
            <span style={{ fontSize: 11, color: '#444' }}>{s.sub}</span>
          </button>
        ))}
      </div>
    </div>
  );

  /* ---- Chat messages ---- */
  const messagesView = (
    <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '12px 12px' : '20px 20px', minHeight: 0 }}>
      {/* New chat button — floating top-right */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <button
          onClick={handleClearChat}
          style={{
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
            color: '#555', fontSize: 11, cursor: 'pointer', padding: '5px 14px',
            borderRadius: 12, transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#999'; e.currentTarget.style.borderColor = '#333'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = '#555'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
        >New chat</button>
      </div>
      {chatMessages.map((msg, i) => (
        <div key={i} style={{
          marginBottom: 12, display: 'flex',
          justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
        }}>
          <div style={{
            padding: '10px 16px',
            borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
            background: msg.role === 'user' ? '#1ed760' : '#1a1a1a',
            color: msg.role === 'user' ? '#000' : (msg.content.startsWith('Error') ? '#f87171' : '#c0c0c0'),
            fontSize: 14, maxWidth: isMobile ? '85%' : 480, lineHeight: 1.5,
            fontWeight: msg.role === 'user' ? 600 : 400, whiteSpace: 'pre-wrap',
          }}>{msg.content}</div>
        </div>
      ))}
      {chatLoading && (
        <div style={{ display: 'flex', marginBottom: 12 }}>
          <div style={{
            padding: '10px 16px', borderRadius: '18px 18px 18px 4px',
            background: '#1a1a1a', color: '#555', fontSize: 14,
            display: 'flex', gap: 4,
          }}>
            <span style={{ animation: 'pulse 1s infinite 0s' }}>.</span>
            <span style={{ animation: 'pulse 1s infinite 0.2s' }}>.</span>
            <span style={{ animation: 'pulse 1s infinite 0.4s' }}>.</span>
          </div>
        </div>
      )}
      <div ref={chatEndRef} />
    </div>
  );

  /* ---- Input bar ---- */
  const inputBar = (
    <div style={{ flexShrink: 0 }}>
      {/* Browse tracks chip — shown when LoRA selected */}
      {lora && artistTracks.length > 0 && !showTrackPicker && (
        <div style={{ padding: isMobile ? '4px 12px 0' : '4px 20px 0' }}>
          <button
            onClick={() => { setShowTrackPicker(true); setTrackSearch(''); }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', borderRadius: 20,
              background: 'rgba(249,158,11,0.08)', border: '1px solid rgba(249,158,11,0.2)',
              color: '#f59e0b', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(249,158,11,0.15)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(249,158,11,0.08)'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}>
              <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
            </svg>
            Inspire from {lora} tracks ({artistTracks.length})
          </button>
        </div>
      )}
      <div style={{
        padding: isMobile ? '8px 12px 10px' : '10px 20px 16px',
        display: 'flex', gap: 8, alignItems: 'center',
      }}>
      {/* LoRA button — compact, inside the input area */}
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setShowLoraPopover(!showLoraPopover)}
          style={{
            width: 40, height: 40, borderRadius: 12,
            background: lora ? 'rgba(30,215,96,0.12)' : '#161616',
            border: lora ? '1px solid rgba(30,215,96,0.25)' : '1px solid #222',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, transition: 'all 0.15s',
          }}
          title={lora || 'Select voice model'}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke={lora ? '#1ed760' : '#555'} strokeWidth="2" style={{ width: 18, height: 18 }}>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        {/* LoRA popover */}
        {showLoraPopover && (
          <>
            <div
              onClick={() => setShowLoraPopover(false)}
              style={{ position: 'fixed', inset: 0, zIndex: 99 }}
            />
            <div style={{
              position: 'absolute', bottom: 50, left: 0, zIndex: 100,
              background: '#1a1a1a', border: '1px solid #333', borderRadius: 14,
              padding: 12, minWidth: 220, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            }}>
              <div style={{ fontSize: 11, color: '#666', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                Voice Model
              </div>
              <select
                className="form-select"
                value={lora}
                onChange={(e) => setLora(e.target.value)}
                style={{ width: '100%', maxWidth: 'none', marginBottom: lora ? 10 : 0 }}
              >
                <option value="">Base Model (no LoRA)</option>
                {loras.map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
              </select>
              {lora && (
                <div>
                  <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>
                    Strength — {parseFloat(strength).toFixed(1)}x
                  </div>
                  <input
                    type="range" min="0" max="2" step="0.1"
                    value={strength}
                    onChange={(e) => setStrength(e.target.value)}
                    style={{ width: '100%', accentColor: '#1ed760' }}
                  />
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Input field */}
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center',
        background: '#161616', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 24, padding: '4px 4px 4px 18px',
        transition: 'border-color 0.15s',
      }}
        onFocus={(e) => e.currentTarget.style.borderColor = 'rgba(30,215,96,0.3)'}
        onBlur={(e) => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'}
      >
        <input
          ref={inputRef}
          style={{
            flex: 1, background: 'none', border: 'none',
            color: '#fff', fontSize: 15, outline: 'none',
            fontFamily: 'inherit', minHeight: 40,
          }}
          placeholder={chatMessages.length === 0 ? 'Describe your song...' : 'Ask for changes...'}
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleChatSend()}
          disabled={chatLoading}
        />
        <button
          onClick={handleChatSend}
          disabled={chatLoading || !chatInput.trim()}
          style={{
            width: 36, height: 36, borderRadius: '50%',
            background: chatInput.trim() ? '#1ed760' : 'transparent',
            border: 'none', cursor: chatInput.trim() ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 0.15s', flexShrink: 0,
          }}
        >
          <svg viewBox="0 0 24 24" fill={chatInput.trim() ? '#000' : '#333'} style={{ width: 16, height: 16 }}>
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </div>

      {/* LoRA indicator chip */}
      {lora && !showLoraPopover && (
        <div style={{
          fontSize: 10, color: '#1ed760', fontWeight: 600,
          background: 'rgba(30,215,96,0.1)', border: '1px solid rgba(30,215,96,0.2)',
          borderRadius: 10, padding: '4px 10px', whiteSpace: 'nowrap', flexShrink: 0,
        }}>
          {lora.length > 12 ? lora.slice(0, 12) + '...' : lora}
        </div>
      )}
      </div>
    </div>
  );

  /* ---- Generate button ---- */
  const generateButton = (
    <button
      onClick={handleGenerate}
      disabled={queuing || !hasContent}
      style={{
        padding: '10px 24px', borderRadius: 20, border: 'none',
        background: !queuing && hasContent ? '#1ed760' : '#2a2a2a',
        color: !queuing && hasContent ? '#000' : '#555',
        fontSize: 13, fontWeight: 700,
        cursor: !queuing && hasContent ? 'pointer' : 'not-allowed',
        transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 6,
        whiteSpace: 'nowrap',
      }}
    >
      {queuing ? (
        <>
          <span style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid rgba(0,0,0,0.3)', borderTopColor: '#000', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />
          Queuing...
        </>
      ) : (
        <>
          <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 14, height: 14 }}><path d="M8 5v14l11-7z" /></svg>
          Generate
        </>
      )}
    </button>
  );

  /* ---- Tab content renderer ---- */
  const renderTabContent = () => {
    switch (activeTab) {
      case 'sound':
        return (
          <div style={{ padding: 16 }}>
            <div className="form-group">
              <label className="form-label">Caption</label>
              <textarea
                className="form-textarea"
                rows="3"
                placeholder="Genre, mood, instruments, vocal style..."
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                style={{ maxWidth: 'none' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label className="form-label">BPM</label>
                <input className="form-input" type="number" min="30" max="300" value={bpm} onChange={(e) => setBpm(e.target.value)} style={{ maxWidth: 'none' }} />
              </div>
              <div style={{ flex: 1 }}>
                <label className="form-label">Key</label>
                <select className="form-select" value={key} onChange={(e) => setKey(e.target.value)} style={{ maxWidth: 'none' }}>
                  <option value="">Auto</option>
                  {KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              {duration && (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: 12, color: '#555' }}>{Math.floor(duration / 60)}:{String(Math.floor(duration % 60)).padStart(2, '0')} auto</span>
                </div>
              )}
            </div>
          </div>
        );
      case 'lyrics':
        return (
          <div style={{ padding: 16, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <textarea
              className="form-textarea"
              placeholder={`[Verse 1]\nYour lyrics here...\n\n[Chorus]\n...`}
              value={lyrics}
              onChange={(e) => setLyrics(e.target.value)}
              style={{ flex: 1, fontFamily: 'monospace', fontSize: 13, maxWidth: 'none', minHeight: 200, resize: 'none' }}
            />
          </div>
        );
      case 'settings':
        return (
          <div style={{ padding: 16 }}>
            <div className="form-group">
              <label className="form-label">Voice Model (LoRA)</label>
              <select className="form-select" value={lora} onChange={(e) => setLora(e.target.value)} style={{ maxWidth: 'none' }}>
                <option value="">Base Model (no LoRA)</option>
                {loras.map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
              </select>
            </div>
            {lora && (
              <div className="form-group">
                <label className="form-label">LoRA Strength — {parseFloat(strength).toFixed(1)}x</label>
                <input type="range" min="0" max="2" step="0.1" value={strength} onChange={(e) => setStrength(e.target.value)} style={{ width: '100%', accentColor: '#1ed760' }} />
              </div>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  /* ---- Canvas panel (desktop) ---- */
  const canvasPanel = (
    <div className={`build-canvas${canvasOpen ? '' : ' collapsed'}`}>
      <div className="canvas-header">
        <input placeholder="Song title..." value={title} onChange={(e) => setTitle(e.target.value)} />
        <button
          onClick={() => setCanvasOpen(false)}
          style={{
            background: 'rgba(255,255,255,0.06)', border: 'none', color: '#666',
            width: 28, height: 28, borderRadius: '50%', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}
          title="Close canvas"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 14, height: 14 }}>
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
          </svg>
        </button>
      </div>
      <div className="canvas-tabs">
        {TABS.map((tab) => (
          <button key={tab.id} className={`canvas-tab${activeTab === tab.id ? ' active' : ''}`} onClick={() => handleTabClick(tab.id)}>
            {tab.label}
            <span className={`tab-dot${tabDirty[tab.id] ? ' visible' : ''}`} />
          </button>
        ))}
      </div>
      <div className="canvas-tab-content" style={activeTab === 'lyrics' ? { display: 'flex', flexDirection: 'column' } : {}}>
        {renderTabContent()}
      </div>
      <div className="canvas-footer">
        {lora && (
          <div style={{ background: 'rgba(30,215,96,0.1)', border: '1px solid rgba(30,215,96,0.2)', borderRadius: 10, padding: '4px 10px', fontSize: 10, color: '#1ed760', fontWeight: 600 }}>
            {lora} {parseFloat(strength).toFixed(1)}x
          </div>
        )}
        <div style={{ flex: 1 }} />
        {generateButton}
      </div>
    </div>
  );

  /* ---- Mobile song view ---- */
  const mobileSongView = (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: '#161616', borderRadius: 16, overflow: 'hidden' }}>
      <div className="canvas-header">
        <input placeholder="Song title..." value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="canvas-tabs">
        {TABS.map((tab) => (
          <button key={tab.id} className={`canvas-tab${activeTab === tab.id ? ' active' : ''}`} onClick={() => handleTabClick(tab.id)}>
            {tab.label}
            <span className={`tab-dot${tabDirty[tab.id] ? ' visible' : ''}`} />
          </button>
        ))}
      </div>
      <div className="canvas-tab-content" style={activeTab === 'lyrics' ? { display: 'flex', flexDirection: 'column' } : {}}>
        {renderTabContent()}
      </div>
      <div className="canvas-footer">
        {lora && (
          <div style={{ background: 'rgba(30,215,96,0.1)', border: '1px solid rgba(30,215,96,0.2)', borderRadius: 10, padding: '4px 10px', fontSize: 10, color: '#1ed760', fontWeight: 600 }}>
            {lora} {parseFloat(strength).toFixed(1)}x
          </div>
        )}
        <div style={{ flex: 1 }} />
        {generateButton}
      </div>
    </div>
  );

  /* ---- Track picker modal ---- */
  const trackPickerModal = showTrackPicker && lora && artistTracks.length > 0 && (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {/* Backdrop */}
      <div onClick={() => setShowTrackPicker(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)' }} />
      {/* Modal */}
      <div style={{
        position: 'relative', zIndex: 1,
        background: '#1a1a1a', border: '1px solid #333', borderRadius: 20,
        width: isMobile ? 'calc(100% - 32px)' : 460, maxHeight: '70vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid #222', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>
              Inspire from {lora}
            </div>
            <button
              onClick={() => setShowTrackPicker(false)}
              style={{ background: 'rgba(255,255,255,0.06)', border: 'none', color: '#666', width: 28, height: 28, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 14, height: 14 }}>
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
              </svg>
            </button>
          </div>
          <input
            autoFocus
            value={trackSearch}
            onChange={(e) => setTrackSearch(e.target.value)}
            placeholder="Search tracks..."
            style={{
              width: '100%', background: '#111', border: '1px solid #333', borderRadius: 12,
              padding: '10px 14px', color: '#fff', fontSize: 14, outline: 'none', fontFamily: 'inherit',
            }}
          />
        </div>
        {/* Track list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {artistTracks
            .filter(t => !trackSearch || t.filename.toLowerCase().includes(trackSearch.toLowerCase()))
            .map((t) => (
            <div
              key={t.filename}
              onClick={() => {
                let prompt = `Write a new song inspired by "${t.filename}".\n\nStyle: ${t.caption || 'similar production and mood'}`;
                if (t.bpm) prompt += `\nBPM: ${t.bpm}`;
                if (t.key) prompt += `\nKey: ${t.key}`;
                if (t.duration) prompt += `\nDuration: ~${Math.round(t.duration)}s`;
                if (t.lyrics && t.lyrics !== '[Instrumental]') {
                  prompt += `\n\nReference lyrics below for STRUCTURE and THEME only. Do NOT copy any lines — write completely original lyrics with similar verse/chorus structure, mood, and subject matter:\n${t.lyrics}`;
                }
                prompt += `\n\nCreate a completely original song — new title, entirely new lyrics (no copied lines), same vibe and production style.`;
                setShowTrackPicker(false);
                // Auto-send the full prompt
                const shortDisplay = `Make more like "${t.filename}" — same style, new lyrics`;
                const newMessages = [{ role: 'user', content: shortDisplay }];
                setChatMessages(newMessages);
                setChatInput('');
                setChatLoading(true);
                aiBuild({ prompt, current: null, chat_history: [], conversation_id: conversationId, turn: 1, lora_name: lora || '' })
                  .then(result => {
                    const isChat = !!result._chat || (!result.title && !result.caption && !result.lyrics);
                    if (!isChat) {
                      if (result.title) setTitle(result.title);
                      if (result.caption) setCaption(result.caption);
                      if (result.lyrics !== undefined) setLyrics(result.lyrics);
                      if (result.bpm) setBpm(result.bpm);
                      if (result.key) setKey(result.key);
                      if (result.duration) setDuration(result.duration);
                      setCanvasOpen(true);
                    }
                    const summary = isChat
                      ? (result._chat || 'Song settings updated.')
                      : `Built: "${result.title}" — ${result.caption?.slice(0, 60)}... | ${result.bpm} BPM, ${result.key}, ${result.duration}s`;
                    setChatMessages([...newMessages, { role: 'assistant', content: summary }]);
                    setChatHistory([{ role: 'user', content: prompt }, { role: 'assistant', content: result._ai_response || JSON.stringify(result) }]);
                    setTurnCount(1);
                    if (!isChat) onToast('Song built!');
                  })
                  .catch(e => {
                    setChatMessages([...newMessages, { role: 'assistant', content: `Error: ${e.message}` }]);
                    onToast(e.message, 'error');
                  })
                  .finally(() => setChatLoading(false));
              }}
              style={{ padding: '12px 20px', cursor: 'pointer', transition: 'background 0.1s' }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(249,158,11,0.06)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{ fontSize: 14, color: '#ddd', fontWeight: 500, marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.filename}
              </div>
              <div style={{ fontSize: 12, color: '#555' }}>
                {[t.bpm && `${t.bpm} BPM`, t.key, t.duration && `${Math.floor(t.duration / 60)}:${String(Math.floor(t.duration % 60)).padStart(2, '0')}`].filter(Boolean).join(' · ') || 'No label data'}
              </div>
            </div>
          ))}
          {artistTracks.filter(t => !trackSearch || t.filename.toLowerCase().includes(trackSearch.toLowerCase())).length === 0 && (
            <div style={{ padding: '24px 20px', color: '#555', fontSize: 13, textAlign: 'center' }}>No tracks found</div>
          )}
        </div>
        {/* Footer */}
        <div style={{ padding: '10px 20px', borderTop: '1px solid #222', flexShrink: 0 }}>
          <div style={{ fontSize: 11, color: '#555' }}>{artistTracks.length} tracks available</div>
        </div>
      </div>
    </div>
  );

  /* ==================== MOBILE RENDER ==================== */
  if (isMobile) {
    return (
      <div className="mobile-flip">
        {/* Chat/Song toggle — only when song exists */}
        {canvasOpen && (
          <div className="mobile-flip-toggle">
            <button
              onClick={() => { setMobileView('chat'); setUnreadChat(false); }}
              style={{
                background: mobileView === 'chat' ? '#1ed760' : 'transparent',
                color: mobileView === 'chat' ? '#000' : '#888',
                position: 'relative',
              }}
            >
              Chat
              {unreadChat && mobileView !== 'chat' && (
                <span style={{ position: 'absolute', top: 4, right: 4, width: 6, height: 6, borderRadius: '50%', background: '#1ed760' }} />
              )}
            </button>
            <button
              onClick={() => setMobileView('song')}
              style={{
                background: mobileView === 'song' ? '#1ed760' : 'transparent',
                color: mobileView === 'song' ? '#000' : '#888',
              }}
            >Song</button>
          </div>
        )}

        {/* Sticky song bar in chat view */}
        {mobileView === 'chat' && canvasOpen && (
          <div className="mobile-song-bar" onClick={() => setMobileView('song')}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {title || 'Untitled'}
              </div>
              <div style={{ fontSize: 11, color: '#555' }}>
                {bpm} BPM {key && `· ${key}`} · {Math.floor(duration / 60)}:{String(Math.floor(duration % 60)).padStart(2, '0')}
              </div>
            </div>
            {generateButton}
          </div>
        )}

        {/* Active view */}
        <div className="mobile-flip-view">
          {mobileView === 'chat' ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              {chatMessages.length === 0 ? welcomeState : messagesView}
              {inputBar}
            </div>
          ) : mobileSongView}
        </div>

        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        {trackPickerModal}
      </div>
    );
  }

  /* ==================== DESKTOP RENDER ==================== */
  return (
    <div style={{ height: '100%', overflow: 'hidden' }}>
      <div className="build-layout" style={{ height: '100%' }}>
        {/* Chat column */}
        <div className="build-chat" style={{ display: 'flex', flexDirection: 'column', background: 'transparent' }}>
          {chatMessages.length === 0 ? welcomeState : messagesView}
          {inputBar}
        </div>
        {/* Canvas column */}
        {canvasPanel}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      {trackPickerModal}
    </div>
  );
}
