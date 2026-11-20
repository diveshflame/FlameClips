import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  CaptionSegment,
  CaptionStyle,
  CropMode,
  ProcessingStage,
  ProcessingStepLog,
  TargetPlatform,
} from '../../shared/types.ts';
import { config } from '../config.ts';
import { getDb } from '../db/client.ts';
import { getActiveAnalysisProvider } from './analysisProvider.ts';
import {
  extractAudioForTranscription,
  inspectVideo,
  renderVerticalClip,
} from './mediaPipeline.ts';
import { buildCaptionsFromTranscript } from './scoring.ts';

const cancelledJobs = new Set<string>();

export function requestJobCancellation(jobId: string): void {
  cancelledJobs.add(jobId);
}

function defaultCaptionStyle(preset: string): CaptionStyle {
  switch (preset) {
    case 'clean_studio':
      return {
        preset: 'clean_studio',
        fontSize: 22,
        highlightColor: '#10B981',
        textColor: '#F8FAFC',
        position: 'bottom',
        uppercase: false,
        showBackground: true,
      };
    case 'editorial_serif':
      return {
        preset: 'editorial_serif',
        fontSize: 24,
        highlightColor: '#F59E0B',
        textColor: '#F8FAFC',
        position: 'center',
        uppercase: false,
        showBackground: false,
      };
    case 'minimal_bottom':
      return {
        preset: 'minimal_bottom',
        fontSize: 19,
        highlightColor: '#818CF8',
        textColor: '#dfe2f1',
        position: 'bottom',
        uppercase: false,
        showBackground: true,
      };
    default:
      return {
        preset: 'kinetic_bold',
        fontSize: 24,
        highlightColor: '#6366F1',
        textColor: '#FFFFFF',
        position: 'bottom',
        uppercase: true,
        showBackground: true,
      };
  }
}

