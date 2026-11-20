import fs from 'node:fs';
import { GoogleGenAI, Type } from '@google/genai';
import type {
  ClipCategory,
  ClipScoreBreakdown,
  TargetPlatform,
  TranscriptSegment,
} from '../../shared/types.ts';
import { config } from '../config.ts';
import { clampClipBoundaries, computeOverallScore, deduplicateClipCandidates } from './scoring.ts';

export interface ProposedSpeaker {
  label: string;
  displayName: string;
  colorHex: string;
}

export interface ProposedTranscriptSegment {
  speakerLabel: string;
  speakerName: string;
  startMs: number;
  endMs: number;
  text: string;
  confidence: number;
}

export interface ProposedClipCandidate {
  editorialTitle: string;
  category: ClipCategory;
  startMs: number;
  endMs: number;
  scoreBreakdown: ClipScoreBreakdown;
  overallScore: number;
  explanation: string;
  transcriptExcerpt: string;
  hookQuote: string;
  recommendedPlatforms: TargetPlatform[];
}

export interface AnalysisResult {
  speakers: ProposedSpeaker[];
  transcript: ProposedTranscriptSegment[];
  clips: ProposedClipCandidate[];
  isDemoResult: boolean;
  providerLabel: string;
}

export interface AnalysisProvider {
  readonly mode: 'gemini' | 'demo';
  analyzeMedia(params: {
    audioPath: string | null;
    durationSec: number;
    targetPlatforms: TargetPlatform[];
    preferredMinSec: number;
    preferredMaxSec: number;
    sourceTitle: string;
  }): Promise<AnalysisResult>;
}

const SPEAKER_COLORS = ['#6366F1', '#10B981', '#F59E0B', '#EC4899'];

