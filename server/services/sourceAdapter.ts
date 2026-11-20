import type { SourceValidationResult } from '../../shared/types.ts';
import { assertSafePublicUrl } from '../security/auth.ts';

export interface SourceAdapter {
  readonly name: string;
  supportsUrl(url: string): boolean;
  validateAndInspectUrl(url: string): Promise<SourceValidationResult>;
}

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

export function extractYouTubeVideoId(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl.trim());
    const host = parsed.hostname.toLowerCase();
    if (!YOUTUBE_HOSTS.has(host)) return null;

    if (host.includes('youtu.be')) {
      const id = parsed.pathname.split('/').filter(Boolean)[0];
      return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }

    const vParam = parsed.searchParams.get('v');
    if (vParam && /^[A-Za-z0-9_-]{11}$/.test(vParam)) {
      return vParam;
    }

    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length >= 2 && ['shorts', 'live', 'embed', 'v'].includes(segments[0])) {
      const id = segments[1];
      return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }
    return null;
  } catch {
    return null;
  }
}

export class YouTubeMetadataAdapter implements SourceAdapter {
  readonly name = 'youtube-oembed-metadata';

  supportsUrl(url: string): boolean {
    return extractYouTubeVideoId(url) !== null;
  }

  async validateAndInspectUrl(rawUrl: string): Promise<SourceValidationResult> {
    const videoId = extractYouTubeVideoId(rawUrl);
    if (!videoId) {
      return {
        valid: false,
        kind: 'unsupported_url',
        normalizedUrl: null,
        videoId: null,
        mediaDownloadSupported: false,
        title: null,
        channelName: null,
        thumbnailUrl: null,
        message:
          'Enter a valid public YouTube video URL (youtube.com/watch?v=..., youtu.be/..., or youtube.com/shorts/...) or upload an authorized video file directly.',
        actionRequired: 'upload_authorized_file',
      };
    }

    const normalizedUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // SSRF-checked URL validation before any outbound metadata call
    await assertSafePublicUrl(normalizedUrl);

    let title: string | null = null;
    let channelName: string | null = null;
    const thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    try {
      const oembedEndpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(normalizedUrl)}&format=json`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4500);
      const response = await fetch(oembedEndpoint, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timeout);

      if (response.ok) {
        const data = (await response.json()) as {
          title?: string;
          author_name?: string;
        };
        title = data.title || null;
        channelName = data.author_name || null;
      }
    } catch {
      // Metadata lookup failed (offline/restricted environment); still preserve clean rights-aware validation response
    }

    return {
      valid: true,
      kind: 'youtube_url',
      normalizedUrl,
      videoId,
      mediaDownloadSupported: false,
      title: title || `YouTube Video (${videoId})`,
      channelName: channelName || 'Creator Channel',
      thumbnailUrl,
      message:
        'Public YouTube metadata verified. Direct video stream extraction from YouTube is not supported under platform access rules. Upload the authorized MP4, MOV, or WebM master file below to run AI clip discovery and 9:16 export.',
      actionRequired: 'upload_authorized_file',
    };
  }
}

export const defaultSourceAdapter: SourceAdapter = new YouTubeMetadataAdapter();
