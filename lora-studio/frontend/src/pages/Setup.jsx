import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

const STEPS = ['API Keys', 'Models', 'Done'];

export default function Setup() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Step 1 — API keys
  const [openaiKey, setOpenaiKey] = useState('');
  const [googleClientId, setGoogleClientId] = useState('');
  const [googleClientSecret, setGoogleClientSecret] = useState('');
  const [keysAlreadySet, setKeysAlreadySet] = useState({});

  // Step 2 — Models
  const [modelCheck, setModelCheck] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadMsg, setDownloadMsg] = useState('');

  // Load current config on mount
  useEffect(() => {
    fetch('/api/setup/config')
      .then(r => r.json())
      .then(cfg => {
        setKeysAlreadySet(cfg.api_keys || {});
      })
      .catch(() => {});
  }, []);

  // Check models when reaching step 2
  useEffect(() => {
    if (step === 1) checkModels();
  }, [step]);

  const checkModels = useCallback(() => {
    fetch('/api/setup/check-models')
      .then(r => r.json())
      .then(setModelCheck)
      .catch(() => {});
  }, []);

  // Poll download status
  useEffect(() => {
    if (!downloading) return;
    const iv = setInterval(() => {
      fetch('/api/setup/download-status')
        .then(r => r.json())
        .then(d => {
          setDownloadMsg(d.message || '');
          if (!d.active) {
            setDownloading(false);
            clearInterval(iv);
            checkModels();
          }
        })
        .catch(() => {});
    }, 2000);
    return () => clearInterval(iv);
  }, [downloading, checkModels]);

  const saveKeys = async () => {
    setSaving(true);
    setError('');
    const keys = {};
    if (openaiKey) keys.openai_api_key = openaiKey;

    if (!openaiKey && !keysAlreadySet.openai_api_key) {
      setError('OpenAI API key is required.');
      setSaving(false);
      return;
    }

    try {
      const r = await fetch('/api/setup/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_keys: keys }),
      });
      if (!r.ok) throw new Error('Failed to save');
      setStep(1);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const startDownload = async () => {
    setDownloading(true);
    setDownloadMsg('Starting download...');
    try {
      await fetch('/api/setup/download-models', { method: 'POST' });
    } catch {
      setDownloading(false);
      setDownloadMsg('Failed to start download.');
    }
  };

  const finish = () => {
    navigate('/artists');
    window.location.reload();
  };

  return (
    <div style={styles.wrapper}>
      <div style={styles.container}>
        {/* Header */}
        <div style={styles.header}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          </svg>
          <h1 style={styles.title}>LoRA Studio Setup</h1>
        </div>

        {/* Step indicator */}
        <div style={styles.steps}>
          {STEPS.map((label, i) => (
            <div key={label} style={styles.stepRow}>
              <div style={{
                ...styles.stepDot,
                background: i < step ? 'var(--accent)' : i === step ? 'var(--accent)' : '#333',
                opacity: i <= step ? 1 : 0.4,
              }}>
                {i < step ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <span style={{ color: i === step ? '#000' : '#888', fontSize: 12, fontWeight: 700 }}>{i + 1}</span>
                )}
              </div>
              <span style={{ color: i <= step ? 'var(--text)' : 'var(--text-muted)', fontSize: 13, fontWeight: i === step ? 600 : 400 }}>{label}</span>
              {i < STEPS.length - 1 && <div style={styles.stepLine} />}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div style={styles.body}>

          {/* Step 1: API Keys */}
          {step === 0 && (
            <div>
              <h2 style={styles.sectionTitle}>API Keys</h2>
              <p style={styles.desc}>
                An OpenAI API key is required for the AI song builder and cover art generation.
                YouTube upload is built in — just sign in with Google when you're ready to upload.
              </p>

              <div style={styles.field}>
                <label style={styles.label}>
                  OpenAI API Key <span style={{ color: 'var(--danger)' }}>*</span>
                  {keysAlreadySet.openai_api_key && !openaiKey && (
                    <span style={styles.setBadge}>already set</span>
                  )}
                </label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="sk-..."
                  value={openaiKey}
                  onChange={e => setOpenaiKey(e.target.value)}
                  style={styles.input}
                />
              </div>

              {/* Google credentials are baked into the app — no setup needed */}

              {error && <p style={styles.error}>{error}</p>}

              <button
                className="btn btn-primary"
                onClick={saveKeys}
                disabled={saving}
                style={styles.nextBtn}
              >
                {saving ? 'Saving...' : 'Next'}
              </button>
            </div>
          )}

          {/* Step 2: Model Check */}
          {step === 1 && (
            <div>
              <h2 style={styles.sectionTitle}>Model Check</h2>
              <p style={styles.desc}>
                ACE-Step requires model checkpoints (~5 GB). Let's verify they're downloaded.
              </p>

              {modelCheck === null ? (
                <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Checking models...</p>
              ) : modelCheck.all_present ? (
                <div style={styles.successBox}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                  <span>All model components found</span>
                </div>
              ) : (
                <div>
                  <div style={styles.componentList}>
                    {modelCheck.components && Object.entries(modelCheck.components).map(([name, present]) => (
                      <div key={name} style={styles.componentRow}>
                        <span style={{ color: present ? 'var(--success)' : 'var(--danger)', marginRight: 8, fontSize: 14 }}>
                          {present ? '\u2713' : '\u2717'}
                        </span>
                        <span style={{ fontSize: 13 }}>{name}</span>
                      </div>
                    ))}
                  </div>

                  {!downloading ? (
                    <div style={{ marginTop: 16 }}>
                      <button className="btn btn-primary" onClick={startDownload} style={styles.nextBtn}>
                        Download Models
                      </button>
                      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                        Or run manually: <code style={styles.code}>python -m acestep.model_downloader</code>
                      </p>
                    </div>
                  ) : (
                    <div style={styles.downloadingBox}>
                      <div style={styles.spinner} />
                      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{downloadMsg}</span>
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
                <button className="btn btn-ghost" onClick={() => setStep(0)}>Back</button>
                <button
                  className="btn btn-primary"
                  onClick={() => setStep(2)}
                  style={{ flex: 1 }}
                >
                  {modelCheck?.all_present ? 'Next' : 'Skip for now'}
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Done */}
          {step === 2 && (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 16 }}>
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <h2 style={{ ...styles.sectionTitle, textAlign: 'center' }}>Setup Complete!</h2>
              <p style={{ ...styles.desc, textAlign: 'center', marginBottom: 24 }}>
                You're ready to start creating music with LoRA Studio.
              </p>
              <button className="btn btn-primary" onClick={finish} style={{ ...styles.nextBtn, minWidth: 220 }}>
                Launch LoRA Studio
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

const styles = {
  wrapper: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    minWidth: '100vw',
    background: 'var(--bg)',
    padding: 16,
    position: 'fixed',
    top: 0,
    left: 0,
    zIndex: 500,
  },
  container: {
    width: '100%',
    maxWidth: 520,
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: 32,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: 700,
    color: 'var(--text)',
    margin: 0,
  },
  steps: {
    display: 'flex',
    alignItems: 'center',
    gap: 0,
    marginBottom: 28,
  },
  stepRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  stepDot: {
    width: 26,
    height: 26,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stepLine: {
    width: 32,
    height: 1,
    background: '#333',
    margin: '0 6px',
  },
  body: {
    minHeight: 200,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 600,
    marginBottom: 8,
    color: 'var(--text)',
  },
  desc: {
    fontSize: 13,
    color: 'var(--text-secondary)',
    lineHeight: 1.5,
    marginBottom: 20,
  },
  field: {
    marginBottom: 16,
  },
  label: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text-secondary)',
    marginBottom: 6,
  },
  optional: {
    fontSize: 10,
    color: 'var(--text-muted)',
    fontWeight: 400,
  },
  setBadge: {
    fontSize: 10,
    background: '#064e3b',
    color: 'var(--success)',
    padding: '1px 8px',
    borderRadius: 10,
    marginLeft: 4,
  },
  input: {
    width: '100%',
  },
  error: {
    fontSize: 13,
    color: 'var(--danger)',
    marginBottom: 12,
  },
  nextBtn: {
    width: '100%',
    marginTop: 4,
    justifyContent: 'center',
  },
  successBox: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '12px 16px',
    borderRadius: 8,
    background: 'rgba(52, 211, 153, 0.08)',
    border: '1px solid rgba(52, 211, 153, 0.2)',
    fontSize: 13,
    color: 'var(--success)',
    marginBottom: 8,
  },
  componentList: {
    background: 'rgba(0,0,0,0.2)',
    borderRadius: 8,
    padding: '8px 12px',
    marginBottom: 4,
  },
  componentRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '6px 0',
  },
  downloadingBox: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '14px 16px',
    borderRadius: 8,
    background: 'rgba(0,0,0,0.2)',
    marginTop: 16,
  },
  spinner: {
    width: 18,
    height: 18,
    border: '2px solid #333',
    borderTop: '2px solid var(--accent)',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
    flexShrink: 0,
  },
  code: {
    background: 'rgba(0,0,0,0.3)',
    padding: '2px 6px',
    borderRadius: 4,
    fontSize: 11,
    fontFamily: 'monospace',
  },
};

// Inject spinner keyframes
if (typeof document !== 'undefined' && !document.getElementById('setup-spinner-keyframes')) {
  const style = document.createElement('style');
  style.id = 'setup-spinner-keyframes';
  style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
  document.head.appendChild(style);
}
