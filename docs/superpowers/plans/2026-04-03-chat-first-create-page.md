# Chat-First Create Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the Create page so chat is the primary interface, with a tabbed canvas (Sound/Lyrics/Settings) that slides in after the first AI song response. Mobile uses a Chat/Song flip toggle.

**Architecture:** `BuildForm.jsx` is rewritten as the single orchestrator — it manages chat state, song field state, canvas visibility, and renders both the chat panel and tabbed canvas. `Generate.jsx` becomes a thin wrapper (queue panel + mode toggle + BuildForm). New CSS classes in `App.css` handle canvas slide animation and tab styling.

**Tech Stack:** React (hooks), inline styles + App.css, existing API functions (`aiBuild`, `startGenerate`, `getLoras`)

**Spec:** `docs/superpowers/specs/2026-04-03-chat-first-create-page-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/components/BuildForm.jsx` | Rewrite | Chat panel + tabbed canvas + all song state management |
| `src/pages/Generate.jsx` | Modify | Thin wrapper: queue panel, mode toggle, renders BuildForm or PlaylistBuilder |
| `src/App.css` | Modify | Add canvas slide animation, tab styles, mobile flip-view transitions |

**Unchanged:** `QueueSection.jsx`, `PlaylistBuilder.jsx`, `ReviewPanel.jsx`, `api.js`, `App.jsx`

---

### Task 1: Add CSS for canvas animations and tabs

**Files:**
- Modify: `src/App.css` (append new rules at end)

This task adds all the CSS infrastructure needed before we touch any components.

- [ ] **Step 1: Add canvas slide and tab CSS to App.css**

Append these rules to the end of `src/App.css` (before the closing of the file):

```css
/* ---- Chat-first canvas ---- */
.build-layout {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.build-chat {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  transition: flex 0.3s ease;
}

.build-canvas {
  flex: 0 0 45%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border-left: 2px solid var(--accent);
  background: var(--panel);
  transform: translateX(0);
  transition: transform 0.3s ease, flex 0.3s ease;
  overflow: hidden;
}

.build-canvas.collapsed {
  flex: 0 0 0%;
  border-left: none;
  transform: translateX(100%);
  pointer-events: none;
}

/* Canvas tabs */
.canvas-tabs {
  display: flex;
  border-bottom: 1px solid var(--border);
  padding: 0 12px;
  flex-shrink: 0;
}

.canvas-tab {
  padding: 10px 14px;
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
  border: none;
  background: none;
  border-bottom: 2px solid transparent;
  position: relative;
  transition: color 0.15s;
}

.canvas-tab:hover {
  color: var(--text-secondary);
}

.canvas-tab.active {
  color: #fff;
  font-weight: 600;
  border-bottom-color: var(--accent);
}

.canvas-tab .tab-dot {
  position: absolute;
  top: 8px;
  right: 6px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent);
  opacity: 0;
  transition: opacity 0.3s;
}

.canvas-tab .tab-dot.visible {
  opacity: 1;
}

.canvas-tab-content {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

/* Canvas header */
.canvas-header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  gap: 8px;
  flex-shrink: 0;
}

.canvas-header input {
  flex: 1;
  font-size: 16px;
  font-weight: 700;
  color: #fff;
  background: none;
  border: none;
  outline: none;
  padding: 4px 0;
  font-family: inherit;
}

.canvas-header input::placeholder {
  color: var(--text-muted);
}

/* Canvas footer */
.canvas-footer {
  display: flex;
  align-items: center;
  padding: 10px 16px;
  border-top: 1px solid var(--border);
  gap: 8px;
  flex-shrink: 0;
}

/* Mobile flip view */
.mobile-flip {
  display: flex;
  flex-direction: column;
  height: calc(100dvh - 64px - 60px);
  /* 64px bottom nav + 60px now-playing approx */
}

.mobile-flip-toggle {
  display: flex;
  gap: 4px;
  padding: 3px;
  background: #111;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  align-self: flex-start;
  margin-bottom: 12px;
  flex-shrink: 0;
}

.mobile-flip-toggle button {
  padding: 8px 16px;
  border-radius: 11px;
  border: none;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  transition: all 0.15s;
}

.mobile-flip-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* Mobile sticky song bar (shown in chat view when song exists) */
.mobile-song-bar {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  background: var(--panel);
  border: 1px solid rgba(30, 215, 96, 0.2);
  border-radius: 12px;
  margin-bottom: 8px;
  cursor: pointer;
  gap: 8px;
  flex-shrink: 0;
  transition: background 0.15s;
}

.mobile-song-bar:hover {
  background: #1a1a1a;
}

/* Narrow desktop canvas */
@media (min-width: 769px) and (max-width: 1024px) {
  .build-canvas {
    flex: 0 0 40%;
  }
}
```