function createGeminiClient(): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: config.geminiApiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export class GeminiAnalysisProvider implements AnalysisProvider {
  readonly mode = 'gemini' as const;

  async analyzeMedia(params: {
    audioPath: string | null;
    durationSec: number;
    targetPlatforms: TargetPlatform[];
    preferredMinSec: number;
    preferredMaxSec: number;
    sourceTitle: string;
  }): Promise<AnalysisResult> {
    if (!config.geminiApiKey) {
      throw new Error('GEMINI_API_KEY is not configured on the server.');
    }

    const ai = createGeminiClient();
    let rawTranscriptText = '';

    if (params.audioPath && fs.existsSync(params.audioPath)) {
      const audioBytes = fs.readFileSync(params.audioPath);
      const maxInlineBytes = 18 * 1024 * 1024;
      if (audioBytes.byteLength > 0 && audioBytes.byteLength <= maxInlineBytes) {
        const audioPart = {
          inlineData: {
            mimeType: 'audio/mp3',
            data: audioBytes.toString('base64'),
          },
        };

        const transcribeResp = await ai.models.generateContent({
          model: config.geminiTranscribeModel,
          contents: {
            parts: [
              audioPart,
              {
                text: 'Transcribe all spoken dialogue accurately. Include speaker changes if distinct speakers are heard, and preserve exact wording without inventing dialogue.',
              },
            ],
          },
        });
        rawTranscriptText = (transcribeResp.text || '').trim();
      }
    }

    // If audio had no intelligible speech (e.g., silent test clip or instrumental tone), return structured empty-speech notice with zero fabricated dialogue
    if (!rawTranscriptText || rawTranscriptText.length < 12) {
      const safeEnd = Math.min(Math.round(params.durationSec * 1000), params.preferredMaxSec * 1000);
      return {
        speakers: [{ label: 'S1', displayName: 'Audio Track', colorHex: SPEAKER_COLORS[0] }],
        transcript: [
          {
            speakerLabel: 'S1',
            speakerName: 'Audio Track',
            startMs: 0,
            endMs: Math.round(params.durationSec * 1000),
            text: '[No clear spoken dialogue detected in source audio track]',
            confidence: 0.4,
          },
        ],
        clips: [
          {
            editorialTitle: 'Visual Highlight Segment (Manual Captioning Suggested)',
            category: 'story',
            startMs: 0,
            endMs: Math.max(5000, safeEnd),
            scoreBreakdown: {
              hookStrength: 62,
              standaloneClarity: 58,
              payoff: 60,
              pacing: 70,
              visualSuitability: 74,
              contextIntegrityPenalty: 4,
            },
            overallScore: computeOverallScore({
              hookStrength: 62,
              standaloneClarity: 58,
              payoff: 60,
              pacing: 70,
              visualSuitability: 74,
              contextIntegrityPenalty: 4,
            }),
            explanation:
              'No spoken dialogue was detected in the extracted audio stream. Proposed an initial visual highlight window that you can trim and caption manually in the editor.',
            transcriptExcerpt: '[No spoken dialogue detected]',
            hookQuote: 'Visual highlight segment',
            recommendedPlatforms: params.targetPlatforms,
          },
        ],
        isDemoResult: false,
        providerLabel: `Gemini (${config.geminiTranscribeModel} + ${config.geminiAnalysisModel})`,
      };
    }

    const totalMs = Math.round(params.durationSec * 1000);
    const analysisPrompt = `You are an editorial video story producer analyzing a transcript for short-form vertical clips (${params.targetPlatforms.join(', ')}).

Source title: ${params.sourceTitle}
Total duration: ${params.durationSec.toFixed(1)} seconds (${totalMs} ms)
Preferred clip duration: ${params.preferredMinSec}s to ${params.preferredMaxSec}s

Raw transcript:
"""
${rawTranscriptText}
"""

Tasks:
1. Segment the transcript into chronological timestamped utterances between 0 and ${totalMs} ms with speaker labels (S1, S2, etc.) and speaker display names.
2. Identify 3 to 6 high-value standalone short-form clip candidates (categories: hook, insight, reaction, story, exchange, humor).
   - Never invent dialogue or distort speaker meaning.
   - Never create misleading out-of-context edits.
   - Do NOT claim a clip will go viral.
   - Propose an editorial title clearly meant as an editorial suggestion.
   - Score each dimension from 0 to 100 (contextIntegrityPenalty 0 to 25 where 0 means full context preserved).
   - Ensure clip startMs and endMs stay strictly inside 0..${totalMs} ms.`;

    const analysisResp = await ai.models.generateContent({
      model: config.geminiAnalysisModel,
      contents: analysisPrompt,
      config: {
        systemInstruction:
          'Return strictly structured JSON matching the response schema. Ground every excerpt and hookQuote verbatim in the provided transcript.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            speakers: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  label: { type: Type.STRING },
                  displayName: { type: Type.STRING },
                },
                required: ['label', 'displayName'],
              },
            },
            transcript: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  speakerLabel: { type: Type.STRING },
                  startMs: { type: Type.INTEGER },
                  endMs: { type: Type.INTEGER },
                  text: { type: Type.STRING },
                },
                required: ['speakerLabel', 'startMs', 'endMs', 'text'],
              },
            },
            clips: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  editorialTitle: { type: Type.STRING },
                  category: { type: Type.STRING },
                  startMs: { type: Type.INTEGER },
                  endMs: { type: Type.INTEGER },
                  hookStrength: { type: Type.NUMBER },
                  standaloneClarity: { type: Type.NUMBER },
                  payoff: { type: Type.NUMBER },
                  pacing: { type: Type.NUMBER },
                  visualSuitability: { type: Type.NUMBER },
                  contextIntegrityPenalty: { type: Type.NUMBER },
                  explanation: { type: Type.STRING },
                  transcriptExcerpt: { type: Type.STRING },
                  hookQuote: { type: Type.STRING },
                },
                required: [
                  'editorialTitle',
                  'category',
                  'startMs',
                  'endMs',
                  'hookStrength',
                  'standaloneClarity',
                  'payoff',
                  'pacing',
                  'visualSuitability',
                  'contextIntegrityPenalty',
                  'explanation',
                  'transcriptExcerpt',
                  'hookQuote',
                ],
              },
            },
          },
          required: ['speakers', 'transcript', 'clips'],
        },
      },
    });

    const parsed = JSON.parse((analysisResp.text || '{}').trim()) as {
      speakers?: Array<{ label: string; displayName: string }>;
      transcript?: Array<{ speakerLabel: string; startMs: number; endMs: number; text: string }>;
      clips?: Array<{
        editorialTitle: string;
        category: string;
        startMs: number;
        endMs: number;
        hookStrength: number;
        standaloneClarity: number;
        payoff: number;
        pacing: number;
        visualSuitability: number;
        contextIntegrityPenalty: number;
        explanation: string;
        transcriptExcerpt: string;
        hookQuote: string;
      }>;
    };

    const speakers: ProposedSpeaker[] = (parsed.speakers || [{ label: 'S1', displayName: 'Speaker 1' }]).map(
      (s, idx) => ({
        label: s.label || `S${idx + 1}`,
        displayName: s.displayName || `Speaker ${idx + 1}`,
        colorHex: SPEAKER_COLORS[idx % SPEAKER_COLORS.length],
      })
    );
    const speakerNameMap = new Map(speakers.map((s) => [s.label, s.displayName]));

    const transcript: ProposedTranscriptSegment[] = (parsed.transcript || []).map((t) => {
      const clamped = clampClipBoundaries(t.startMs, Math.max(t.startMs + 1000, t.endMs), params.durationSec);
      return {
        speakerLabel: t.speakerLabel || 'S1',
        speakerName: speakerNameMap.get(t.speakerLabel) || 'Speaker 1',
        startMs: clamped.startMs,
        endMs: clamped.endMs,
        text: t.text,
        confidence: 0.94,
      };
    });

    const validCategories = new Set<ClipCategory>([
      'hook',
      'insight',
      'reaction',
      'story',
      'exchange',
      'humor',
    ]);

    const rawClips: ProposedClipCandidate[] = (parsed.clips || []).map((c) => {
      const clamped = clampClipBoundaries(c.startMs, c.endMs, params.durationSec);
      const breakdown: ClipScoreBreakdown = {
        hookStrength: Math.min(100, Math.max(0, Number(c.hookStrength) || 75)),
        standaloneClarity: Math.min(100, Math.max(0, Number(c.standaloneClarity) || 75)),
        payoff: Math.min(100, Math.max(0, Number(c.payoff) || 75)),
        pacing: Math.min(100, Math.max(0, Number(c.pacing) || 75)),
        visualSuitability: Math.min(100, Math.max(0, Number(c.visualSuitability) || 75)),
        contextIntegrityPenalty: Math.min(25, Math.max(0, Number(c.contextIntegrityPenalty) || 0)),
      };
      const cat = validCategories.has(c.category as ClipCategory)
        ? (c.category as ClipCategory)
        : 'insight';

      return {
        editorialTitle: c.editorialTitle,
        category: cat,
        startMs: clamped.startMs,
        endMs: clamped.endMs,
        scoreBreakdown: breakdown,
        overallScore: computeOverallScore(breakdown),
        explanation: c.explanation,
        transcriptExcerpt: c.transcriptExcerpt,
        hookQuote: c.hookQuote,
        recommendedPlatforms: params.targetPlatforms,
      };
    });

    const deduplicated = deduplicateClipCandidates(rawClips);
    return {
      speakers,
      transcript,
      clips: deduplicated,
      isDemoResult: false,
      providerLabel: `Gemini (${config.geminiTranscribeModel} + ${config.geminiAnalysisModel})`,
    };
  }
}

