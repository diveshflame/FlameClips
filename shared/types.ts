export type TargetPlatform = 'youtube_shorts' | 'instagram_reels';

export type ProjectStatus =
  | 'draft'
  | 'ready_for_analysis'
  | 'processing'
  | 'completed'
  | 'failed';

export type ProcessingStage =
  | 'queued'
  | 'inspecting_media'
  | 'extracting_audio'
  | 'transcribing'
  | 'analyzing_moments'
  | 'ranking_candidates'
  | 'generating_previews'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ClipCategory =
  | 'hook'
  | 'insight'
  | 'reaction'
  | 'story'
  | 'exchange'
  | 'humor';

export type CropMode = 'auto_speaker' | 'center' | 'fit_blur' | 'custom_focal';

export type CaptionPreset = 'kinetic_bold' | 'clean_studio' | 'editorial_serif' | 'minimal_bottom';

export interface CaptionStyle {
  preset: CaptionPreset;
  fontSize: number;
  highlightColor: string;
  textColor: string;
  position: 'bottom' | 'center' | 'top';
  uppercase: boolean;
  showBackground: boolean;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  defaultPlatforms: TargetPlatform[];
  defaultCaptionPreset: CaptionPreset;
  storageUsedBytes: number;
  storageQuotaBytes: number;
  createdAt: string;
}

export interface ProjectSummary {
  id: string;
  userId: string;
  title: string;
  description: string;
  targetPlatforms: TargetPlatform[];
  preferredMinSec: number;
  preferredMaxSec: number;
  defaultCaptionPreset: CaptionPreset;
  status: ProjectStatus;
  providerMode: 'gemini' | 'demo';
  createdAt: string;
  updatedAt: string;
  sourceAsset: SourceAsset | null;
  latestJob: ProcessingJob | null;
  clipCount: number;
  exportCount: number;
}

export interface SourceAsset {
  id: string;
  projectId: string;
  userId: string;
  sourceType: 'upload' | 'youtube_metadata' | 'sample_studio';
  originalFilename: string;
  sourceUrl: string | null;
  mimeType: string;
  fileSizeBytes: number;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  rightsConfirmed: boolean;
  metadataTitle: string | null;
  metadataChannel: string | null;
  thumbnailUrl: string | null;
  streamUrl: string | null;
  createdAt: string;
}

export interface ProcessingStepLog {
  stage: ProcessingStage;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  detail: string;
  timestamp: string;
}

export interface ProcessingJob {
  id: string;
  projectId: string;
  userId: string;
  idempotencyKey: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  currentStage: ProcessingStage;
  progressPct: number;
  providerMode: 'gemini' | 'demo';
  isDemoResult: boolean;
  errorMessage: string | null;
  logs: ProcessingStepLog[];
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Speaker {
  id: string;
  projectId: string;
  label: string;
  displayName: string;
  colorHex: string;
}

export interface TranscriptSegment {
  id: string;
  projectId: string;
  speakerId: string | null;
  speakerName: string;
  startMs: number;
  endMs: number;
  text: string;
  confidence: number;
}

export interface ClipScoreBreakdown {
  hookStrength: number;
  standaloneClarity: number;
  payoff: number;
  pacing: number;
  visualSuitability: number;
  contextIntegrityPenalty: number;
}

export interface CaptionSegment {
  id: string;
  clipCandidateId: string;
  startMs: number;
  endMs: number;
  text: string;
  emphasisWord: string | null;
  orderIndex: number;
}

export interface ClipEdit {
  id: string;
  clipCandidateId: string;
  startMs: number;
  endMs: number;
  cropMode: CropMode;
  focalPointX: number; // 0.0 to 1.0
  captionStyle: CaptionStyle;
  burnInCaptions: boolean;
  updatedAt: string;
}

export interface ClipCandidate {
  id: string;
  projectId: string;
  editorialTitle: string;
  isEditorialSuggestion: boolean;
  category: ClipCategory;
  startMs: number;
  endMs: number;
  durationSec: number;
  overallScore: number;
  scoreBreakdown: ClipScoreBreakdown;
  explanation: string;
  transcriptExcerpt: string;
  hookQuote: string;
  recommendedPlatforms: TargetPlatform[];
  previewUrl: string | null;
  edit: ClipEdit;
  captions: CaptionSegment[];
  createdAt: string;
}

export interface ExportJob {
  id: string;
  projectId: string;
  clipCandidateId: string;
  userId: string;
  targetPlatform: TargetPlatform;
  resolution: '1080x1920';
  aspectRatio: '9:16';
  videoCodec: 'h264';
  audioCodec: 'aac';
  burnInCaptions: boolean;
  status: 'queued' | 'rendering' | 'completed' | 'failed';
  progressPct: number;
  fileSizeBytes: number | null;
  durationSec: number | null;
  errorMessage: string | null;
  downloadUrl: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface SourceValidationResult {
  valid: boolean;
  kind: 'youtube_url' | 'unsupported_url';
  normalizedUrl: string | null;
  videoId: string | null;
  mediaDownloadSupported: boolean;
  title: string | null;
  channelName: string | null;
  thumbnailUrl: string | null;
  message: string;
  actionRequired: 'upload_authorized_file' | 'none';
}

export interface ProviderStatusInfo {
  geminiConfigured: boolean;
  transcribeModel: string;
  analysisModel: string;
  ffmpegAvailable: boolean;
  ffprobeAvailable: boolean;
  storageDir: string;
}

export interface ProjectDetailResponse {
  project: ProjectSummary;
  speakers: Speaker[];
  transcript: TranscriptSegment[];
  clips: ClipCandidate[];
  exports: ExportJob[];
}
