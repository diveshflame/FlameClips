import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { ProjectSummary } from '../shared/types.ts';
import { AuthView } from './components/auth/AuthView.tsx';
import { ClipLibraryView } from './components/clips/ClipLibraryView.tsx';
import { DashboardView } from './components/dashboard/DashboardView.tsx';
import { ClipEditorView } from './components/editor/ClipEditorView.tsx';
import { StudioShell, type AppRoute } from './components/layout/StudioShell.tsx';
import { ProcessingView } from './components/processing/ProcessingView.tsx';
import { ProjectsView } from './components/projects/ProjectsView.tsx';
import { SettingsView } from './components/settings/SettingsView.tsx';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { ToastProvider } from './context/ToastContext.tsx';

function parseRouteFromPath(pathname: string): AppRoute {
  if (pathname === '/projects') return { name: 'projects' };
  if (pathname === '/settings') return { name: 'settings' };

  const processingMatch = pathname.match(/^\/projects\/([^/]+)\/processing$/);
  if (processingMatch) {
    return { name: 'processing', projectId: decodeURIComponent(processingMatch[1]) };
  }

  const editorMatch = pathname.match(/^\/projects\/([^/]+)\/clips\/([^/]+)\/edit$/);
  if (editorMatch) {
    return {
      name: 'editor',
      projectId: decodeURIComponent(editorMatch[1]),
      clipId: decodeURIComponent(editorMatch[2]),
    };
  }

  const clipsMatch = pathname.match(/^\/projects\/([^/]+)\/clips$/);
  if (clipsMatch) {
    return { name: 'clips', projectId: decodeURIComponent(clipsMatch[1]) };
  }

  return { name: 'dashboard' };
}

function routeToPath(route: AppRoute): string {
  switch (route.name) {
    case 'projects':
      return '/projects';
    case 'settings':
      return '/settings';
    case 'processing':
      return `/projects/${encodeURIComponent(route.projectId)}/processing`;
    case 'clips':
      return `/projects/${encodeURIComponent(route.projectId)}/clips`;
    case 'editor':
      return `/projects/${encodeURIComponent(route.projectId)}/clips/${encodeURIComponent(route.clipId)}/edit`;
    default:
      return '/';
  }
}

function StudioRouter() {
  const { user, loading } = useAuth();
  const [route, setRoute] = useState<AppRoute>(() => parseRouteFromPath(window.location.pathname));
  const [activeProject, setActiveProject] = useState<ProjectSummary | null>(null);

  const navigate = useCallback((nextRoute: AppRoute) => {
    const targetPath = routeToPath(nextRoute);
    if (window.location.pathname !== targetPath) {
      window.history.pushState({}, '', targetPath);
    }
    setRoute(nextRoute);
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setRoute(parseRouteFromPath(window.location.pathname));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0F19] flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-[#94A3B8]">
          <Loader2 className="w-5 h-5 animate-spin text-[#6366F1]" />
          <span>Loading ClipForge AI...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthView />;
  }

  const breadcrumbs: Array<{ label: string; route?: AppRoute }> = [{ label: 'Studio', route: { name: 'dashboard' } }];
  if (route.name === 'projects') {
    breadcrumbs.push({ label: 'My Projects' });
  } else if (route.name === 'settings') {
    breadcrumbs.push({ label: 'Settings' });
  } else if (route.name === 'processing') {
    breadcrumbs.push({ label: 'My Projects', route: { name: 'projects' } });
    breadcrumbs.push({ label: activeProject?.title || 'Project', route: { name: 'clips', projectId: route.projectId } });
    breadcrumbs.push({ label: 'Processing' });
  } else if (route.name === 'clips') {
    breadcrumbs.push({ label: 'My Projects', route: { name: 'projects' } });
    breadcrumbs.push({ label: activeProject?.title || 'Clip Library' });
  } else if (route.name === 'editor') {
    breadcrumbs.push({ label: 'My Projects', route: { name: 'projects' } });
    breadcrumbs.push({ label: activeProject?.title || 'Project', route: { name: 'clips', projectId: route.projectId } });
    breadcrumbs.push({ label: 'Clip Editor' });
  } else {
    breadcrumbs.push({ label: 'New Clip Job' });
  }

  return (
    <StudioShell
      route={route}
      onNavigate={navigate}
      activeProjectTitle={activeProject?.title}
      breadcrumbs={breadcrumbs}
    >
      {route.name === 'dashboard' && <DashboardView onNavigate={navigate} />}
      {route.name === 'projects' && <ProjectsView onNavigate={navigate} />}
      {route.name === 'settings' && <SettingsView />}
      {route.name === 'processing' && (
        <ProcessingView
          projectId={route.projectId}
          onNavigate={navigate}
          onProjectLoaded={setActiveProject}
        />
      )}
      {route.name === 'clips' && (
        <ClipLibraryView
          projectId={route.projectId}
          onNavigate={navigate}
          onProjectLoaded={setActiveProject}
        />
      )}
      {route.name === 'editor' && (
        <ClipEditorView
          projectId={route.projectId}
          clipId={route.clipId}
          onNavigate={navigate}
          onProjectLoaded={setActiveProject}
        />
      )}
    </StudioShell>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <StudioRouter />
      </AuthProvider>
    </ToastProvider>
  );
}
