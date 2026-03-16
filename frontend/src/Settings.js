import React, { useState, useEffect } from 'react';
import { Save, Settings2 } from 'lucide-react';
import { apiRequest } from './api';

export default function Settings() {
  const [url, setUrl] = useState('http://localhost:11434');
  const [model, setModel] = useState('llama3.2:3b');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    apiRequest('/settings')
      .then(d => {
        setUrl(d.ollama_url || 'http://localhost:11434');
        setModel(d.default_model || 'llama3.2:3b');
      })
      .catch(() => {});
  }, []);

  const save = async () => {
    setBusy(true);
    setStatus('');
    try {
      await apiRequest('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ollama_url: url || 'http://localhost:11434',
          default_model: model || 'llama3.2:3b',
        }),
      });
      setStatus('Settings saved successfully.');
    } catch (err) {
      setStatus(err.message || 'Could not save settings.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Configure default Ollama values used across project runs.</p>
      </div>

      <div className="max-w-2xl rounded-2xl border border-amber-100 bg-white p-6">
        <div className="mb-5 flex items-center gap-2 text-slate-700">
          <Settings2 className="h-5 w-5" />
          <p className="text-lg font-bold">Inference Defaults</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-600">Ollama URL</label>
            <input
              value={url}
              onChange={e => setUrl(e.target.value)}
              className="input-premium"
              placeholder="http://localhost:11434"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-600">Default Model</label>
            <input
              value={model}
              onChange={e => setModel(e.target.value)}
              className="input-premium"
              placeholder="llama3.2:3b"
            />
          </div>

          {status ? <p className="text-sm font-semibold text-slate-600">{status}</p> : null}

          <button onClick={save} className="btn-primary" disabled={busy}>
            <Save className="h-4 w-4" />
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}
