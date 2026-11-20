import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../config.ts';
import { getDb } from '../db/client.ts';
import {
  createRateLimiter,
  requireAuth,
  type AuthenticatedRequest,
} from '../security/auth.ts';
import {
  serializeClipCandidate,
  serializeExportJob,
  serializeProcessingJob,
  serializeProjectSummary,
  serializeSourceAsset,
  serializeSpeakersAndTranscript,
} from '../serializers.ts';
import { enqueueAnalysisJob, requestJobCancellation } from '../services/jobWorker.ts';
import { ensureDemoSampleVideo, inspectVideo } from '../services/mediaPipeline.ts';
import { defaultSourceAdapter } from '../services/sourceAdapter.ts';

export const projectRouter = express.Router();

const uploadLimiter = createRateLimiter('upload', 20, 60_000);
const jobLimiter = createRateLimiter('job', 30, 60_000);

const ALLOWED_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.m4v', '.mkv']);
const ALLOWED_MIMES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-matroska',
  'application/octet-stream',
]);

const upload = multer({
  dest: config.tempDir,
  limits: {
    fileSize: config.maxUploadBytes,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext) && !ALLOWED_MIMES.has(file.mimetype)) {
      cb(new Error('Unsupported video format. Please upload MP4, MOV, or WebM.'));
      return;
    }
    cb(null, true);
  },
});

const createProjectSchema = z.object({
  title: z.string().trim().min(1).max(140),
  description: z.string().trim().max(500).optional().default(''),
  targetPlatforms: z
    .array(z.enum(['youtube_shorts', 'instagram_reels']))
    .min(1)
    .default(['youtube_shorts', 'instagram_reels']),
  preferredMinSec: z.number().int().min(10).max(90).optional().default(20),
  preferredMaxSec: z.number().int().min(15).max(180).optional().default(58),
  defaultCaptionPreset: z
    .enum(['kinetic_bold', 'clean_studio', 'editorial_serif', 'minimal_bottom'])
    .optional()
    .default('kinetic_bold'),
  sourceUrl: z.string().trim().max(500).optional().nullable(),
});

const updateProjectSchema = z.object({
  title: z.string().trim().min(1).max(140).optional(),
  description: z.string().trim().max(500).optional(),
  targetPlatforms: z.array(z.enum(['youtube_shorts', 'instagram_reels'])).min(1).optional(),
  preferredMinSec: z.number().int().min(10).max(90).optional(),
  preferredMaxSec: z.number().int().min(15).max(180).optional(),
  defaultCaptionPreset: z
    .enum(['kinetic_bold', 'clean_studio', 'editorial_serif', 'minimal_bottom'])
    .optional(),
});

projectRouter.post('/sources/validate', requireAuth, async (req: AuthenticatedRequest, res) => {
  const schema = z.object({ url: z.string().trim().min(1).max(600) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Please provide a valid URL string.' });
    return;
  }

  try {
    const result = await defaultSourceAdapter.validateAndInspectUrl(parsed.data.url);
    res.json(result);
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Unable to validate source URL safely.',
    });
  }
});

projectRouter.get('/projects', requireAuth, (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC')
    .all(req.user!.id) as Array<Parameters<typeof serializeProjectSummary>[0]>;

  res.json({ projects: rows.map(serializeProjectSummary) });
});

projectRouter.post('/projects', requireAuth, (req: AuthenticatedRequest, res) => {
  const parsed = createProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid project settings' });
    return;
  }

  if (parsed.data.preferredMinSec >= parsed.data.preferredMaxSec) {
    res.status(400).json({ error: 'Minimum clip duration must be shorter than maximum duration.' });
    return;
  }

  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const providerMode = config.geminiApiKey ? 'gemini' : 'demo';

  db.prepare(
    `INSERT INTO projects (
      id, user_id, title, description, target_platforms, preferred_min_sec, preferred_max_sec,
      default_caption_preset, status, provider_mode, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`
  ).run(
    id,
    req.user!.id,
    parsed.data.title,
    parsed.data.description,
    JSON.stringify(parsed.data.targetPlatforms),
    parsed.data.preferredMinSec,
    parsed.data.preferredMaxSec,
    parsed.data.defaultCaptionPreset,
    providerMode,
    now,
    now
  );

  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Parameters<
    typeof serializeProjectSummary
  >[0];
  res.status(201).json({ project: serializeProjectSummary(row) });
});

