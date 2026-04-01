import { useState, useEffect, useRef, useCallback } from 'react';
import { getLoras, playlistChat, generatePlaylist } from '../api.js';

export default function PlaylistBuilder({ onToast, onDone }) {
  const [loras, setLoras] = useState([]);
  const [lora, setLora] = useState('');
  const [chat, setChat] = useState([]);
  const [chatHistory, setChatHistory] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(null);
  const [generating, setGenerating] = useState(false);
  const endRef = useRef(null);

  useEffect(() => { getLoras().then(setLoras).catch(() => {}); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chat]);

  const handleSend = async () => {
    const msg = input.trim();
    if (!msg || busy) return;
    const newMsgs = [...chat, { role: 'user', content: msg }];
    setChat(newMsgs);
    setInput('');
    setBusy(true);
    try {
      const result = await playlistChat({ prompt: msg, chat_history: chatHistory, lora_name: lora });
      if (result.ready) {
        setReady(result);
        setChat([...newMsgs, { role: 'assistant', content: `Ready to generate "${result.album_name}" (${result.song_count} songs). Hit Generate!` }]);
      } else {
        setChat([...newMsgs, { role: 'assistant', content: result.message }]);
      }
      setChatHistory([...chatHistory, { role: 'user', content: msg }, { role: 'assistant', content: result._raw || result.message || '' }]);
    } catch (e) {
      setChat([...newMsgs, { role: 'assistant', content: `Error: ${e.message}` }]);
    } finally {
      setBusy(false);
    }
  };

  const handleGenerate = async () => {
    if (!ready || generating) return;
    setGenerating(true);
    try {
      const result = await generatePlaylist({
        prompt: ready.description || chat.filter(m => m.role === 'user').map(m => m.content).join('. '),
        song_count: ready.song_count || 6,
        lora_name: lora,
      });
      onToast(`"${result.album_name}" created! Generating ${result.song_count} songs...`);
      setChat([]); setChatHistory([]); setReady(null);
    } catch (e) {
      onToast(e.message, 'error');
    } finally {
      setGenerating(false);
    }
  };

  const handleClear = () => {
    setChat([]); setChatHistory([]); setReady(null); setInput('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg, #1ed760, #169d46)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg viewBox="0 0 24 24" fill="#000" style={{ width: 14, height: 14 }}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z" /></svg>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>Auto Album</div>
            <div style={{ fontSize: 11, color: '#666' }}>Plan an album with AI, then generate all songs</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={lora} onChange={(e) => setLora(e.target.value)}
            style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 12, padding: '4px 10px', fontSize: 11, color: lora ? '#1ed760' : '#666', outline: 'none' }}>
            <option value="">Base Model</option>
            {loras.map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
          </select>
          {chat.length > 0 && (
            <button onClick={handleClear} style={{ background: 'rgba(255,255,255,0.06)', border: 'none', color: '#666', fontSize: 11, cursor: 'pointer', padding: '5px 12px', borderRadius: 12 }}>
              New
            </button>
          )}
        </div>
      </div>

      {/* Chat */}
      {chat.length > 0 ? (
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
          {chat.map((msg, i) => (
            <div key={i} style={{ marginBottom: 10, display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{
                padding: '10px 16px', maxWidth: 420, fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap',
                borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                background: msg.role === 'user' ? '#1ed760' : '#1a1a1a',
                color: msg.role === 'user' ? '#000' : '#c0c0c0',
                fontWeight: msg.role === 'user' ? 600 : 400,
              }}>{msg.content}</div>
            </div>
          ))}
          {busy && (
            <div style={{ display: 'flex' }}>
              <div style={{ padding: '10px 16px', borderRadius: '16px 16px 16px 4px', background: '#1a1a1a', color: '#555', fontSize: 14 }}>...</div>
            </div>
          )}
          <div ref={endRef} />
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '24px 18px', textAlign: 'center' }}>
          <div style={{ fontSize: 24, marginBottom: 12, opacity: 0.3 }}>&#127926;</div>
          <div style={{ fontSize: 14, color: '#888', marginBottom: 6 }}>Describe your album</div>
          <div style={{ fontSize: 12, color: '#555', lineHeight: 1.6, marginBottom: 16 }}>
            The AI will plan the tracklist, then generate all songs automatically.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
            {['jazz lofi to sleep to', '90s britpop revival', 'acoustic confessional', 'cinematic instrumentals'].map((s) => (
              <button key={s} onClick={() => setInput(s)}
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '6px 12px', color: '#777', fontSize: 12, cursor: 'pointer' }}
              >{s}</button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div style={{ padding: '12px 12px', display: 'flex', gap: 8, alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
        <input
          style={{ flex: 1, background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 24, padding: '12px 18px', color: '#fff', fontSize: 15, outline: 'none', minHeight: 48, fontFamily: 'inherit' }}
          onFocus={(e) => (e.target.style.borderColor = 'rgba(30,215,96,0.4)')}
          onBlur={(e) => (e.target.style.borderColor = 'rgba(255,255,255,0.08)')}
          placeholder={chat.length === 0 ? 'Describe your album...' : 'Refine or say "generate"...'}
          value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
          disabled={busy || generating}
        />
        {ready ? (
          <button onClick={handleGenerate} disabled={generating}
            style={{ height: 48, padding: '0 20px', borderRadius: 24, border: 'none', background: generating ? '#333' : 'linear-gradient(135deg, #1ed760, #169d46)', color: generating ? '#666' : '#000', fontSize: 14, fontWeight: 700, cursor: generating ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
            {generating ? 'Creating...' : 'Generate'}
          </button>
        ) : (
          <button onClick={handleSend} disabled={busy || !input.trim()}
            style={{ width: 48, height: 48, borderRadius: '50%', border: 'none', flexShrink: 0, background: input.trim() ? '#1ed760' : '#1a1a1a', cursor: input.trim() ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg viewBox="0 0 24 24" fill={input.trim() ? '#000' : '#444'} style={{ width: 18, height: 18 }}><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
          </button>
        )}
      </div>
    </div>
  );
}
