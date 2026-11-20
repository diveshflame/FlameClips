import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { CaptionSegment, CaptionStyle, CropMode } from '../../shared/types.ts';
import { config } from '../config.ts';
import { formatAssTimestamp } from './scoring.ts';

const execFileAsync = promisify(execFile);

export interface VideoProbeInfo {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  hasAudio: boolean;
}

export async function checkMediaBinaries(): Promise<{
  ffmpegAvailable: boolean;
  ffprobeAvailable: boolean;
}> {
  const check = async (bin: string): Promise<boolean> => {
    try {
      await execFileAsync(bin, ['-version'], { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  };
  const [ffmpegAvailable, ffprobeAvailable] = await Promise.all([
    check('ffmpeg'),
    check('ffprobe'),
  ]);
  return { ffmpegAvailable, ffprobeAvailable };
}

export async function inspectVideo(filePath: string): Promise<VideoProbeInfo> {
  const { stdout } = await execFileAsync(
    'ffprobe',
    ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath],
    { timeout: 15000 }
  );

  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      r_frame_rate?: string;
    }>;
  };

  const videoStream = parsed.streams?.find((s) => s.codec_type === 'video');
  if (!videoStream || !videoStream.width || !videoStream.height) {
    throw new Error('Uploaded file does not contain a valid video stream.');
  }

  const audioStream = parsed.streams?.find((s) => s.codec_type === 'audio');
  const durationSec = Number(parsed.format?.duration || 0);
  if (!Number.isFinite(durationSec) || durationSec < 3) {
    throw new Error('Video duration is too short (minimum 3 seconds required).');
  }

  let fps = 30;
  if (videoStream.r_frame_rate && videoStream.r_frame_rate.includes('/')) {
    const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
    if (den > 0 && num > 0) {
      fps = Math.round((num / den) * 100) / 100;
    }
  }

  return {
    durationSec,
    width: videoStream.width,
    height: videoStream.height,
    fps,
    videoCodec: videoStream.codec_name || 'unknown',
    hasAudio: Boolean(audioStream),
  };
}

export async function extractAudioForTranscription(
  videoPath: string,
  outMp3Path: string
): Promise<boolean> {
  try {
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-i',
        videoPath,
        '-vn',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-b:a',
        '48k',
        '-t',
        '600',
        outMp3Path,
      ],
      { timeout: 60000 }
    );
    return fs.existsSync(outMp3Path) && fs.statSync(outMp3Path).size > 0;
  } catch {
    return false;
  }
}

function hexToAssColor(hex: string, alphaHex = '00'): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return '&H00FFFFFF';
  const r = clean.slice(0, 2);
  const g = clean.slice(2, 4);
  const b = clean.slice(4, 6);
  return `&H${alphaHex}${b}${g}${r}`.toUpperCase();
}

function escapeAssText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\n/g, '\\N');
}

export function generateAssSubtitlesFile(
  outPath: string,
  captions: CaptionSegment[],
  style: CaptionStyle,
  targetWidth: number,
  targetHeight: number
): void {
  const scaleFactor = targetWidth / 1080;
  const fontSize = Math.max(24, Math.round(style.fontSize * 1.65 * scaleFactor));
  const alignment = style.position === 'top' ? 8 : style.position === 'center' ? 5 : 2;
  const marginV =
    style.position === 'center'
      ? 0
      : Math.round((style.position === 'top' ? 180 : 240) * (targetHeight / 1920));

  const primaryColour = hexToAssColor(style.textColor || '#FFFFFF');
  const secondaryColour = hexToAssColor(style.highlightColor || '#6366F1');
  const backColour = style.showBackground ? '&H800B0F19' : '&H00000000';
  const borderStyle = style.showBackground ? 3 : 1;

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${targetWidth}
PlayResY: ${targetHeight}
WrapStyle: 1

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,DejaVu Sans,${fontSize},${primaryColour},${secondaryColour},&H000B0F19,${backColour},-1,0,0,0,100,100,0,0,${borderStyle},3,1,${alignment},60,60,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events = captions
    .map((cap) => {
      const display = style.uppercase ? cap.text.toUpperCase() : cap.text;
      let formatted = escapeAssText(display);
      if (cap.emphasisWord) {
        const targetWord = style.uppercase ? cap.emphasisWord.toUpperCase() : cap.emphasisWord;
        const idx = formatted.indexOf(targetWord);
        if (idx !== -1) {
          const highlight = hexToAssColor(style.highlightColor || '#6366F1');
          formatted =
            formatted.slice(0, idx) +
            `{\\c${highlight}}` +
            targetWord +
            `{\\c${primaryColour}}` +
            formatted.slice(idx + targetWord.length);
        }
      }
      return `Dialogue: 0,${formatAssTimestamp(cap.startMs)},${formatAssTimestamp(cap.endMs)},Default,,0,0,0,,${formatted}`;
    })
    .join('\n');

  fs.writeFileSync(outPath, `${header}${events}\n`, 'utf8');
}

