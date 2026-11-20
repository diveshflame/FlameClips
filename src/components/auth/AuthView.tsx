import React, { useState } from 'react';
import { Clapperboard, ArrowRight, ShieldCheck, Scissors, Captions, SlidersHorizontal } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { useToast } from '../../context/ToastContext.tsx';

export function AuthView() {
  const { login, signup, loginDemo } = useAuth();
  const { addToast } = useToast();

  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode === 'signup' && name.trim().length < 2) {
      setError('Enter your name (at least 2 characters).');
      return;
    }
    if (!email.includes('@')) {
      setError('Enter a valid email address.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login(email.trim(), password);
        addToast('success', 'Signed in to ClipForge AI');
      } else {
        await signup(email.trim(), password, name.trim());
        addToast('success', 'Account created');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDemo = async () => {
    setError(null);
    setDemoLoading(true);
    try {
      await loginDemo();
      addToast('info', 'Loaded seeded Demo Studio workspace');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load demo workspace');
    } finally {
      setDemoLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0F19] text-[#dfe2f1] flex flex-col lg:flex-row">
      {/* Left Studio Overview */}
      <div className="lg:w-7/12 p-8 sm:p-12 lg:p-16 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-white/[0.06] bg-[radial-gradient(ellipse_at_top_left,_rgba(99,102,241,0.14),_transparent_55%)]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg studio-cta flex items-center justify-center">
            <Clapperboard className="w-5 h-5 text-white" />
          </div>
          <span className="font-display text-lg font-bold tracking-tight text-white">
            ClipForge AI
          </span>
        </div>

        <div className="my-12 lg:my-0 max-w-xl">
          <h1
            className="font-display text-3xl sm:text-4xl lg:text-[40px] font-bold tracking-tight text-[#F8FAFC] leading-tight"
            style={{ textWrap: 'balance' }}
          >
            Turn long-form video into story-complete vertical clips.
          </h1>
          <p className="mt-4 text-base text-[#94A3B8] leading-relaxed">
            Discover standalone hooks, insights, and speaker exchanges backed by explainable
            scoring, frame-accurate timeline trimming, and 1080×1920 MP4 export for YouTube Shorts
            and Instagram Reels.
          </p>

          <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-6 pt-8 border-t border-white/[0.07]">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Scissors className="w-4 h-4 text-[#818CF8]" />
                <span>Story Discovery</span>
              </div>
              <p className="mt-1.5 text-xs text-[#94A3B8] leading-relaxed">
                Semantic boundaries preserve setup and payoff instead of naive fixed-length slices.
              </p>
            </div>
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Captions className="w-4 h-4 text-[#10B981]" />
                <span>Synced Captions</span>
              </div>
              <p className="mt-1.5 text-xs text-[#94A3B8] leading-relaxed">
                Edit caption text, emphasis words, and burn-in styling directly against the 9:16 preview.
              </p>
            </div>
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <SlidersHorizontal className="w-4 h-4 text-[#F59E0B]" />
                <span>FFmpeg Render</span>
              </div>
              <p className="mt-1.5 text-xs text-[#94A3B8] leading-relaxed">
                Export vertical 1080×1920 H.264/AAC MP4 files with custom crop framing.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-[#64748B]">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>Rights-first ingestion: authorized uploads and private per-user project isolation.</span>
        </div>
      </div>

      {/* Right Auth Panel */}
      <div className="lg:w-5/12 flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md studio-panel rounded-2xl p-6 sm:p-8">
          <div className="flex items-center gap-1 p-1 bg-[#0E1424] rounded-lg border border-white/[0.06] mb-6">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                mode === 'login'
                  ? 'bg-[#1E293B] text-white'
                  : 'text-[#94A3B8] hover:text-white'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('signup');
                setError(null);
              }}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                mode === 'signup'
                  ? 'bg-[#1E293B] text-white'
                  : 'text-[#94A3B8] hover:text-white'
              }`}
            >
              Create Account
            </button>
          </div>

          <h2 className="font-display text-xl font-semibold text-white">
            {mode === 'login' ? 'Open your studio' : 'Create your studio account'}
          </h2>
          <p className="mt-1 text-sm text-[#94A3B8]">
            {mode === 'login'
              ? 'Access your projects, transcripts, and rendered exports.'
              : 'All projects, uploads, and exports stay private to your account.'}
          </p>

          {error && (
            <div
              role="alert"
              className="mt-4 rounded-lg bg-red-500/10 border border-red-400/30 px-3.5 py-2.5 text-xs text-red-200"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {mode === 'signup' && (
              <div>
                <label htmlFor="auth-name" className="block text-xs font-medium text-[#c7c4d7] mb-1.5">
                  Full name
                </label>
                <input
                  id="auth-name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Maya Chen"
                  className="w-full studio-input rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-[#475569]"
                />
              </div>
            )}

            <div>
              <label htmlFor="auth-email" className="block text-xs font-medium text-[#c7c4d7] mb-1.5">
                Email address
              </label>
              <input
                id="auth-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="creator@studio.com"
                className="w-full studio-input rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-[#475569]"
              />
            </div>

            <div>
              <label htmlFor="auth-password" className="block text-xs font-medium text-[#c7c4d7] mb-1.5">
                Password
              </label>
              <input
                id="auth-password"
                type="password"
                required
                minLength={8}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 8 characters"
                className="w-full studio-input rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-[#475569]"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full studio-cta rounded-lg py-2.5 px-4 text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer"
            >
              <span>{submitting ? 'Authenticating...' : mode === 'login' ? 'Sign In' : 'Create Account'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-white/[0.07]">
            <button
              type="button"
              onClick={handleDemo}
              disabled={demoLoading}
              className="w-full rounded-lg bg-[#1E293B] hover:bg-[#25334D] border border-white/10 py-2.5 px-4 text-sm font-medium text-slate-200 transition-colors cursor-pointer disabled:opacity-60"
            >
              {demoLoading ? 'Preparing Demo Studio...' : 'Explore Seeded Demo Workspace'}
            </button>
            <p className="mt-2 text-[11px] text-[#64748B] text-center">
              Includes a 48s studio master video, transcript, and 3 AI clip candidates.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
