import React, { useMemo, useState, useEffect } from 'react';
import { Database, Edit3, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { apiRequest } from './api';

export default function Sources() {
  const [data, setData] = useState([]);
  const [name, setName] = useState('');
  const [file, setFile] = useState(null);
  const [editingId, setEditingId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    try {
      const rows = await apiRequest('/sources');
      setData(Array.isArray(rows) ? rows : []);
    } catch {
      setData([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const selectedSource = useMemo(() => data.find(item => item._id === editingId), [data, editingId]);

  async function submit(e) {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('Document name is required.');
      return;
    }

    if (!editingId && !file) {
      setError('Please choose a source document.');
      return;
    }

    setBusy(true);
    try {
      const formData = new FormData();
      formData.append('name', name.trim());
      if (file) formData.append('file', file);

      if (editingId) {
        await apiRequest(`/sources/${editingId}`, { method: 'PUT', body: formData });
      } else {
        await apiRequest('/sources', { method: 'POST', body: formData });
      }

      setName('');
      setFile(null);
      setEditingId('');
      await load();
    } catch (err) {
      setError(err.message || 'Operation failed');
    } finally {
      setBusy(false);
    }
  }

  async function removeSource(id) {
    if (!window.confirm('Delete this source document?')) return;
    setBusy(true);
    setError('');
    try {
      await apiRequest(`/sources/${id}`, { method: 'DELETE' });
      if (editingId === id) {
        setEditingId('');
        setName('');
        setFile(null);
      }
      await load();
    } catch (err) {
      setError(err.message || 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  function startEdit(item) {
    setEditingId(item._id);
    setName(item.name || '');
    setFile(null);
    setError('');
  }

  function resetForm() {
    setEditingId('');
    setName('');
    setFile(null);
    setError('');
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Source Documents</h1>
        <p className="page-subtitle">Upload PDF/DOC/DOCX source files to use across projects.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.45fr]">
        <form onSubmit={submit} className="rounded-2xl border border-amber-100 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-lg font-bold text-slate-800">{editingId ? 'Edit Source' : 'Add Source Document'}</p>
            {editingId ? (
              <button type="button" className="btn-ghost" onClick={resetForm}>Cancel</button>
            ) : null}
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-600">Document Name</label>
              <input
                className="input-premium"
                placeholder="Loan Agreement - Client A"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-600">File (PDF, DOC, DOCX)</label>
              <input
                className="input-premium py-2"
                type="file"
                accept=".pdf,.doc,.docx"
                onChange={e => setFile(e.target.files?.[0] ?? null)}
              />
              <p className="mt-1 text-xs text-slate-500">
                {editingId
                  ? `Current file: ${selectedSource?.filename || 'Unknown'} (upload to replace)`
                  : 'Upload a source file to parse and extract content from.'}
              </p>
            </div>

            {error ? <p className="text-sm font-semibold text-rose-600">{error}</p> : null}

            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" type="submit" disabled={busy}>
                {editingId ? <Edit3 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {editingId ? 'Update Source' : 'Add Document'}
              </button>
              <button className="btn-secondary" type="button" onClick={() => load()} disabled={busy}>
                <RefreshCw className="h-4 w-4" />
                Refresh
              </button>
            </div>
          </div>
        </form>

        <div className="table-shell">
          <div className="flex items-center justify-between border-b border-amber-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-700">Stored Source Files</p>
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">{data.length} items</span>
          </div>

          <div className="max-h-[520px] overflow-auto">
            {data.length === 0 ? (
              <div className="grid min-h-[200px] place-items-center p-8 text-center text-sm text-slate-500">
                <div>
                  <Database className="mx-auto mb-2 h-7 w-7 text-slate-300" />
                  No source documents yet.
                </div>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-amber-50/70 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">File</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map(item => (
                    <tr key={item._id} className="border-t border-amber-100/80">
                      <td className="px-4 py-3 font-semibold text-slate-700">{item.name}</td>
                      <td className="px-4 py-3 text-slate-500">{item.filename || '-'}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <button className="btn-ghost" onClick={() => startEdit(item)}>
                            <Edit3 className="h-4 w-4" /> Edit
                          </button>
                          <button className="btn-danger" onClick={() => removeSource(item._id)}>
                            <Trash2 className="h-4 w-4" /> Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
