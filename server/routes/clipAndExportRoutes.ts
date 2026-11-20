import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { z } from 'zod';
import type { CaptionStyle, CropMode } from '../../shared/types.ts';
import { config } from '../config.ts';
import { getDb } from '../db/client.ts';
import {
  createRateLimiter,
  requireAuth,
  verifyMediaSignature,
  type AuthenticatedRequest,
} from '../security/auth.ts';
import { serializeClipCandidate, serializeExportJob } from '../serializers.ts';
import { enqueueExportJob } from '../services/jobWorker.ts';
import { checkMediaBinaries, renderVerticalClip } from '../services/mediaPipeline.ts';
import { clampClipBoundaries } from '../services/scoring.ts';

export const clipAndExportRouter = express.Router();

const exportLimiter = createRateLimiter('export', 25, 60_000);

const clipUpdateSchema = z.object({
  startMs: z.number().int().min(0).optional(),
  endMs: z.number().int().min(1000).optional(),
  cropMode: z.enum(['auto_speaker', 'center', 'fit_blur', 'custom_focal']).optional(),
  focalPointX: z.number().min(0).max(1).optional(),
  burnInCaptions: z.boolean().optional(),
  captionStyle: z
    .object({
      preset: z.enum(['kinetic_bold', 'clean_studio', 'editorial_serif', 'minimal_bottom']),
      fontSize: z.number().int().min(14).max(40),
      highlightColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
      textColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
      position: z.enum(['bottom', 'center', 'top']),
      uppercase: z.boolean(),
      showBackground: z.boolean(),
    })
    .optional(),
});

const captionsUpdateSchema = z.object({
  captions: z.array(
    z.object({
      id: z.string().optional(),
      startMs: z.number().int().min(0),
      endMs: z.number().int().min(100),
      text: z.string().trim().min(1).max(240),
      emphasisWord: z.string().trim().max(40).nullable().optional(),
    })
  ),
});

const createExportSchema = z.object({
  targetPlatform: z.enum(['youtube_shorts', 'instagram_reels']),
  burnInCaptions: z.boolean().optional().default(true),
});

function loadOwnedClip(clipId: string, userId: string) {
  const db = getDb();
  return db
    .prepare(
      `SELECT c.*, p.user_id AS owner_id
       FROM clip_candidates c
       JOIN projects p ON p.id = c.project_id
       WHERE c.id = ? AND p.user_id = ?`
    )
    .get(clipId, userId) as
    | (Parameters<typeof serializeClipCandidate>[0] & { owner_id: string })
    | undefined;
}

