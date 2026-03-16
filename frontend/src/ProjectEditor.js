import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, Download, RefreshCw, XCircle } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { API_BASE, apiRequest } from './api';

export default function ProjectEditor() {
  const { projectId, jobId } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [meta, setMeta] = useState({
    status: 'pending',
    progress: 0,
    message: 'Loading editor...',
    project_name: '',
    template_name: '',
    has_docx: false,
    has_pdf: false,
    approved: false,
  });
  const [templateText, setTemplateText] = useState('');
  const [changes, setChanges] = useState([]);
  const [draftNotice, setDraftNotice] = useState('');
  const [streamState, setStreamState] = useState({
    is_streaming: false,
    current_marker: null,
    current_text: '',
    marker_index: 0,
    total_markers: 0,
  });

  const loadEditorData = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    try {
      const data = await apiRequest(`/projects/${projectId}/editor/${jobId}`);
      const suggestions = data.replacements || {};
      const markers = Array.isArray(data.markers) ? data.markers : [];

      setMeta({
        status: data.status || 'pending',
        progress: Number(data.progress || 0),
        message: data.message || '',
        project_name: data.project_name || 'Project',
        template_name: data.template_name || '',
        has_docx: !!data.has_docx,
        has_pdf: !!data.has_pdf,
        approved: !!data.approved,
      });
      setTemplateText(data.template_text || '');

      setChanges(prev => {
        if (prev.length > 0) {
          const previousMap = new Map(prev.map(c => [c.marker, c]));
          return markers.map(marker => {
            const existing = previousMap.get(marker.marker);
            const incomingValue = String(suggestions[marker.marker] || '');
            const shouldAdoptIncoming = existing && !existing.isEdited && incomingValue.trim();
            return {
              marker: marker.marker,
              decision: existing ? existing.decision : 'pending',
              suggestedValue: shouldAdoptIncoming
                ? incomingValue
                : (existing ? existing.suggestedValue : incomingValue),
              value: existing
                ? (shouldAdoptIncoming ? incomingValue : existing.value)
                : incomingValue,
              isEdited: existing ? existing.isEdited : false,
              locked: existing ? existing.locked : !!data.approved,
            };
          });
        }

        return markers.map(marker => ({
          marker: marker.marker,
          decision: 'pending',
          suggestedValue: String(suggestions[marker.marker] || ''),
          value: String(suggestions[marker.marker] || ''),
          isEdited: false,
          locked: !!data.approved,
        }));
      });

      if (data.stream) {
        setStreamState({
          is_streaming: !!data.stream.is_streaming,
          current_marker: data.stream.current_marker || null,
          current_text: data.stream.current_text || '',
          marker_index: Number(data.stream.marker_index || 0),
          total_markers: Number(data.stream.total_markers || 0),
        });
      }
      setError('');
    } catch (err) {
      setError(err.message || 'Could not load editor payload.');
    } finally {
      if (isInitial) setLoading(false);
    }
  }, [jobId, projectId]);

  useEffect(() => {
    loadEditorData(true).catch(() => {});
  }, [projectId, jobId, loadEditorData]);

  useEffect(() => {
    if (meta.status === 'done' || meta.status === 'error') return undefined;

    const timer = setInterval(() => {
      loadEditorData(false).catch(() => {});
    }, 1800);

    return () => clearInterval(timer);
  }, [projectId, jobId, meta.status, loadEditorData]);

  useEffect(() => {
    const streamUrl = `${API_BASE}/projects/${projectId}/editor/${jobId}/stream`;
    const eventSource = new EventSource(streamUrl);

    eventSource.onmessage = event => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.error) {
          setError(payload.error);
          return;
        }

        setMeta(prev => ({
          ...prev,
          status: payload.status || prev.status,
          progress: Number(payload.progress ?? prev.progress),
          message: payload.message || prev.message,
        }));

        const stream = payload.stream || {};
        setStreamState({
          is_streaming: !!stream.is_streaming,
          current_marker: stream.current_marker || null,
          current_text: stream.current_text || '',
          marker_index: Number(stream.marker_index || 0),
          total_markers: Number(stream.total_markers || 0),
        });

        if (stream.current_marker) {
          setChanges(prev => prev.map(item => {
            if (item.marker !== stream.current_marker) return item;
            if (item.isEdited || item.locked) return item;
            const live = String(stream.current_text || '');
            return {
              ...item,
              suggestedValue: live || item.suggestedValue,
              value: live || item.value,
            };
          }));
        }
      } catch {
        // Ignore malformed stream chunks.
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => eventSource.close();
  }, [jobId, projectId]);

  const effectiveMap = useMemo(() => {
    const map = {};
    for (const change of changes) {
      map[change.marker] = change.decision === 'rejected' ? change.marker : change.value;
    }
    return map;
  }, [changes]);

  const acceptedCount = useMemo(() => changes.filter(c => c.decision === 'accepted').length, [changes]);
  const rejectedCount = useMemo(() => changes.filter(c => c.decision === 'rejected').length, [changes]);
  const pendingCount = useMemo(() => changes.filter(c => c.decision === 'pending').length, [changes]);
  const editedCount = useMemo(() => changes.filter(c => c.isEdited).length, [changes]);

  const livePreviewText = useMemo(() => {
    let preview = templateText;
    Object.entries(effectiveMap).forEach(([marker, value]) => {
      preview = preview.split(marker).join(String(value));
    });
    return preview;
  }, [templateText, effectiveMap]);

  function updateChange(marker, patch) {
    setChanges(prev => prev.map(item => (item.marker === marker ? { ...item, ...patch } : item)));
    setDraftNotice('Draft updated locally. Click Approve & Finalize to generate final files.');
  }

  function acceptChange(marker) {
    setChanges(prev => prev.map(item => {
      if (item.marker !== marker) return item;
      const nextValue = item.value || item.suggestedValue || '';
      return {
        ...item,
        decision: 'accepted',
        value: nextValue,
        locked: true,
      };
    }));
    setDraftNotice('Change accepted.');
  }

  function rejectChange(marker) {
    setChanges(prev => prev.map(item => (
      item.marker === marker ? { ...item, decision: 'rejected', locked: true } : item
    )));
    setDraftNotice('Change rejected.');
  }

  function unlockChange(marker) {
    setChanges(prev => prev.map(item => (
      item.marker === marker ? { ...item, locked: false } : item
    )));
    setDraftNotice('You can now accept or reject this change again.');
  }

  async function approveAndFinalize() {
    setSaving(true);
    setError('');
    try {
      await apiRequest(`/projects/${projectId}/editor/${jobId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replacements: effectiveMap }),
      });
      setChanges(prev => prev.map(item => ({ ...item, locked: true })));
      setDraftNotice('Finalized. All changes are now locked.');
      await loadEditorData(false);
    } catch (err) {
      setError(err.message || 'Could not finalize approved edits.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <button className="btn-ghost" onClick={() => navigate('/projects')}>
          <ArrowLeft className="h-4 w-4" /> Back To Projects
        </button>
        <div className="rounded-2xl border border-amber-100 bg-white p-6 text-sm text-slate-600">Loading editor...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button className="btn-ghost mb-2" onClick={() => navigate('/projects')}>
            <ArrowLeft className="h-4 w-4" /> Back To Projects
          </button>
          <h1 className="page-title">{meta.project_name} Editing Studio</h1>
          <p className="page-subtitle">Template: {meta.template_name || '-'} • Job: {jobId}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={() => loadEditorData(false)}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <button className="btn-primary" onClick={approveAndFinalize} disabled={saving || changes.length === 0}>
            <CheckCircle2 className="h-4 w-4" /> {saving ? 'Finalizing...' : 'Approve & Finalize'}
          </button>
          <a
            className={`btn-ghost ${meta.has_docx ? '' : 'pointer-events-none opacity-50'}`}
            href={`${API_BASE}/download/${jobId}/docx`}
            target="_blank"
            rel="noreferrer"
          >
            <Download className="h-4 w-4" /> Word
          </a>
          <a
            className={`btn-ghost ${meta.has_pdf ? '' : 'pointer-events-none opacity-50'}`}
            href={`${API_BASE}/download/${jobId}/pdf`}
            target="_blank"
            rel="noreferrer"
          >
            <Download className="h-4 w-4" /> PDF
          </a>
        </div>
      </div>

      <div className="rounded-2xl border border-amber-100 bg-white p-4">
        <p className="text-sm font-semibold text-slate-700">
          Status: {meta.status} • {meta.progress}% • {meta.message || 'Waiting for updates...'}
        </p>
        {streamState.is_streaming ? (
          <p className="mt-1 text-xs font-semibold text-sky-700">
            Model is writing marker {streamState.marker_index}/{streamState.total_markers}
          </p>
        ) : null}
        <p className="mt-1 text-xs text-slate-500">
          Pending: {pendingCount} • Accepted: {acceptedCount} • Rejected: {rejectedCount} • Manually Edited: {editedCount}
        </p>
        {draftNotice ? <p className="mt-2 text-sm font-semibold text-emerald-700">{draftNotice}</p> : null}
        {error ? <p className="mt-2 text-sm font-semibold text-rose-600">{error}</p> : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-2xl border border-amber-100 bg-white p-4">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">Original Template</h2>
          <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-xs text-slate-700">
            {templateText || 'No template text available.'}
          </pre>
        </section>

        <section className="rounded-2xl border border-amber-100 bg-white p-4">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">Live Edited Preview</h2>
          <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-xl bg-amber-50/50 p-3 text-xs text-slate-700">
            {livePreviewText || 'No preview yet.'}
          </pre>
        </section>
      </div>

      <section className="rounded-2xl border border-amber-100 bg-white p-4">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">Proposed Changes</h2>
        {changes.length === 0 ? (
          <p className="text-sm text-slate-500">No extracted changes yet. Wait for processing to complete or refresh.</p>
        ) : (
          <div className="space-y-3">
            {changes.map(change => (
              <article key={change.marker} className="rounded-xl border border-slate-200 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <code className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{change.marker}</code>
                    <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                      change.decision === 'rejected'
                        ? 'bg-rose-50 text-rose-700'
                        : change.decision === 'accepted'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-slate-100 text-slate-600'
                    }`}>
                      {change.decision === 'rejected'
                        ? 'Rejected'
                        : change.decision === 'accepted'
                          ? (change.isEdited ? 'Accepted + Edited' : 'Accepted')
                          : 'Pending'}
                    </span>
                  </div>
                  {!meta.approved ? (
                    <div className="flex gap-2">
                      {change.locked ? (
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => unlockChange(change.marker)}
                        >
                          Change
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            className={`btn-ghost ${change.decision === 'accepted' ? 'ring-2 ring-emerald-200' : ''}`}
                            onClick={() => acceptChange(change.marker)}
                          >
                            <CheckCircle2 className="h-4 w-4" /> Accept
                          </button>
                          <button
                            type="button"
                            className={`btn-ghost ${change.decision === 'rejected' ? 'ring-2 ring-rose-200' : ''}`}
                            onClick={() => rejectChange(change.marker)}
                          >
                            <XCircle className="h-4 w-4" /> Reject
                          </button>
                        </>
                      )}
                    </div>
                  ) : null}
                </div>
                <textarea
                  className={`input-premium min-h-24 py-2 ${change.locked ? 'opacity-70' : ''}`}
                  value={change.value}
                  disabled={change.locked || meta.approved}
                  onChange={e => updateChange(change.marker, {
                    value: e.target.value,
                    decision: 'accepted',
                    isEdited: e.target.value !== (change.suggestedValue || ''),
                  })}
                />
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
