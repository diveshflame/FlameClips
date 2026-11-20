import type { ClipCategory, ProjectStatus, TargetPlatform } from '../../shared/types.ts';

export function formatTimecodeMs(ms: number): string {
  const safe = Math.max(0, ms);
  const totalSec = safe / 1000;
  const mins = Math.floor(totalSec / 60);
  const secs = Math.floor(totalSec % 60);
  const hundredths = Math.floor((totalSec * 100) % 100);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

export function formatDurationCompact(sec: number): string {
  const safe = Math.max(0, sec);
  if (safe < 60) return `${safe.toFixed(1)}s`;
  const mins = Math.floor(safe / 60);
  const rem = Math.round(safe % 60);
  return `${mins}m ${String(rem).padStart(2, '0')}s`;
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatRelativeDate(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export const CATEGORY_LABELS: Record<ClipCategory, string> = {
  hook: 'Opening Hook',
  insight: 'Key Insight',
  reaction: 'Reaction',
  story: 'Story Arc',
  exchange: 'Dialogue Exchange',
  humor: 'Humor',
};

export const PLATFORM_LABELS: Record<TargetPlatform, string> = {
  youtube_shorts: 'YouTube Shorts',
  instagram_reels: 'Instagram Reels',
};

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: 'Draft',
  ready_for_analysis: 'Ready',
  processing: 'Processing',
  completed: 'Clips Ready',
  failed: 'Failed',
};

export function getScoreTierClasses(score: number): {
  badge: string;
  bar: string;
  label: string;
} {
  if (score >= 85) {
    return {
      badge: 'bg-emerald-500/12 text-emerald-400 border border-emerald-500/30',
      bar: 'bg-emerald-500',
      label: 'High Fit',
    };
  }
  if (score >= 70) {
    return {
      badge: 'bg-amber-500/12 text-amber-400 border border-amber-500/30',
      bar: 'bg-amber-500',
      label: 'Solid Fit',
    };
  }
  return {
    badge: 'bg-slate-500/15 text-slate-300 border border-slate-500/30',
    bar: 'bg-slate-400',
    label: 'Moderate',
  };
}
