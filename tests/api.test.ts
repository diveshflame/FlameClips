import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clipforge-test-'));
process.env.CLIPFORGE_TEST_MODE = '1';
process.env.STORAGE_DIR = tmpRoot;
process.env.DATABASE_PATH = path.join(tmpRoot, 'test.db');
process.env.GEMINI_API_KEY = '';

const { createApp } = await import('../server.ts');
const { closeDb } = await import('../server/db/client.ts');
const { inspectVideo } = await import('../server/services/mediaPipeline.ts');

let baseUrl = '';
let server: ReturnType<ReturnType<typeof createApp>['listen']>;

test.before(async () => {
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  closeDb();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

async function apiJson<T>(
  route: string,
  opts: { method?: string; body?: unknown; token?: string } = {}
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;

  const res = await fetch(`${baseUrl}${route}`, {
    method: opts.method || 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = (await res.json()) as T;
  return { status: res.status, data };
}

test('End-to-end happy path: auth isolation, upload, analysis, edit, and 1080x1920 MP4 export', async () => {
  // 1. Signup User A and User B
  const signupA = await apiJson<{ user: { id: string }; token: string }>('/api/auth/signup', {
    method: 'POST',
    body: { email: 'alice@example.com', password: 'Password123!', name: 'Alice' },
  });
  assert.equal(signupA.status, 201);
  const tokenA = signupA.data.token;

  const signupB = await apiJson<{ user: { id: string }; token: string }>('/api/auth/signup', {
    method: 'POST',
    body: { email: 'bob@example.com', password: 'Password123!', name: 'Bob' },
  });
  assert.equal(signupB.status, 201);
  const tokenB = signupB.data.token;

  // 2. Rights-aware source validation
  const ytVal = await apiJson<{ valid: boolean; mediaDownloadSupported: boolean; videoId: string }>(
    '/api/sources/validate',
    {
      method: 'POST',
      token: tokenA,
      body: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
    }
  );
  assert.equal(ytVal.status, 200);
  assert.equal(ytVal.data.valid, true);
  assert.equal(ytVal.data.mediaDownloadSupported, false);
  assert.equal(ytVal.data.videoId, 'dQw4w9WgXcQ');

  // 3. Create project as User A
  const createProj = await apiJson<{ project: { id: string } }>('/api/projects', {
    method: 'POST',
    token: tokenA,
    body: {
      title: 'E2E Test Studio Project',
      targetPlatforms: ['youtube_shorts', 'instagram_reels'],
    },
  });
  assert.equal(createProj.status, 201);
  const projectId = createProj.data.project.id;

  // 4. Enforce per-user ownership isolation (User B cannot access User A's project)
  const forbiddenRead = await apiJson<{ error: string }>(`/api/projects/${projectId}`, {
    token: tokenB,
  });
  assert.equal(forbiddenRead.status, 404);

  // 5. Generate a real 12-second 640x360 MP4 fixture using FFmpeg and upload it
  const fixturePath = path.join(tmpRoot, 'fixture.mp4');
  await execFileAsync('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=640x360:rate=24:duration=12',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=44100:duration=12',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    fixturePath,
  ]);

  const form = new FormData();
  const blob = new Blob([fs.readFileSync(fixturePath)], { type: 'video/mp4' });
  form.append('file', blob, 'fixture.mp4');
  form.append('rightsConfirmed', 'true');

  const uploadRes = await fetch(`${baseUrl}/api/projects/${projectId}/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: form,
  });
  assert.equal(uploadRes.status, 201);
  const uploadJson = (await uploadRes.json()) as {
    asset: { width: number; height: number; durationSec: number };
  };
  assert.equal(uploadJson.asset.width, 640);
  assert.equal(uploadJson.asset.height, 360);

  // 6. Start analysis job with idempotency key
  const startJob1 = await apiJson<{ job: { id: string } }>(
    `/api/projects/${projectId}/analyze`,
    {
      method: 'POST',
      token: tokenA,
      body: { idempotencyKey: 'e2e-key-1' },
    }
  );
  assert.equal(startJob1.status, 202);
  const startJob2 = await apiJson<{ job: { id: string } }>(
    `/api/projects/${projectId}/analyze`,
    {
      method: 'POST',
      token: tokenA,
      body: { idempotencyKey: 'e2e-key-1' },
    }
  );
  assert.equal(startJob2.data.job.id, startJob1.data.job.id);

  // 7. Poll job until completed
  let jobStatus = 'queued';
  for (let i = 0; i < 40; i++) {
    const poll = await apiJson<{ job: { status: string; errorMessage: string | null } }>(
      `/api/jobs/${startJob1.data.job.id}`,
      { token: tokenA }
    );
    jobStatus = poll.data.job.status;
    if (jobStatus === 'completed' || jobStatus === 'failed') {
      assert.equal(poll.data.job.errorMessage, null);
      break;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.equal(jobStatus, 'completed');

  // 8. Fetch project detail, verify clips & transcript
  const detail = await apiJson<{
    transcript: Array<{ text: string }>;
    clips: Array<{ id: string; overallScore: number; captions: Array<{ text: string }> }>;
  }>(`/api/projects/${projectId}`, { token: tokenA });
  assert.equal(detail.status, 200);
  assert.ok(detail.data.transcript.length >= 1);
  assert.ok(detail.data.clips.length >= 1);
  const firstClip = detail.data.clips[0];

  // 9. Edit boundaries and captions
  const patchClip = await apiJson<{ clip: { edit: { startMs: number; endMs: number; cropMode: string } } }>(
    `/api/clips/${firstClip.id}`,
    {
      method: 'PATCH',
      token: tokenA,
      body: { startMs: 500, endMs: 8500, cropMode: 'fit_blur' },
    }
  );
  assert.equal(patchClip.status, 200);
  assert.equal(patchClip.data.clip.edit.startMs, 500);
  assert.equal(patchClip.data.clip.edit.endMs, 8500);
  assert.equal(patchClip.data.clip.edit.cropMode, 'fit_blur');

  const putCaps = await apiJson<{ clip: { captions: Array<{ text: string }> } }>(
    `/api/clips/${firstClip.id}/captions`,
    {
      method: 'PUT',
      token: tokenA,
      body: {
        captions: [
          { startMs: 0, endMs: 3000, text: 'Edited caption verification line', emphasisWord: 'verification' },
        ],
      },
    }
  );
  assert.equal(putCaps.status, 200);
  assert.equal(putCaps.data.clip.captions[0].text, 'Edited caption verification line');

  // 10. Start 1080x1920 MP4 export and verify downloaded output via ffprobe
  const exportStart = await apiJson<{ export: { id: string } }>(
    `/api/clips/${firstClip.id}/export`,
    {
      method: 'POST',
      token: tokenA,
      body: { targetPlatform: 'youtube_shorts', burnInCaptions: true },
    }
  );
  assert.equal(exportStart.status, 202);

  let downloadUrl: string | null = null;
  for (let i = 0; i < 120; i++) {
    const expPoll = await apiJson<{
      export: { status: string; downloadUrl: string | null; errorMessage: string | null };
    }>(`/api/exports/${exportStart.data.export.id}`, { token: tokenA });
    if (expPoll.data.export.status === 'completed') {
      downloadUrl = expPoll.data.export.downloadUrl;
      break;
    }
    if (expPoll.data.export.status === 'failed') {
      assert.fail(`Export failed: ${expPoll.data.export.errorMessage}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  assert.ok(downloadUrl, 'Expected signed export download URL');

  const mp4Res = await fetch(`${baseUrl}${downloadUrl}&download=1`);
  assert.equal(mp4Res.status, 200);
  const mp4Buf = Buffer.from(await mp4Res.arrayBuffer());
  const downloadedPath = path.join(tmpRoot, 'exported_9x16.mp4');
  fs.writeFileSync(downloadedPath, mp4Buf);

  const probe = await inspectVideo(downloadedPath);
  assert.equal(probe.width, 1080);
  assert.equal(probe.height, 1920);
  assert.equal(probe.videoCodec, 'h264');
  assert.equal(probe.hasAudio, true);
});