export class DemoFallbackProvider implements AnalysisProvider {
  readonly mode = 'demo' as const;

  async analyzeMedia(params: {
    audioPath: string | null;
    durationSec: number;
    targetPlatforms: TargetPlatform[];
    preferredMinSec: number;
    preferredMaxSec: number;
    sourceTitle: string;
  }): Promise<AnalysisResult> {
    const totalMs = Math.max(15000, Math.round(params.durationSec * 1000));
    const speakers: ProposedSpeaker[] = [
      { label: 'S1', displayName: 'Maya Chen (Host)', colorHex: '#6366F1' },
      { label: 'S2', displayName: 'Devon Brooks (Guest)', colorHex: '#10B981' },
    ];

    const ratio = totalMs / 48000;
    const scale = (ms: number) => Math.min(totalMs, Math.round(ms * ratio));

    const transcript: ProposedTranscriptSegment[] = [
      {
        speakerLabel: 'S1',
        speakerName: 'Maya Chen (Host)',
        startMs: scale(0),
        endMs: scale(7500),
        text: 'Most creators think editing down a 60-minute podcast is about finding the loudest thirty seconds.',
        confidence: 0.96,
      },
      {
        speakerLabel: 'S2',
        speakerName: 'Devon Brooks (Guest)',
        startMs: scale(7500),
        endMs: scale(15500),
        text: 'Right, and that actually ruins retention. A clip only works standalone if the viewer understands the stakes in three seconds.',
        confidence: 0.95,
      },
      {
        speakerLabel: 'S1',
        speakerName: 'Maya Chen (Host)',
        startMs: scale(15500),
        endMs: scale(23500),
        text: 'When we switched from fixed 30-second slices to complete story arcs with a real payoff, completion doubled.',
        confidence: 0.97,
      },
      {
        speakerLabel: 'S2',
        speakerName: 'Devon Brooks (Guest)',
        startMs: scale(23500),
        endMs: scale(32000),
        text: 'Wait—did you also cut the intro setup, or keep the question inside the clip?',
        confidence: 0.94,
      },
      {
        speakerLabel: 'S1',
        speakerName: 'Maya Chen (Host)',
        startMs: scale(32000),
        endMs: scale(41000),
        text: 'Always keep the premise! Stripping context makes people confused, and confused viewers swipe immediately.',
        confidence: 0.96,
      },
      {
        speakerLabel: 'S2',
        speakerName: 'Devon Brooks (Guest)',
        startMs: scale(41000),
        endMs: totalMs,
        text: 'Honestly that single rule saved our channel ten hours of guesswork every single week.',
        confidence: 0.95,
      },
    ];

    const buildSlice = (
      title: string,
      category: ClipCategory,
      sMs: number,
      eMs: number,
      breakdown: ClipScoreBreakdown,
      explanation: string,
      hookQuote: string
    ): ProposedClipCandidate => {
      const clamped = clampClipBoundaries(sMs, eMs, params.durationSec);
      const excerpt = transcript
        .filter((t) => t.endMs > clamped.startMs && t.startMs < clamped.endMs)
        .map((t) => `${t.speakerName.split(' ')[0]}: "${t.text}"`)
        .join(' ');
      return {
        editorialTitle: title,
        category,
        startMs: clamped.startMs,
        endMs: clamped.endMs,
        scoreBreakdown: breakdown,
        overallScore: computeOverallScore(breakdown),
        explanation,
        transcriptExcerpt: excerpt || transcript[0].text,
        hookQuote,
        recommendedPlatforms: params.targetPlatforms,
      };
    };

    const rawClips: ProposedClipCandidate[] = [
      buildSlice(
        'Why Fixed 30-Second Slices Destroy Short-Form Retention',
        'hook',
        scale(0),
        scale(23500),
        {
          hookStrength: 93,
          standaloneClarity: 91,
          payoff: 89,
          pacing: 88,
          visualSuitability: 86,
          contextIntegrityPenalty: 0,
        },
        '[Demo Fallback] Opens with a direct contrarian premise on short-form editing, retains the guest rebuttal, and closes on a concrete outcome metric.',
        'Most creators think editing down a 60-minute podcast is about finding the loudest thirty seconds.'
      ),
      buildSlice(
        'The 3-Second Context Rule Before Cutting Any Setup',
        'exchange',
        scale(23500),
        totalMs,
        {
          hookStrength: 88,
          standaloneClarity: 94,
          payoff: 90,
          pacing: 87,
          visualSuitability: 84,
          contextIntegrityPenalty: 1,
        },
        '[Demo Fallback] Crisp two-speaker Q&A exchange where the question frames the exact payoff without leaving viewers missing prior context.',
        'Wait—did you also cut the intro setup, or keep the question inside the clip?'
      ),
      buildSlice(
        'Complete Story Arcs vs. Loudness-Only Clipping',
        'insight',
        scale(14000),
        scale(36000),
        {
          hookStrength: 83,
          standaloneClarity: 85,
          payoff: 84,
          pacing: 86,
          visualSuitability: 82,
          contextIntegrityPenalty: 2,
        },
        '[Demo Fallback] Actionable workflow takeaway contrasting story completeness against naive loudness triggers.',
        'When we switched from fixed 30-second slices to complete story arcs, completion doubled.'
      ),
    ];

    return {
      speakers,
      transcript,
      clips: deduplicateClipCandidates(rawClips),
      isDemoResult: true,
      providerLabel: 'Demo Fallback Provider (Set GEMINI_API_KEY for live Gemini AI)',
    };
  }
}

export function getActiveAnalysisProvider(): AnalysisProvider {
  if (config.geminiApiKey && config.geminiApiKey !== 'MY_GEMINI_API_KEY') {
    return new GeminiAnalysisProvider();
  }
  return new DemoFallbackProvider();
}

export function formatTranscriptForExport(segments: TranscriptSegment[]): string {
  return segments
    .map((s) => `[${(s.startMs / 1000).toFixed(1)}s - ${(s.endMs / 1000).toFixed(1)}s] ${s.speakerName}: ${s.text}`)
    .join('\n');
}
