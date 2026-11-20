import crypto from 'node:crypto';
import fs from 'node:fs';
import express from 'express';
import { z } from 'zod';
import { config } from '../config.ts';
import { getDb } from '../db/client.ts';
import { DEMO_USER_EMAIL, seedDemoWorkspace } from '../seed.ts';
import {
  clearSessionCookie,
  createRateLimiter,
  createUserSession,
  hashPassword,
  hashToken,
  requireAuth,
  setSessionCookie,
  verifyPassword,
  type AuthenticatedRequest,
} from '../security/auth.ts';
import { serializeUser } from '../serializers.ts';

export const authRouter = express.Router();

const authLimiter = createRateLimiter('auth', 30, 60_000);

const signupSchema = z.object({
  email: z.string().email().max(180),
  password: z.string().min(8).max(128),
  name: z.string().trim().min(2).max(80),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const settingsSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  defaultPlatforms: z.array(z.enum(['youtube_shorts', 'instagram_reels'])).min(1).optional(),
  defaultCaptionPreset: z
    .enum(['kinetic_bold', 'clean_studio', 'editorial_serif', 'minimal_bottom'])
    .optional(),
});

authRouter.post('/signup', authLimiter, (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid signup input' });
    return;
  }

  const db = getDb();
  const normalizedEmail = parsed.data.email.trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) {
    res.status(409).json({ error: 'An account with this email already exists.' });
    return;
  }

  const userId = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, email, name, password_hash, storage_quota_bytes, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    userId,
    normalizedEmail,
    parsed.data.name,
    hashPassword(parsed.data.password),
    config.maxUserStorageBytes,
    now
  );

  const session = createUserSession(userId);
  setSessionCookie(res, session.token, session.expiresAt);

  const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as Parameters<
    typeof serializeUser
  >[0];
  res.status(201).json({ user: serializeUser(userRow), token: session.token });
});

authRouter.post('/login', authLimiter, (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }

  const db = getDb();
  const userRow = db
    .prepare('SELECT * FROM users WHERE email = ?')
    .get(parsed.data.email.trim().toLowerCase()) as
    | (Parameters<typeof serializeUser>[0] & { password_hash: string })
    | undefined;

  if (!userRow || !verifyPassword(parsed.data.password, userRow.password_hash)) {
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }

  const session = createUserSession(userRow.id);
  setSessionCookie(res, session.token, session.expiresAt);
  res.json({ user: serializeUser(userRow), token: session.token });
});

authRouter.post('/demo', authLimiter, async (_req, res) => {
  await seedDemoWorkspace();
  const db = getDb();
  const userRow = db
    .prepare('SELECT * FROM users WHERE email = ?')
    .get(DEMO_USER_EMAIL) as Parameters<typeof serializeUser>[0] | undefined;

  if (!userRow) {
    res.status(500).json({ error: 'Demo workspace failed to initialize' });
    return;
  }

  const session = createUserSession(userRow.id);
  setSessionCookie(res, session.token, session.expiresAt);
  res.json({ user: serializeUser(userRow), token: session.token });
});

authRouter.post('/logout', (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/clipforge_session=([^;]+)/);
  const token =
    (req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7).trim()
      : null) || (match ? decodeURIComponent(match[1]) : null);

  if (token) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const userRow = db
    .prepare('SELECT * FROM users WHERE id = ?')
    .get(req.user!.id) as Parameters<typeof serializeUser>[0];
  res.json({ user: serializeUser(userRow) });
});

authRouter.patch('/settings', requireAuth, (req: AuthenticatedRequest, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid settings payload' });
    return;
  }

  const db = getDb();
  const current = db
    .prepare('SELECT * FROM users WHERE id = ?')
    .get(req.user!.id) as Parameters<typeof serializeUser>[0];

  const nextName = parsed.data.name ?? current.name;
  const nextPlatforms = parsed.data.defaultPlatforms
    ? JSON.stringify(parsed.data.defaultPlatforms)
    : current.default_platforms;
  const nextPreset = parsed.data.defaultCaptionPreset ?? current.default_caption_preset;

  db.prepare(
    'UPDATE users SET name = ?, default_platforms = ?, default_caption_preset = ? WHERE id = ?'
  ).run(nextName, nextPlatforms, nextPreset, req.user!.id);

  const updated = db
    .prepare('SELECT * FROM users WHERE id = ?')
    .get(req.user!.id) as Parameters<typeof serializeUser>[0];
  res.json({ user: serializeUser(updated) });
});

authRouter.delete('/account', requireAuth, (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const userId = req.user!.id;

  const assets = db
    .prepare('SELECT storage_path FROM source_assets WHERE user_id = ?')
    .all(userId) as Array<{ storage_path: string | null }>;
  const previews = db
    .prepare(
      `SELECT c.preview_path FROM clip_candidates c
       JOIN projects p ON p.id = c.project_id
       WHERE p.user_id = ?`
    )
    .all(userId) as Array<{ preview_path: string | null }>;
  const exportsRows = db
    .prepare('SELECT storage_path FROM exports WHERE user_id = ?')
    .all(userId) as Array<{ storage_path: string | null }>;

  for (const row of [...assets, ...exportsRows]) {
    if (row.storage_path && fs.existsSync(row.storage_path)) {
      try {
        fs.unlinkSync(row.storage_path);
      } catch {
        // ignore file cleanup failure
      }
    }
  }
  for (const p of previews) {
    if (p.preview_path && fs.existsSync(p.preview_path)) {
      try {
        fs.unlinkSync(p.preview_path);
      } catch {
        // ignore file cleanup failure
      }
    }
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  clearSessionCookie(res);
  res.json({ deleted: true });
});