clipAndExportRouter.patch('/clips/:clipId', requireAuth, async (req: AuthenticatedRequest, res) => {
  const parsed = clipUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid clip edit payload' });
    return;
  }

  const clipRow = loadOwnedClip(String(req.params.clipId), req.user!.id);
  if (!clipRow) {
    res.status(404).json({ error: 'Clip candidate not found' });
    return;
  }

  const db = getDb();
  const editRow = db
    .prepare('SELECT * FROM clip_edits WHERE clip_candidate_id = ?')
    .get(clipRow.id) as {
    id: string;
    start_ms: number;
    end_ms: number;
    crop_mode: CropMode;
    focal_point_x: number;
    caption_style_json: string;
    burn_in_captions: number;
  };

  const asset = db
    .prepare('SELECT storage_path, duration_sec, has_audio FROM source_assets WHERE project_id = ? LIMIT 1')
    .get(clipRow.project_id) as
    | { storage_path: string | null; duration_sec: number; has_audio: number }
    | undefined;

  const nextBounds = clampClipBoundaries(
    parsed.data.startMs ?? editRow.start_ms,
    parsed.data.endMs ?? editRow.end_ms,
    asset?.duration_sec || 600
  );

  const nextCropMode = (parsed.data.cropMode ?? editRow.crop_mode) as CropMode;
  const nextFocalX = parsed.data.focalPointX ?? editRow.focal_point_x;
  const nextStyle = (parsed.data.captionStyle ??
    JSON.parse(editRow.caption_style_json)) as CaptionStyle;
  const nextBurnIn =
    parsed.data.burnInCaptions === undefined
      ? Boolean(editRow.burn_in_captions)
      : parsed.data.burnInCaptions;

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE clip_edits
     SET start_ms = ?, end_ms = ?, crop_mode = ?, focal_point_x = ?,
         caption_style_json = ?, burn_in_captions = ?, updated_at = ?
     WHERE clip_candidate_id = ?`
  ).run(
    nextBounds.startMs,
    nextBounds.endMs,
    nextCropMode,
    nextFocalX,
    JSON.stringify(nextStyle),
    nextBurnIn ? 1 : 0,
    now,
    clipRow.id
  );

  const durationSec = Math.round(((nextBounds.endMs - nextBounds.startMs) / 1000) * 10) / 10;
  db.prepare('UPDATE clip_candidates SET start_ms = ?, end_ms = ?, duration_sec = ? WHERE id = ?').run(
    nextBounds.startMs,
    nextBounds.endMs,
    durationSec,
    clipRow.id
  );

  const geometryChanged =
    nextBounds.startMs !== editRow.start_ms ||
    nextBounds.endMs !== editRow.end_ms ||
    nextCropMode !== editRow.crop_mode ||
    Math.abs(nextFocalX - editRow.focal_point_x) > 0.02;

  if (geometryChanged && asset?.storage_path && fs.existsSync(asset.storage_path)) {
    const previewPath = path.join(config.previewsDir, `${clipRow.id}.mp4`);
    try {
      await renderVerticalClip({
        sourcePath: asset.storage_path,
        outputPath: previewPath,
        startMs: nextBounds.startMs,
        endMs: nextBounds.endMs,
        cropMode: nextCropMode,
        focalPointX: nextFocalX,
        captions: [],
        captionStyle: nextStyle,
        burnInCaptions: false,
        isPreview: true,
        sourceHasAudio: Boolean(asset.has_audio),
      });
      db.prepare('UPDATE clip_candidates SET preview_path = ? WHERE id = ?').run(
        previewPath,
        clipRow.id
      );
    } catch {
      // Keep existing preview if re-render fails transiently
    }
  }

  const updatedRow = db
    .prepare('SELECT * FROM clip_candidates WHERE id = ?')
    .get(clipRow.id) as Parameters<typeof serializeClipCandidate>[0];
  res.json({ clip: serializeClipCandidate(updatedRow, req.user!.id) });
});

clipAndExportRouter.put('/clips/:clipId/captions', requireAuth, (req: AuthenticatedRequest, res) => {
  const parsed = captionsUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid captions payload' });
    return;
  }

  const clipRow = loadOwnedClip(String(req.params.clipId), req.user!.id);
  if (!clipRow) {
    res.status(404).json({ error: 'Clip candidate not found' });
    return;
  }

  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM caption_segments WHERE clip_candidate_id = ?').run(clipRow.id);
    parsed.data.captions.forEach((cap, idx) => {
      db.prepare(
        `INSERT INTO caption_segments (id, clip_candidate_id, start_ms, end_ms, text, emphasis_word, order_index)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        crypto.randomUUID(),
        clipRow.id,
        cap.startMs,
        Math.max(cap.startMs + 250, cap.endMs),
        cap.text,
        cap.emphasisWord ?? null,
        idx
      );
    });
  });
  tx();

  const updatedRow = db
    .prepare('SELECT * FROM clip_candidates WHERE id = ?')
    .get(clipRow.id) as Parameters<typeof serializeClipCandidate>[0];
  res.json({ clip: serializeClipCandidate(updatedRow, req.user!.id) });
});

