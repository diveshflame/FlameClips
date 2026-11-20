import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.ts';
import { getDb } from '../db/client.ts';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
  };
  sessionToken?: string;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derivedBuf.length) return false;
  return crypto.timingSafeEqual(keyBuf, derivedBuf);
}

export function hashToken(token: string): string {
  return crypto.createHmac('sha256', config.sessionSecret).update(token).digest('hex');
}

export function parseCookies(cookieHeader?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    out[key] = val;
  }
  return out;
}

export function createUserSession(userId: string): { token: string; expiresAt: string } {
  const db = getDb();
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    'INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(crypto.randomUUID(), userId, tokenHash, expiresAt, new Date().toISOString());
  return { token, expiresAt };
}

export function setSessionCookie(res: Response, token: string, expiresAt: string): void {
  res.cookie('clipforge_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.nodeEnv === 'production' && config.appUrl.startsWith('https://'),
    expires: new Date(expiresAt),
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie('clipforge_session', { path: '/' });
}

export function extractSessionToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookies = parseCookies(req.headers.cookie);
  return cookies['clipforge_session'] || null;
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const token = extractSessionToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const db = getDb();
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`
    )
    .get(hashToken(token)) as
    | { id: string; email: string; name: string; expires_at: string }
    | undefined;

  if (!row || new Date(row.expires_at).getTime() <= Date.now()) {
    res.status(401).json({ error: 'Session expired or invalid' });
    return;
  }

  req.user = { id: row.id, email: row.email, name: row.name };
  req.sessionToken = token;
  next();
}

export function signMediaUrl(
  kind: 'source' | 'preview' | 'export',
  resourceId: string,
  userId: string,
  ttlSeconds = 3600
): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${kind}:${resourceId}:${userId}:${exp}`;
  const sig = crypto.createHmac('sha256', config.signedUrlSecret).update(payload).digest('hex');
  return `/api/media/${kind}/${encodeURIComponent(resourceId)}?uid=${encodeURIComponent(userId)}&exp=${exp}&sig=${sig}`;
}

export function verifyMediaSignature(
  kind: 'source' | 'preview' | 'export',
  resourceId: string,
  userId: string,
  expStr: string,
  sig: string
): boolean {
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
    return false;
  }
  const payload = `${kind}:${resourceId}:${userId}:${exp}`;
  const expected = crypto.createHmac('sha256', config.signedUrlSecret).update(payload).digest('hex');
  const sigBuf = Buffer.from(sig, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expectedBuf);
}

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function createRateLimiter(bucketName: string, maxRequests: number, windowMs: number) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const key = `${bucketName}:${req.user?.id || req.ip || 'anon'}`;
    const now = Date.now();
    const entry = rateBuckets.get(key);
    if (!entry || entry.resetAt <= now) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    if (entry.count >= maxRequests) {
      res.status(429).json({
        error: 'Rate limit exceeded. Please wait briefly before retrying.',
      });
      return;
    }
    entry.count += 1;
    next();
  };
}

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    return (
      lower === '::1' ||
      lower === '::' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      lower.startsWith('fe80:') ||
      lower.startsWith('::ffff:127.') ||
      lower.startsWith('::ffff:10.') ||
      lower.startsWith('::ffff:192.168.')
    );
  }
  return true;
}

export async function assertSafePublicUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL format');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Only HTTP/HTTPS URLs are permitted');
  }

  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('Local or internal hostnames are blocked');
  }

  if (net.isIP(host)) {
    if (isPrivateIp(host)) {
      throw new Error('Private network IP addresses are blocked');
    }
    return parsed;
  }

  try {
    const records = await dns.lookup(host, { all: true });
    if (records.length === 0) {
      throw new Error('Could not resolve URL hostname');
    }
    for (const rec of records) {
      if (isPrivateIp(rec.address)) {
        throw new Error('Resolved IP address belongs to a restricted network range');
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('restricted')) {
      throw err;
    }
    // Allow DNS lookup failure to bubble cleanly during validation
    throw new Error('Unable to verify public host DNS');
  }

  return parsed;
}
