import { useState } from 'react';
import { describeCover, generateCandidates, selectCover } from '../api.js';
import CoverGrid from './CoverGrid.jsx';

export default function CoverGenerate({ albumId, existingPrompt, onToast, onDone, onClose }) {
  const [phase, setPhase] = useState('prompt');
  const [userIdea, setUserIdea] = useState('');
  const [promptText, setPromptText] = useState(existingPrompt || '');
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [selecting, setSelecting] = useState(false);

  const handleGenPrompt = async () => {
    setGeneratingPrompt(true);
    setPromptText('Analyzing songs and generating prompt...');
    try {
      const result = await describeCover(albumId, { user_prompt: userIdea });
      setPromptText(result.prompt || '');
    } catch (e) {
      setPromptText('');
      onToast(e.message, 'error');
    } finally {
      setGeneratingPrompt(false);
    }
  };

  const handleGenerate = async () => {
    if (!promptText.trim()) { onToast('Enter an image prompt', 'error'); return; }
    setGenerating(true);
    setCandidates([]);
    setSelectedIndex(null);
    try {
      const result = await generateCandidates(albumId, { prompt: promptText.trim() });
      const imgs = (result.candidates || []).map((url) => ({ url }));
      setCandidates(imgs);
      setPhase('pick');
      if (result.errors && result.errors.length > 0) {
        onToast(`${result.errors.length} image(s) failed`, 'error');
      }
    } catch (e) {
      onToast(e.message, 'error');
    } finally {
      setGenerating(false);
    }
  };

  const handleSelect = async () => {
    if (selectedIndex === null) { onToast('Select an image first', 'error'); return; }
    setSelecting(true);
    try {
      await selectCover(albumId, { candidate_index: selectedIndex, prompt: promptText.trim() });
      onToast('Cover saved!');
      onDone();
      onClose();
    } catch (e) {
      onToast(e.message, 'error');
    } finally {
      setSelecting(false);
    }
  };

  if (phase === 'pick' && candidates.length > 0) {
    return (
      <div>
        <CoverGrid images={candidates} selectedIndex={selectedIndex} onSelect={setSelectedIndex} columns={3} />
        <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
          <button
            onClick={() => { setPhase('prompt'); setCandidates([]); setSelectedIndex(null); }}
            style={{ padding: '10px 20px', borderRadius: 20, border: '1px solid #333', background: 'none', color: '#a7a7a7', fontSize: 13, cursor: 'pointer' }}
          >Regenerate</button>
          <button
            onClick={handleSelect}
            disabled={selectedIndex === null || selecting}
            style={{
              padding: '10px 24px', borderRadius: 20, border: 'none',
              background: selectedIndex !== null && !selecting ? '#1ed760' : '#2a2a2a',
              color: selectedIndex !== null && !selecting ? '#000' : '#555',
              fontSize: 14, fontWeight: 700, cursor: selectedIndex !== null && !selecting ? 'pointer' : 'not-allowed',
            }}
          >{selecting ? 'Saving...' : 'Use This'}</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#a7a7a7', marginBottom: 6, fontWeight: 600 }}>
          Your Direction
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            style={{
              flex: 1, background: '#2a2a2a', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8, padding: '10px 14px', fontSize: 14, color: '#fff',
              outline: 'none', fontFamily: 'inherit',
            }}
            placeholder="e.g. dark moody, silhouette on a highway"
            value={userIdea}
            onChange={(e) => setUserIdea(e.target.value)}
            autoFocus
          />
          <button
            onClick={handleGenPrompt}
            disabled={generatingPrompt}
            style={{
              padding: '10px 16px', borderRadius: 20, border: 'none',
              background: '#1ed760', color: '#000', fontSize: 13, fontWeight: 700,
              cursor: generatingPrompt ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
              opacity: generatingPrompt ? 0.5 : 1,
            }}
          >{generatingPrompt ? 'Thinking...' : 'Generate Prompt'}</button>
        </div>
        <p style={{ fontSize: 12, color: '#555', marginTop: 6 }}>
          AI combines your direction with song context. Leave empty for fully auto.
        </p>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#a7a7a7', marginBottom: 6, fontWeight: 600 }}>
          Image Prompt
        </label>
        <textarea
          style={{
            width: '100%', background: '#2a2a2a', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8, padding: '10px 14px', fontSize: 14, color: '#fff',
            outline: 'none', fontFamily: 'inherit', resize: 'vertical', minHeight: 120, boxSizing: 'border-box',
          }}
          rows={5}
          placeholder="Click 'Generate Prompt' or type your own..."
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          disabled={generatingPrompt}
        />
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button
          onClick={onClose}
          style={{ padding: '10px 20px', borderRadius: 20, border: '1px solid #333', background: 'none', color: '#a7a7a7', fontSize: 13, cursor: 'pointer' }}
        >Cancel</button>
        <button
          onClick={handleGenerate}
          disabled={generating || !promptText.trim()}
          style={{
            padding: '10px 24px', borderRadius: 20, border: 'none',
            background: !generating && promptText.trim() ? '#1ed760' : '#2a2a2a',
            color: !generating && promptText.trim() ? '#000' : '#555',
            fontSize: 14, fontWeight: 700, cursor: !generating && promptText.trim() ? 'pointer' : 'not-allowed',
          }}
        >{generating ? 'Generating 6 covers...' : 'Generate 6 Covers'}</button>
      </div>
    </div>
  );
}