- [ ] **Step 2: Verify the CSS loads without errors**

Run: `cd F:/ACE-Step-1.5/lora-studio/frontend && npx vite build --mode development 2>&1 | head -5`

Expected: Build succeeds (or dev server already running shows no CSS errors).

- [ ] **Step 3: Commit**

```bash
git add lora-studio/frontend/src/App.css
git commit -m "feat: add CSS for chat-first canvas layout, tabs, and mobile flip view"
```

---

### Task 2: Simplify Generate.jsx wrapper

**Files:**
- Modify: `src/pages/Generate.jsx`

Generate.jsx currently wraps BuildForm with a mode toggle and queue panel. We simplify it: the mode toggle stays here, but the desktop layout no longer needs to manage BuildForm's internal two-column layout (BuildForm does that itself now).

- [ ] **Step 1: Rewrite Generate.jsx**

Replace the entire contents of `src/pages/Generate.jsx` with:

```jsx
import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getQueue } from '../api.js';
import BuildForm from '../components/BuildForm.jsx';
import PlaylistBuilder from '../components/PlaylistBuilder.jsx';
import ReviewPanel from '../components/ReviewPanel.jsx';
import QueueSection from '../components/QueueSection.jsx';

function useIsMobile(breakpoint = 769) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < breakpoint);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [breakpoint]);
  return isMobile;
}

export default function Generate({ onToast }) {
  const [draftId, setDraftId] = useState(null);
  const [queueCount, setQueueCount] = useState(0);
  const [showMobileQueue, setShowMobileQueue] = useState(false);
  const [mode, setMode] = useState('song');
  const navigate = useNavigate();
  const params = useParams();
  const reviewId = params.draftId || draftId;
  const isMobile = useIsMobile();

  useEffect(() => {
    const check = async () => {
      try {
        const jobs = await getQueue();
        const active = jobs.filter(j => !['accepted', 'discarded'].includes(j.status));
        setQueueCount(active.length);
      } catch {}
    };
    check();
    const id = setInterval(check, 4000);
    return () => clearInterval(id);
  }, []);

  const handleBack = () => {
    if (params.draftId) navigate('/generate');
    else setDraftId(null);
  };

  const handleAccepted = () => {
    setDraftId(null);
    navigate('/library');
  };

  if (reviewId) {
    return <ReviewPanel draftId={reviewId} onToast={onToast} onBack={handleBack} onAccepted={handleAccepted} />;
  }

  // Mode toggle pill
  const ModeToggle = () => (
    <div style={{
      display: 'flex', gap: 4, padding: 3, background: '#111', borderRadius: 14,
      border: '1px solid rgba(255,255,255,0.06)', alignSelf: 'flex-start',
    }}>
      {[
        { id: 'song', label: 'Song' },
        { id: 'album', label: 'Auto Album' },
      ].map((m) => (
        <button
          key={m.id}
          onClick={() => setMode(m.id)}
          style={{
            padding: '8px 16px', borderRadius: 11, border: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: 600, transition: 'all 0.15s',
            background: mode === m.id ? '#1ed760' : 'transparent',
            color: mode === m.id ? '#000' : '#888',
          }}
        >{m.label}</button>
      ))}
    </div>
  );

  // Mobile layout
  if (isMobile) {
    return (
      <div>
        <ModeToggle />
        <div style={{ height: 12 }} />
        {queueCount > 0 && (
          <button
            onClick={() => setShowMobileQueue(!showMobileQueue)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 14px', marginBottom: 12,
              background: showMobileQueue ? 'rgba(30,215,96,0.1)' : '#181818',
              border: showMobileQueue ? '1px solid rgba(30,215,96,0.3)' : '1px solid #222',
              borderRadius: 20, color: showMobileQueue ? '#1ed760' : '#a7a7a7',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Queue
            <span style={{ background: '#1ed760', color: '#000', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10 }}>
              {queueCount}
            </span>
          </button>
        )}
        {showMobileQueue && <QueueSection onToast={onToast} />}
        {mode === 'song' ? (
          <BuildForm onToast={onToast} />
        ) : (
          <div style={{ background: '#111', borderRadius: 20, border: '1px solid rgba(255,255,255,0.06)', minHeight: 400 }}>
            <PlaylistBuilder onToast={onToast} onDone={() => navigate('/library')} />
          </div>
        )}
      </div>
    );
  }

  // Desktop: queue panel + main content
  return (
    <div className="full-vh" style={{ display: 'flex', height: 'calc(100vh - 72px)', overflow: 'hidden' }}>
      {/* Left: Queue panel */}
      {queueCount > 0 && (
        <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid #1a1a1a', overflowY: 'auto', padding: '20px 16px', background: '#0d0d0d' }}>
          <QueueSection onToast={onToast} />
        </div>
      )}

      {/* Main content */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Mode toggle bar */}
        <div style={{ padding: '16px 32px 0', flexShrink: 0 }}>
          <ModeToggle />
        </div>

        {/* Builder — BuildForm handles its own two-column canvas layout */}
        <div style={{ flex: 1, minHeight: 0 }}>
          {mode === 'song' ? (
            <BuildForm onToast={onToast} />
          ) : (
            <div style={{ height: '100%', padding: '16px 32px 24px' }}>
              <div style={{ height: '100%', background: '#111', borderRadius: 20, border: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column' }}>
                <PlaylistBuilder onToast={onToast} onDone={() => navigate('/library')} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

Note: This is nearly identical to the current file. The only meaningful change is that the comment clarifies BuildForm now handles its own internal layout. The structure is the same — Generate.jsx owns the queue panel and mode toggle, BuildForm owns everything inside the song builder.

- [ ] **Step 2: Verify it renders**

Open http://localhost:8888/#/generate in the browser. It should show the current UI (BuildForm hasn't been rewritten yet). No errors in console.

- [ ] **Step 3: Commit**

```bash
git add lora-studio/frontend/src/pages/Generate.jsx
git commit -m "refactor: clarify Generate.jsx as thin wrapper for BuildForm"
```

---

### Task 3: Rewrite BuildForm.jsx — Chat panel

**Files:**
- Rewrite: `src/components/BuildForm.jsx`

This is the main task. We rewrite BuildForm in one go since the chat panel and canvas are tightly coupled (they share all song state). The component is ~400 lines.

- [ ] **Step 1: Write the complete new BuildForm.jsx**

Replace the entire contents of `src/components/BuildForm.jsx` with:

```jsx
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

