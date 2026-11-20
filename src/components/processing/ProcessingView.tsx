import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Loader2,
  AlertCircle,
  RotateCcw,
  XCircle,
  ArrowRight,
  Film,
} from 'lucide-react';
import type { ProcessingJob, ProcessingStage, ProjectSummary } from '../../../shared/types.ts';
import { api } from '../../api/client.ts';
import { useToast } from '../../context/ToastContext.tsx';
import type { AppRoute } from '../layout/StudioShell.tsx';

interface ProcessingViewProps {
  projectId: string;
  onNavigate: (route: AppRoute) => void;
  onProjectLoaded?: (project: ProjectSummary) => void;
}

const PIPELINE_STAGES: Array<{ stage: ProcessingStage; title: string; subtitle: string }> = [
  {
    stage: 'inspecting_media',
    title: 'Media Inspection',
    subtitle: 'Verifying codec, resolution, framerate, and audio streams via ffprobe',
  },
  {
    stage: 'extracting_audio',
    title: 'Audio Extraction',
    subtitle: 'Decoding 16kHz mono speech stream via FFmpeg',
  },
  {
    stage: 'transcribing',
    title: 'Transcription & Diarization',
    subtitle: 'Generating timestamped dialogue segments and speaker turns',
  },
  {
    stage: 'analyzing_moments',
    title: 'Story & Hook Discovery',
    subtitle: 'Identifying standalone hooks, insights, reactions, and complete arcs',
  },
  {
    stage: 'ranking_candidates',
    title: 'Explainable Scoring & Deduplication',
    subtitle: 'Scoring 6 editorial dimensions and suppressing overlapping segments',
  },
  {
    stage: 'generating_previews',
    title: 'Vertical 9:16 Preview Rendering',
    subtitle: 'Rendering 9:16 H.264 preview clips and aligning caption timing',
  },
];