projectRouter.get('/projects/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const projectRow = db
    .prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user!.id) as Parameters<typeof serializeProjectSummary>[0] | undefined;

  if (!projectRow) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const { speakers, transcript } = serializeSpeakersAndTranscript(projectRow.id);
  const clipRows = db
    .prepare('SELECT * FROM clip_candidates WHERE project_id = ? ORDER BY overall_score DESC')
    .all(projectRow.id) as Array<Parameters<typeof serializeClipCandidate>[0]>;

  const exportRows = db
    .prepare('SELECT * FROM exports WHERE project_id = ? ORDER BY created_at DESC')
    .all(projectRow.id) as Array<Parameters<typeof serializeExportJob>[0]>;

  res.json({
    project: serializeProjectSummary(projectRow),
    speakers,
    transcript,
    clips: clipRows.map((c) => serializeClipCandidate(c, req.user!.id)),
    exports: exportRows.map(serializeExportJob),
  });
});

projectRouter.patch('/projects/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const parsed = updateProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid update payload' });
    return;
  }

  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user!.id) as Parameters<typeof serializeProjectSummary>[0] | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const nextMin = parsed.data.preferredMinSec ?? existing.preferred_min_sec;
  const nextMax = parsed.data.preferredMaxSec ?? existing.preferred_max_sec;
  if (nextMin >= nextMax) {
    res.status(400).json({ error: 'Minimum clip duration must be shorter than maximum duration.' });
    return;
  }

  db.prepare(
    `UPDATE projects
     SET title = ?, description = ?, target_platforms = ?, preferred_min_sec = ?,
         preferred_max_sec = ?, default_caption_preset = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`
  ).run(
    parsed.data.title ?? existing.title,
    parsed.data.description ?? existing.description,
    parsed.data.targetPlatforms
      ? JSON.stringify(parsed.data.targetPlatforms)
      : existing.target_platforms,
    nextMin,
    nextMax,
    parsed.data.defaultCaptionPreset ?? existing.default_caption_preset,
    new Date().toISOString(),
    existing.id,
    req.user!.id
  );

  const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(existing.id) as Parameters<
    typeof serializeProjectSummary
  >[0];
  res.json({ project: serializeProjectSummary(updated) });
});

projectRouter.delete('/projects/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const project = db
    .prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user!.id) as { id: string } | undefined;

  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const assets = db
    .prepare('SELECT storage_path FROM source_assets WHERE project_id = ?')
    .all(project.id) as Array<{ storage_path: string | null }>;
  const previews = db
    .prepare('SELECT preview_path FROM clip_candidates WHERE project_id = ?')
    .all(project.id) as Array<{ preview_path: string | null }>;
  const exportsRows = db
    .prepare('SELECT storage_path FROM exports WHERE project_id = ?')
    .all(project.id) as Array<{ storage_path: string | null }>;

  for (const item of [...assets, ...exportsRows]) {
    if (item.storage_path && fs.existsSync(item.storage_path)) {
      try {
        fs.unlinkSync(item.storage_path);
      } catch {
        // ignore cleanup error
      }
    }
  }
  for (const p of previews) {
    if (p.preview_path && fs.existsSync(p.preview_path)) {
      try {
        fs.unlinkSync(p.preview_path);
      } catch {
        // ignore cleanup error
      }
    }
  }

  db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(project.id, req.user!.id);
  res.json({ deleted: true });
});

