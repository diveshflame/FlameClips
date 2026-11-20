import type {
  CaptionSegment,
  CaptionStyle,
  ClipCandidate,
  ClipCategory,
  ClipEdit,
  ClipScoreBreakdown,
  CropMode,
  ExportJob,
  ProcessingJob,
  ProcessingStage,
  ProcessingStepLog,
  ProjectStatus,
  ProjectSummary,
  SourceAsset,
  Speaker,
  TargetPlatform,
  TranscriptSegment,
  UserProfile,
} from '../shared/types.ts';
import { getDb } from './db/client.ts';
import { signMediaUrl } from './security/auth.ts';

export function serializeUser(userRow: {
  id: string;
  email: string;
  name: string;
  default_platforms: string;
  default_caption_preset: string;
  storage_quota_bytes: number;
  created_at: string;
}): UserProfile {
  const db = getDb();
  const usageRow = db
    .prepare(
      `SELECT
         COALESCE((SELECT SUM(file_size_bytes) FROM source_assets WHERE user_id = ?), 0) +
         COALESCE((SELECT SUM(file_size_bytes) FROM exports WHERE user_id = ?), 0) AS total_bytes`
    )
    .get(userRow.id, userRow.id) as { total_bytes: number };

  return {
    id: userRow.id,
    email: userRow.email,
    name: userRow.name,
    defaultPlatforms: JSON.parse(userRow.default_platforms) as TargetPlatform[],
    defaultCaptionPreset: userRow.default_caption_preset as UserProfile['defaultCaptionPreset'],
    storageUsedBytes: Number(usageRow?.total_bytes || 0),
    storageQuotaBytes: Number(userRow.storage_quota_bytes || 2147483648),
    createdAt: userRow.created_at,
  };
}

export function serializeSourceAsset(row: {
  id: string;
  project_id: string;
  user_id: string;
  source_type: string;
  original_filename: string;
  source_url: string | null;
  storage_path: string | null;
  mime_type: string;
  file_size_bytes: number;
  duration_sec: number;
  width: number;
  height: number;
  fps: number;
  has_audio: number;
  rights_confirmed: number;
  metadata_title: string | null;
  metadata_channel: string | null;
  thumbnail_url: string | null;
  created_at: string;
}): SourceAsset {
  return {
    id: row.id,
    projectId: row.project_id,
    userId: row.user_id,
    sourceType: row.source_type as SourceAsset['sourceType'],
    originalFilename: row.original_filename,
    sourceUrl: row.source_url,
    mimeType: row.mime_type,
    fileSizeBytes: row.file_size_bytes,
    durationSec: row.duration_sec,
    width: row.width,
    height: row.height,
    fps: row.fps,
    hasAudio: Boolean(row.has_audio),
    rightsConfirmed: Boolean(row.rights_confirmed),
    metadataTitle: row.metadata_title,
    metadataChannel: row.metadata_channel,
    thumbnailUrl: row.thumbnail_url,
    streamUrl: row.storage_path ? signMediaUrl('source', row.id, row.user_id, 7200) : null,
    createdAt: row.created_at,
  };
}

