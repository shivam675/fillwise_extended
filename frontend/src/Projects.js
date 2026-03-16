import React, { useState, useEffect, useCallback } from 'react';
import { FolderKanban, FolderOpen, Play, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { apiRequest } from './api';
import { useNavigate } from 'react-router-dom';

export default function Projects() {
  const navigate = useNavigate();
  const [data, setData] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [sources, setSources] = useState([]);
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [editingId, setEditingId] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusText, setStatusText] = useState('');

  const loadProjects = useCallback(async () => {
    try {
      const rows = await apiRequest('/projects');
      setData(Array.isArray(rows) ? rows : []);
    } catch {
      setData([]);
    }
  }, []);

  const loadLookups = useCallback(async () => {
    try {
      const [tRows, sRows] = await Promise.all([
        apiRequest('/templates'),
        apiRequest('/sources'),
      ]);
      setTemplates(Array.isArray(tRows) ? tRows : []);
      setSources(Array.isArray(sRows) ? sRows : []);
    } catch {
      setTemplates([]);
      setSources([]);
    }
  }, []);

  const loadAll = useCallback(async () => {
    await Promise.all([loadProjects(), loadLookups()]);
  }, [loadLookups, loadProjects]);

  useEffect(() => {
    loadAll().catch(() => {});
  }, [loadAll]);

  function resetForm() {
    setEditingId('');
    setName('');
    setTemplateId('');
    setSourceId('');
    setStatusText('');
  }

  async function submitProject(e) {
    e.preventDefault();
    setStatusText('');

    if (!name.trim() || !templateId || !sourceId) {
      setStatusText('Provide project name, template, and source document.');
      return;
    }

    setBusy(true);
    try {
      const payload = {
        name: name.trim(),
        template_id: templateId,
        source_id: sourceId,
      };

      if (editingId) {
        await apiRequest(`/projects/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        await apiRequest('/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      await loadProjects();
      resetForm();
    } catch (err) {
      setStatusText(err.message || 'Could not save project.');
    } finally {
      setBusy(false);
    }
  }

  function startEdit(project) {
    setEditingId(project._id);
    setName(project.name || '');
    setTemplateId(project.template_id || '');
    setSourceId(project.source_id || '');
    setStatusText('');
  }

  async function removeProject(id) {
    if (!window.confirm('Delete this project?')) return;
    setBusy(true);
    setStatusText('');
    try {
      await apiRequest(`/projects/${id}`, { method: 'DELETE' });
      if (editingId === id) resetForm();
      await loadProjects();
    } catch (err) {
      setStatusText(err.message || 'Could not delete project.');
    } finally {
      setBusy(false);
    }
  }

  async function startProject(id) {
    setBusy(true);
    setStatusText('');
    try {
      const res = await apiRequest(`/projects/${id}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      setStatusText(`Project started. Job ID: ${res.job_id}`);
      await loadProjects();
      navigate(`/projects/${id}/edit/${res.job_id}`);
    } catch (err) {
      setStatusText(err.message || 'Could not start project.');
    } finally {
      setBusy(false);
    }
  }

  function openStudio(project) {
    if (!project.last_job_id) return;
    navigate(`/projects/${project._id}/edit/${project.last_job_id}`);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Projects</h1>
        <p className="page-subtitle">Create projects from saved assets and launch the refactoring pipeline.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.45fr]">
        <form onSubmit={submitProject} className="rounded-2xl border border-amber-100 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-lg font-bold text-slate-800">{editingId ? 'Edit Project' : 'Create Project'}</p>
            {editingId ? (
              <button type="button" className="btn-ghost" onClick={resetForm}>Cancel</button>
            ) : null}
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-600">Project Name</label>
              <input
                className="input-premium"
                placeholder="Project Atlas"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-600">Template</label>
              <select className="input-premium" value={templateId} onChange={e => setTemplateId(e.target.value)}>
                <option value="">Select template</option>
                {templates.map(item => (
                  <option key={item._id} value={item._id}>{item.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-600">Source Document</label>
              <select className="input-premium" value={sourceId} onChange={e => setSourceId(e.target.value)}>
                <option value="">Select source</option>
                {sources.map(item => (
                  <option key={item._id} value={item._id}>{item.name}</option>
                ))}
              </select>
            </div>

            {statusText ? <p className="text-sm font-semibold text-slate-600">{statusText}</p> : null}

            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" type="submit" disabled={busy || !templates.length || !sources.length}>
                {editingId ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {editingId ? 'Update Project' : 'Create Project'}
              </button>
              <button className="btn-secondary" type="button" onClick={() => loadAll()} disabled={busy}>
                <RefreshCw className="h-4 w-4" />
                Refresh Data
              </button>
            </div>
          </div>
        </form>

        <div className="table-shell">
          <div className="flex items-center justify-between border-b border-amber-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-700">Project Library</p>
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">{data.length} items</span>
          </div>

          <div className="max-h-[520px] overflow-auto">
            {data.length === 0 ? (
              <div className="grid min-h-[200px] place-items-center p-8 text-center text-sm text-slate-500">
                <div>
                  <FolderKanban className="mx-auto mb-2 h-7 w-7 text-slate-300" />
                  No projects found. Create your first project to start processing.
                </div>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-amber-50/70 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Project</th>
                    <th className="px-4 py-3">Template</th>
                    <th className="px-4 py-3">Source</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map(item => (
                    <tr key={item._id} className="border-t border-amber-100/80">
                      <td className="px-4 py-3 font-semibold text-slate-700">{item.name || 'Project'}</td>
                      <td className="px-4 py-3 text-slate-500">{item.template_name || '-'}</td>
                      <td className="px-4 py-3 text-slate-500">{item.source_name || '-'}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          {!item.last_job_id ? (
                            <button className="btn-secondary" onClick={() => startProject(item._id)} disabled={busy}>
                              <Play className="h-4 w-4" /> Start
                            </button>
                          ) : (
                            <button className="btn-secondary" onClick={() => openStudio(item)} disabled={busy}>
                              <FolderOpen className="h-4 w-4" /> Open Studio
                            </button>
                          )}
                          <button className="btn-ghost" onClick={() => startEdit(item)} disabled={busy}>
                            <Save className="h-4 w-4" /> Edit
                          </button>
                          <button className="btn-danger" onClick={() => removeProject(item._id)} disabled={busy}>
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
