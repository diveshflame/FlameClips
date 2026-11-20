import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSafePublicUrl, isPrivateIp } from '../server/security/auth.ts';
import {
  buildCaptionsFromTranscript,
  clampClipBoundaries,
  computeOverallScore,
  deduplicateClipCandidates,
  formatAssTimestamp,
  formatSrtTimestamp,
  formatTimecodeMs,
} from '../server/services/scoring.ts';
import { extractYouTubeVideoId } from '../server/services/sourceAdapter.ts';

test('computeOverallScore weights dimensions and subtracts context integrity penalty', () => {
  const high = computeOverallScore({
    hookStrength: 95,
    standaloneClarity: 90,
    payoff: 90,
    pacing: 85,
    visualSuitability: 80,
    contextIntegrityPenalty: 0,
  });
  const penalized = computeOverallScore({
    hookStrength: 95,
    standaloneClarity: 90,
    payoff: 90,
    pacing: 85,
    visualSuitability: 80,
    contextIntegrityPenalty: 15,
  });

  assert.equal(high, 89.7);
  assert.equal(penalized, 74.7);
});

test('clampClipBoundaries enforces source bounds and minimum 3s span', () => {
  const clamped = clampClipBoundaries(-500, 999000, 45);
  assert.equal(clamped.startMs, 0);
  assert.equal(clamped.endMs, 45000);

  const minSpan = clampClipBoundaries(44000, 44500, 45);
  assert.equal(minSpan.startMs, 42000);
  assert.equal(minSpan.endMs, 45000);
});

test('timestamp formatters produce accurate timecodes', () => {
  assert.equal(formatTimecodeMs(65430), '01:05.43');
  assert.equal(formatSrtTimestamp(3661250), '01:01:01,250');
  assert.equal(formatAssTimestamp(65430), '0:01:05.43');
});

test('deduplicateClipCandidates removes heavily overlapping candidates and keeps diverse ones', () => {
  const deduped = deduplicateClipCandidates([
    {
      startMs: 0,
      endMs: 25000,
      overallScore: 92,
      category: 'hook',
      transcriptExcerpt: 'Fixed thirty second slices break retention and story arcs',
    },
    {
      startMs: 2000,
      endMs: 24000,
      overallScore: 84,
      category: 'hook',
      transcriptExcerpt: 'Fixed thirty second slices break retention',
    },
    {
      startMs: 26000,
      endMs: 48000,
      overallScore: 88,
      category: 'exchange',
      transcriptExcerpt: 'Question setup keeps viewers locked through the payoff',
    },
  ]);

  assert.equal(deduped.length, 2);
  assert.equal(deduped[0].overallScore, 92);
  assert.equal(deduped[1].overallScore, 88);
});

test('buildCaptionsFromTranscript aligns captions relative to clip start', () => {
  const caps = buildCaptionsFromTranscript('clip-1', 10000, 20000, [
    {
      id: 't1',
      projectId: 'p1',
      speakerId: null,
      speakerName: 'Host',
      startMs: 10000,
      endMs: 15000,
      text: 'This is a clear standalone insight for short form creators',
      confidence: 0.95,
    },
  ]);
  assert.ok(caps.length >= 1);
  assert.equal(caps[0].startMs, 0);
  assert.ok(caps[caps.length - 1].endMs <= 10000);
});

test('YouTube URL parser and SSRF IP checks reject private and malformed inputs', async () => {
  assert.equal(extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeVideoId('https://youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeVideoId('https://evil.com/watch?v=dQw4w9WgXcQ'), null);

  assert.equal(isPrivateIp('127.0.0.1'), true);
  assert.equal(isPrivateIp('10.0.0.5'), true);
  assert.equal(isPrivateIp('192.168.1.1'), true);
  assert.equal(isPrivateIp('169.254.169.254'), true);
  assert.equal(isPrivateIp('8.8.8.8'), false);

  await assert.rejects(() => assertSafePublicUrl('http://localhost:3000/test'), /blocked/i);
  await assert.rejects(() => assertSafePublicUrl('http://127.0.0.1/secret'), /blocked/i);
  await assert.rejects(() => assertSafePublicUrl('file:///etc/passwd'), /HTTP/i);
});
