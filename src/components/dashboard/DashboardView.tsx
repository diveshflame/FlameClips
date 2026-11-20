import React, { useEffect, useRef, useState } from 'react';
import {
  Upload,
  Link2,
  Film,
  Check,
  AlertTriangle,
  Info,
  Sparkles,
  Clock,
  ArrowRight,
  Play,
  FileVideo,
} from 'lucide-react';
import type {
  CaptionPreset,
  ProjectSummary,
  ProviderStatusInfo,
  SourceValidationResult,
  TargetPlatform,
} from '../../../shared/types.ts';
import { api } from '../../api/client.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { useToast } from '../../context/ToastContext.tsx';
import { formatBytes, formatDurationCompact, formatRelativeDate, STATUS_LABELS } from '../../utils/formatters.ts';
import type { AppRoute } from '../layout/StudioShell.tsx';

interface DashboardViewProps {
  onNavigate: (route: AppRoute) => void;
}

export function DashboardView({ onNavigate }: DashboardViewProps) {
  const { user } = useAuth();
  const { addToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [sourceMode, setSourceMode] = useState<'upload' | 'youtube'>('upload');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [useSampleSource, setUseSampleSource] = useState(false);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);

  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [validatingUrl, setValidatingUrl] = useState(false);
  const [urlValidation, setUrlValidation] = useState<SourceValidationResult | null>(null);

  const [projectTitle, setProjectTitle] = useState('');
  const [platforms, setPlatforms] = useState<TargetPlatform[]>(
    user?.defaultPlatforms || ['youtube_shorts', 'instagram_reels']
  );
  const [minSec, setMinSec] = useState(20);
  const [maxSec, setMaxSec] = useState(58);
  const [captionPreset, setCaptionPreset] = useState<CaptionPreset>(
    user?.defaultCaptionPreset || 'kinetic_bold'
  );

  const [submitting, setSubmitting] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [recentProjects, setRecentProjects] = useState<ProjectSummary[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [providerInfo, setProviderInfo] = useState<ProviderStatusInfo | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([api.projects.list(), api.system.providers()])
      .then(([projRes, provRes]) => {
        if (!active) return;
        setRecentProjects(projRes.projects.slice(0, 4));
        setProviderInfo(provRes);
      })
      .catch(() => {
        // handled silently on dashboard load
      })
      .finally(() => {
        if (active) setLoadingProjects(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const togglePlatform = (p: TargetPlatform) => {
    setPlatforms((prev) => {
      if (prev.includes(p)) {
        return prev.length > 1 ? prev.filter((item) => item !== p) : prev;
      }
      return [...prev, p];
    });
  };

  const handleFilePicked = (file: File | undefined) => {
    if (!file) return;
    setSelectedFile(file);
    setUseSampleSource(false);
    if (!projectTitle.trim()) {
      const base = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
      setProjectTitle(base);
    }
  };

  const handleSelectSample = () => {
    setSelectedFile(null);
    setUseSampleSource(true);
    setRightsConfirmed(true);
    if (!projectTitle.trim()) {
      setProjectTitle('Studio Master Sample Session');
    }
    addToast('info', 'Loaded 48s studio sample video');
  };

  const handleValidateUrl = async () => {
    if (!youtubeUrl.trim()) {
      addToast('error', 'Paste a YouTube URL to validate');
      return;
    }
    setValidatingUrl(true);
    try {
      const res = await api.sources.validateUrl(youtubeUrl.trim());
      setUrlValidation(res);
      if (res.valid && res.title && !projectTitle.trim()) {
        setProjectTitle(res.title);
      }
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Failed to validate URL');
    } finally {
      setValidatingUrl(false);
    }
  };

  const canGenerate =
    !submitting &&
    platforms.length > 0 &&
    ((selectedFile !== null && rightsConfirmed) || useSampleSource);

  const handleGenerateClips = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile && !useSampleSource) {
      addToast('error', 'Upload an authorized video file or load the studio sample first.');
      return;
    }
    if (!rightsConfirmed && !useSampleSource) {
      addToast('error', 'Confirm that you own or are authorized to process this video.');
      return;
    }
    if (minSec >= maxSec) {
      addToast('error', 'Minimum clip length must be shorter than maximum length.');
      return;
    }

    setSubmitting(true);
    setUploadPct(selectedFile ? 0 : null);

    try {
      const finalTitle =
        projectTitle.trim() ||
        selectedFile?.name.replace(/\.[^.]+$/, '') ||
        urlValidation?.title ||
        'Untitled Clip Project';

      const { project } = await api.projects.create({
        title: finalTitle,
        targetPlatforms: platforms,
        preferredMinSec: minSec,
        preferredMaxSec: maxSec,
        defaultCaptionPreset: captionPreset,
      });

      if (useSampleSource) {
        await api.projects.useSample(project.id);
      } else if (selectedFile) {
        await api.projects.uploadVideo(
          project.id,
          selectedFile,
          {
            rightsConfirmed: true,
            sourceUrl: urlValidation?.normalizedUrl || undefined,
            metadataTitle: urlValidation?.title || undefined,
          },
          (pct) => setUploadPct(pct)
        );
      }

      const idempotencyKey = `analyze-${project.id}-${Date.now()}`;
      await api.projects.startAnalysis(project.id, idempotencyKey);
      addToast('success', 'Analysis pipeline started');
      onNavigate({ name: 'processing', projectId: project.id });
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Failed to start generation');
      setSubmitting(false);
      setUploadPct(null);
    }
  };

  return (
    <div className="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-8">
      {/* Studio Heading */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#F8FAFC] tracking-tight">
            Create Short-Form Clips
          </h1>
          <p className="mt-1.5 text-sm text-[#94A3B8]">
            Upload an authorized video or validate a YouTube link to discover hooks, insights, and story arcs.
          </p>
        </div>

        {providerInfo && !providerInfo.geminiConfigured && (
          <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 border border-amber-500/25 px-3 py-2 text-xs text-amber-200">
            <Info className="w-4 h-4 text-amber-400 shrink-0" />
            <span>Demo Analysis Mode active (set GEMINI_API_KEY for live Gemini AI)</span>
          </div>
        )}
      </div>

      {/* Main 2-column Studio Workbench */}
      <form onSubmit={handleGenerateClips} className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Source Ingestion Area */}
        <div className="lg:col-span-7 xl:col-span-8 space-y-5">
          <div className="studio-card rounded-2xl p-5 sm:p-6">
            <div className="flex items-center justify-between gap-4 flex-wrap mb-5">
              <div className="inline-flex p-1 rounded-lg bg-[#0E1424] border border-white/[0.06]">
                <button
                  type="button"
                  onClick={() => setSourceMode('upload')}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors cursor-pointer ${
                    sourceMode === 'upload'
                      ? 'bg-[#1E293B] text-white'
                      : 'text-[#94A3B8] hover:text-white'
                  }`}
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload Video</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSourceMode('youtube')}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors cursor-pointer ${
                    sourceMode === 'youtube'
                      ? 'bg-[#1E293B] text-white'
                      : 'text-[#94A3B8] hover:text-white'
                  }`}
                >
                  <Link2 className="w-3.5 h-3.5" />
                  <span>YouTube URL</span>
                </button>
              </div>

              <button
                type="button"
                onClick={handleSelectSample}
                className="text-xs font-medium text-[#c0c1ff] hover:text-white transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Load 48s Studio Sample</span>
              </button>
            </div>

            {sourceMode === 'youtube' && (
              <div className="mb-6 space-y-3">
                <label htmlFor="yt-url-input" className="block text-xs font-medium text-[#c7c4d7]">
                  Paste public YouTube URL for metadata verification
                </label>
                <div className="flex flex-col sm:flex-row gap-2.5">
                  <input
                    id="yt-url-input"
                    type="url"
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    placeholder="https://www.youtube.com/watch?v=..."
                    className="flex-1 studio-input rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-[#475569]"
                  />
                  <button
                    type="button"
                    onClick={() => void handleValidateUrl()}
                    disabled={validatingUrl}
                    className="rounded-lg bg-[#1E293B] hover:bg-[#25334D] border border-white/10 px-4 py-2.5 text-sm font-medium text-white whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    {validatingUrl ? 'Checking...' : 'Validate URL'}
                  </button>
                </div>

                {urlValidation && (
                  <div
                    className={`rounded-xl p-4 border text-sm ${
                      urlValidation.valid
                        ? 'bg-[#0E1424] border-amber-500/30'
                        : 'bg-red-500/10 border-red-400/30'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {urlValidation.thumbnailUrl && (
                        <img
                          src={urlValidation.thumbnailUrl}
                          alt={urlValidation.title || 'YouTube thumbnail'}
                          referrerPolicy="no-referrer"
                          className="w-24 h-14 object-cover rounded-lg border border-white/10 shrink-0"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        {urlValidation.valid && (
                          <div className="font-medium text-white truncate">
                            {urlValidation.title}
                            {urlValidation.channelName && (
                              <span className="text-xs font-normal text-[#94A3B8] ml-2">
                                · {urlValidation.channelName}
                              </span>
                            )}
                          </div>
                        )}
                        <div className="mt-1 flex items-start gap-2 text-xs text-amber-200/90 leading-relaxed">
                          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                          <span>{urlValidation.message}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Authorized Upload Dropzone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                handleFilePicked(e.dataTransfer.files?.[0]);
              }}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              className={`rounded-xl border border-dashed p-6 sm:p-8 text-center transition-colors cursor-pointer ${
                dragOver
                  ? 'border-[#6366F1] bg-[#6366F1]/10'
                  : selectedFile || useSampleSource
                    ? 'border-emerald-500/40 bg-emerald-500/[0.04]'
                    : 'border-white/15 bg-[#0E1424] hover:border-[#6366F1]/50'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v,.mkv"
                className="hidden"
                onChange={(e) => handleFilePicked(e.target.files?.[0])}
              />

              {selectedFile ? (
                <div className="flex flex-col items-center">
                  <div className="w-11 h-11 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-3">
                    <FileVideo className="w-5 h-5" />
                  </div>
                  <div className="text-sm font-semibold text-white">{selectedFile.name}</div>
                  <div className="mt-1 font-mono-tabular text-xs text-[#94A3B8]">
                    {formatBytes(selectedFile.size)} · Click to replace file
                  </div>
                </div>
              ) : useSampleSource ? (
                <div className="flex flex-col items-center">
                  <div className="w-11 h-11 rounded-xl bg-[#6366F1]/20 border border-[#6366F1]/40 flex items-center justify-center text-[#c0c1ff] mb-3">
                    <Film className="w-5 h-5" />
                  </div>
                  <div className="text-sm font-semibold text-white">
                    sample_studio_interview.mp4 (Loaded)
                  </div>
                  <div className="mt-1 font-mono-tabular text-xs text-[#94A3B8]">
                    1280×720 · 24fps · 48.0s studio master · Click to choose your own file
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <div className="w-11 h-11 rounded-xl bg-[#1E293B] border border-white/10 flex items-center justify-center text-[#c0c1ff] mb-3">
                    <Upload className="w-5 h-5" />
                  </div>
                  <div className="text-sm font-semibold text-white">
                    Drop an authorized video file or click to browse
                  </div>
                  <p className="mt-1 text-xs text-[#94A3B8]">
                    MP4, MOV, or WebM up to 500 MB · Analyzed via FFmpeg & AI discovery
                  </p>
                </div>
              )}
            </div>

            {/* Rights Confirmation Checkbox */}
            <label className="mt-4 flex items-start gap-3 text-xs text-[#c7c4d7] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rightsConfirmed}
                onChange={(e) => setRightsConfirmed(e.target.checked)}
                className="mt-0.5 h-[18px] w-[18px] rounded border border-[#334155] bg-[#0E1424] accent-[#6366F1] shrink-0"
              />
              <span className="leading-relaxed">
                I confirm that I own this video or have explicit authorization from the rights holder
                to transcribe, segment, and export vertical clips.
              </span>
            </label>

            {uploadPct !== null && (
              <div className="mt-4">
                <div className="flex items-center justify-between text-xs text-[#94A3B8] mb-1.5">
                  <span>Uploading source media...</span>
                  <span className="font-mono-tabular text-white">{uploadPct}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-[#0E1424] overflow-hidden">
                  <div
                    className="h-full bg-[#6366F1] transition-all duration-150"
                    style={{ width: `${uploadPct}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Preferences & Generate Panel (380px feel) */}
        <div className="lg:col-span-5 xl:col-span-4 studio-card rounded-2xl p-5 sm:p-6 space-y-5">
          <div>
            <h2 className="font-display text-base font-semibold text-white">
              Destination & Clip Preferences
            </h2>
            <p className="text-xs text-[#94A3B8] mt-0.5">
              Tailor discovery boundaries and vertical caption styling.
            </p>
          </div>

          <div>
            <label htmlFor="project-title" className="block text-xs font-medium text-[#c7c4d7] mb-1.5">
              Project title
            </label>
            <input
              id="project-title"
              type="text"
              value={projectTitle}
              onChange={(e) => setProjectTitle(e.target.value)}
              placeholder="e.g. Founder Podcast Ep. 42"
              className="w-full studio-input rounded-lg px-3.5 py-2 text-sm text-white placeholder-[#475569]"
            />
          </div>

          <div>
            <span className="block text-xs font-medium text-[#c7c4d7] mb-2">
              Target destinations
            </span>
            <div className="grid grid-cols-2 gap-2.5">
              {(['youtube_shorts', 'instagram_reels'] as TargetPlatform[]).map((p) => {
                const active = platforms.includes(p);
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => togglePlatform(p)}
                    className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-xs font-medium border transition-colors cursor-pointer ${
                      active
                        ? 'bg-[#6366F1]/15 border-[#6366F1] text-white'
                        : 'bg-[#0E1424] border-white/[0.08] text-[#94A3B8] hover:text-white'
                    }`}
                  >
                    <span className="whitespace-nowrap">
                      {p === 'youtube_shorts' ? 'YouTube Shorts' : 'Instagram Reels'}
                    </span>
                    {active && <Check className="w-3.5 h-3.5 text-[#c0c1ff] shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="min-sec" className="block text-xs font-medium text-[#c7c4d7] mb-1.5">
                Min length (sec)
              </label>
              <input
                id="min-sec"
                type="number"
                min={10}
                max={90}
                value={minSec}
                onChange={(e) => setMinSec(Number(e.target.value))}
                className="w-full studio-input rounded-lg px-3 py-2 text-sm font-mono-tabular text-white"
              />
            </div>
            <div>
              <label htmlFor="max-sec" className="block text-xs font-medium text-[#c7c4d7] mb-1.5">
                Max length (sec)
              </label>
              <input
                id="max-sec"
                type="number"
                min={15}
                max={180}
                value={maxSec}
                onChange={(e) => setMaxSec(Number(e.target.value))}
                className="w-full studio-input rounded-lg px-3 py-2 text-sm font-mono-tabular text-white"
              />
            </div>
          </div>

          <div>
            <label htmlFor="caption-preset" className="block text-xs font-medium text-[#c7c4d7] mb-1.5">
              Caption preset
            </label>
            <select
              id="caption-preset"
              value={captionPreset}
              onChange={(e) => setCaptionPreset(e.target.value as CaptionPreset)}
              className="w-full studio-input rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="kinetic_bold">Kinetic Bold (Indigo Emphasis)</option>
              <option value="clean_studio">Clean Studio (Emerald Accent)</option>
              <option value="editorial_serif">Editorial Center (Amber Accent)</option>
              <option value="minimal_bottom">Minimal Bottom Third</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={!canGenerate}
            className="w-full studio-cta rounded-lg py-3 px-4 text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-45 cursor-pointer"
          >
            <Sparkles className="w-4 h-4" />
            <span>{submitting ? 'Starting Pipeline...' : 'Generate Clips'}</span>
          </button>

          <p className="text-[11px] text-[#64748B] leading-relaxed">
            Output format defaults to 9:16 vertical MP4 (1080×1920, H.264 + AAC) with editable
            boundaries and captions.
          </p>
        </div>
      </form>

      {/* Recent Projects Strip */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-white">Recent Projects</h2>
          <button
            type="button"
            onClick={() => onNavigate({ name: 'projects' })}
            className="text-xs font-medium text-[#c0c1ff] hover:text-white flex items-center gap-1 cursor-pointer"
          >
            <span>View all projects</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {loadingProjects ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="studio-card rounded-xl p-4 h-32 animate-pulse" />
            ))}
          </div>
        ) : recentProjects.length === 0 ? (
          <div className="studio-card rounded-xl p-8 text-center">
            <p className="text-sm text-[#94A3B8]">
              No projects yet. Upload a video or load the 48s studio sample above to generate your
              first vertical clips.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {recentProjects.map((proj) => (
              <button
                key={proj.id}
                type="button"
                onClick={() =>
                  onNavigate(
                    proj.status === 'processing'
                      ? { name: 'processing', projectId: proj.id }
                      : { name: 'clips', projectId: proj.id }
                  )
                }
                className="studio-card hover:border-[#6366F1]/45 rounded-xl p-4 text-left transition-colors flex flex-col justify-between gap-3 cursor-pointer"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 text-xs text-[#94A3B8]">
                    <span
                      className={
                        proj.status === 'completed'
                          ? 'text-emerald-400 font-medium'
                          : proj.status === 'failed'
                            ? 'text-red-400 font-medium'
                            : 'text-[#c0c1ff] font-medium'
                      }
                    >
                      {STATUS_LABELS[proj.status]}
                    </span>
                    <span className="font-mono-tabular">{formatRelativeDate(proj.updatedAt)}</span>
                  </div>
                  <h3 className="mt-1.5 font-display text-sm font-semibold text-white line-clamp-2">
                    {proj.title}
                  </h3>
                </div>

                <div className="flex items-center gap-2 text-xs text-[#64748B] font-mono-tabular">
                  <Clock className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {proj.sourceAsset ? formatDurationCompact(proj.sourceAsset.durationSec) : 'No media'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{proj.clipCount} clips</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