const TABS = [
  { id: 'sound', label: 'Sound' },
  { id: 'lyrics', label: 'Lyrics' },
  { id: 'settings', label: 'Settings' },
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

  // Canvas state
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('sound');
  const [tabDirty, setTabDirty] = useState({}); // { sound: true, lyrics: true }

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

  // Mobile flip view
  const [mobileView, setMobileView] = useState('chat'); // 'chat' | 'song'
  const [unreadChat, setUnreadChat] = useState(false);

  useEffect(() => { getLoras().then(setLoras).catch(() => {}); }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Reuse settings from library / "Back to Edit"
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
    // Session restore: open canvas immediately with no animation
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

  // Mark tab as read when selected
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

      // Track which fields changed for tab dirty indicators
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

        // Open canvas on first song response
        if (!canvasOpen) setCanvasOpen(true);

        // Mark changed tabs as dirty (except the currently active one)
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

      const assistantMsg = { role: 'assistant', content: summary };
      setChatMessages([...newMessages, assistantMsg]);

      setChatHistory([
        ...chatHistory,
        { role: 'user', content: msg },
        { role: 'assistant', content: result._ai_response || JSON.stringify(result) },
      ]);

      // If on mobile song view, mark chat as having unread
      if (isMobile && mobileView === 'song' && !isChat) {
        setUnreadChat(true);
      }

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
    setCanvasOpen(false);
    setActiveTab('sound');
    setTabDirty({});
    setMobileView('chat');
  };

  const hasContent = caption.trim();

  /* ---- LoRA pill (shared between chat input area and settings tab) ---- */
  const loraPill = (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <select
        className="form-select"
        value={lora}
        onChange={(e) => setLora(e.target.value)}
        style={{
          flex: '1 1 auto', minWidth: 0, maxWidth: 220, minHeight: 40,
          borderRadius: 20, padding: '8px 16px', fontSize: 13,
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
  );

  /* ---- Chat panel ---- */
  const chatPanel = (
    <div
      className="build-chat"
      style={{
        background: '#111',
        borderRadius: isMobile ? 20 : 0,
        overflow: 'hidden',
        border: isMobile ? '1px solid rgba(255,255,255,0.06)' : 'none',
        ...(isMobile ? { flex: 1, minHeight: 0 } : {}),
      }}
    >
      {/* Header */}
      <div style={{
        padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: 'linear-gradient(135deg, #1ed760, #169d46)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <svg viewBox="0 0 24 24" fill="#000" style={{ width: 14, height: 14 }}>
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>Song Builder</div>
            <div style={{ fontSize: 11, color: '#666' }}>Describe your song idea</div>
          </div>
        </div>
        {chatMessages.length > 0 && (
          <button
            onClick={handleClearChat}
            style={{
              background: 'rgba(255,255,255,0.06)', border: 'none', color: '#666',
              fontSize: 11, cursor: 'pointer', padding: '5px 12px', borderRadius: 12,
            }}
          >New chat</button>
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
                onClick={() => setChatInput(s)}
                style={{
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 16, padding: '7px 14px', color: '#888', fontSize: 12, cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(30,215,96,0.3)'; e.currentTarget.style.color = '#aaa'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#888'; }}
              >{s}</button>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      {chatMessages.length > 0 && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px', minHeight: 0 }}>
          {chatMessages.map((msg, i) => (
            <div key={i} style={{ marginBottom: 12, display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{
                padding: '10px 16px',
                borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                background: msg.role === 'user' ? '#1ed760' : '#1a1a1a',
                color: msg.role === 'user' ? '#000' : (msg.content.startsWith('Error') ? '#f87171' : '#c0c0c0'),
                fontSize: 14, maxWidth: 420, lineHeight: 1.5,
                fontWeight: msg.role === 'user' ? 600 : 400, whiteSpace: 'pre-wrap',
              }}>{msg.content}</div>
            </div>
          ))}
          {chatLoading && (
            <div style={{ display: 'flex', marginBottom: 12 }}>
              <div style={{ padding: '10px 16px', borderRadius: '18px 18px 18px 4px', background: '#1a1a1a', color: '#555', fontSize: 14, display: 'flex', gap: 4 }}>
                <span style={{ animation: 'pulse 1s infinite 0s' }}>.</span>
                <span style={{ animation: 'pulse 1s infinite 0.2s' }}>.</span>
                <span style={{ animation: 'pulse 1s infinite 0.4s' }}>.</span>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
      )}

      {/* LoRA pill + Input */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
        {/* LoRA selector above input */}
        <div style={{ padding: '8px 12px 0' }}>
          {loraPill}
        </div>
        <div style={{ padding: '8px 12px 12px', display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            style={{
              flex: 1, background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 24, padding: '12px 18px', color: '#fff', fontSize: 15,
              outline: 'none', minHeight: 48, fontFamily: 'inherit', transition: 'border-color 0.15s',
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
              width: 48, height: 48, borderRadius: '50%',
              background: chatInput.trim() ? '#1ed760' : '#1a1a1a',
              border: 'none', cursor: chatInput.trim() ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 0.15s', flexShrink: 0,
            }}
          >
            <svg viewBox="0 0 24 24" fill={chatInput.trim() ? '#000' : '#444'} style={{ width: 18, height: 18 }}>
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );

  /* ---- Canvas tab content ---- */
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
              <div style={{ flex: 1 }}>
                <label className="form-label">Duration</label>
                <input className="form-input" type="number" min="30" max="480" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="s" style={{ maxWidth: 'none' }} />
              </div>
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
              style={{
                flex: 1, fontFamily: 'monospace', fontSize: 13, maxWidth: 'none',
                minHeight: 200, resize: 'none',
              }}
            />
          </div>
        );
      case 'settings':
        return (
          <div style={{ padding: 16 }}>
            <div className="form-group">
              <label className="form-label">Voice Model (LoRA)</label>
              <select
                className="form-select"
                value={lora}
                onChange={(e) => setLora(e.target.value)}
                style={{ maxWidth: 'none' }}
              >
                <option value="">Base Model (no LoRA)</option>
                {loras.map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
              </select>
            </div>
            {lora && (
              <div className="form-group">
                <label className="form-label">LoRA Strength — {parseFloat(strength).toFixed(1)}x</label>
                <input
                  type="range" min="0" max="2" step="0.1"
                  value={strength}
                  onChange={(e) => setStrength(e.target.value)}
                  style={{ width: '100%', accentColor: '#1ed760' }}
                />
              </div>
            )}
          </div>
        );
      default:
        return null;
    }
  };

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

  /* ---- Canvas panel ---- */
  const canvasPanel = (
    <div className={`build-canvas${canvasOpen ? '' : ' collapsed'}`}>
      {/* Header */}
      <div className="canvas-header">
        <input
          placeholder="Song title..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
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

      {/* Tabs */}
      <div className="canvas-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`canvas-tab${activeTab === tab.id ? ' active' : ''}`}
            onClick={() => handleTabClick(tab.id)}
          >
            {tab.label}
            <span className={`tab-dot${tabDirty[tab.id] ? ' visible' : ''}`} />
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="canvas-tab-content" style={activeTab === 'lyrics' ? { display: 'flex', flexDirection: 'column' } : {}}>
        {renderTabContent()}
      </div>

      {/* Footer */}
      <div className="canvas-footer">
        {lora && (
          <div style={{
            background: 'rgba(30,215,96,0.1)', border: '1px solid rgba(30,215,96,0.2)',
            borderRadius: 10, padding: '4px 10px', fontSize: 10, color: '#1ed760', fontWeight: 600,
          }}>
            {lora} {parseFloat(strength).toFixed(1)}x
          </div>
        )}
        <div style={{ flex: 1 }} />
        {generateButton}
      </div>
    </div>
  );

  /* ---- Mobile song view (same tabs as canvas) ---- */
  const mobileSongView = (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: '#111', borderRadius: 20, border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden' }}>
      {/* Header */}
      <div className="canvas-header">
        <input
          placeholder="Song title..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      {/* Tabs */}
      <div className="canvas-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`canvas-tab${activeTab === tab.id ? ' active' : ''}`}
            onClick={() => handleTabClick(tab.id)}
          >
            {tab.label}
            <span className={`tab-dot${tabDirty[tab.id] ? ' visible' : ''}`} />
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="canvas-tab-content" style={activeTab === 'lyrics' ? { display: 'flex', flexDirection: 'column' } : {}}>
        {renderTabContent()}
      </div>

      {/* Footer */}
      <div className="canvas-footer">
        {lora && (
          <div style={{
            background: 'rgba(30,215,96,0.1)', border: '1px solid rgba(30,215,96,0.2)',
            borderRadius: 10, padding: '4px 10px', fontSize: 10, color: '#1ed760', fontWeight: 600,
          }}>
            {lora} {parseFloat(strength).toFixed(1)}x
          </div>
        )}
        <div style={{ flex: 1 }} />
        {generateButton}
      </div>
    </div>
  );

  /* ---- MOBILE RENDER ---- */
  if (isMobile) {
    return (
      <div className="mobile-flip">
        {/* Chat/Song toggle */}
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
                <span style={{
                  position: 'absolute', top: 4, right: 4, width: 6, height: 6,
                  borderRadius: '50%', background: '#1ed760',
                }} />
              )}
            </button>
            <button
              onClick={() => setMobileView('song')}
              style={{
                background: mobileView === 'song' ? '#1ed760' : 'transparent',
                color: mobileView === 'song' ? '#000' : '#888',
              }}
            >
              Song
            </button>
          </div>
        )}

        {/* Mobile sticky song bar (in chat view) */}
        {mobileView === 'chat' && canvasOpen && (
          <div className="mobile-song-bar" onClick={() => setMobileView('song')}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {title || 'Untitled'}
              </div>
              <div style={{ fontSize: 11, color: '#666' }}>
                {bpm} BPM {key && `· ${key}`} · {Math.floor(duration / 60)}:{String(Math.floor(duration % 60)).padStart(2, '0')}
              </div>
            </div>
            {generateButton}
          </div>
        )}

        {/* Active view */}
        <div className="mobile-flip-view">
          {mobileView === 'chat' ? chatPanel : mobileSongView}
        </div>

        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  /* ---- DESKTOP RENDER ---- */
  return (
    <div style={{ height: '100%', overflow: 'hidden', padding: '24px 32px' }}>
      <div className="build-layout" style={{ height: '100%' }}>
        {chatPanel}
        {canvasPanel}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
```

- [ ] **Step 2: Verify the component renders on desktop**

Open http://localhost:8888/#/generate in a desktop browser. You should see:
1. Full-width chat panel with welcome state and prompt suggestions
2. No canvas visible
3. LoRA selector pill above the chat input
4. Type a message and send — after AI responds with song data, the canvas should slide in from the right with Sound tab active

- [ ] **Step 3: Verify mobile view**

Open the same URL on a phone (or resize browser to < 769px). You should see:
1. Chat only (no toggle pill yet since no song exists)
2. Send a message → AI responds with song data → Chat/Song toggle appears at top + sticky song bar
3. Tap "Song" → full-screen tabbed editor
4. Tap "Chat" → back to chat with sticky bar

- [ ] **Step 4: Verify session restore ("Back to Edit")**

1. Generate a song, go to review
2. Click "Back to Edit"
3. The Create page should open with canvas immediately visible, all fields populated, chat history restored

- [ ] **Step 5: Commit**

```bash
git add lora-studio/frontend/src/components/BuildForm.jsx
git commit -m "feat: chat-first BuildForm with sliding canvas and mobile flip view"
```

---

### Task 4: Polish and edge cases

**Files:**
- Modify: `src/components/BuildForm.jsx` (minor tweaks)

- [ ] **Step 1: Test "New chat" button**

Click "New chat" in the chat header. Verify:
- All fields clear
- Canvas slides away on desktop
- Mobile returns to chat-only view (no toggle pill)

- [ ] **Step 2: Test canvas close button (desktop)**

Click the ✕ button on the canvas header. Verify:
- Canvas slides away
- Song data is NOT cleared (fields still have values)
- Sending another chat message that returns song data should re-open the canvas

- [ ] **Step 3: Test narrow desktop (769–1024px)**

Resize browser to ~900px wide. Verify:
- Canvas takes 40% width (from the CSS media query)
- Chat gets 60%
- Nothing overflows or breaks

- [ ] **Step 4: Test tab dirty indicators**

1. Have a song loaded with canvas open
2. Switch to Lyrics tab
3. Send a chat message that changes BPM/caption (Sound tab fields)
4. Verify: Sound tab shows a green dot indicator
5. Click Sound tab → dot disappears

- [ ] **Step 5: Run a full build to ensure no errors**

Run: `cd F:/ACE-Step-1.5/lora-studio/frontend && npx vite build`

Expected: Build succeeds with no errors.

- [ ] **Step 6: Commit any fixes**

```bash
git add -A lora-studio/frontend/src/
git commit -m "fix: polish chat-first canvas edge cases"
```

---

## Summary of Changes

| File | Lines (approx) | What changed |
|------|----------------|--------------|
| `App.css` | +90 | Canvas slide, tab styles, mobile flip, sticky bar |
| `Generate.jsx` | ~148 (same) | Comment update only — structure unchanged |
| `BuildForm.jsx` | ~420 (rewrite) | Chat-first layout, sliding canvas, tabbed editor, mobile flip view |

Total: ~3 files changed, ~510 lines (mostly the BuildForm rewrite replacing ~780 existing lines).
