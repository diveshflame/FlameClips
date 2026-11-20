import type { CaptionSegment, ClipScoreBreakdown, TranscriptSegment } from '../../shared/types.ts';

export function computeOverallScore(b: ClipScoreBreakdown): number {
  const positive =
    b.hookStrength * 0.28 +
    b.standaloneClarity * 0.24 +
    b.payoff * 0.24 +
    b.pacing * 0.14 +
    b.visualSuitability * 0.1;

  const penalized = positive - b.contextIntegrityPenalty;
  return Math.round(Math.max(0, Math.min(100, penalized)) * 10) / 10;
}

export function clampClipBoundaries(
  startMs: number,
  endMs: number,
  sourceDurationSec: number
): { startMs: number; endMs: number } {
  const maxMs = Math.max(5000, Math.round(sourceDurationSec * 1000));
  const safeStart = Math.max(0, Math.min(Math.round(startMs), maxMs - 3000));
  const safeEnd = Math.max(safeStart + 3000, Math.min(Math.round(endMs), maxMs));
  return { startMs: safeStart, endMs: safeEnd };
}

export function formatTimecodeMs(ms: number): string {
  const totalSec = Math.max(0, ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = Math.floor(totalSec % 60);
  const hundredths = Math.floor((totalSec * 100) % 100);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

export function formatSrtTimestamp(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const hours = Math.floor(clamped / 3600000);
  const mins = Math.floor((clamped % 3600000) / 60000);
  const secs = Math.floor((clamped % 60000) / 1000);
  const millis = clamped % 1000;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

export function formatAssTimestamp(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const hours = Math.floor(clamped / 3600000);
  const mins = Math.floor((clamped % 3600000) / 60000);
  const secs = Math.floor((clamped % 60000) / 1000);
  const centis = Math.floor((clamped % 1000) / 10);
  return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
}

export function computeTemporalOverlapRatio(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): number {
  const overlap = Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
  const minDur = Math.max(1, Math.min(aEnd - aStart, bEnd - bStart));
  return overlap / minDur;
}

export function computeTextJaccard(aText: string, bText: string): number {
  const a = tokenize(aText);
  const b = tokenize(bText);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface RawScoredCandidate {
  startMs: number;
  endMs: number;
  overallScore: number;
  category: string;
  transcriptExcerpt: string;
}

export function deduplicateClipCandidates<T extends RawScoredCandidate>(candidates: T[]): T[] {
  const sorted = [...candidates].sort((a, b) => b.overallScore - a.overallScore);
  const accepted: T[] = [];

  for (const item of sorted) {
    const isNearDuplicate = accepted.some((existing) => {
      const overlap = computeTemporalOverlapRatio(
        item.startMs,
        item.endMs,
        existing.startMs,
        existing.endMs
      );
      const jaccard = computeTextJaccard(item.transcriptExcerpt, existing.transcriptExcerpt);
      return overlap > 0.45 || jaccard > 0.62;
    });

    if (!isNearDuplicate) {
      accepted.push(item);
    }
  }

  return accepted;
}

export function buildCaptionsFromTranscript(
  clipCandidateId: string,
  clipStartMs: number,
  clipEndMs: number,
  transcript: TranscriptSegment[]
): CaptionSegment[] {
  const relevant = transcript.filter(
    (seg) => seg.endMs > clipStartMs && seg.startMs < clipEndMs
  );

  const captions: CaptionSegment[] = [];
  let orderIndex = 0;

  for (const seg of relevant) {
    const relStart = Math.max(0, seg.startMs - clipStartMs);
    const relEnd = Math.min(clipEndMs - clipStartMs, seg.endMs - clipStartMs);
    const duration = Math.max(600, relEnd - relStart);
    const words = seg.text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    // Split long utterances into 5-7 word kinetic caption chunks
    const chunkSize = 6;
    const numChunks = Math.ceil(words.length / chunkSize);
    const chunkDur = duration / numChunks;

    for (let i = 0; i < numChunks; i++) {
      const chunkWords = words.slice(i * chunkSize, (i + 1) * chunkSize);
      const chunkStart = Math.round(relStart + i * chunkDur);
      const chunkEnd = Math.round(relStart + (i + 1) * chunkDur);
      const emphasis =
        chunkWords.find((w) => w.length >= 6)?.replace(/[^a-zA-Z0-9'-]/g, '') || null;

      captions.push({
        id: `${clipCandidateId}-cap-${orderIndex}`,
        clipCandidateId,
        startMs: chunkStart,
        endMs: Math.max(chunkStart + 400, chunkEnd),
        text: chunkWords.join(' '),
        emphasisWord: emphasis,
        orderIndex,
      });
      orderIndex += 1;
    }
  }

  return captions;
}
