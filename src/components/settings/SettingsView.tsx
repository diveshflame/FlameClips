import React, { useEffect, useState } from 'react';
import { Save, Trash2, Check, Cpu, HardDrive } from 'lucide-react';
import type { CaptionPreset, ProviderStatusInfo, TargetPlatform } from '../../../shared/types.ts';
import { api } from '../../api/client.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { useToast } from '../../context/ToastContext.tsx';
import { formatBytes } from '../../utils/formatters.ts';

export function SettingsView() {
  const { user, setUser, logout } = useAuth();
  const { addToast } = useToast();

  const [name, setName] = useState(user?.name || '');
  const [platforms, setPlatforms] = useState<TargetPlatform[]>(
    user?.defaultPlatforms || ['youtube_shorts', 'instagram_reels']
  );
  const [captionPreset, setCaptionPreset] = useState<CaptionPreset>(
    user?.defaultCaptionPreset || 'kinetic_bold'
  );
  const [saving, setSaving] = useState(false);
  const [providerInfo, setProviderInfo] = useState<ProviderStatusInfo | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    api.system
      .providers()
      .then(setProviderInfo)
      .catch(() => {
        // ignore
      });
  }, []);

  if (!user) return null;

  const togglePlatform = (p: TargetPlatform) => {
    setPlatforms((prev) => {
      if (prev.includes(p)) {
        return prev.length > 1 ? prev.filter((item) => item !== p) : prev;
      }
      return [...prev, p];
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.auth.updateSettings({
        name: name.trim(),
        defaultPlatforms: platforms,
        defaultCaptionPreset: captionPreset,
      });
      setUser(res.user);
      addToast('success', 'Studio preferences updated');
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (confirmText !== 'DELETE') {
      addToast('error', 'Type DELETE to confirm permanent account removal');
      return;
    }
    setDeleting(true);
    try {
      await api.auth.deleteAccount();
      await logout();
      addToast('info', 'Account and all stored media removed');
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Account deletion failed');
      setDeleting(false);
    }
  };

  const usagePct = Math.min(
    100,
    Math.round((user.storageUsedBytes / Math.max(1, user.storageQuotaBytes)) * 100)
  );

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#F8FAFC] tracking-tight">
          Studio Settings
        </h1>
        <p className="mt-1 text-sm text-[#94A3B8]">
          Configure default clip destinations, caption presets, storage quotas, and account data.
        </p>
      </div>

      <form onSubmit={handleSave} className="studio-card rounded-2xl p-6 space-y-5">
        <h2 className="font-display text-base font-semibold text-white">Creator Preferences</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="settings-name" className="block text-xs font-medium text-[#c7c4d7] mb-1.5">
              Display name
            </label>
            <input
              id="settings-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full studio-input rounded-lg px-3.5 py-2 text-sm text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#c7c4d7] mb-1.5">Account email</label>
            <input
              type="email"
              disabled
              value={user.email}
              className="w-full studio-input rounded-lg px-3.5 py-2 text-sm text-[#64748B] opacity-75"
            />
          </div>
        </div>

        <div>
          <span className="block text-xs font-medium text-[#c7c4d7] mb-2">
            Default target platforms
          </span>
          <div className="grid grid-cols-2 gap-3 max-w-md">
            {(['youtube_shorts', 'instagram_reels'] as TargetPlatform[]).map((p) => {
              const active = platforms.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePlatform(p)}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 text-xs font-medium border cursor-pointer ${
                    active
                      ? 'bg-[#6366F1]/15 border-[#6366F1] text-white'
                      : 'bg-[#0E1424] border-white/[0.08] text-[#94A3B8]'
                  }`}
                >
                  <span>{p === 'youtube_shorts' ? 'YouTube Shorts' : 'Instagram Reels'}</span>
                  {active && <Check className="w-3.5 h-3.5 text-[#c0c1ff]" />}
                </button>
              );
            })}
          </div>
        </div>

        <div className="max-w-md">
          <label htmlFor="settings-preset" className="block text-xs font-medium text-[#c7c4d7] mb-1.5">
            Default caption preset
          </label>
          <select
            id="settings-preset"
            value={captionPreset}
            onChange={(e) => setCaptionPreset(e.target.value as CaptionPreset)}
            className="w-full studio-input rounded-lg px-3 py-2 text-sm text-white"
          >
            <option value="kinetic_bold">Kinetic Bold</option>
            <option value="clean_studio">Clean Studio</option>
            <option value="editorial_serif">Editorial Center</option>
            <option value="minimal_bottom">Minimal Bottom</option>
          </select>
        </div>

        <div className="pt-2">
          <button
            type="submit"
            disabled={saving}
            className="studio-cta rounded-lg px-5 py-2 text-sm font-semibold text-white inline-flex items-center gap-2 cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? 'Saving...' : 'Save Preferences'}</span>
          </button>
        </div>
      </form>

      {/* Storage Quota & Provider Capabilities */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="studio-card rounded-2xl p-6 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <HardDrive className="w-4 h-4 text-[#818CF8]" />
            <span>Storage Quota</span>
          </div>
          <div className="flex items-center justify-between text-xs font-mono-tabular text-[#94A3B8]">
            <span>{formatBytes(user.storageUsedBytes)} used</span>
            <span>{formatBytes(user.storageQuotaBytes)} limit</span>
          </div>
          <div className="h-2 rounded-full bg-[#0E1424] overflow-hidden">
            <div className="h-full bg-[#6366F1]" style={{ width: `${usagePct}%` }} />
          </div>
          <p className="text-xs text-[#64748B]">
            Includes uploaded master videos and rendered 1080×1920 MP4 exports.
          </p>
        </div>

        <div className="studio-card rounded-2xl p-6 space-y-2.5">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Cpu className="w-4 h-4 text-emerald-400" />
            <span>Pipeline Providers</span>
          </div>
          {providerInfo ? (
            <div className="space-y-1.5 text-xs text-[#c7c4d7]">
              <div className="flex justify-between">
                <span className="text-[#94A3B8]">AI Discovery</span>
                <span className={providerInfo.geminiConfigured ? 'text-emerald-400' : 'text-amber-400'}>
                  {providerInfo.geminiConfigured ? 'Gemini Connected' : 'Demo Fallback Mode'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#94A3B8]">FFmpeg / FFprobe</span>
                <span className={providerInfo.ffmpegAvailable ? 'text-emerald-400' : 'text-red-400'}>
                  {providerInfo.ffmpegAvailable && providerInfo.ffprobeAvailable
                    ? 'Available'
                    : 'Missing'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#94A3B8]">Analysis Model</span>
                <span className="font-mono-tabular">{providerInfo.analysisModel}</span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-[#64748B]">Loading provider diagnostics...</p>
          )}
        </div>
      </div>

      {/* Data Deletion */}
      <div className="studio-card rounded-2xl p-6 border-red-500/20 space-y-4">
        <div>
          <h2 className="font-display text-base font-semibold text-red-300">
            Delete Account & Media Data
          </h2>
          <p className="mt-1 text-xs text-[#94A3B8]">
            Permanently removes your account, projects, transcripts, uploaded videos, and exported
            MP4 files from disk.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="Type DELETE to confirm"
            className="sm:w-56 studio-input rounded-lg px-3.5 py-2 text-sm text-white placeholder-[#475569]"
          />
          <button
            type="button"
            onClick={() => void handleDeleteAccount()}
            disabled={deleting || confirmText !== 'DELETE'}
            className="rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-400/40 px-4 py-2 text-sm font-medium text-red-200 inline-flex items-center justify-center gap-2 disabled:opacity-45 cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
            <span>{deleting ? 'Deleting...' : 'Delete My Account'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
