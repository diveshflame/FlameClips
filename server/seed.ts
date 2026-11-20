import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { CaptionStyle, ClipScoreBreakdown, TargetPlatform } from '../shared/types.ts';
import { config } from './config.ts';
import { getDb } from './db/client.ts';
import { hashPassword } from './security/auth.ts';
import { ensureDemoSampleVideo, renderVerticalClip } from './services/mediaPipeline.ts';
import { buildCaptionsFromTranscript, computeOverallScore } from './services/scoring.ts';

export const DEMO_USER_EMAIL = 'demo@clipforge.studio';
export const DEMO_USER_PASSWORD = 'ClipForgeDemo2026!';

export async function seedDemoWorkspace(): Promise<void> {
  const db = getDb();
  const sampleVideoPath = await ensureDemoSampleVideo();

  let demoUser = db
    .prepare('SELECT id FROM users WHERE email = ?')
    .get(DEMO_USER_EMAIL) as { id: string } | undefined;

  if (!demoUser) {
    const userId = 'demo-user-001';
    db.prepare(
      `INSERT INTO users (id, email, name, password_hash, default_platforms, default_caption_preset, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      userId,
      DEMO_USER_EMAIL,
      'Alex Rivera',
      hashPassword(DEMO_USER_PASSWORD),
      JSON.stringify(['youtube_shorts', 'instagram_reels']),
      'kinetic_bold',
      new Date().toISOString()
    );
    demoUser = { id: userId };
  }

  const existingProject = db
    .prepare('SELECT id FROM projects WHERE user_id = ? LIMIT 1')
    .get(demoUser.id) as { id: string } | undefined;

  if (existingProject) {
    return;
  }

  const now = new Date().toISOString();
  const projectId = 'demo-project-001';
  const assetId = 'demo-asset-001';
  const jobId = 'demo-job-001';
  const platforms: TargetPlatform[] = ['youtube_shorts', 'instagram_reels'];

  const assetCopyPath = path.join(config.uploadsDir, `${assetId}_sample_studio_interview.mp4`);
  fs.copyFileSync(sampleVideoPath, assetCopyPath);
  const stat = fs.statSync(assetCopyPath);

  db.prepare(
    `INSERT INTO projects (
      id, user_id, title, description, target_platforms, preferred_min_sec, preferred_max_sec,
      default_caption_preset, status, provider_mode, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 18, 55, 'kinetic_bold', 'completed', 'demo', ?, ?)`
  ).run(
    projectId,
    demoUser.id,
    'Founder Retention Workshop (Demo Studio Master)',
    'Seeded studio sample demonstrating AI hook discovery, explainable scoring, timeline trimming, and 9:16 MP4 export.',
    JSON.stringify(platforms),
    now,
    now
  );

  db.prepare(
    `INSERT INTO source_assets (
      id, project_id, user_id, source_type, original_filename, source_url, storage_path,
      mime_type, file_size_bytes, duration_sec, width, height, fps, has_audio, rights_confirmed,
      metadata_title, metadata_channel, thumbnail_url, created_at
    ) VALUES (?, ?, ?, 'sample_studio', 'sample_studio_interview.mp4', NULL, ?, 'video/mp4', ?, 48, 1280, 720, 24, 1, 1, 'Founder Retention Workshop', 'ClipForge Studio Sample', NULL, ?)`
  ).run(assetId, projectId, demoUser.id, assetCopyPath, stat.size, now);

  const logs = [
    {
      stage: 'inspecting_media',
      label: 'Inspecting source media',
      status: 'completed',
      detail: '1280x720 @ 24fps · 48.0s',
      timestamp: now,
    },
    {
      stage: 'transcribing',
      label: 'Transcribing & diarizing speech',
      status: 'completed',
      detail: '6 timestamped segments · 2 speakers (Demo Seed)',
      timestamp: now,
    },
    {
      stage: 'generating_previews',
      label: 'Rendering 9:16 vertical previews',
      status: 'completed',
      detail: '3 vertical preview clips ready',
      timestamp: now,
    },
  ];

  db.prepare(
    `INSERT INTO processing_jobs (
      id, project_id, user_id, idempotency_key, status, current_stage, progress_pct,
      provider_mode, is_demo_result, logs_json, started_at, completed_at, created_at, updated_at
    ) VALUES (?, ?, ?, 'seed-v1', 'completed', 'completed', 100, 'demo', 1, ?, ?, ?, ?, ?)`
  ).run(jobId, projectId, demoUser.id, JSON.stringify(logs), now, now, now, now);

  const sp1Id = 'demo-sp-1';
  const sp2Id = 'demo-sp-2';
  db.prepare('INSERT INTO speakers (id, project_id, label, display_name, color_hex) VALUES (?, ?, ?, ?, ?)').run(
    sp1Id,
    projectId,
    'S1',
    'Maya Chen (Host)',
    '#6366F1'
  );
  db.prepare('INSERT INTO speakers (id, project_id, label, display_name, color_hex) VALUES (?, ?, ?, ?, ?)').run(
    sp2Id,
    projectId,
    'S2',
    'Devon Brooks (Guest)',
    '#10B981'
  );

  const transcriptRows = [
    {
      id: 'demo-tr-1',
      speakerId: sp1Id,
      speakerName: 'Maya Chen (Host)',
      startMs: 0,
      endMs: 7800,
      text: 'Most creators think turning a long podcast into Shorts is just slicing every thirty seconds.',
    },
    {
      id: 'demo-tr-2',
      speakerId: sp2Id,
      speakerName: 'Devon Brooks (Guest)',
      startMs: 7800,
      endMs: 16400,
      text: 'Exactly—and fixed slices break the setup. A short clip only holds attention if the stakes land in three seconds.',
    },
    {
      id: 'demo-tr-3',
      speakerId: sp1Id,
      speakerName: 'Maya Chen (Host)',
      startMs: 16400,
      endMs: 24500,
      text: 'When we started keeping the full question and the concrete payoff together, audience retention nearly doubled.',
    },
    {
      id: 'demo-tr-4',
      speakerId: sp2Id,
      speakerName: 'Devon Brooks (Guest)',
      startMs: 24500,
      endMs: 33200,
      text: 'Wait—did you leave the awkward pause in before the answer, or tighten the pacing in post?',
    },
    {
      id: 'demo-tr-5',
      speakerId: sp1Id,
      speakerName: 'Maya Chen (Host)',
      startMs: 33200,
      endMs: 42000,
      text: 'We tightened dead air, never the meaning. Viewers forgive fast pacing, they never forgive missing context.',
    },
    {
      id: 'demo-tr-6',
      speakerId: sp2Id,
      speakerName: 'Devon Brooks (Guest)',
      startMs: 42000,
      endMs: 48000,
      text: 'That single rule cut our editing review time in half across both Reels and Shorts.',
    },
  ];

  for (const row of transcriptRows) {
    db.prepare(
      `INSERT INTO transcript_segments (id, project_id, speaker_id, speaker_name, start_ms, end_ms, text, confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0.96)`
    ).run(row.id, projectId, row.speakerId, row.speakerName, row.startMs, row.endMs, row.text);
  }

  const style: CaptionStyle = {
    preset: 'kinetic_bold',
    fontSize: 24,
    highlightColor: '#6366F1',
    textColor: '#FFFFFF',
    position: 'bottom',
    uppercase: true,
    showBackground: true,
  };

  const candidates = [
    {
      id: 'demo-clip-1',
      title: 'Why Fixed 30-Second Slicing Breaks Short-Form Retention',
      category: 'hook',
      startMs: 0,
      endMs: 24500,
      breakdown: {
        hookStrength: 94,
        standaloneClarity: 92,
        payoff: 90,
        pacing: 89,
        visualSuitability: 87,
        contextIntegrityPenalty: 0,
      } satisfies ClipScoreBreakdown,
      explanation:
        'Opens with a strong contrarian statement on editing mistakes, maintains speaker exchange, and finishes on a verified retention outcome.',
      hookQuote: 'Most creators think turning a long podcast into Shorts is just slicing every thirty seconds.',
    },
    {
      id: 'demo-clip-2',
      title: 'Tighten Pacing, Never Strip Essential Context',
      category: 'exchange',
      startMs: 24500,
      endMs: 48000,
      breakdown: {
        hookStrength: 89,
        standaloneClarity: 93,
        payoff: 91,
        pacing: 88,
        visualSuitability: 85,
        contextIntegrityPenalty: 1,
      } satisfies ClipScoreBreakdown,
      explanation:
        'Memorable back-and-forth Q&A exchange with an explicit question setup and crisp, practical editorial rule at the end.',
      hookQuote: 'Wait—did you leave the awkward pause in before the answer, or tighten the pacing in post?',
    },
    {
      id: 'demo-clip-3',
      title: 'The 3-Second Stakes Rule for Standalone Clips',
      category: 'insight',
      startMs: 7800,
      endMs: 33200,
      breakdown: {
        hookStrength: 84,
        standaloneClarity: 86,
        payoff: 83,
        pacing: 85,
        visualSuitability: 84,
        contextIntegrityPenalty: 2,
      } satisfies ClipScoreBreakdown,
      explanation:
        'Focused tactical insight explaining why premise clarity in the first three seconds outperforms abrupt mid-thought cuts.',
      hookQuote: 'A short clip only holds attention if the stakes land in three seconds.',
    },
  ];

  const mappedTranscript = transcriptRows.map((t) => ({ ...t, projectId, confidence: 0.96 }));

  for (const cand of candidates) {
    const previewPath = path.join(config.previewsDir, `${cand.id}.mp4`);
    const captions = buildCaptionsFromTranscript(cand.id, cand.startMs, cand.endMs, mappedTranscript);

    await renderVerticalClip({
      sourcePath: assetCopyPath,
      outputPath: previewPath,
      startMs: cand.startMs,
      endMs: cand.endMs,
      cropMode: 'auto_speaker',
      focalPointX: 0.5,
      captions,
      captionStyle: style,
      burnInCaptions: false,
      isPreview: true,
      sourceHasAudio: true,
    });

    const overallScore = computeOverallScore(cand.breakdown);
    const excerpt = transcriptRows
      .filter((t) => t.endMs > cand.startMs && t.startMs < cand.endMs)
      .map((t) => t.text)
      .join(' ');

    db.prepare(
      `INSERT INTO clip_candidates (
        id, project_id, editorial_title, is_editorial_suggestion, category,
        start_ms, end_ms, duration_sec, overall_score, score_breakdown_json,
        explanation, transcript_excerpt, hook_quote, recommended_platforms, preview_path, created_at
      ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      cand.id,
      projectId,
      cand.title,
      cand.category,
      cand.startMs,
      cand.endMs,
      Math.round(((cand.endMs - cand.startMs) / 1000) * 10) / 10,
      overallScore,
      JSON.stringify(cand.breakdown),
      cand.explanation,
      excerpt,
      cand.hookQuote,
      JSON.stringify(platforms),
      previewPath,
      now
    );

    db.prepare(
      `INSERT INTO clip_edits (
        id, clip_candidate_id, start_ms, end_ms, crop_mode, focal_point_x, caption_style_json, burn_in_captions, updated_at
      ) VALUES (?, ?, ?, ?, 'auto_speaker', 0.5, ?, 1, ?)`
    ).run(crypto.randomUUID(), cand.id, cand.startMs, cand.endMs, JSON.stringify(style), now);

    for (const cap of captions) {
      db.prepare(
        `INSERT INTO caption_segments (id, clip_candidate_id, start_ms, end_ms, text, emphasis_word, order_index)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        crypto.randomUUID(),
        cand.id,
        cap.startMs,
        cap.endMs,
        cap.text,
        cap.emphasisWord,
        cap.orderIndex
      );
    }
  }
}
