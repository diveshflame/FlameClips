import React, { useEffect, useMemo, useState } from 'react';
import { Search, Trash2, ArrowRight, FolderOpen, Clock, Plus } from 'lucide-react';
import type { ProjectStatus, ProjectSummary } from '../../../shared/types.ts';
import { api } from '../../api/client.ts';
import { useToast } from '../../context/ToastContext.tsx';
import {
  formatDurationCompact,
  formatRelativeDate,
  PLATFORM_LABELS,
  STATUS_LABELS,
} from '../../utils/formatters.ts';
import type { AppRoute } from '../layout/StudioShell.tsx';

interface ProjectsViewProps {
  onNavigate: (route: AppRoute) => void;
}

export function ProjectsView({ onNavigate }: ProjectsViewProps) {
  const { addToast } = useToast();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | 'all'>('all');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    api.projects
      .list()
      .then((res) => setProjects(res.projects))
      .catch((err) =>
        addToast('error', err instanceof Error ? err.message : 'Failed to load projects')
      )
      .finally(() => setLoading(false));
  }, [addToast]);

  const filtered = useMemo(() => {
    return projects.filter((p) => {
      const matchesSearch = p.title.toLowerCase().includes(search.trim().toLowerCase());
      const matchesStatus = statusFilter === 'all' ? true : p.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [projects, search, statusFilter]);

  const handleDelete = async (id: string) => {
    try {
      await api.projects.delete(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
      setConfirmDeleteId(null);
      addToast('success', 'Project and associated media deleted');
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Failed to delete project');
    }
  };

  return (
    <div className="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#F8FAFC] tracking-tight">
            My Projects
          </h1>
          <p className="mt-1 text-sm text-[#94A3B8]">
            Manage uploaded source masters, processing jobs, and exported short-form clips.
          </p>
        </div>

        <button
          type="button"
          onClick={() => onNavigate({ name: 'dashboard' })}
          className="studio-cta rounded-lg px-4 py-2 text-sm font-semibold text-white flex items-center gap-1.5 self-start sm:self-auto cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>New Clip Project</span>
        </button>
      </div>

      {/* Search & Status Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#64748B] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects by title..."
            className="w-full studio-input rounded-lg pl-10 pr-3.5 py-2 text-sm text-white placeholder-[#475569]"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as ProjectStatus | 'all')}
          aria-label="Filter projects by status"
          className="studio-input rounded-lg px-3.5 py-2 text-sm text-white"
        >
          <option value="all">All Statuses</option>
          <option value="completed">Clips Ready</option>
          <option value="processing">Processing</option>
          <option value="ready_for_analysis">Ready for Analysis</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="studio-card rounded-xl h-20 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="studio-card rounded-2xl p-12 text-center space-y-3">
          <FolderOpen className="w-8 h-8 text-[#818CF8] mx-auto" />
          <h2 className="font-display text-lg font-semibold text-white">No projects found</h2>
          <p className="text-sm text-[#94A3B8]">
            {projects.length === 0
              ? 'Upload an authorized video or load the studio sample to create your first project.'
              : 'Adjust your search term or status filter.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((proj) => (
            <div
              key={proj.id}
              className="studio-card hover:border-[#6366F1]/40 rounded-xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors"
            >
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span
                    className={`font-medium ${
                      proj.status === 'completed'
                        ? 'text-emerald-400'
                        : proj.status === 'failed'
                          ? 'text-red-400'
                          : 'text-[#c0c1ff]'
                    }`}
                  >
                    {STATUS_LABELS[proj.status]}
                  </span>
                  <span aria-hidden="true" className="text-[#64748B]">
                    ·
                  </span>
                  <span className="text-[#94A3B8]">
                    {proj.targetPlatforms.map((p) => PLATFORM_LABELS[p]).join(' & ')}
                  </span>
                  <span aria-hidden="true" className="text-[#64748B]">
                    ·
                  </span>
                  <span className="font-mono-tabular text-[#64748B]">
                    Updated {formatRelativeDate(proj.updatedAt)}
                  </span>
                </div>

                <h2 className="font-display text-base font-semibold text-white truncate">
                  {proj.title}
                </h2>

                <div className="flex flex-wrap items-center gap-3 text-xs text-[#94A3B8] font-mono-tabular">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-[#64748B]" />
                    {proj.sourceAsset
                      ? formatDurationCompact(proj.sourceAsset.durationSec)
                      : 'No media'}
                  </span>
                  <span>{proj.clipCount} clips</span>
                  <span>{proj.exportCount} exports</span>
                </div>
              </div>

              <div className="flex items-center gap-2.5 shrink-0">
                {confirmDeleteId === proj.id ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleDelete(proj.id)}
                      className="rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-400/40 px-3 py-1.5 text-xs font-medium text-red-200 cursor-pointer"
                    >
                      Confirm Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      className="rounded-lg px-2.5 py-1.5 text-xs text-[#94A3B8] hover:text-white cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(proj.id)}
                    className="rounded-lg p-2 text-slate-400 hover:text-red-400 hover:bg-white/[0.04] cursor-pointer"
                    aria-label={`Delete ${proj.title}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}

                <button
                  type="button"
                  onClick={() =>
                    onNavigate(
                      proj.status === 'processing' || proj.status === 'ready_for_analysis'
                        ? { name: 'processing', projectId: proj.id }
                        : { name: 'clips', projectId: proj.id }
                    )
                  }
                  className="rounded-lg bg-[#1E293B] hover:bg-[#25334D] border border-white/10 px-4 py-2 text-xs sm:text-sm font-medium text-white flex items-center gap-1.5 cursor-pointer"
                >
                  <span>{proj.status === 'processing' ? 'View Progress' : 'Open Studio'}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
