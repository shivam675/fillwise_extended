import React, { useEffect, useMemo, useState } from 'react';
import { API_BASE, apiRequest } from './api';

function dateValue(v) {
  if (!v) return 0;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function normalizeModelNames(payload) {
  const rawModels = Array.isArray(payload?.models) ? payload.models : [];
  return rawModels
    .map((m) => {
      if (typeof m === 'string') return m;
      return m?.name || m?.model || null;
    })
    .filter(Boolean);
}

function displayDate(value) {
  const t = dateValue(value);
  if (!t) return 'Unknown date';
  return new Date(t).toLocaleString();
}

export default function CommentEditStudio() {
  const [models, setModels] = useState([]);
  const [model, setModel] = useState('llama3.1:8b');
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [loadingModels, setLoadingModels] = useState(false);

  const [sessionId, setSessionId] = useState('');
  const [filename, setFilename] = useState('');
  const [comments, setComments] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [search, setSearch] = useState('');

  const [processing, setProcessing] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState([]);
  const [errors, setErrors] = useState([]);
  const [infos, setInfos] = useState([]);
  const [downloadReady, setDownloadReady] = useState(false);
  const [busyApply, setBusyApply] = useState(false);

  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem('comment_studio_ollama_url');
    if (saved) setOllamaUrl(saved);
  }, []);

  useEffect(() => {
    localStorage.setItem('comment_studio_ollama_url', ollamaUrl);
  }, [ollamaUrl, model]);

  useEffect(() => {
    let active = true;
    async function loadModels() {
      setLoadingModels(true);
      try {
        const payload = await apiRequest(`/models?ollama_url=${encodeURIComponent(ollamaUrl)}`);
        if (!active) return;
        const names = normalizeModelNames(payload);
        setModels(names);
        if (names.length > 0 && !names.includes(model)) {
          setModel(names[0]);
        }
      } catch (e) {
        if (!active) return;
        setError(e.message || 'Failed to load models');
      } finally {
        if (active) setLoadingModels(false);
      }
    }
    loadModels();
    return () => {
      active = false;
    };
  }, [ollamaUrl, model]);

  const groupedComments = useMemo(() => {
    const q = search.trim().toLowerCase();
    const map = new Map();
    for (const c of comments) {
      const source = c.source_part || 'word/document.xml';
      const para = Array.isArray(c.paragraph_indices) && c.paragraph_indices.length ? c.paragraph_indices[0] : 'na';
      const key = `${source}::${para}`;

      const hay = `${c.comment_text || ''} ${c.anchored_text || ''} ${c.author || ''} ${c.comment_id || ''}`.toLowerCase();
      if (q && !hay.includes(q)) continue;

      if (!map.has(key)) {
        map.set(key, { key, source, para, items: [] });
      }
      map.get(key).items.push(c);
    }

    const groups = Array.from(map.values());
    groups.forEach((g) => {
      g.items.sort((a, b) => dateValue(b.comment_date) - dateValue(a.comment_date));
    });
    groups.sort((a, b) => b.items.length - a.items.length);
    return groups;
  }, [comments, search]);

  async function handleUpload(file) {
    if (!file) return;
    setError('');
    setStatus('Uploading and parsing comments...');
    setSuggestions([]);
    setSelectedSuggestionIds([]);
    setErrors([]);
    setInfos([]);
    setDownloadReady(false);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const payload = await fetch(`${API_BASE}/comment-studio/upload`, {
        method: 'POST',
        body: formData,
      }).then(async (res) => {
        if (!res.ok) {
          let detail = `Upload failed with status ${res.status}`;
          try {
            const data = await res.json();
            if (data?.detail) detail = data.detail;
          } catch {
            // Keep fallback message.
          }
          throw new Error(detail);
        }
        return res.json();
      });

      setSessionId(payload.session_id);
      setFilename(payload.filename || file.name);
      const nextComments = Array.isArray(payload.comments) ? payload.comments : [];
      setComments(nextComments);

      const defaults = [];
      const seen = new Set();
      const ordered = [...nextComments].sort((a, b) => dateValue(b.comment_date) - dateValue(a.comment_date));
      for (const c of ordered) {
        const source = c.source_part || 'word/document.xml';
        const para = Array.isArray(c.paragraph_indices) && c.paragraph_indices.length ? c.paragraph_indices[0] : 'na';
        const key = `${source}::${para}`;
        if (!seen.has(key)) {
          seen.add(key);
          defaults.push(c.comment_id);
        }
      }
      setSelectedIds(defaults);
      setStatus(`Loaded ${nextComments.length} comments from ${payload.filename || file.name}`);
    } catch (e) {
      setError(e.message || 'Upload failed');
      setStatus('');
    }
  }

  function toggleComment(commentId) {
    setSelectedIds((prev) => (prev.includes(commentId) ? prev.filter((id) => id !== commentId) : [...prev, commentId]));
  }

  function toggleGroup(group, checked) {
    const ids = group.items.map((i) => i.comment_id);
    setSelectedIds((prev) => {
      if (checked) {
        const merged = new Set([...prev, ...ids]);
        return Array.from(merged);
      }
      return prev.filter((id) => !ids.includes(id));
    });
  }

  async function processSelected() {
    if (!sessionId) return;
    setError('');
    setStatus('Generating suggestions with selected model...');
    setProcessing(true);
    try {
      const payload = await apiRequest('/comment-studio/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          model,
          ollama_url: ollamaUrl,
          comment_ids: selectedIds,
        }),
      });

      const nextSuggestions = Array.isArray(payload.suggestions) ? payload.suggestions : [];
      setSuggestions(nextSuggestions);
      setSelectedSuggestionIds(nextSuggestions.map((s) => s.comment_id));
      setErrors(Array.isArray(payload.errors) ? payload.errors : []);
      setInfos(Array.isArray(payload.infos) ? payload.infos : []);
      setStatus(`Generated ${nextSuggestions.length} suggestion(s).`);
    } catch (e) {
      setError(e.message || 'Failed to process selected comments');
      setStatus('');
    } finally {
      setProcessing(false);
    }
  }

  function updateSuggestionText(commentId, newText) {
    setSuggestions((prev) => prev.map((s) => (s.comment_id === commentId ? { ...s, new_text: newText } : s)));
  }

  function toggleSuggestion(commentId) {
    setSelectedSuggestionIds((prev) =>
      prev.includes(commentId) ? prev.filter((id) => id !== commentId) : [...prev, commentId]
    );
  }

  async function applyAndPrepareDownload() {
    if (!sessionId || selectedSuggestionIds.length === 0) return;
    setError('');
    setStatus('Applying selected suggestions to DOCX...');
    setBusyApply(true);
    try {
      const edits = suggestions
        .filter((s) => selectedSuggestionIds.includes(s.comment_id))
        .map((s) => ({
          comment_id: s.comment_id,
          new_text: s.new_text,
          replace_scope: s.replace_scope,
        }));

      await apiRequest('/comment-studio/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, edits }),
      });
      setDownloadReady(true);
      setStatus('Edits applied. Download is ready.');
    } catch (e) {
      setError(e.message || 'Failed to apply edits');
      setStatus('');
    } finally {
      setBusyApply(false);
    }
  }

  const totalGroups = groupedComments.length;
  const totalComments = comments.length;
  const totalSelected = selectedIds.length;

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="page-title">Comment Edit Studio</h1>
        <p className="page-subtitle">Upload a DOCX, review grouped comments on the left, then review and edit generated rewrites on the right.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="stat-card">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Comments</p>
          <p className="mt-1 text-2xl font-bold text-slate-800">{totalComments}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Groups</p>
          <p className="mt-1 text-2xl font-bold text-slate-800">{totalGroups}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Selected</p>
          <p className="mt-1 text-2xl font-bold text-slate-800">{totalSelected}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Suggestions</p>
          <p className="mt-1 text-2xl font-bold text-slate-800">{suggestions.length}</p>
        </div>
      </div>

      <div className="page-shell p-4 md:p-5 space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="md:col-span-1">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Model</label>
            <select className="input-premium" value={model} onChange={(e) => setModel(e.target.value)}>
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Ollama URL</label>
            <input className="input-premium" value={ollamaUrl} onChange={(e) => setOllamaUrl(e.target.value)} />
          </div>
          <div className="md:col-span-1 flex items-end gap-2">
            <label className="btn-secondary w-full cursor-pointer">
              <input
                type="file"
                accept=".docx"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files && e.target.files[0];
                  if (f) handleUpload(f);
                }}
              />
              Upload DOCX
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            className="btn-primary"
            onClick={processSelected}
            disabled={!sessionId || selectedIds.length === 0 || processing || loadingModels}
          >
            {processing ? 'Processing...' : 'Process Selected'}
          </button>
          <button
            className="btn-secondary"
            onClick={applyAndPrepareDownload}
            disabled={!sessionId || selectedSuggestionIds.length === 0 || busyApply}
          >
            {busyApply ? 'Applying...' : 'Apply to DOCX'}
          </button>
          {downloadReady && (
            <a className="btn-ghost" href={`${API_BASE}/comment-studio/download/${sessionId}`}>
              Download Edited DOCX
            </a>
          )}
          {filename && <span className="text-xs text-slate-500">File: {filename}</span>}
          {loadingModels && <span className="text-xs text-slate-500">Loading models...</span>}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <input
            className="input-premium"
            placeholder="Search comments, anchored text, author..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="text-xs text-slate-500 flex items-center">
            {status || 'Upload a file to begin.'}
          </div>
        </div>

        {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="page-shell p-4 md:p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Comments To Process</h2>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">Left Panel</span>
          </div>
          <p className="text-xs text-slate-500">Each group is a paragraph block. Select a whole group or individual comments.</p>
          <div className="max-h-[560px] space-y-3 overflow-auto pr-1">
            {groupedComments.length === 0 && <div className="text-sm text-slate-500">No comments yet.</div>}
            {groupedComments.map((group) => {
              const ids = group.items.map((i) => i.comment_id);
              const selectedCount = ids.filter((id) => selectedIds.includes(id)).length;
              const allSelected = selectedCount === ids.length;
              return (
                <div key={group.key} className="rounded-xl border border-amber-200 bg-gradient-to-b from-white to-amber-50/40 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold text-slate-800">{group.source}</div>
                      <div className="text-xs text-slate-600">Paragraph {String(group.para)} • {group.items.length} comment(s)</div>
                    </div>
                    <label className="text-xs text-slate-600 flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={(e) => toggleGroup(group, e.target.checked)}
                      />
                      Select Group
                    </label>
                  </div>
                  {group.items.map((item) => (
                    <label
                      key={item.comment_id}
                      className="block rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-800"
                    >
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900">Comment #{item.comment_id}</span>
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(item.comment_id)}
                          onChange={() => toggleComment(item.comment_id)}
                        />
                      </div>
                      <div className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-slate-700">
                        <span className="font-semibold text-slate-800">Instruction:</span> {item.comment_text}
                      </div>
                      <div className="mt-1 rounded-md bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
                        <span className="font-semibold text-slate-700">Original text:</span> {item.anchored_text || '-'}
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500">{displayDate(item.comment_date)} • {item.author || 'Unknown author'}</div>
                    </label>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        <div className="page-shell p-4 md:p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">AI Rewrite Suggestions</h2>
            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-900">Right Panel</span>
          </div>
          <p className="text-xs text-slate-500">Review each rewrite, edit if needed, then keep checked items for apply.</p>
          <div className="max-h-[560px] space-y-3 overflow-auto pr-1">
            {suggestions.length === 0 && <div className="text-sm text-slate-500">No suggestions yet.</div>}
            {suggestions.map((s) => (
              <div key={s.comment_id} className="rounded-xl border border-sky-200 bg-gradient-to-b from-white to-sky-50/40 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-slate-700">
                    Comment #{s.comment_id} • {s.replace_scope === 'paragraph' ? 'Paragraph rewrite' : 'Anchor rewrite'}
                  </div>
                  <input
                    type="checkbox"
                    checked={selectedSuggestionIds.includes(s.comment_id)}
                    onChange={() => toggleSuggestion(s.comment_id)}
                  />
                </div>
                <div className="rounded-md bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
                  <span className="font-semibold text-slate-700">Why this change:</span> {s.comment}
                </div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Proposed Rewrite</div>
                <textarea
                  className="input-premium min-h-[120px]"
                  value={s.new_text || ''}
                  onChange={(e) => updateSuggestionText(s.comment_id, e.target.value)}
                />
              </div>
            ))}
          </div>

          {(errors.length > 0 || infos.length > 0) && (
            <div className="space-y-2">
              {errors.length > 0 && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
                  {errors.length} error(s): {errors.slice(0, 3).map((e) => `#${e.comment_id}`).join(', ')}
                </div>
              )}
              {infos.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
                  {infos.length} info message(s) available.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