projectRouter.post(
  '/projects/:id/upload',
  requireAuth,
  uploadLimiter,
  (req: AuthenticatedRequest, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        res.status(400).json({ error: err.message || 'Upload failed' });
        return;
      }
      next();
    });
  },
  async (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const project = db
      .prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.user!.id) as { id: string } | undefined;

    if (!project) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'No video file was provided.' });
      return;
    }

    const rightsConfirmed =
      req.body?.rightsConfirmed === 'true' || req.body?.rightsConfirmed === true;
    if (!rightsConfirmed) {
      fs.unlinkSync(req.file.path);
      res.status(400).json({
        error: 'You must confirm ownership or authorization to process this video.',
      });
      return;
    }

    try {
      // Check user quota
      const userQuota = db
        .prepare('SELECT storage_quota_bytes FROM users WHERE id = ?')
        .get(req.user!.id) as { storage_quota_bytes: number };
      const usageRow = db
        .prepare(
          `SELECT
             COALESCE((SELECT SUM(file_size_bytes) FROM source_assets WHERE user_id = ?), 0) +
             COALESCE((SELECT SUM(file_size_bytes) FROM exports WHERE user_id = ?), 0) AS total_bytes`
        )
        .get(req.user!.id, req.user!.id) as { total_bytes: number };

      if (usageRow.total_bytes + req.file.size > userQuota.storage_quota_bytes) {
        fs.unlinkSync(req.file.path);
        res.status(413).json({ error: 'Storage quota exceeded. Delete older projects to free space.' });
        return;
      }

      const probe = await inspectVideo(req.file.path);
      const assetId = crypto.randomUUID();
      const safeExt = path.extname(req.file.originalname || '.mp4').toLowerCase() || '.mp4';
      const finalPath = path.join(config.uploadsDir, `${assetId}${safeExt}`);
      fs.renameSync(req.file.path, finalPath);

      // Remove prior source assets for this project
      const prevAssets = db
        .prepare('SELECT storage_path FROM source_assets WHERE project_id = ?')
        .all(project.id) as Array<{ storage_path: string | null }>;
      for (const prev of prevAssets) {
        if (prev.storage_path && fs.existsSync(prev.storage_path)) {
          try {
            fs.unlinkSync(prev.storage_path);
          } catch {
            // ignore
          }
        }
      }
      db.prepare('DELETE FROM source_assets WHERE project_id = ?').run(project.id);

      const now = new Date().toISOString();
      const sourceUrl = typeof req.body?.sourceUrl === 'string' ? req.body.sourceUrl : null;
      const metadataTitle =
        typeof req.body?.metadataTitle === 'string' ? req.body.metadataTitle : null;

      db.prepare(
        `INSERT INTO source_assets (
          id, project_id, user_id, source_type, original_filename, source_url, storage_path,
          mime_type, file_size_bytes, duration_sec, width, height, fps, has_audio, rights_confirmed,
          metadata_title, created_at
        ) VALUES (?, ?, ?, 'upload', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
      ).run(
        assetId,
        project.id,
        req.user!.id,
        path.basename(req.file.originalname || `upload${safeExt}`),
        sourceUrl,
        finalPath,
        req.file.mimetype || 'video/mp4',
        req.file.size,
        probe.durationSec,
        probe.width,
        probe.height,
        probe.fps,
        probe.hasAudio ? 1 : 0,
        metadataTitle,
        now
      );

      db.prepare('UPDATE projects SET status = ?, updated_at = ? WHERE id = ?').run(
        'ready_for_analysis',
        now,
        project.id
      );

      const assetRow = db
        .prepare('SELECT * FROM source_assets WHERE id = ?')
        .get(assetId) as Parameters<typeof serializeSourceAsset>[0];
      res.status(201).json({ asset: serializeSourceAsset(assetRow) });
    } catch (err) {
      if (req.file && fs.existsSync(req.file.path)) {
        try {
          fs.unlinkSync(req.file.path);
        } catch {
          // ignore
        }
      }
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Uploaded file failed media validation.',
      });
    }
  }
);

projectRouter.post('/projects/:id/use-sample', requireAuth, async (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const project = db
    .prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user!.id) as { id: string } | undefined;

  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const samplePath = await ensureDemoSampleVideo();
  const assetId = crypto.randomUUID();
  const destPath = path.join(config.uploadsDir, `${assetId}_sample.mp4`);
  fs.copyFileSync(samplePath, destPath);
  const stat = fs.statSync(destPath);
  const probe = await inspectVideo(destPath);

  db.prepare('DELETE FROM source_assets WHERE project_id = ?').run(project.id);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO source_assets (
      id, project_id, user_id, source_type, original_filename, storage_path,
      mime_type, file_size_bytes, duration_sec, width, height, fps, has_audio, rights_confirmed,
      metadata_title, metadata_channel, created_at
    ) VALUES (?, ?, ?, 'sample_studio', 'sample_studio_interview.mp4', ?, 'video/mp4', ?, ?, ?, ?, ?, ?, 1, 'Studio Interview Master Sample', 'ClipForge Studio', ?)`
  ).run(
    assetId,
    project.id,
    req.user!.id,
    destPath,
    stat.size,
    probe.durationSec,
    probe.width,
    probe.height,
    probe.fps,
    probe.hasAudio ? 1 : 0,
    now
  );

  db.prepare('UPDATE projects SET status = ?, updated_at = ? WHERE id = ?').run(
    'ready_for_analysis',
    now,
    project.id
  );

  const assetRow = db.prepare('SELECT * FROM source_assets WHERE id = ?').get(assetId) as Parameters<
    typeof serializeSourceAsset
  >[0];
  res.status(201).json({ asset: serializeSourceAsset(assetRow) });
});