export interface RenderVerticalOptions {
  sourcePath: string;
  outputPath: string;
  startMs: number;
  endMs: number;
  cropMode: CropMode;
  focalPointX: number;
  captions: CaptionSegment[];
  captionStyle: CaptionStyle;
  burnInCaptions: boolean;
  isPreview: boolean;
  sourceHasAudio: boolean;
}

export async function renderVerticalClip(opts: RenderVerticalOptions): Promise<{
  fileSizeBytes: number;
  durationSec: number;
}> {
  const targetWidth = opts.isPreview ? 540 : 1080;
  const targetHeight = opts.isPreview ? 960 : 1920;
  const startSec = Math.max(0, opts.startMs / 1000);
  const durationSec = Math.max(1, (opts.endMs - opts.startMs) / 1000);
  const focalX = Math.max(0, Math.min(1, opts.focalPointX));

  fs.mkdirSync(path.dirname(opts.outputPath), { recursive: true });
  const assPath = path.join(config.tempDir, `sub_${Date.now()}_${Math.random().toString(36).slice(2)}.ass`);

  try {
    let baseFilter: string;
    if (opts.cropMode === 'fit_blur') {
      const bgW = Math.max(120, Math.round(targetWidth / 4));
      const bgH = Math.max(214, Math.round(targetHeight / 4));
      baseFilter = `[0:v]split=2[bg][fg];[bg]scale=${bgW}:${bgH}:force_original_aspect_ratio=increase,crop=${bgW}:${bgH},boxblur=6:2,scale=${targetWidth}:${targetHeight},setsar=1[bgblur];[fg]scale=${targetWidth}:-2:force_original_aspect_ratio=decrease[fgscaled];[bgblur][fgscaled]overlay=(W-w)/2:(H-h)/2[vbase]`;
    } else {
      const effectiveX = opts.cropMode === 'center' ? 0.5 : focalX;
      baseFilter = `[0:v]scale=-2:${targetHeight},crop=w=min(iw\\,${targetWidth}):h=${targetHeight}:x='max(0,min(iw-${targetWidth},(iw-${targetWidth})*${effectiveX.toFixed(3)}))':y=0,scale=${targetWidth}:${targetHeight},setsar=1[vbase]`;
    }

    let filterComplex = baseFilter;
    let mapOut = '[vbase]';

    if (opts.burnInCaptions && opts.captions.length > 0) {
      generateAssSubtitlesFile(
        assPath,
        opts.captions,
        opts.captionStyle,
        targetWidth,
        targetHeight
      );
      const escapedAss = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
      filterComplex = `${baseFilter};[vbase]ass='${escapedAss}'[vout]`;
      mapOut = '[vout]';
    }

    const args = [
      '-y',
      '-ss',
      startSec.toFixed(3),
      '-t',
      durationSec.toFixed(3),
      '-i',
      opts.sourcePath,
      '-filter_complex',
      filterComplex,
      '-map',
      mapOut,
    ];

    if (opts.sourceHasAudio) {
      args.push('-map', '0:a?', '-c:a', 'aac', '-b:a', opts.isPreview ? '96k' : '160k', '-ar', '44100');
    } else {
      args.push('-an');
    }

    args.push(
      '-c:v',
      'libx264',
      '-preset',
      opts.isPreview ? 'ultrafast' : 'veryfast',
      '-crf',
      opts.isPreview ? '27' : '21',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      opts.outputPath
    );

    await execFileAsync('ffmpeg', args, { timeout: 180000 });
    const stat = fs.statSync(opts.outputPath);
    return {
      fileSizeBytes: stat.size,
      durationSec: Math.round(durationSec * 10) / 10,
    };
  } finally {
    if (fs.existsSync(assPath)) {
      fs.unlinkSync(assPath);
    }
  }
}

export async function ensureDemoSampleVideo(): Promise<string> {
  const samplePath = path.join(config.demoDir, 'sample_studio_interview.mp4');
  if (fs.existsSync(samplePath) && fs.statSync(samplePath).size > 10000) {
    return samplePath;
  }

  fs.mkdirSync(config.demoDir, { recursive: true });
  // Generate a 48-second 1280x720 dark kinetic studio video with SMPTE/motion patterns + AAC audio
  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=1280x720:rate=24:duration=48',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=220:sample_rate=44100:duration=48',
      '-vf',
      "drawbox=x=0:y=0:w=1280:h=720:color=#0B0F19@0.68:t=fill,drawtext=text='CLIPFORGE STUDIO SAMPLE · 16\\:9 MASTER':x=(w-text_w)/2:y=h-90:fontsize=28:fontcolor=#dfe2f1",
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '28',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '96k',
      '-movflags',
      '+faststart',
      samplePath,
    ],
    { timeout: 60000 }
  );

  return samplePath;
}