clipAndExportRouter.post(
  '/clips/:clipId/export',
  requireAuth,
  exportLimiter,
  (req: AuthenticatedRequest, res) => {
    const parsed = createExportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid export options' });
      return;
    }

    const clipRow = loadOwnedClip(String(req.params.clipId), req.user!.id);
    if (!clipRow) {
      res.status(404).json({ error: 'Clip candidate not found' });
      return;
    }

    const db = getDb();
    const exportId = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO exports (
        id, project_id, clip_candidate_id, user_id, target_platform, resolution, aspect_ratio,
        video_codec, audio_codec, burn_in_captions, status, progress_pct, created_at
      ) VALUES (?, ?, ?, ?, ?, '1080x1920', '9:16', 'h264', 'aac', ?, 'queued', 5, ?)`
    ).run(
      exportId,
      clipRow.project_id,
      clipRow.id,
      req.user!.id,
      parsed.data.targetPlatform,
      parsed.data.burnInCaptions ? 1 : 0,
      now
    );

    enqueueExportJob(exportId);

    const created = db.prepare('SELECT * FROM exports WHERE id = ?').get(exportId) as Parameters<
      typeof serializeExportJob
    >[0];
    res.status(202).json({ export: serializeExportJob(created) });
  }
);

clipAndExportRouter.get('/exports/:exportId', requireAuth, (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM exports WHERE id = ? AND user_id = ?')
    .get(req.params.exportId, req.user!.id) as Parameters<typeof serializeExportJob>[0] | undefined;

  if (!row) {
    res.status(404).json({ error: 'Export job not found' });
    return;
  }

  res.json({ export: serializeExportJob(row) });
});

clipAndExportRouter.post('/exports/:exportId/retry', requireAuth, (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM exports WHERE id = ? AND user_id = ?')
    .get(req.params.exportId, req.user!.id) as { id: string } | undefined;

  if (!row) {
    res.status(404).json({ error: 'Export job not found' });
    return;
  }

  db.prepare(
    "UPDATE exports SET status = 'queued', progress_pct = 5, error_message = NULL WHERE id = ?"
  ).run(row.id);

  enqueueExportJob(row.id);

  const updated = db.prepare('SELECT * FROM exports WHERE id = ?').get(row.id) as Parameters<
    typeof serializeExportJob
  >[0];
  res.status(202).json({ export: serializeExportJob(updated) });
});

clipAndExportRouter.get('/media/:kind/:resourceId', (req, res) => {
  const kind = req.params.kind;
  const resourceId = req.params.resourceId;
  const uid = String(req.query.uid || '');
  const exp = String(req.query.exp || '');
  const sig = String(req.query.sig || '');

  if (kind !== 'source' && kind !== 'preview' && kind !== 'export') {
    res.status(400).json({ error: 'Invalid media kind' });
    return;
  }

  if (!verifyMediaSignature(kind, resourceId, uid, exp, sig)) {
    res.status(403).json({ error: 'Signed media URL is invalid or expired' });
    return;
  }

  const db = getDb();
  let filePath: string | null = null;
  let downloadName: string | null = null;

  if (kind === 'source') {
    const row = db
      .prepare('SELECT storage_path, original_filename FROM source_assets WHERE id = ? AND user_id = ?')
      .get(resourceId, uid) as { storage_path: string | null; original_filename: string } | undefined;
    filePath = row?.storage_path || null;
  } else if (kind === 'preview') {
    const row = db
      .prepare(
        `SELECT c.preview_path FROM clip_candidates c
         JOIN projects p ON p.id = c.project_id
         WHERE c.id = ? AND p.user_id = ?`
      )
      .get(resourceId, uid) as { preview_path: string | null } | undefined;
    filePath = row?.preview_path || null;
  } else if (kind === 'export') {
    const row = db
      .prepare('SELECT storage_path, target_platform FROM exports WHERE id = ? AND user_id = ?')
      .get(resourceId, uid) as { storage_path: string | null; target_platform: string } | undefined;
    filePath = row?.storage_path || null;
    if (row) {
      downloadName = `clipforge_${row.target_platform}_${resourceId.slice(0, 8)}_1080x1920.mp4`;
    }
  }

  if (!filePath || !fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Media file not found' });
    return;
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=300');
  if (kind === 'export' && req.query.download === '1' && downloadName) {
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
  }

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    if (Number.isNaN(start) || start >= fileSize || end >= fileSize || start > end) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
      return;
    }
    const chunkSize = end - start + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Content-Length': chunkSize,
      'Content-Type': 'video/mp4',
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    'Content-Length': fileSize,
    'Content-Type': 'video/mp4',
  });
  fs.createReadStream(filePath).pipe(res);
});

clipAndExportRouter.get('/system/providers', requireAuth, async (_req, res) => {
  const binaries = await checkMediaBinaries();
  res.json({
    geminiConfigured: Boolean(config.geminiApiKey && config.geminiApiKey !== 'MY_GEMINI_API_KEY'),
    transcribeModel: config.geminiTranscribeModel,
    analysisModel: config.geminiAnalysisModel,
    ffmpegAvailable: binaries.ffmpegAvailable,
    ffprobeAvailable: binaries.ffprobeAvailable,
    storageDir: config.storageRoot,
  });
});