projectRouter.post('/projects/:id/analyze', requireAuth, jobLimiter, (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const project = db
    .prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user!.id) as { id: string } | undefined;

  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const asset = db
    .prepare('SELECT id FROM source_assets WHERE project_id = ? LIMIT 1')
    .get(project.id) as { id: string } | undefined;

  if (!asset) {
    res.status(400).json({ error: 'Upload an authorized video file before starting analysis.' });
    return;
  }

  const idempotencyKey =
    typeof req.headers['idempotency-key'] === 'string'
      ? req.headers['idempotency-key'].trim()
      : typeof req.body?.idempotencyKey === 'string'
        ? req.body.idempotencyKey.trim()
        : null;

  if (idempotencyKey) {
    const existing = db
      .prepare('SELECT * FROM processing_jobs WHERE project_id = ? AND idempotency_key = ?')
      .get(project.id, idempotencyKey) as Parameters<typeof serializeProcessingJob>[0] | undefined;
    if (existing) {
      res.status(200).json({ job: serializeProcessingJob(existing) });
      return;
    }
  }

  // Prevent duplicate active jobs on the same project
  const active = db
    .prepare(
      "SELECT * FROM processing_jobs WHERE project_id = ? AND status IN ('queued', 'running') LIMIT 1"
    )
    .get(project.id) as Parameters<typeof serializeProcessingJob>[0] | undefined;

  if (active) {
    res.status(200).json({ job: serializeProcessingJob(active) });
    return;
  }

  const jobId = crypto.randomUUID();
  const now = new Date().toISOString();
  const providerMode = config.geminiApiKey && config.geminiApiKey !== 'MY_GEMINI_API_KEY' ? 'gemini' : 'demo';
  const initialLogs = [
    {
      stage: 'queued',
      label: 'Job queued',
      status: 'completed',
      detail: 'Analysis pipeline scheduled in background worker',
      timestamp: now,
    },
  ];

  db.prepare(
    `INSERT INTO processing_jobs (
      id, project_id, user_id, idempotency_key, status, current_stage, progress_pct,
      provider_mode, is_demo_result, logs_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'queued', 'queued', 5, ?, ?, ?, ?, ?)`
  ).run(
    jobId,
    project.id,
    req.user!.id,
    idempotencyKey,
    providerMode,
    providerMode === 'demo' ? 1 : 0,
    JSON.stringify(initialLogs),
    now,
    now
  );

  db.prepare('UPDATE projects SET status = ?, updated_at = ? WHERE id = ?').run(
    'processing',
    now,
    project.id
  );

  enqueueAnalysisJob(jobId);

  const created = db.prepare('SELECT * FROM processing_jobs WHERE id = ?').get(jobId) as Parameters<
    typeof serializeProcessingJob
  >[0];
  res.status(202).json({ job: serializeProcessingJob(created) });
});

projectRouter.get('/jobs/:jobId', requireAuth, (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const job = db
    .prepare('SELECT * FROM processing_jobs WHERE id = ? AND user_id = ?')
    .get(req.params.jobId, req.user!.id) as Parameters<typeof serializeProcessingJob>[0] | undefined;

  if (!job) {
    res.status(404).json({ error: 'Processing job not found' });
    return;
  }

  res.json({ job: serializeProcessingJob(job) });
});

projectRouter.post('/jobs/:jobId/cancel', requireAuth, (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const job = db
    .prepare('SELECT * FROM processing_jobs WHERE id = ? AND user_id = ?')
    .get(req.params.jobId, req.user!.id) as { id: string; status: string } | undefined;

  if (!job) {
    res.status(404).json({ error: 'Processing job not found' });
    return;
  }

  requestJobCancellation(job.id);
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE processing_jobs SET status = 'cancelled', current_stage = 'cancelled', updated_at = ? WHERE id = ? AND status IN ('queued', 'running')"
  ).run(now, job.id);

  const updated = db.prepare('SELECT * FROM processing_jobs WHERE id = ?').get(job.id) as Parameters<
    typeof serializeProcessingJob
  >[0];
  res.json({ job: serializeProcessingJob(updated) });
});
