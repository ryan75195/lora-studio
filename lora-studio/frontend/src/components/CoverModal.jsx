import { useState } from 'react';
import Modal from './Modal.jsx';
import { describeCover, generateCover } from '../api.js';

export default function CoverModal({ albumId, open, onClose, onToast, onDone }) {
  const [userIdea, setUserIdea] = useState('');
  const [promptText, setPromptText] = useState('');
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [sendingCover, setSendingCover] = useState(false);

  const handleGenPrompt = async () => {
    setGeneratingPrompt(true);
    setPromptText('Analyzing songs and generating prompt...');
    try {
      const result = await describeCover(albumId, { user_prompt: userIdea });
      setPromptText(result.prompt || '');
    } catch (e) {
      setPromptText('Failed to generate. Type your own prompt.');
      onToast(e.message, 'error');
    } finally { setGeneratingPrompt(false); }
  };

  const handleSend = async () => {
    if (!promptText.trim()) { onToast('Enter an image prompt', 'error'); return; }
    setSendingCover(true);
    try {
      await generateCover(albumId, { user_prompt: promptText.trim() });
      onToast('Cover generated!');
      onClose(); onDone();
    } catch (e) { onToast(e.message, 'error'); }
    finally { setSendingCover(false); }
  };

  return (
    <Modal
      open={open}
      onClose={() => { setUserIdea(''); setPromptText(''); onClose(); }}
      title="Generate Album Cover"
      width={560}
    >
      <div className="mb-5">
        <label className="block text-[11px] uppercase tracking-[0.1em] text-[#a7a7a7] mb-2 font-medium">
          Your Direction
        </label>
        <div className="flex gap-2">
          <input
            className="flex-1 bg-[#2a2a2a] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2.5 text-[14px] text-white placeholder-[#6a6a6a] focus:border-[#1ed760] focus:outline-none transition-colors"
            placeholder="e.g. dark moody, silhouette on a highway"
            value={userIdea}
            onChange={(e) => setUserIdea(e.target.value)}
            autoFocus
          />
          <button
            className="px-4 py-2.5 bg-[#1ed760] hover:bg-[#1fdf64] text-black text-[14px] font-bold rounded-full whitespace-nowrap disabled:opacity-50 transition-colors"
            onClick={handleGenPrompt}
            disabled={generatingPrompt}
          >
            {generatingPrompt ? 'Thinking...' : 'Generate Prompt'}
          </button>
        </div>
        <p className="text-[12px] text-[#6a6a6a] mt-1.5">
          AI combines your direction with song context. Leave empty for fully auto.
        </p>
      </div>
      <div className="mb-5">
        <label className="block text-[11px] uppercase tracking-[0.1em] text-[#a7a7a7] mb-2 font-medium">
          DALL-E Prompt
        </label>
        <textarea
          className="w-full bg-[#2a2a2a] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2.5 text-[14px] text-white placeholder-[#6a6a6a] focus:border-[#1ed760] focus:outline-none resize-y transition-colors"
          rows={6}
          style={{ minHeight: 140 }}
          placeholder="Click 'Generate Prompt' to get an AI suggestion..."
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          disabled={generatingPrompt}
        />
      </div>
      <div className="flex gap-3 justify-end">
        <button
          className="px-5 py-2.5 text-[14px] text-[#a7a7a7] border border-[rgba(255,255,255,0.1)] rounded-full hover:text-white hover:border-white transition-colors"
          onClick={() => { setUserIdea(''); setPromptText(''); onClose(); }}
        >
          Cancel
        </button>
        <button
          className="px-5 py-2.5 bg-[#1ed760] hover:bg-[#1fdf64] text-black text-[14px] font-bold rounded-full disabled:opacity-50 transition-colors"
          onClick={handleSend}
          disabled={sendingCover || !promptText.trim()}
        >
          {sendingCover ? 'Generating image...' : 'Send to DALL-E'}
        </button>
      </div>
    </Modal>
  );
}
