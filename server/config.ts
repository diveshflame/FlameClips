import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const storageRoot = path.resolve(process.env.STORAGE_DIR || './storage');

export const config = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  geminiApiKey: (process.env.GEMINI_API_KEY || '').trim(),
  geminiTranscribeModel: process.env.GEMINI_TRANSCRIBE_MODEL || 'gemini-3.5-transcribe',
  geminiAnalysisModel: process.env.GEMINI_ANALYSIS_MODEL || 'gemini-4-hydrogen',
  sessionSecret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  signedUrlSecret: process.env.SIGNED_URL_SECRET || crypto.randomBytes(32).toString('hex'),
  storageRoot,
  uploadsDir: path.join(storageRoot, 'uploads'),
  previewsDir: path.join(storageRoot, 'previews'),
  exportsDir: path.join(storageRoot, 'exports'),
  tempDir: path.join(storageRoot, 'temp'),
  demoDir: path.join(storageRoot, 'demo'),
  databasePath: path.resolve(process.env.DATABASE_PATH || path.join(storageRoot, 'clipforge.db')),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 500) * 1024 * 1024,
  maxUserStorageBytes: Number(process.env.MAX_USER_STORAGE_MB || 2048) * 1024 * 1024,
};

export function ensureStorageDirectories(): void {
  for (const dir of [
    config.storageRoot,
    config.uploadsDir,
    config.previewsDir,
    config.exportsDir,
    config.tempDir,
    config.demoDir,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