export function ProcessingView({
  projectId,
  onNavigate,
  onProjectLoaded,
}: ProcessingViewProps) {
  const { addToast } = useToast();
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [job, setJob] = useState<ProcessingJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const detail = await api.projects.get(projectId);
        if (!active) return;
        setProject(detail.project);
        onProjectLoaded?.(detail.project);

        let latestJob = detail.project.latestJob;
        if (latestJob) {
          const jobRes = await api.jobs.get(latestJob.id);
          if (!active) return;
          latestJob = jobRes.job;
          setJob(latestJob);
        }
        setLoading(false);

        if (latestJob && (latestJob.status === 'queued' || latestJob.status === 'running')) {
          timer = setTimeout(() => void poll(), 1100);
        }
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Unable to load processing status');
        setLoading(false);
      }
    };

    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [projectId, onProjectLoaded]);

  const handleRetry = async () => {
    setActionBusy(true);
    try {
      const res = await api.projects.startAnalysis(projectId);
      setJob(res.job);
      addToast('info', 'Analysis job restarted');
      // Reload polling loop via quick refresh
      const detail = await api.projects.get(projectId);
      setProject(detail.project);
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setActionBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!job) return;
    setActionBusy(true);
    try {
      const res = await api.jobs.cancel(job.id);
      setJob(res.job);
      addToast('info', 'Processing cancelled');
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Cancel failed');
    } finally {
      setActionBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="studio-card rounded-2xl p-8 flex items-center gap-3 text-sm text-[#94A3B8]">
          <Loader2 className="w-5 h-5 animate-spin text-[#6366F1]" />
          <span>Loading persistent job status...</span>
        </div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="studio-card rounded-2xl p-8 text-center space-y-4">
          <AlertCircle className="w-8 h-8 text-red-400 mx-auto" />
          <p className="text-sm text-red-200">{error || 'Project not found'}</p>
          <button
            type="button"
            onClick={() => onNavigate({ name: 'projects' })}
            className="rounded-lg bg-[#1E293B] px-4 py-2 text-sm text-white cursor-pointer"
          >
            Back to My Projects
          </button>
        </div>
      </div>
    );
  }

  const stageOrder = PIPELINE_STAGES.map((s) => s.stage);
  const currentIdx = job ? stageOrder.indexOf(job.currentStage) : -1;
  const isRunning = job?.status === 'queued' || job?.status === 'running';
  const isCompleted = job?.status === 'completed';
  const isFailed = job?.status === 'failed' || job?.status === 'cancelled';

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div className="studio-card rounded-2xl p-6 sm:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-mono-tabular text-[#94A3B8]">
              <Film className="w-3.5 h-3.5 text-[#818CF8]" />
              <span>{project.sourceAsset?.originalFilename || 'Source Video'}</span>
              {job && (
                <>
                  <span>·</span>
                  <span>{job.providerMode === 'gemini' ? 'Gemini AI' : 'Demo Provider'}</span>
                </>
              )}
            </div>
            <h1 className="mt-1.5 font-display text-2xl font-bold text-white">{project.title}</h1>
          </div>

          <div className="font-mono-tabular text-right">
            <div className="text-2xl font-bold text-white">{job?.progressPct ?? 0}%</div>
            <div className="text-xs text-[#94A3B8]">
              {isCompleted
                ? 'Complete'
                : isFailed
                  ? job?.status === 'cancelled'
                    ? 'Cancelled'
                    : 'Failed'
                  : 'Running in background'}
            </div>
          </div>
        </div>

        {/* Progress Track */}
        <div className="h-2 rounded-full bg-[#0E1424] overflow-hidden border border-white/[0.06]">
          <div
            className={`h-full transition-all duration-300 ${
              isCompleted ? 'bg-emerald-500' : isFailed ? 'bg-red-500' : 'bg-[#6366F1]'
            }`}
            style={{ width: `${job?.progressPct ?? 0}%` }}
          />
        </div>

        {isFailed && job?.errorMessage && (
          <div
            role="alert"
            className="rounded-xl bg-red-500/10 border border-red-400/30 p-4 flex items-start gap-3 text-sm text-red-200"
          >
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-white">Processing stopped</div>
              <p className="mt-0.5 text-xs text-red-200/90">{job.errorMessage}</p>
            </div>
          </div>
        )}

        {/* Stage Checklist */}
        <div className="space-y-3 pt-2">
          {PIPELINE_STAGES.map((step, idx) => {
            const logEntry = job?.logs.find((l) => l.stage === step.stage);
            const done = isCompleted || logEntry?.status === 'completed' || (currentIdx > idx && !isFailed);
            const active = isRunning && job?.currentStage === step.stage && !done;

            return (
              <div
                key={step.stage}
                className={`rounded-xl px-4 py-3 border flex items-start gap-3.5 transition-colors ${
                  active
                    ? 'bg-[#161F36] border-[#6366F1]/50'
                    : done
                      ? 'bg-[#0E1424]/80 border-white/[0.06]'
                      : 'bg-[#0E1424]/40 border-white/[0.03] opacity-60'
                }`}
              >
                <div className="mt-0.5 shrink-0">
                  {done ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : active ? (
                    <Loader2 className="w-4 h-4 text-[#818CF8] animate-spin" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border border-white/20" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white">{step.title}</div>
                  <div className="text-xs text-[#94A3B8] mt-0.5">
                    {logEntry?.detail || step.subtitle}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Actions */}
        <div className="pt-4 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-3">
          {isRunning && (
            <button
              type="button"
              onClick={() => void handleCancel()}
              disabled={actionBusy}
              className="rounded-lg bg-[#1E293B] hover:bg-[#25334D] border border-white/10 px-4 py-2 text-sm text-slate-200 flex items-center gap-2 cursor-pointer"
            >
              <XCircle className="w-4 h-4" />
              <span>Cancel Job</span>
            </button>
          )}

          {(isFailed || !job) && (
            <button
              type="button"
              onClick={() => void handleRetry()}
              disabled={actionBusy}
              className="studio-cta rounded-lg px-5 py-2.5 text-sm font-semibold text-white flex items-center gap-2 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>{job ? 'Retry Analysis' : 'Start Analysis'}</span>
            </button>
          )}

          {isCompleted && (
            <button
              type="button"
              onClick={() => onNavigate({ name: 'clips', projectId: project.id })}
              className="ml-auto studio-cta rounded-lg px-5 py-2.5 text-sm font-semibold text-white flex items-center gap-2 cursor-pointer"
            >
              <span>Review {project.clipCount} Clip Candidates</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
