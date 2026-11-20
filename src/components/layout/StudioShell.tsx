import React, { useState } from 'react';
import {
  Clapperboard,
  FolderKanban,
  Home,
  LogOut,
  Menu,
  Plus,
  Scissors,
  Settings,
  Sparkles,
  Activity,
  X,
  ChevronRight,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';

export type AppRoute =
  | { name: 'dashboard' }
  | { name: 'projects' }
  | { name: 'settings' }
  | { name: 'processing'; projectId: string }
  | { name: 'clips'; projectId: string }
  | { name: 'editor'; projectId: string; clipId: string };

interface StudioShellProps {
  route: AppRoute;
  onNavigate: (route: AppRoute) => void;
  activeProjectTitle?: string;
  breadcrumbs: Array<{ label: string; route?: AppRoute }>;
  primaryAction?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
  };
  children: React.ReactNode;
}

export function StudioShell({
  route,
  onNavigate,
  activeProjectTitle,
  breadcrumbs,
  primaryAction,
  children,
}: StudioShellProps) {
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const projectId =
    route.name === 'processing' || route.name === 'clips' || route.name === 'editor'
      ? route.projectId
      : null;

  const navItems: Array<{
    id: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    active: boolean;
    onClick: () => void;
  }> = [
    {
      id: 'dashboard',
      label: 'New Clip Job',
      icon: Home,
      active: route.name === 'dashboard',
      onClick: () => {
        onNavigate({ name: 'dashboard' });
        setMobileOpen(false);
      },
    },
    {
      id: 'projects',
      label: 'My Projects',
      icon: FolderKanban,
      active: route.name === 'projects',
      onClick: () => {
        onNavigate({ name: 'projects' });
        setMobileOpen(false);
      },
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: Settings,
      active: route.name === 'settings',
      onClick: () => {
        onNavigate({ name: 'settings' });
        setMobileOpen(false);
      },
    },
  ];

  const renderSidebarContent = (compact = false) => (
    <div className="flex flex-col h-full justify-between">
      <div>
        <button
          type="button"
          onClick={() => {
            onNavigate({ name: 'dashboard' });
            setMobileOpen(false);
          }}
          className={`flex items-center gap-3 w-full text-left px-3 py-2.5 rounded-lg hover:bg-white/[0.04] transition-colors cursor-pointer ${
            compact ? 'justify-center px-0' : ''
          }`}
        >
          <div className="w-8 h-8 rounded-lg studio-cta flex items-center justify-center shrink-0">
            <Clapperboard className="w-4 h-4 text-white" />
          </div>
          {!compact && (
            <span className="font-display font-bold text-base tracking-tight text-white whitespace-nowrap">
              ClipForge AI
            </span>
          )}
        </button>

        <nav className="mt-6 space-y-1" aria-label="Primary navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={item.onClick}
                title={compact ? item.label : undefined}
                className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors cursor-pointer ${
                  compact ? 'justify-center px-0' : ''
                } ${
                  item.active
                    ? 'bg-[#6366F1]/15 text-[#c0c1ff] border border-[#6366F1]/35'
                    : 'text-[#94A3B8] hover:text-white hover:bg-white/[0.04] border border-transparent'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {!compact && <span className="whitespace-nowrap truncate">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        {projectId && (
          <div className="mt-8 pt-6 border-t border-white/[0.06]">
            {!compact && (
              <div className="px-3 mb-2 text-xs font-medium text-[#64748B] truncate">
                {activeProjectTitle || 'Active Project'}
              </div>
            )}
            <div className="space-y-1">
              <button
                type="button"
                title={compact ? 'Pipeline Status' : undefined}
                onClick={() => {
                  onNavigate({ name: 'processing', projectId });
                  setMobileOpen(false);
                }}
                className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors cursor-pointer ${
                  compact ? 'justify-center px-0' : ''
                } ${
                  route.name === 'processing'
                    ? 'bg-[#161F36] text-white border border-[#6366F1]/40'
                    : 'text-[#94A3B8] hover:text-white hover:bg-white/[0.04] border border-transparent'
                }`}
              >
                <Activity className="w-4 h-4 shrink-0" />
                {!compact && <span className="whitespace-nowrap">Processing</span>}
              </button>
              <button
                type="button"
                title={compact ? 'Clip Library' : undefined}
                onClick={() => {
                  onNavigate({ name: 'clips', projectId });
                  setMobileOpen(false);
                }}
                className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors cursor-pointer ${
                  compact ? 'justify-center px-0' : ''
                } ${
                  route.name === 'clips'
                    ? 'bg-[#161F36] text-white border border-[#6366F1]/40'
                    : 'text-[#94A3B8] hover:text-white hover:bg-white/[0.04] border border-transparent'
                }`}
              >
                <Sparkles className="w-4 h-4 shrink-0" />
                {!compact && <span className="whitespace-nowrap">Clip Library</span>}
              </button>
              {route.name === 'editor' && (
                <button
                  type="button"
                  title={compact ? 'Clip Editor' : undefined}
                  onClick={() => setMobileOpen(false)}
                  className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm bg-[#161F36] text-white border border-[#6366F1]/40 ${
                    compact ? 'justify-center px-0' : ''
                  }`}
                >
                  <Scissors className="w-4 h-4 shrink-0" />
                  {!compact && <span className="whitespace-nowrap">Clip Editor</span>}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* User Footer */}
      <div className="pt-4 border-t border-white/[0.06]">
        {!compact && user && (
          <div className="px-3 mb-3">
            <div className="text-sm font-medium text-white truncate">{user.name}</div>
            <div className="text-xs text-[#64748B] truncate">{user.email}</div>
          </div>
        )}
        <button
          type="button"
          onClick={() => void logout()}
          title={compact ? 'Sign Out' : undefined}
          className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-[#94A3B8] hover:text-white hover:bg-white/[0.04] transition-colors cursor-pointer ${
            compact ? 'justify-center px-0' : ''
          }`}
        >
          <LogOut className="w-4 h-4 shrink-0" />
          {!compact && <span>Sign Out</span>}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0B0F19] text-[#dfe2f1] flex">
      {/* Desktop 260px Sidebar (>=1280px) */}
      <aside className="hidden xl:flex flex-col w-[260px] shrink-0 studio-panel border-r border-white/[0.06] p-4 sticky top-0 h-screen">
        {renderSidebarContent(false)}
      </aside>

      {/* Tablet 64px Icon Rail (768px-1279px) */}
      <aside className="hidden md:flex xl:hidden flex-col w-16 shrink-0 studio-panel border-r border-white/[0.06] py-4 px-2 sticky top-0 h-screen">
        {renderSidebarContent(true)}
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative z-10 w-64 bg-[#111827] border-r border-white/10 p-4 flex flex-col h-full">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white"
              aria-label="Close navigation menu"
            >
              <X className="w-5 h-5" />
            </button>
            {renderSidebarContent(false)}
          </aside>
        </div>
      )}

      {/* Main Column */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 h-14 px-4 sm:px-6 flex items-center justify-between gap-4 studio-panel border-b border-white/[0.06]">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="md:hidden p-2 -ml-2 rounded-lg text-slate-300 hover:bg-white/[0.06]"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm min-w-0">
              {breadcrumbs.map((crumb, idx) => (
                <React.Fragment key={`${crumb.label}-${idx}`}>
                  {idx > 0 && <ChevronRight className="w-3.5 h-3.5 text-[#64748B] shrink-0" />}
                  {crumb.route ? (
                    <button
                      type="button"
                      onClick={() => onNavigate(crumb.route!)}
                      className="text-[#94A3B8] hover:text-white transition-colors truncate whitespace-nowrap cursor-pointer"
                    >
                      {crumb.label}
                    </button>
                  ) : (
                    <span className="font-medium text-white truncate">{crumb.label}</span>
                  )}
                </React.Fragment>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {primaryAction ? (
              <button
                type="button"
                onClick={primaryAction.onClick}
                disabled={primaryAction.disabled}
                className="studio-cta rounded-lg px-4 py-1.5 text-xs sm:text-sm font-semibold text-white whitespace-nowrap shrink-0 disabled:opacity-50 cursor-pointer"
              >
                {primaryAction.label}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate({ name: 'dashboard' })}
                className="rounded-lg bg-[#1E293B] hover:bg-[#25334D] border border-white/10 px-3.5 py-1.5 text-xs sm:text-sm font-medium text-slate-200 flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Project</span>
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
