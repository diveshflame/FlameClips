import React, { useEffect, useState } from 'react';
import {
  X,
  Download,
  Loader2,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  Film,
} from 'lucide-react';
import type { ClipCandidate, ExportJob, TargetPlatform } from '../../../shared/types.ts';
import { api } from '../../api/client.ts';
import { useToast } from '../../context/ToastContext.tsx';
import { formatBytes, formatDurationCompact, PLATFORM_LABELS } from '../../utils/formatters.ts';

interface ExportModalProps {
  clip: ClipCandidate;
  existingExports: ExportJob[];
  onClose: () => void;
  onExportUpdated: (exp: ExportJob) => void;
}

export function ExportModal({
  clip,
  existingExports,
  onClose,
  onExportUpdated,
}: ExportModalProps) {
  const { addToast } = useToast();
  const [targetPlatform, setTargetPlatform] = useState<TargetPlatform>(
    clip.recommendedPlatforms[0] || 'youtube_shorts'
  );
  const [burnInCaptions, setBurnInCaptions] = useState(clip.edit.burnInCaptions);
  const [activeExport, setActiveExport] = useState<ExportJob | null>(
    existingExports.find((e) => e.clipCandidateId === clip.id) || null
  );
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (
      !activeExport ||
      (activeExport.status !== 'queued' && activeExport.status !== 'rendering')
    ) {
      return;
    }

    let active = true;
    const timer = setTimeout(async () => {
      try {
        const res = await api.exports.get(activeExport.id);
        if (!active) return;
        setActiveExport(res.export);
        onExportUpdated(res.export);
        if (res.export.status === 'completed') {
          addToast('success', 'Vertical 1080×1920 MP4 export ready to download');
        }
      } catch {
        // ignore transient polling error
      }
    }, 1000);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [activeExport, addToast, onExportUpdated]);

  const handleStartExport = async () => {
    setSubmitting(true);
    try {
      const res = await api.clips.startExport(clip.id, {
        targetPlatform,
        burnInCaptions,
      });
      setActiveExport(res.export);
      onExportUpdated(res.export);
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Failed to start export');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRetry = async () => {
    if (!activeExport) return;
    setSubmitting(true);
    try {
      const res = await api.exports.retry(activeExport.id);
      setActiveExport(res.export);
      onExportUpdated(res.export);
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setSubmitting(false);
    }
  };

  const clipExports = existingExports.filter((e) => e.clipCandidateId === clip.id);
  const isRendering = activeExport?.status === 'queued' || activeExport?.status === 'rendering';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
    >
      <div className="w-full max-w-lg rounded-2xl bg-[#1E293B] border border-white/10 shadow-[0_16px_36px_-8px_rgba(0,0,0,0.65)] overflow-hidden">
        <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Film className="w-4 h-4 text-[#818CF8]" />
            <h2 id="export-modal-title" className="font-display text-base font-semibold text-white">
              Export Vertical MP4
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] cursor-pointer"
            aria-label="Close export dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div>
            <div className="text-xs text-[#94A3B8]">Selected clip</div>
            <div className="mt-0.5 text-sm font-medium text-white line-clamp-1">
              {clip.editorialTitle}
            </div>
            <div className="mt-1 font-mono-tabular text-xs text-[#94A3B8]">
              1080×1920 · 9:16 · H.264 / AAC · {formatDurationCompact((clip.edit.endMs - clip.edit.startMs) / 1000)}
            </div>
          </div>

          <div>
            <span className="block text-xs font-medium text-[#c7c4d7] mb-2">
              Target destination preset
            </span>
            <div className="grid grid-cols-2 gap-2.5">
              {(['youtube_shorts', 'instagram_reels'] as TargetPlatform[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setTargetPlatform(p)}
                  className={`rounded-lg px-3 py-2.5 text-xs font-medium border transition-colors cursor-pointer ${
                    targetPlatform === p
                      ? 'bg-[#6366F1]/20 border-[#6366F1] text-white'
                      : 'bg-[#0E1424] border-white/[0.08] text-[#94A3B8] hover:text-white'
                  }`}
                >
                  {PLATFORM_LABELS[p]}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center justify-between rounded-xl bg-[#0E1424] border border-white/[0.06] px-4 py-3 cursor-pointer">
            <div>
              <div className="text-sm font-medium text-white">Burn-in stylized captions</div>
              <div className="text-xs text-[#94A3B8]">
                Render edited caption segments directly onto the 9:16 video track
              </div>
            </div>
            <input
              type="checkbox"
              checked={burnInCaptions}
              onChange={(e) => setBurnInCaptions(e.target.checked)}
              className="h-[18px] w-[18px] rounded border-[#334155] bg-[#0E1424] accent-[#6366F1]"
            />
          </label>

          {/* Active Export Status */}
          {activeExport && (
            <div className="rounded-xl bg-[#111827] border border-white/[0.08] p-4 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-white flex items-center gap-2">
                  {isRendering && <Loader2 className="w-3.5 h-3.5 animate-spin text-[#818CF8]" />}
                  {activeExport.status === 'completed' && (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  )}
                  {activeExport.status === 'failed' && (
                    <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                  )}
                  <span>
                    {activeExport.status === 'completed'
                      ? 'Render complete'
                      : activeExport.status === 'failed'
                        ? 'Render failed'
                        : 'Rendering 1080×1920 H.264 MP4...'}
                  </span>
                </span>
                <span className="font-mono-tabular text-[#94A3B8]">
                  {activeExport.progressPct}%
                </span>
              </div>

              <div className="h-1.5 rounded-full bg-[#0E1424] overflow-hidden">
                <div
                  className={`h-full transition-all duration-200 ${
                    activeExport.status === 'completed'
                      ? 'bg-emerald-500'
                      : activeExport.status === 'failed'
                        ? 'bg-red-500'
                        : 'bg-[#6366F1]'
                  }`}
                  style={{ width: `${activeExport.progressPct}%` }}
                />
              </div>

              {activeExport.status === 'failed' && (
                <div className="flex items-center justify-between gap-2 text-xs text-red-200">
                  <span className="truncate">{activeExport.errorMessage || 'FFmpeg error'}</span>
                  <button
                    type="button"
                    onClick={() => void handleRetry()}
                    className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded bg-white/10 hover:bg-white/15 text-white cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Retry</span>
                  </button>
                </div>
              )}

              {activeExport.status === 'completed' && activeExport.downloadUrl && (
                <div className="flex items-center justify-between gap-3 pt-1">
                  <span className="font-mono-tabular text-xs text-[#94A3B8]">
                    {formatBytes(activeExport.fileSizeBytes || 0)} · MP4 Ready
                  </span>
                  <a
                    href={`${activeExport.downloadUrl}&download=1`}
                    download
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 px-3.5 py-1.5 text-xs font-semibold text-emerald-200 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download MP4</span>
                  </a>
                </div>
              )}
            </div>
          )}

          {clipExports.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-[#94A3B8]">Export history for this clip</div>
              <div className="max-h-28 overflow-y-auto space-y-1.5">
                {clipExports.slice(0, 4).map((exp) => (
                  <div
                    key={exp.id}
                    className="flex items-center justify-between text-xs rounded-lg bg-[#0E1424]/70 px-3 py-2 border border-white/[0.04]"
                  >
                    <span className="text-[#c7c4d7]">
                      {PLATFORM_LABELS[exp.targetPlatform]} ·{' '}
                      <span className="font-mono-tabular text-[#94A3B8]">
                        {exp.burnInCaptions ? 'Captions' : 'Clean'}
                      </span>
                    </span>
                    {exp.status === 'completed' && exp.downloadUrl ? (
                      <a
                        href={`${exp.downloadUrl}&download=1`}
                        download
                        className="text-emerald-400 hover:text-emerald-300 font-medium inline-flex items-center gap-1"
                      >
                        <Download className="w-3 h-3" />
                        <span>MP4</span>
                      </a>
                    ) : (
                      <span className="font-mono-tabular text-[#64748B]">{exp.status}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 bg-[#111827]/70 border-t border-white/[0.06] flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-[#94A3B8] hover:text-white cursor-pointer"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => void handleStartExport()}
            disabled={submitting || isRendering}
            className="studio-cta rounded-lg px-5 py-2 text-sm font-semibold text-white disabled:opacity-50 cursor-pointer"
          >
            {isRendering ? 'Rendering...' : 'Render Vertical MP4'}
          </button>
        </div>
      </div>
    </div>
  );
}