function updateJobProgress(
  jobId: string,
  stage: ProcessingStage,
  progressPct: number,
  logs: ProcessingStepLog[],
  extra?: { status?: string; errorMessage?: string | null; isDemoResult?: boolean; completedAt?: string | null }
): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE processing_jobs
     SET current_stage = ?,
         progress_pct = ?,
         logs_json = ?,
         status = COALESCE(?, status),
         error_message = COALESCE(?, error_message),
         is_demo_result = COALESCE(?, is_demo_result),
         completed_at = COALESCE(?, completed_at),
         updated_at = ?
     WHERE id = ?`
  ).run(
    stage,
    progressPct,
    JSON.stringify(logs),
    extra?.status ?? null,
    extra?.errorMessage === undefined ? null : extra.errorMessage,
    extra?.isDemoResult === undefined ? null : extra.isDemoResult ? 1 : 0,
    extra?.completedAt ?? null,
    now,
    jobId
  );
}

function appendLog(
  logs: ProcessingStepLog[],
  stage: ProcessingStage,
  label: string,
  status: ProcessingStepLog['status'],
  detail: string
): ProcessingStepLog[] {
  const filtered = logs.filter((l) => l.stage !== stage);
  return [
    ...filtered,
    {
      stage,
      label,
      status,
      detail,
      timestamp: new Date().toISOString(),
    },
  ];
}

export function enqueueAnalysisJob(jobId: string): void {
  setImmediate(() => {
    void runAnalysisJob(jobId);
  });
}

async function runAnalysisJob(jobId: string): Promise<void> {
  const db = getDb();
  const job = db
    .prepare('SELECT * FROM processing_jobs WHERE id = ?')
    .get(jobId) as
    | {
        id: string;
        project_id: string;
        user_id: string;
        status: string;
      }
    | undefined;

  if (!job || job.status === 'cancelled') return;

  const project = db
    .prepare('SELECT * FROM projects WHERE id = ?')
    .get(job.project_id) as
    | {
        id: string;
        title: string;
        target_platforms: string;
        preferred_min_sec: number;
        preferred_max_sec: number;
        default_caption_preset: string;
      }
    | undefined;

  const asset = db
    .prepare('SELECT * FROM source_assets WHERE project_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(job.project_id) as
    | {
        id: string;
        storage_path: string | null;
        duration_sec: number;
        has_audio: number;
      }
    | undefined;

  if (!project || !asset || !asset.storage_path || !fs.existsSync(asset.storage_path)) {
    updateJobProgress(
      jobId,
      'failed',
      0,
      [
        {
          stage: 'failed',
          label: 'Source Validation',
          status: 'failed',
          detail: 'No authorized uploaded video file found for this project.',
          timestamp: new Date().toISOString(),
        },
      ],
      {
        status: 'failed',
        errorMessage: 'No authorized uploaded video file found for this project.',
      }
    );
    db.prepare('UPDATE projects SET status = ?, updated_at = ? WHERE id = ?').run(
      'failed',
      new Date().toISOString(),
      job.project_id
    );
    return;
  }

  let logs: ProcessingStepLog[] = [];
  const tempAudioPath = path.join(config.tempDir, `audio_${jobId}.mp3`);

  const checkCancelled = () => {
    if (cancelledJobs.has(jobId)) {
      cancelledJobs.delete(jobId);
      throw new Error('JOB_CANCELLED');
    }
  };

  try {
    db.prepare('UPDATE processing_jobs SET status = ?, started_at = ?, updated_at = ? WHERE id = ?').run(
      'running',
      new Date().toISOString(),
      new Date().toISOString(),
      jobId
    );
    db.prepare('UPDATE projects SET status = ?, updated_at = ? WHERE id = ?').run(
      'processing',
      new Date().toISOString(),
      project.id
    );

    // 1. Inspect media with ffprobe
    checkCancelled();
    logs = appendLog(logs, 'inspecting_media', 'Inspecting source media', 'running', 'Running ffprobe stream diagnostics');
    updateJobProgress(jobId, 'inspecting_media', 15, logs);
    const probe = await inspectVideo(asset.storage_path);
    db.prepare(
      'UPDATE source_assets SET duration_sec = ?, width = ?, height = ?, fps = ?, has_audio = ? WHERE id = ?'
    ).run(probe.durationSec, probe.width, probe.height, probe.fps, probe.hasAudio ? 1 : 0, asset.id);
    logs = appendLog(
      logs,
      'inspecting_media',
      'Inspecting source media',
      'completed',
      `${probe.width}x${probe.height} @ ${probe.fps}fps · ${probe.durationSec.toFixed(1)}s`
    );

    // 2. Extract audio
    checkCancelled();
    logs = appendLog(logs, 'extracting_audio', 'Extracting audio track', 'running', 'Decoding mono 16kHz audio for speech analysis');
    updateJobProgress(jobId, 'extracting_audio', 30, logs);
    const audioExtracted = probe.hasAudio
      ? await extractAudioForTranscription(asset.storage_path, tempAudioPath)
      : false;
    logs = appendLog(
      logs,
      'extracting_audio',
      'Extracting audio track',
      'completed',
      audioExtracted ? '16kHz MP3 audio stream extracted' : 'No audio track found; proceeding with visual timeline'
    );

    // 3. Transcription & AI Moment Discovery
    checkCancelled();
    const provider = getActiveAnalysisProvider();
    logs = appendLog(
      logs,
      'transcribing',
      'Transcribing & diarizing speech',
      'running',
      provider.mode === 'gemini'
        ? `Calling ${config.geminiTranscribeModel} for speech-to-text`
        : 'Running demo fallback transcript adapter (GEMINI_API_KEY not configured)'
    );
    updateJobProgress(jobId, 'transcribing', 50, logs);

    const targetPlatforms = JSON.parse(project.target_platforms) as TargetPlatform[];
    const analysis = await provider.analyzeMedia({
      audioPath: audioExtracted ? tempAudioPath : null,
      durationSec: probe.durationSec,
      targetPlatforms,
      preferredMinSec: project.preferred_min_sec,
      preferredMaxSec: project.preferred_max_sec,
      sourceTitle: project.title,
    });

    logs = appendLog(
      logs,
      'transcribing',
      'Transcribing & diarizing speech',
      'completed',
      `${analysis.transcript.length} timestamped segments · ${analysis.speakers.length} speaker(s)`
    );

    checkCancelled();
    logs = appendLog(
      logs,
      'analyzing_moments',
      'Discovering story & hook moments',
      'completed',
      `Evaluated narrative arcs via ${analysis.providerLabel}`
    );
    logs = appendLog(
      logs,
      'ranking_candidates',
      'Scoring & deduplicating clips',
      'completed',
      `Selected ${analysis.clips.length} non-overlapping clip candidates`
    );
    updateJobProgress(jobId, 'generating_previews', 75, logs, {
      isDemoResult: analysis.isDemoResult,
    });

    // Clear previous analysis artifacts if re-running
    db.prepare('DELETE FROM speakers WHERE project_id = ?').run(project.id);
    db.prepare('DELETE FROM transcript_segments WHERE project_id = ?').run(project.id);
    db.prepare('DELETE FROM clip_candidates WHERE project_id = ?').run(project.id);

    const speakerIdByLabel = new Map<string, string>();
    for (const sp of analysis.speakers) {
      const spId = crypto.randomUUID();
      speakerIdByLabel.set(sp.label, spId);
      db.prepare('INSERT INTO speakers (id, project_id, label, display_name, color_hex) VALUES (?, ?, ?, ?, ?)').run(
        spId,
        project.id,
        sp.label,
        sp.displayName,
        sp.colorHex
      );
    }

    const storedTranscript = analysis.transcript.map((seg) => {
      const id = crypto.randomUUID();
      const speakerId = speakerIdByLabel.get(seg.speakerLabel) || null;
      db.prepare(
        `INSERT INTO transcript_segments (id, project_id, speaker_id, speaker_name, start_ms, end_ms, text, confidence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, project.id, speakerId, seg.speakerName, seg.startMs, seg.endMs, seg.text, seg.confidence);
      return {
        id,
        projectId: project.id,
        speakerId,
        speakerName: seg.speakerName,
        startMs: seg.startMs,
        endMs: seg.endMs,
        text: seg.text,
        confidence: seg.confidence,
      };
    });

    const style = defaultCaptionStyle(project.default_caption_preset);
    logs = appendLog(
      logs,
      'generating_previews',
      'Rendering 9:16 vertical previews',
      'running',
      `Generating ${analysis.clips.length} vertical preview renders`
    );
    updateJobProgress(jobId, 'generating_previews', 82, logs);

    for (let i = 0; i < analysis.clips.length; i++) {
      checkCancelled();
      const cand = analysis.clips[i];
      const clipId = crypto.randomUUID();
      const previewPath = path.join(config.previewsDir, `${clipId}.mp4`);
      const captions = buildCaptionsFromTranscript(clipId, cand.startMs, cand.endMs, storedTranscript);

      await renderVerticalClip({
        sourcePath: asset.storage_path,
        outputPath: previewPath,
        startMs: cand.startMs,
        endMs: cand.endMs,
        cropMode: 'auto_speaker',
        focalPointX: 0.5,
        captions,
        captionStyle: style,
        burnInCaptions: false,
        isPreview: true,
        sourceHasAudio: probe.hasAudio,
      });

      const now = new Date().toISOString();
      const durationSec = Math.round(((cand.endMs - cand.startMs) / 1000) * 10) / 10;

      db.prepare(
        `INSERT INTO clip_candidates (
          id, project_id, editorial_title, is_editorial_suggestion, category,
          start_ms, end_ms, duration_sec, overall_score, score_breakdown_json,
          explanation, transcript_excerpt, hook_quote, recommended_platforms, preview_path, created_at
        ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        clipId,
        project.id,
        cand.editorialTitle,
        cand.category,
        cand.startMs,
        cand.endMs,
        durationSec,
        cand.overallScore,
        JSON.stringify(cand.scoreBreakdown),
        cand.explanation,
        cand.transcriptExcerpt,
        cand.hookQuote,
        JSON.stringify(cand.recommendedPlatforms),
        previewPath,
        now
      );

      db.prepare(
        `INSERT INTO clip_edits (
          id, clip_candidate_id, start_ms, end_ms, crop_mode, focal_point_x, caption_style_json, burn_in_captions, updated_at
        ) VALUES (?, ?, ?, ?, 'auto_speaker', 0.5, ?, 1, ?)`
      ).run(crypto.randomUUID(), clipId, cand.startMs, cand.endMs, JSON.stringify(style), now);

      for (const cap of captions) {
        db.prepare(
          `INSERT INTO caption_segments (id, clip_candidate_id, start_ms, end_ms, text, emphasis_word, order_index)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          crypto.randomUUID(),
          clipId,
          cap.startMs,
          cap.endMs,
          cap.text,
          cap.emphasisWord,
          cap.orderIndex
        );
      }

      const pct = Math.min(98, 82 + Math.round(((i + 1) / analysis.clips.length) * 16));
      updateJobProgress(jobId, 'generating_previews', pct, logs);
    }

    logs = appendLog(
      logs,
      'generating_previews',
      'Rendering 9:16 vertical previews',
      'completed',
      `All ${analysis.clips.length} vertical preview clips ready`
    );

    const completedAt = new Date().toISOString();
    updateJobProgress(jobId, 'completed', 100, logs, {
      status: 'completed',
      isDemoResult: analysis.isDemoResult,
      completedAt,
    });

    db.prepare(
      'UPDATE projects SET status = ?, provider_mode = ?, updated_at = ? WHERE id = ?'
    ).run('completed', provider.mode, completedAt, project.id);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unexpected error while analyzing source video';
    const isCancel = message === 'JOB_CANCELLED';
    const finalStage: ProcessingStage = isCancel ? 'cancelled' : 'failed';
    logs = appendLog(
      logs,
      finalStage,
      isCancel ? 'Job cancelled' : 'Pipeline failed',
      'failed',
      isCancel ? 'Analysis job was cancelled by user.' : message
    );

    updateJobProgress(jobId, finalStage, 0, logs, {
      status: isCancel ? 'cancelled' : 'failed',
      errorMessage: isCancel ? 'Cancelled by user' : message,
    });
    db.prepare('UPDATE projects SET status = ?, updated_at = ? WHERE id = ?').run(
      isCancel ? 'ready_for_analysis' : 'failed',
      new Date().toISOString(),
      project.id
    );
  } finally {
    if (fs.existsSync(tempAudioPath)) {
      try {
        fs.unlinkSync(tempAudioPath);
      } catch {
        // ignore cleanup errors
      }
    }
  }
}

