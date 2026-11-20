import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Scissors,
  Download,
  FileText,
  Info,
  Loader2,
  AlertCircle,
  X,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import type {
  ClipCandidate,
  ClipCategory,
  ExportJob,
  ProjectDetailResponse,
  ProjectSummary,
} from '../../../shared/types.ts';
import { api } from '../../api/client.ts';
import { useToast } from '../../context/ToastContext.tsx';
import {
  CATEGORY_LABELS,
  formatDurationCompact,
  formatTimecodeMs,
  getScoreTierClasses,
} from '../../utils/formatters.ts';
import { ExportModal } from '../export/ExportModal.tsx';
import type { AppRoute } from '../layout/StudioShell.tsx';

interface ClipLibraryViewProps {
  projectId: string;
  onNavigate: (route: AppRoute) => void;
  onProjectLoaded?: (project: ProjectSummary) => void;
}

export function ClipLibraryView({
  projectId,
  onNavigate,
  onProjectLoaded,
}: ClipLibraryViewProps) {
  const { addToast } = useToast();
  const [detail, setDetail] = useState<ProjectDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [categoryFilter, setCategoryFilter] = useState<ClipCategory | 'all'>('all');
  const [sortBy, setSortBy] = useState<'score' | 'chronological'>('score');
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [exportingClip, setExportingClip] = useState<ClipCandidate | null>(null);

  const loadProject = useCallback(async () => {
    try {
      const data = await api.projects.get(projectId);
      setDetail(data);
      onProjectLoaded?.(data.project);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load clips');
    } finally {
      setLoading(false);
    }
  }, [projectId, onProjectLoaded]);

  useEffect(() => {
    void loadProject();
  }, [loadProject]);

  const filteredClips = useMemo(() => {
    if (!detail) return [];
    const list = detail.clips.filter((c) =>
      categoryFilter === 'all' ? true : c.category === categoryFilter
    );
    return [...list].sort((a, b) =>
      sortBy === 'score' ? b.overallScore - a.overallScore : a.startMs - b.startMs
    );
  }, [detail, categoryFilter, sortBy]);

  const handleExportUpdated = (exp: ExportJob) => {
    setDetail((prev) => {
      if (!prev) return prev;
      const exists = prev.exports.some((e) => e.id === exp.id);
      const nextExports = exists
        ? prev.exports.map((e) => (e.id === exp.id ? exp : e))
        : [exp, ...prev.exports];
      return { ...prev, exports: nextExports };
    });
  };

  const handleReanalyze = async () => {
    try {
      await api.projects.startAnalysis(projectId);
      onNavigate({ name: 'processing', projectId });
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Failed to restart analysis');
    }
  };

  if (loading) {
    return (
      <div className="max-w-[1320px] mx-auto px-4 sm:px-6 py-10 flex items-center gap-3 text-sm text-[#94A3B8]">
        <Loader2 className="w-5 h-5 animate-spin text-[#6366F1]" />
        <span>Loading discovered clip candidates...</span>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="max-w-xl mx-auto px-4 py-12">
        <div className="studio-card rounded-2xl p-8 text-center space-y-4">
          <AlertCircle className="w-8 h-8 text-red-400 mx-auto" />
          <p className="text-sm text-red-200">{error || 'Project could not be loaded'}</p>
          <button
            type="button"
            onClick={() => onNavigate({ name: 'projects' })}
            className="rounded-lg bg-[#1E293B] px-4 py-2 text-sm text-white cursor-pointer"
          >
            Back to Projects
          </button>
        </div>
      </div>
    );
  }

  const { project, clips, transcript } = detail;
  const isDemo = project.latestJob?.isDemoResult || project.providerMode === 'demo';

  return (
    <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
      {/* Header & Metadata */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#F8FAFC] tracking-tight">
            {project.title}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[#94A3B8] font-mono-tabular">
            <span>{clips.length} Clip Candidates</span>
            {project.sourceAsset && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {project.sourceAsset.width}×{project.sourceAsset.height}
                </span>
                <span aria-hidden="true">·</span>
                <span>{formatDurationCompact(project.sourceAsset.durationSec)}</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span>{transcript.length} Transcript Segments</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setTranscriptOpen(true)}
            className="rounded-lg bg-[#1E293B] hover:bg-[#25334D] border border-white/10 px-3.5 py-2 text-xs sm:text-sm font-medium text-slate-200 flex items-center gap-2 cursor-pointer"
          >
            <FileText className="w-4 h-4 text-[#818CF8]" />
            <span>Full Transcript</span>
          </button>
          <button
            type="button"
            onClick={() => void handleReanalyze()}
            className="rounded-lg bg-[#1E293B] hover:bg-[#25334D] border border-white/10 px-3.5 py-2 text-xs sm:text-sm font-medium text-slate-200 flex items-center gap-2 cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Re-run Discovery</span>
          </button>
        </div>
      </div>

      {isDemo && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/25 px-4 py-3 flex items-start gap-3 text-xs text-amber-100">
          <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <span>
            <strong>Demo Provider Output:</strong> These transcript segments and candidate scores
            were generated by the local demo fallback adapter because{' '}
            <code className="font-mono">GEMINI_API_KEY</code> is not configured. Preview renders
            and 1080×1920 MP4 exports still execute through the real FFmpeg pipeline.
          </span>
        </div>
      )}

      {/* Filter & Sort Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-[#111827] rounded-lg border border-white/[0.06] overflow-x-auto">
          {(['all', 'hook', 'insight', 'exchange', 'story', 'reaction', 'humor'] as const).map(
            (cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryFilter(cat)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  categoryFilter === cat
                    ? 'bg-[#6366F1] text-white'
                    : 'text-[#94A3B8] hover:text-white'
                }`}
              >
                {cat === 'all' ? 'All Moments' : CATEGORY_LABELS[cat]}
              </button>
            )
          )}
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <label htmlFor="clip-sort" className="text-xs text-[#94A3B8]">
            Sort:
          </label>
          <select
            id="clip-sort"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'score' | 'chronological')}
            className="studio-input rounded-lg px-3 py-1.5 text-xs text-white"
          >
            <option value="score">Highest Score</option>
            <option value="chronological">Chronological</option>
          </select>
        </div>
      </div>

      {/* Empty State */}
      {filteredClips.length === 0 ? (
        <div className="studio-card rounded-2xl p-12 text-center space-y-3">
          <Sparkles className="w-8 h-8 text-[#818CF8] mx-auto" />
          <h2 className="font-display text-lg font-semibold text-white">
            {clips.length === 0
              ? 'No clip candidates generated yet'
              : 'No clips match this category filter'}
          </h2>
          <p className="text-sm text-[#94A3B8] max-w-md mx-auto">
            {clips.length === 0
              ? 'Run the analysis pipeline to transcribe speech and discover standalone short-form moments.'
              : 'Switch back to All Moments to inspect every discovered candidate.'}
          </p>
          {clips.length === 0 ? (
            <button
              type="button"
              onClick={() => void handleReanalyze()}
              className="studio-cta rounded-lg px-5 py-2.5 text-sm font-semibold text-white cursor-pointer"
            >
              Run Analysis
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setCategoryFilter('all')}
              className="rounded-lg bg-[#1E293B] px-4 py-2 text-sm text-white cursor-pointer"
            >
              Show All Moments
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filteredClips.map((clip) => {
            const tier = getScoreTierClasses(clip.overallScore);
            const b = clip.scoreBreakdown;
            const dimensions = [
              { label: 'Hook', val: b.hookStrength },
              { label: 'Clarity', val: b.standaloneClarity },
              { label: 'Payoff', val: b.payoff },
              { label: 'Pacing', val: b.pacing },
              { label: 'Visual', val: b.visualSuitability },
            ];

            return (
              <article
                key={clip.id}
                className="studio-card hover:border-[#6366F1]/45 rounded-2xl overflow-hidden flex flex-col transition-colors"
              >
                {/* 9:16 Video Preview Area */}
                <div className="relative bg-[#0A0E18] flex items-center justify-center border-b border-white/[0.06]">
                  {clip.previewUrl ? (
                    <video
                      src={clip.previewUrl}
                      controls
                      preload="metadata"
                      playsInline
                      className="w-full max-h-[320px] aspect-[9/16] object-contain bg-black"
                    />
                  ) : (
                    <div className="w-full h-[260px] flex items-center justify-center text-xs text-[#64748B]">
                      Preview unavailable
                    </div>
                  )}

                  <div
                    className={`absolute top-3 right-3 rounded-full px-2.5 py-1 font-mono-tabular text-[11px] font-bold backdrop-blur-md ${tier.badge}`}
                  >
                    Score: {clip.overallScore.toFixed(1)}
                  </div>
                </div>

                {/* Metadata & Breakdown */}
                <div className="p-5 flex-1 flex flex-col justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 text-[11px] text-[#94A3B8]">
                      <span className="text-[#c0c1ff] font-medium">Editorial Suggestion</span>
                      <span aria-hidden="true">·</span>
                      <span>{CATEGORY_LABELS[clip.category]}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-tabular">
                        {formatTimecodeMs(clip.edit.startMs)}–{formatTimecodeMs(clip.edit.endMs)}
                      </span>
                    </div>

                    <h2 className="mt-1.5 font-display text-base font-semibold text-white leading-snug">
                      {clip.editorialTitle}
                    </h2>

                    <p className="mt-2 text-xs text-[#c7c4d7] leading-relaxed line-clamp-3">
                      {clip.explanation}
                    </p>

                    <div className="mt-3 rounded-lg bg-[#0E1424] border border-white/[0.05] p-3">
                      <div className="text-[11px] text-[#64748B] mb-1">Transcript excerpt</div>
                      <p className="text-xs text-[#dfe2f1] line-clamp-2 italic">
                        “{clip.transcriptExcerpt}”
                      </p>
                    </div>

                    {/* 5 Positive + Context Penalty Breakdown */}
                    <div className="mt-4 space-y-1.5">
                      {dimensions.map((d) => (
                        <div key={d.label} className="flex items-center gap-2 text-[11px]">
                          <span className="w-12 text-[#94A3B8]">{d.label}</span>
                          <div className="flex-1 h-1.5 rounded-full bg-[#0E1424] overflow-hidden">
                            <div
                              className={`h-full rounded-full ${tier.bar}`}
                              style={{ width: `${Math.min(100, d.val)}%` }}
                            />
                          </div>
                          <span className="w-7 text-right font-mono-tabular text-[#c7c4d7]">
                            {Math.round(d.val)}
                          </span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between text-[11px] pt-1 text-[#64748B]">
                        <span>Context integrity penalty</span>
                        <span className="font-mono-tabular text-[#94A3B8]">
                          -{b.contextIntegrityPenalty} pts
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Card Actions */}
                  <div className="pt-3 border-t border-white/[0.06] flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() =>
                        onNavigate({ name: 'editor', projectId: project.id, clipId: clip.id })
                      }
                      className="flex-1 studio-cta rounded-lg py-2 px-3 text-xs font-semibold text-white flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Scissors className="w-3.5 h-3.5" />
                      <span>Trim & Edit</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setExportingClip(clip)}
                      className="rounded-lg bg-[#1E293B] hover:bg-[#25334D] border border-white/10 py-2 px-3 text-xs font-medium text-slate-200 flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Export MP4</span>
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Full Source Transcript Drawer */}
      {transcriptOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Full source transcript"
        >
          <div className="w-full max-w-xl bg-[#111827] border-l border-white/10 h-full flex flex-col">
            <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-semibold text-white">
                  Timestamped Source Transcript
                </h2>
                <p className="text-xs text-[#94A3B8]">
                  {transcript.length} segments across {detail.speakers.length} speaker(s)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTranscriptOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] cursor-pointer"
                aria-label="Close transcript drawer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {transcript.map((seg) => (
                <div
                  key={seg.id}
                  className="rounded-xl bg-[#0E1424] border border-white/[0.05] p-4 space-y-1.5"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-[#c0c1ff]">{seg.speakerName}</span>
                    <span className="font-mono-tabular text-[#64748B]">
                      {formatTimecodeMs(seg.startMs)} – {formatTimecodeMs(seg.endMs)}
                    </span>
                  </div>
                  <p className="text-sm text-[#dfe2f1] leading-relaxed">{seg.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Export Dialog */}
      {exportingClip && (
        <ExportModal
          clip={exportingClip}
          existingExports={detail.exports}
          onClose={() => setExportingClip(null)}
          onExportUpdated={handleExportUpdated}
        />
      )}
    </div>
  );
}
