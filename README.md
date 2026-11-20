# ClipForge AI

ClipForge AI is an AI-assisted long-video-to-short-clips studio built for discovering standalone hooks, insights, reactions, dialogue exchanges, and complete story arcs, trimming and captioning clips in a dark studio editor, and exporting vertical `1080×1920` (`9:16`) H.264/AAC MP4 files for YouTube Shorts and Instagram Reels.

## Architecture & Stack Note

To honor the existing repository infrastructure (Node.js 22, Express, React 19, Vite, Tailwind CSS v4, `@google/genai`), the application retains a cohesive single-runtime TypeScript full-stack architecture rather than introducing a separate Python/FastAPI/Celery service:
- **Frontend**: React 19 + TypeScript + Tailwind CSS v4 (`src/`) implementing the **Studio Kinetic Dark** design tokens.
- **Backend**: Express (`server.ts`, `server/`) with SQLite (`better-sqlite3`, WAL mode, versioned SQL migrations, and relational indexes for `users`, `sessions`, `projects`, `source_assets`, `processing_jobs`, `speakers`, `transcript_segments`, `clip_candidates`, `clip_edits`, `caption_segments`, and `exports`).
- **Background Worker**: Asynchronous worker module (`server/services/jobWorker.ts`) backed by persistent `processing_jobs` and `exports` records, with startup recovery and temporary file cleanup.
- **Media Pipeline**: Real `ffprobe` inspection, `ffmpeg` 16kHz audio extraction, `9:16` framing (`auto_speaker`, `center`, `fit_blur`, `custom_focal`), and `.ass` subtitle burn-in via `libx264` + `aac`.
- **AI Discovery Provider**: Modular `AnalysisProvider` interface (`server/services/analysisProvider.ts`) using `@google/genai` (`gemini-3.5-transcribe` + `gemini-4-hydrogen` structured JSON discovery) when `GEMINI_API_KEY` is configured, and a clearly labeled `DemoFallbackProvider` when `GEMINI_API_KEY` is unset.

## Prerequisites

- **Node.js** `>= 22.18` (for native `.ts` server execution with `node server.ts` or `tsx`)
- **FFmpeg & FFprobe** (`ffmpeg` and `ffprobe` available in `PATH`, with `libx264`, `aac`, and `ass`/`libass` support)

### Installing FFmpeg
- **Ubuntu/Debian**: `sudo apt-get update && sudo apt-get install -y ffmpeg fonts-dejavu-core`
- **macOS (Homebrew)**: `brew install ffmpeg`

## Local Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy environment template and configure optional keys:
   ```bash
   cp .env.example .env
   ```
   - Set `GEMINI_API_KEY` to enable live Gemini transcription (`gemini-3.5-transcribe`) and story/hook analysis (`gemini-4-hydrogen`).
   - Leave `GEMINI_API_KEY` blank to run in clearly labeled **Demo Fallback Mode** while exercising real FFmpeg upload, inspection, preview rendering, and 1080×1920 MP4 export.
3. Start development server on port `3000`:
   ```bash
   npm run dev
   ```
4. Build and run in production mode:
   ```bash
   npm run build
   npm start
   ```

## Docker Setup

```bash
docker compose up --build
```
The studio is available at `http://localhost:3000` with persistent media/database storage mounted at `clipforge_data`.

## Verification & Tests

Run TypeScript checks, unit tests, and end-to-end API/FFmpeg integration tests:
```bash
npm run lint
npm test
npm run build
```

## Rights-Aware Source Ingestion

- Direct upload of authorized MP4, MOV, or WebM files (with explicit rights confirmation) is the primary ingestion path.
- YouTube URLs are validated with SSRF guards and inspected for permitted public oEmbed metadata (`https://www.youtube.com/oembed`); the application never bypasses DRM, login walls, or platform access controls.

## Known Limitations & Next Steps

- **Face/Speaker Auto-Tracking**: `auto_speaker` currently centers/offsets based on configurable focal X position (`focalPointX`); integrating a frame-level face/speaker bounding-box detector (e.g., MediaPipe or server-side vision keyframes) is the natural next upgrade for multi-speaker wide shots.
- **Object Storage**: Local filesystem storage with HMAC-signed expiring URLs is used for MVP simplicity; swap `storage_path` adapters for S3/GCS presigned URLs when scaling horizontally across multiple worker containers.
- **Queue Persistence**: Background execution runs in-process backed by SQLite state; extract `jobWorker.ts` to a dedicated Redis/BullMQ worker process for multi-node concurrency.