export function enqueueExportJob(exportId: string): void {
  setImmediate(() => {
    void runExportJob(exportId);
  });
}

async function runExportJob(exportId: string): Promise<void> {
  const db = getDb();
  const exp = db
    .prepare('SELECT * FROM exports WHERE id = ?')
    .get(exportId) as
    | {
        id: string;
        project_id: string;
        clip_candidate_id: string;
        burn_in_captions: number;
      }
    | undefined;

  if (!exp) return;

  try {
    db.prepare('UPDATE exports SET status = ?, progress_pct = 20 WHERE id = ?').run(
      'rendering',
      exportId
    );

    const asset = db
      .prepare('SELECT storage_path, has_audio FROM source_assets WHERE project_id = ? LIMIT 1')
      .get(exp.project_id) as { storage_path: string; has_audio: number } | undefined;

    const edit = db
      .prepare('SELECT * FROM clip_edits WHERE clip_candidate_id = ?')
      .get(exp.clip_candidate_id) as
      | {
          start_ms: number;
          end_ms: number;
          crop_mode: CropMode;
          focal_point_x: number;
          caption_style_json: string;
        }
      | undefined;

    const captions = db
      .prepare(
        'SELECT id, clip_candidate_id, start_ms, end_ms, text, emphasis_word, order_index FROM caption_segments WHERE clip_candidate_id = ? ORDER BY order_index ASC'
      )
      .all(exp.clip_candidate_id) as Array<{
      id: string;
      clip_candidate_id: string;
      start_ms: number;
      end_ms: number;
      text: string;
      emphasis_word: string | null;
      order_index: number;
    }>;

    if (!asset || !asset.storage_path || !fs.existsSync(asset.storage_path) || !edit) {
      throw new Error('Source asset or clip edit settings are missing for export.');
    }

    const mappedCaptions: CaptionSegment[] = captions.map((c) => ({
      id: c.id,
      clipCandidateId: c.clip_candidate_id,
      startMs: c.start_ms,
      endMs: c.end_ms,
      text: c.text,
      emphasisWord: c.emphasis_word,
      orderIndex: c.order_index,
    }));

    const outPath = path.join(config.exportsDir, `${exportId}.mp4`);
    db.prepare('UPDATE exports SET progress_pct = 55 WHERE id = ?').run(exportId);

    const rendered = await renderVerticalClip({
      sourcePath: asset.storage_path,
      outputPath: outPath,
      startMs: edit.start_ms,
      endMs: edit.end_ms,
      cropMode: edit.crop_mode,
      focalPointX: edit.focal_point_x,
      captions: mappedCaptions,
      captionStyle: JSON.parse(edit.caption_style_json) as CaptionStyle,
      burnInCaptions: Boolean(exp.burn_in_captions),
      isPreview: false,
      sourceHasAudio: Boolean(asset.has_audio),
    });

    db.prepare(
      `UPDATE exports
       SET status = 'completed',
           progress_pct = 100,
           storage_path = ?,
           file_size_bytes = ?,
           duration_sec = ?,
           completed_at = ?
       WHERE id = ?`
    ).run(outPath, rendered.fileSizeBytes, rendered.durationSec, new Date().toISOString(), exportId);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Export rendering failed';
    db.prepare('UPDATE exports SET status = ?, error_message = ?, progress_pct = 0 WHERE id = ?').run(
      'failed',
      message,
      exportId
    );
  }
}

export function recoverInterruptedJobs(): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE processing_jobs
     SET status = 'failed',
         current_stage = 'failed',
         error_message = 'Job was interrupted by a server restart. Click Retry to run again.',
         updated_at = ?
     WHERE status IN ('queued', 'running')`
  ).run(now);

  db.prepare(
    `UPDATE exports
     SET status = 'failed',
         error_message = 'Export render was interrupted by a server restart. Retry export.'
     WHERE status IN ('queued', 'rendering')`
  ).run();
}