export function serializeProcessingJob(row: {
  id: string;
  project_id: string;
  user_id: string;
  idempotency_key: string | null;
  status: string;
  current_stage: string;
  progress_pct: number;
  provider_mode: string;
  is_demo_result: number;
  error_message: string | null;
  logs_json: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}): ProcessingJob {
  return {
    id: row.id,
    projectId: row.project_id,
    userId: row.user_id,
    idempotencyKey: row.idempotency_key,
    status: row.status as ProcessingJob['status'],
    currentStage: row.current_stage as ProcessingStage,
    progressPct: row.progress_pct,
    providerMode: (row.provider_mode as 'gemini' | 'demo') || 'demo',
    isDemoResult: Boolean(row.is_demo_result),
    errorMessage: row.error_message,
    logs: JSON.parse(row.logs_json || '[]') as ProcessingStepLog[],
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function serializeProjectSummary(projectRow: {
  id: string;
  user_id: string;
  title: string;
  description: string;
  target_platforms: string;
  preferred_min_sec: number;
  preferred_max_sec: number;
  default_caption_preset: string;
  status: string;
  provider_mode: string;
  created_at: string;
  updated_at: string;
}): ProjectSummary {
  const db = getDb();

  const assetRow = db
    .prepare('SELECT * FROM source_assets WHERE project_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(projectRow.id) as Parameters<typeof serializeSourceAsset>[0] | undefined;

  const jobRow = db
    .prepare('SELECT * FROM processing_jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(projectRow.id) as Parameters<typeof serializeProcessingJob>[0] | undefined;

  const clipCountRow = db
    .prepare('SELECT COUNT(*) AS cnt FROM clip_candidates WHERE project_id = ?')
    .get(projectRow.id) as { cnt: number };

  const exportCountRow = db
    .prepare('SELECT COUNT(*) AS cnt FROM exports WHERE project_id = ?')
    .get(projectRow.id) as { cnt: number };

  return {
    id: projectRow.id,
    userId: projectRow.user_id,
    title: projectRow.title,
    description: projectRow.description,
    targetPlatforms: JSON.parse(projectRow.target_platforms) as TargetPlatform[],
    preferredMinSec: projectRow.preferred_min_sec,
    preferredMaxSec: projectRow.preferred_max_sec,
    defaultCaptionPreset: projectRow.default_caption_preset as ProjectSummary['defaultCaptionPreset'],
    status: projectRow.status as ProjectStatus,
    providerMode: (projectRow.provider_mode as 'gemini' | 'demo') || 'demo',
    createdAt: projectRow.created_at,
    updatedAt: projectRow.updated_at,
    sourceAsset: assetRow ? serializeSourceAsset(assetRow) : null,
    latestJob: jobRow ? serializeProcessingJob(jobRow) : null,
    clipCount: clipCountRow.cnt,
    exportCount: exportCountRow.cnt,
  };
}

export function serializeClipCandidate(
  row: {
    id: string;
    project_id: string;
    editorial_title: string;
    is_editorial_suggestion: number;
    category: string;
    start_ms: number;
    end_ms: number;
    duration_sec: number;
    overall_score: number;
    score_breakdown_json: string;
    explanation: string;
    transcript_excerpt: string;
    hook_quote: string;
    recommended_platforms: string;
    preview_path: string | null;
    created_at: string;
  },
  userId: string
): ClipCandidate {
  const db = getDb();

  const editRow = db
    .prepare('SELECT * FROM clip_edits WHERE clip_candidate_id = ?')
    .get(row.id) as {
    id: string;
    clip_candidate_id: string;
    start_ms: number;
    end_ms: number;
    crop_mode: string;
    focal_point_x: number;
    caption_style_json: string;
    burn_in_captions: number;
    updated_at: string;
  };

  const captionRows = db
    .prepare(
      'SELECT * FROM caption_segments WHERE clip_candidate_id = ? ORDER BY order_index ASC'
    )
    .all(row.id) as Array<{
    id: string;
    clip_candidate_id: string;
    start_ms: number;
    end_ms: number;
    text: string;
    emphasis_word: string | null;
    order_index: number;
  }>;

  const edit: ClipEdit = {
    id: editRow.id,
    clipCandidateId: editRow.clip_candidate_id,
    startMs: editRow.start_ms,
    endMs: editRow.end_ms,
    cropMode: editRow.crop_mode as CropMode,
    focalPointX: editRow.focal_point_x,
    captionStyle: JSON.parse(editRow.caption_style_json) as CaptionStyle,
    burnInCaptions: Boolean(editRow.burn_in_captions),
    updatedAt: editRow.updated_at,
  };

  const captions: CaptionSegment[] = captionRows.map((c) => ({
    id: c.id,
    clipCandidateId: c.clip_candidate_id,
    startMs: c.start_ms,
    endMs: c.end_ms,
    text: c.text,
    emphasisWord: c.emphasis_word,
    orderIndex: c.order_index,
  }));

  return {
    id: row.id,
    projectId: row.project_id,
    editorialTitle: row.editorial_title,
    isEditorialSuggestion: Boolean(row.is_editorial_suggestion),
    category: row.category as ClipCategory,
    startMs: row.start_ms,
    endMs: row.end_ms,
    durationSec: row.duration_sec,
    overallScore: row.overall_score,
    scoreBreakdown: JSON.parse(row.score_breakdown_json) as ClipScoreBreakdown,
    explanation: row.explanation,
    transcriptExcerpt: row.transcript_excerpt,
    hookQuote: row.hook_quote,
    recommendedPlatforms: JSON.parse(row.recommended_platforms) as TargetPlatform[],
    previewUrl: row.preview_path ? signMediaUrl('preview', row.id, userId, 7200) : null,
    edit,
    captions,
    createdAt: row.created_at,
  };
}

export function serializeExportJob(row: {
  id: string;
  project_id: string;
  clip_candidate_id: string;
  user_id: string;
  target_platform: string;
  resolution: string;
  aspect_ratio: string;
  video_codec: string;
  audio_codec: string;
  burn_in_captions: number;
  status: string;
  progress_pct: number;
  storage_path: string | null;
  file_size_bytes: number | null;
  duration_sec: number | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}): ExportJob {
  return {
    id: row.id,
    projectId: row.project_id,
    clipCandidateId: row.clip_candidate_id,
    userId: row.user_id,
    targetPlatform: row.target_platform as TargetPlatform,
    resolution: '1080x1920',
    aspectRatio: '9:16',
    videoCodec: 'h264',
    audioCodec: 'aac',
    burnInCaptions: Boolean(row.burn_in_captions),
    status: row.status as ExportJob['status'],
    progressPct: row.progress_pct,
    fileSizeBytes: row.file_size_bytes,
    durationSec: row.duration_sec,
    errorMessage: row.error_message,
    downloadUrl:
      row.status === 'completed' && row.storage_path
        ? signMediaUrl('export', row.id, row.user_id, 7200)
        : null,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export function serializeSpeakersAndTranscript(projectId: string): {
  speakers: Speaker[];
  transcript: TranscriptSegment[];
} {
  const db = getDb();
  const speakerRows = db
    .prepare('SELECT * FROM speakers WHERE project_id = ?')
    .all(projectId) as Array<{
    id: string;
    project_id: string;
    label: string;
    display_name: string;
    color_hex: string;
  }>;

  const transcriptRows = db
    .prepare('SELECT * FROM transcript_segments WHERE project_id = ? ORDER BY start_ms ASC')
    .all(projectId) as Array<{
    id: string;
    project_id: string;
    speaker_id: string | null;
    speaker_name: string;
    start_ms: number;
    end_ms: number;
    text: string;
    confidence: number;
  }>;

  return {
    speakers: speakerRows.map((s) => ({
      id: s.id,
      projectId: s.project_id,
      label: s.label,
      displayName: s.display_name,
      colorHex: s.color_hex,
    })),
    transcript: transcriptRows.map((t) => ({
      id: t.id,
      projectId: t.project_id,
      speakerId: t.speaker_id,
      speakerName: t.speaker_name,
      startMs: t.start_ms,
      endMs: t.end_ms,
      text: t.text,
      confidence: t.confidence,
    })),
  };
}
