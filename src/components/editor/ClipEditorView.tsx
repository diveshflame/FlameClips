import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Download,
  Loader2,
  Pause,
  Play,
  Plus,
  Save,
  Trash2,
  Sliders,
  Captions,
  BarChart3,
} from 'lucide-react';
import type {
  CaptionPreset,
  CaptionSegment,
  CaptionStyle,
  ClipCandidate,
  CropMode,
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
} from '../../utils/formatters.ts';
import { ExportModal } from '../export/ExportModal.tsx';
import type { AppRoute } from '../layout/StudioShell.tsx';

interface ClipEditorViewProps {
  projectId: string;
  clipId: string;
  onNavigate: (route: AppRoute) => void;
  onProjectLoaded?: (project: ProjectSummary) => void;
}

export function ClipEditorView({
  projectId,
  clipId,
  onNavigate,
  onProjectLoaded,
}: ClipEditorViewProps) {
  const { addToast } = useToast();
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [detail, setDetail] = useState<ProjectDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Editable clip state
  const [startMs, setStartMs] = useState(0);
  const [endMs, setEndMs] = useState(20000);
  const [cropMode, setCropMode] = useState<CropMode>('auto_speaker');
  const [focalPointX, setFocalPointX] = useState(0.5);
  const [burnInCaptions, setBurnInCaptions] = useState(true);
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>({
    preset: 'kinetic_bold',
    fontSize: 24,
    highlightColor: '#6366F1',
    textColor: '#FFFFFF',
    position: 'bottom',
    uppercase: true,
    showBackground: true,
  });
  const [captions, setCaptions] = useState<CaptionSegment[]>([]);

  // Player & inspector state
  const [playing, setPlaying] = useState(false);
  const [playheadRelMs, setPlayheadRelMs] = useState(0);
  const [inspectorTab, setInspectorTab] = useState<'captions' | 'style' | 'score'>('captions');
  const [exportOpen, setExportOpen] = useState(false);

  const hydrateFromClip = useCallback((clip: ClipCandidate) => {
    setStartMs(clip.edit.startMs);
    setEndMs(clip.edit.endMs);
    setCropMode(clip.edit.cropMode);
    setFocalPointX(clip.edit.focalPointX);
    setBurnInCaptions(clip.edit.burnInCaptions);
    setCaptionStyle(clip.edit.captionStyle);
    setCaptions(clip.captions);
    setPlayheadRelMs(0);
  }, []);

  useEffect(() => {
    let active = true;
    api.projects
      .get(projectId)
      .then((data) => {
        if (!active) return;
        setDetail(data);
        onProjectLoaded?.(data.project);
        const found = data.clips.find((c) => c.id === clipId);
        if (found) hydrateFromClip(found);
      })
      .catch((err) => {
        if (active) addToast('error', err instanceof Error ? err.message : 'Failed to load editor');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId, clipId, hydrateFromClip, onProjectLoaded, addToast]);

  const clip = useMemo(
    () => detail?.clips.find((c) => c.id === clipId) || null,
    [detail, clipId]
  );

  const sourceDurationMs = Math.max(
    10000,
    Math.round((detail?.project.sourceAsset?.durationSec || 48) * 1000)
  );
  const clipDurationMs = Math.max(3000, endMs - startMs);

  // Sync HTML5 video element to source stream within [startMs, endMs]
  const videoSrc = detail?.project.sourceAsset?.streamUrl || clip?.previewUrl || '';
  const usingSourceStream = Boolean(detail?.project.sourceAsset?.streamUrl);

  const seekToRelMs = (relMs: number) => {
    const clamped = Math.max(0, Math.min(clipDurationMs, relMs));
    setPlayheadRelMs(clamped);
    if (videoRef.current) {
      videoRef.current.currentTime = usingSourceStream
        ? (startMs + clamped) / 1000
        : clamped / 1000;
    }
  };

  const togglePlay = () => {
    const el = videoRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      if (usingSourceStream && el.currentTime * 1000 < startMs) {
        el.currentTime = startMs / 1000;
      }
      void el.play();
      setPlaying(true);
    }
  };

  const handleTimeUpdate = () => {
    const el = videoRef.current;
    if (!el) return;
    const currentMs = el.currentTime * 1000;
    const rel = usingSourceStream ? currentMs - startMs : currentMs;
    if (rel >= clipDurationMs) {
      el.currentTime = usingSourceStream ? startMs / 1000 : 0;
      setPlayheadRelMs(0);
    } else {
      setPlayheadRelMs(Math.max(0, rel));
    }
  };

  const activeCaption = useMemo(
    () =>
      captions.find((c) => playheadRelMs >= c.startMs && playheadRelMs <= c.endMs) ||
      captions[0] ||
      null,
    [captions, playheadRelMs]
  );

  const applyPreset = (preset: CaptionPreset) => {
    const presets: Record<CaptionPreset, CaptionStyle> = {
      kinetic_bold: {
        preset: 'kinetic_bold',
        fontSize: 24,
        highlightColor: '#6366F1',
        textColor: '#FFFFFF',
        position: 'bottom',
        uppercase: true,
        showBackground: true,
      },
      clean_studio: {
        preset: 'clean_studio',
        fontSize: 22,
        highlightColor: '#10B981',
        textColor: '#F8FAFC',
        position: 'bottom',
        uppercase: false,
        showBackground: true,
      },
      editorial_serif: {
        preset: 'editorial_serif',
        fontSize: 24,
        highlightColor: '#F59E0B',
        textColor: '#F8FAFC',
        position: 'center',
        uppercase: false,
        showBackground: false,
      },
      minimal_bottom: {
        preset: 'minimal_bottom',
        fontSize: 19,
        highlightColor: '#818CF8',
        textColor: '#dfe2f1',
        position: 'bottom',
        uppercase: false,
        showBackground: true,
      },
    };
    setCaptionStyle(presets[preset]);
  };

  const handleSaveAll = async () => {
    if (!clip) return;
    setSaving(true);
    try {
      await api.clips.update(clip.id, {
        startMs,
        endMs,
        cropMode,
        focalPointX,
        burnInCaptions,
        captionStyle,
      });
      const updated = await api.clips.updateCaptions(
        clip.id,
        captions.map((c) => ({
          startMs: c.startMs,
          endMs: c.endMs,
          text: c.text,
          emphasisWord: c.emphasisWord,
        }))
      );
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              clips: prev.clips.map((c) => (c.id === updated.clip.id ? updated.clip : c)),
            }
          : prev
      );
      addToast('success', 'Clip boundaries, framing, and captions saved');
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Failed to save clip edits');
    } finally {
      setSaving(false);
    }
  };

  const handleExportUpdated = (exp: ExportJob) => {
    setDetail((prev) => {
      if (!prev) return prev;
      const exists = prev.exports.some((e) => e.id === exp.id);
      return {
        ...prev,
        exports: exists
          ? prev.exports.map((e) => (e.id === exp.id ? exp : e))
          : [exp, ...prev.exports],
      };
    });
  };

  if (loading || !detail || !clip) {
    return (
      <div className="p-10 flex items-center gap-3 text-sm text-[#94A3B8]">
        <Loader2 className="w-5 h-5 animate-spin text-[#6366F1]" />
        <span>Loading studio clip editor...</span>
      </div>
    );
  }

  const updateCaptionAt = (idx: number, patch: Partial<CaptionSegment>) => {
    setCaptions((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  };

  const addCaptionSegment = () => {
    const lastEnd = captions[captions.length - 1]?.endMs || 0;
    const nextStart = Math.min(clipDurationMs - 1000, lastEnd);
    const nextEnd = Math.min(clipDurationMs, nextStart + 2500);
    setCaptions((prev) => [
      ...prev,
      {
        id: `new-${Date.now()}`,
        clipCandidateId: clip.id,
        startMs: nextStart,
        endMs: Math.max(nextStart + 500, nextEnd),
        text: 'New caption line',
        emphasisWord: null,
        orderIndex: prev.length,
      },
    ]);
  };

  const renderOverlayCaption = () => {
    if (!activeCaption) return null;
    const text = captionStyle.uppercase ? activeCaption.text.toUpperCase() : activeCaption.text;
    const words = text.split(' ');
    const posClass =
      captionStyle.position === 'top'
        ? 'top-8'
        : captionStyle.position === 'center'
          ? 'top-1/2 -translate-y-1/2'
          : 'bottom-10';

    return (
      <div
        className={`pointer-events-none absolute left-4 right-4 ${posClass} flex justify-center text-center`}
      >
        <div
          className={`px-3 py-1.5 rounded-lg font-display font-bold leading-tight max-w-[90%] ${
            captionStyle.showBackground ? 'bg-[#0B0F19]/80 backdrop-blur-sm' : ''
          }`}
          style={{
            fontSize: `${Math.max(14, Math.round(captionStyle.fontSize * 0.78))}px`,
            color: captionStyle.textColor,
            textShadow: '0 2px 10px rgba(0,0,0,0.85)',
          }}
        >
          {words.map((w, i) => {
            const clean = w.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
            const isEmph =
              activeCaption.emphasisWord &&
              clean === activeCaption.emphasisWord.toLowerCase();
            return (
              <span
                key={`${w}-${i}`}
                style={isEmph ? { color: captionStyle.highlightColor } : undefined}
              >
                {w}
                {i < words.length - 1 ? ' ' : ''}
              </span>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col lg:h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Editor Sub-toolbar */}
      <div className="px-4 sm:px-6 py-3 border-b border-white/[0.06] bg-[#111827]/70 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => onNavigate({ name: 'clips', projectId })}
            className="rounded-lg bg-[#1E293B] hover:bg-[#25334D] border border-white/10 p-2 text-slate-300 hover:text-white cursor-pointer"
            aria-label="Back to clip library"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <div className="text-[11px] text-[#94A3B8]">
              {CATEGORY_LABELS[clip.category]} · Editorial Suggestion
            </div>
            <h1 className="font-display text-sm sm:text-base font-semibold text-white truncate">
              {clip.editorialTitle}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => void handleSaveAll()}
            disabled={saving}
            className="rounded-lg bg-[#1E293B] hover:bg-[#25334D] border border-white/10 px-3.5 py-2 text-xs sm:text-sm font-medium text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? 'Saving...' : 'Save Edits'}</span>
          </button>
          <button
            type="button"
            onClick={() => setExportOpen(true)}
            className="studio-cta rounded-lg px-4 py-2 text-xs sm:text-sm font-semibold text-white flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export 9:16 MP4</span>
          </button>
        </div>
      </div>

      {/* Main Studio Split: Center 9:16 Preview + Timeline (left) | 380px Inspector (right) */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
        {/* Left/Center Canvas & Timeline */}
        <div className="flex-1 min-w-0 flex flex-col justify-between p-4 sm:p-6 bg-[#0B0F19]">
          {/* 9:16 Vertical Preview Frame */}
          <div className="flex-1 min-h-0 flex items-center justify-center py-2">
            <div className="relative h-[420px] sm:h-[460px] lg:h-full lg:max-h-[490px] aspect-[9/16] rounded-2xl overflow-hidden bg-black border border-white/10 shadow-[0_0_24px_-4px_rgba(99,102,241,0.2)]">
              <video
                ref={videoRef}
                src={videoSrc}
                playsInline
                onTimeUpdate={handleTimeUpdate}
                onPause={() => setPlaying(false)}
                onPlay={() => setPlaying(true)}
                className="w-full h-full"
                style={{
                  objectFit: cropMode === 'fit_blur' ? 'contain' : 'cover',
                  objectPosition: `${Math.round(
                    (cropMode === 'center' ? 0.5 : focalPointX) * 100
                  )}% 50%`,
                }}
              />
              {renderOverlayCaption()}

              <div className="absolute top-3 left-3 rounded-md bg-black/65 backdrop-blur-sm px-2 py-1 font-mono-tabular text-[10px] text-white border border-white/10">
                9:16 · {cropMode.replace('_', ' ')}
              </div>
            </div>
          </div>

          {/* Dual-Ended Timeline Trimmer Bar */}
          <div className="mt-4 studio-card rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={togglePlay}
                  className="w-9 h-9 rounded-lg studio-cta flex items-center justify-center text-white cursor-pointer"
                  aria-label={playing ? 'Pause preview' : 'Play preview'}
                >
                  {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                </button>
                <div className="font-mono-tabular text-xs text-white">
                  <span>{formatTimecodeMs(playheadRelMs)}</span>
                  <span className="text-[#64748B]"> / {formatTimecodeMs(clipDurationMs)}</span>
                </div>
              </div>

              <div className="flex items-center gap-4 font-mono-tabular text-xs text-[#94A3B8]">
                <span>In: {formatTimecodeMs(startMs)}</span>
                <span>Out: {formatTimecodeMs(endMs)}</span>
                <span className="text-emerald-400">
                  Len: {formatDurationCompact(clipDurationMs / 1000)}
                </span>
              </div>
            </div>

            {/* Dual Sliders */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
              <div>
                <div className="flex items-center justify-between text-[11px] text-[#94A3B8] mb-1">
                  <span>Start boundary</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setStartMs((v) => Math.max(0, v - 500))}
                      className="px-1.5 py-0.5 rounded bg-[#1E293B] text-white cursor-pointer"
                    >
                      -0.5s
                    </button>
                    <button
                      type="button"
                      onClick={() => setStartMs((v) => Math.min(endMs - 3000, v + 500))}
                      className="px-1.5 py-0.5 rounded bg-[#1E293B] text-white cursor-pointer"
                    >
                      +0.5s
                    </button>
                  </div>
                </div>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, endMs - 3000)}
                  step={100}
                  value={startMs}
                  onChange={(e) => setStartMs(Number(e.target.value))}
                  aria-label="Clip start boundary"
                  className="w-full accent-[#6366F1]"
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-[11px] text-[#94A3B8] mb-1">
                  <span>End boundary</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEndMs((v) => Math.max(startMs + 3000, v - 500))}
                      className="px-1.5 py-0.5 rounded bg-[#1E293B] text-white cursor-pointer"
                    >
                      -0.5s
                    </button>
                    <button
                      type="button"
                      onClick={() => setEndMs((v) => Math.min(sourceDurationMs, v + 500))}
                      className="px-1.5 py-0.5 rounded bg-[#1E293B] text-white cursor-pointer"
                    >
                      +0.5s
                    </button>
                  </div>
                </div>
                <input
                  type="range"
                  min={startMs + 3000}
                  max={sourceDurationMs}
                  step={100}
                  value={endMs}
                  onChange={(e) => setEndMs(Number(e.target.value))}
                  aria-label="Clip end boundary"
                  className="w-full accent-[#6366F1]"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right 380px Studio Inspector */}
        <aside className="w-full lg:w-[390px] shrink-0 studio-panel border-t lg:border-t-0 lg:border-l border-white/[0.06] flex flex-col min-h-0">
          <div className="p-3 border-b border-white/[0.06] grid grid-cols-3 gap-1 bg-[#0E1424]">
            <button
              type="button"
              onClick={() => setInspectorTab('captions')}
              className={`py-2 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer ${
                inspectorTab === 'captions'
                  ? 'bg-[#1E293B] text-white'
                  : 'text-[#94A3B8] hover:text-white'
              }`}
            >
              <Captions className="w-3.5 h-3.5" />
              <span>Captions</span>
            </button>
            <button
              type="button"
              onClick={() => setInspectorTab('style')}
              className={`py-2 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer ${
                inspectorTab === 'style'
                  ? 'bg-[#1E293B] text-white'
                  : 'text-[#94A3B8] hover:text-white'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Framing</span>
            </button>
            <button
              type="button"
              onClick={() => setInspectorTab('score')}
              className={`py-2 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer ${
                inspectorTab === 'score'
                  ? 'bg-[#1E293B] text-white'
                  : 'text-[#94A3B8] hover:text-white'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>Insights</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {inspectorTab === 'captions' && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#94A3B8]">
                    Synchronized Caption Blocks ({captions.length})
                  </span>
                  <button
                    type="button"
                    onClick={addCaptionSegment}
                    className="text-xs font-medium text-[#c0c1ff] hover:text-white flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Block</span>
                  </button>
                </div>

                <div className="space-y-3">
                  {captions.map((cap, idx) => {
                    const isActive = activeCaption?.id === cap.id;
                    return (
                      <div
                        key={cap.id}
                        onClick={() => seekToRelMs(cap.startMs + 50)}
                        className={`rounded-xl p-3 border transition-colors cursor-pointer space-y-2 ${
                          isActive
                            ? 'bg-[#161F36] border-[#6366F1]/60'
                            : 'bg-[#0E1424] border-white/[0.06] hover:border-white/15'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 text-[11px] font-mono-tabular text-[#94A3B8]">
                          <span>
                            {formatTimecodeMs(cap.startMs)} – {formatTimecodeMs(cap.endMs)}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCaptions((prev) => prev.filter((_, i) => i !== idx));
                            }}
                            className="text-slate-500 hover:text-red-400 cursor-pointer"
                            aria-label="Delete caption block"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <textarea
                          rows={2}
                          value={cap.text}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => updateCaptionAt(idx, { text: e.target.value })}
                          className="w-full studio-input rounded-lg px-2.5 py-1.5 text-xs text-white resize-none"
                        />

                        <div className="flex items-center gap-2">
                          <label className="text-[11px] text-[#64748B] shrink-0">Emphasis:</label>
                          <input
                            type="text"
                            value={cap.emphasisWord || ''}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) =>
                              updateCaptionAt(idx, {
                                emphasisWord: e.target.value.trim() || null,
                              })
                            }
                            placeholder="Keyword"
                            className="flex-1 studio-input rounded px-2 py-1 text-[11px] text-white"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {inspectorTab === 'style' && (
              <div className="space-y-5">
                <div>
                  <span className="block text-xs font-medium text-[#c7c4d7] mb-2">
                    9:16 Crop & Reframe Mode
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        { id: 'auto_speaker', label: 'Auto Speaker' },
                        { id: 'center', label: 'Center Crop' },
                        { id: 'fit_blur', label: 'Fit + Blur Bars' },
                        { id: 'custom_focal', label: 'Custom Focal X' },
                      ] as const
                    ).map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setCropMode(m.id)}
                        className={`rounded-lg px-3 py-2 text-xs font-medium border cursor-pointer ${
                          cropMode === m.id
                            ? 'bg-[#6366F1]/20 border-[#6366F1] text-white'
                            : 'bg-[#0E1424] border-white/[0.08] text-[#94A3B8]'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                {(cropMode === 'custom_focal' || cropMode === 'auto_speaker') && (
                  <div>
                    <div className="flex items-center justify-between text-xs text-[#c7c4d7] mb-1.5">
                      <span>Horizontal focal point</span>
                      <span className="font-mono-tabular text-[#818CF8]">
                        {Math.round(focalPointX * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.02}
                      value={focalPointX}
                      onChange={(e) => setFocalPointX(Number(e.target.value))}
                      className="w-full accent-[#6366F1]"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-[#c7c4d7] mb-1.5">
                    Caption Style Preset
                  </label>
                  <select
                    value={captionStyle.preset}
                    onChange={(e) => applyPreset(e.target.value as CaptionPreset)}
                    className="w-full studio-input rounded-lg px-3 py-2 text-xs text-white"
                  >
                    <option value="kinetic_bold">Kinetic Bold</option>
                    <option value="clean_studio">Clean Studio</option>
                    <option value="editorial_serif">Editorial Center</option>
                    <option value="minimal_bottom">Minimal Bottom</option>
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs text-[#c7c4d7] mb-1.5">
                    <span>Caption font size</span>
                    <span className="font-mono-tabular">{captionStyle.fontSize}px</span>
                  </div>
                  <input
                    type="range"
                    min={16}
                    max={34}
                    value={captionStyle.fontSize}
                    onChange={(e) =>
                      setCaptionStyle((s) => ({ ...s, fontSize: Number(e.target.value) }))
                    }
                    className="w-full accent-[#6366F1]"
                  />
                </div>

                <div>
                  <span className="block text-xs font-medium text-[#c7c4d7] mb-2">
                    Vertical caption placement
                  </span>
                  <div className="grid grid-cols-3 gap-2">
                    {(['top', 'center', 'bottom'] as const).map((pos) => (
                      <button
                        key={pos}
                        type="button"
                        onClick={() => setCaptionStyle((s) => ({ ...s, position: pos }))}
                        className={`rounded-lg py-1.5 text-xs capitalize border cursor-pointer ${
                          captionStyle.position === pos
                            ? 'bg-[#6366F1]/20 border-[#6366F1] text-white'
                            : 'bg-[#0E1424] border-white/[0.08] text-[#94A3B8]'
                        }`}
                      >
                        {pos}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2.5 pt-2 border-t border-white/[0.06]">
                  <label className="flex items-center justify-between text-xs text-[#c7c4d7] cursor-pointer">
                    <span>Uppercase captions</span>
                    <input
                      type="checkbox"
                      checked={captionStyle.uppercase}
                      onChange={(e) =>
                        setCaptionStyle((s) => ({ ...s, uppercase: e.target.checked }))
                      }
                      className="accent-[#6366F1]"
                    />
                  </label>
                  <label className="flex items-center justify-between text-xs text-[#c7c4d7] cursor-pointer">
                    <span>Dark caption backdrop box</span>
                    <input
                      type="checkbox"
                      checked={captionStyle.showBackground}
                      onChange={(e) =>
                        setCaptionStyle((s) => ({ ...s, showBackground: e.target.checked }))
                      }
                      className="accent-[#6366F1]"
                    />
                  </label>
                  <label className="flex items-center justify-between text-xs text-[#c7c4d7] cursor-pointer">
                    <span>Burn-in captions on MP4 export</span>
                    <input
                      type="checkbox"
                      checked={burnInCaptions}
                      onChange={(e) => setBurnInCaptions(e.target.checked)}
                      className="accent-[#6366F1]"
                    />
                  </label>
                </div>
              </div>
            )}

            {inspectorTab === 'score' && (
              <div className="space-y-4">
                <div className="rounded-xl bg-[#0E1424] border border-white/[0.06] p-4">
                  <div className="text-xs text-[#94A3B8]">Overall candidate score</div>
                  <div className="mt-1 font-mono-tabular text-2xl font-bold text-emerald-400">
                    {clip.overallScore.toFixed(1)} / 100
                  </div>
                </div>

                <div className="rounded-xl bg-[#0E1424] border border-white/[0.06] p-4 space-y-2">
                  <div className="text-xs font-medium text-white">Editorial Rationale</div>
                  <p className="text-xs text-[#c7c4d7] leading-relaxed">{clip.explanation}</p>
                </div>

                <div className="rounded-xl bg-[#0E1424] border border-white/[0.06] p-4 space-y-2">
                  <div className="text-xs font-medium text-white">Opening Hook Quote</div>
                  <p className="text-xs text-[#dfe2f1] italic">“{clip.hookQuote}”</p>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      {exportOpen && (
        <ExportModal
          clip={clip}
          existingExports={detail.exports}
          onClose={() => setExportOpen(false)}
          onExportUpdated={handleExportUpdated}
        />
      )}
    </div>
  );
}
