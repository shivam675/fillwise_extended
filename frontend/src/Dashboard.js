import React, { useEffect, useState } from 'react';
import { Activity, Database, FileText, FolderKanban, RefreshCw, Users } from 'lucide-react';
import { apiRequest } from './api';

export default function Dashboard() {
  const [stats, setStats] = useState({
    templates: 0,
    sources: 0,
    projects: 0,
    jobs: 0,
    running_jobs: 0,
    users: 1,
  });
  const [loading, setLoading] = useState(false);

  const statCards = [
    { key: 'templates', label: 'Templates', icon: FileText, color: 'text-sky-900' },
    { key: 'sources', label: 'Source Docs', icon: Database, color: 'text-emerald-700' },
    { key: 'projects', label: 'Projects', icon: FolderKanban, color: 'text-amber-700' },
    { key: 'jobs', label: 'Jobs', icon: Activity, color: 'text-indigo-700' },
    { key: 'running_jobs', label: 'Running Jobs', icon: RefreshCw, color: 'text-rose-700' },
    { key: 'users', label: 'Users', icon: Users, color: 'text-slate-700' },
  ];

  async function loadStats() {
    setLoading(true);
    try {
      const data = await apiRequest('/dashboard/stats');
      setStats(prev => ({ ...prev, ...data }));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStats().catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">A live pulse of templates, documents, projects, and active runs.</p>
        </div>
        <button className="btn-secondary" onClick={() => loadStats().catch(() => {})} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {statCards.map(card => (
          <article key={card.key} className="stat-card">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-500">{card.label}</p>
              <card.icon className={`h-5 w-5 ${card.color}`} />
            </div>
            <p className="text-4xl font-bold tracking-tight text-slate-900">{stats[card.key] ?? 0}</p>
          </article>
        ))}
      </div>

      <div className="rounded-2xl border border-amber-100 bg-gradient-to-r from-sky-50 via-white to-amber-50 p-6">
        <p className="text-sm font-semibold text-slate-700">Studio Insight</p>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">
          Use Templates and Source Docs to build your project library, then launch processing from Projects with one click.
          Saved Ollama settings are used as defaults when starting runs.
        </p>
      </div>
    </div>
  );
}
