import React, { useState } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import {
  Home,
  MessageSquareText,
  FileText,
  File,
  FolderKanban,
  Settings,
  Menu,
  PanelLeftClose,
  Sparkles,
} from 'lucide-react';

export default function Layout({ currentUser, onLogout }) {
  const [collapsed, setCollapsed] = useState(false);

  const links = [
    { to: '/', icon: Home, label: 'Dashboard' },
    { to: '/comment-edit-studio', icon: MessageSquareText, label: 'Comment Edit Studio' },
    { to: '/templates', icon: FileText, label: 'Templates' },
    { to: '/sources', icon: File, label: 'Source Docs' },
    { to: '/projects', icon: FolderKanban, label: 'Projects' },
    { to: '/settings', icon: Settings, label: 'Settings' },
  ];

  return (
    <div className="flex min-h-screen p-3 lg:p-5">
      <aside className={`page-shell mr-3 flex flex-col transition-all duration-300 ${collapsed ? 'w-[5.5rem]' : 'w-72'}`}>
        <div className="flex h-20 items-center justify-between border-b border-amber-100 px-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-amber-200 via-orange-100 to-sky-100">
              <Sparkles className="h-5 w-5 text-sky-900" />
            </div>
            {!collapsed && (
              <div>
                <p className="text-lg font-bold tracking-tight text-slate-800">FillWise</p>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Studio</p>
              </div>
            )}
          </div>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="btn-ghost h-9 w-9 p-0"
            aria-label="Toggle navigation"
          >
            {collapsed ? <Menu className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {links.map((l, idx) => (
            <React.Fragment key={l.to}>
              {idx === 2 ? <div className="my-2 border-t border-amber-100" /> : null}
              <NavLink
                to={l.to}
                end={l.to === '/'}
                className={({ isActive }) =>
                  `group flex items-center rounded-2xl px-3 py-2.5 text-sm font-semibold transition ${
                    isActive
                      ? 'bg-sky-900 text-white shadow-[0_10px_24px_-16px_rgba(2,132,199,0.9)]'
                      : 'text-slate-600 hover:bg-amber-50 hover:text-slate-900'
                  }`
                }
              >
                <l.icon className={`h-5 w-5 ${collapsed ? 'mx-auto' : ''}`} />
                {!collapsed && <span className="ml-3">{l.label}</span>}
              </NavLink>
            </React.Fragment>
          ))}
        </nav>
        <div className="border-t border-amber-100 p-4 text-xs text-slate-500">
          {!collapsed ? 'SLM Labs' : 'SLM'}
        </div>
      </aside>

      <main className="flex-1">
        <header className="page-shell mb-3 flex h-20 items-center justify-between px-5">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Workspace</p>
            <p className="text-xl font-bold text-slate-800">Document Refactoring Suite</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {currentUser || 'User'}
            </div>
            <button className="btn-ghost" onClick={onLogout} type="button">
              Logout
            </button>
          </div>
        </header>
        <section className="page-shell min-h-[calc(100vh-8rem)] p-5 lg:p-7">
          <Outlet />
        </section>
      </main>
    </div>
  );
}
