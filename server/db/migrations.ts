import Database from 'better-sqlite3';

interface Migration {
  version: number;
  name: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        default_platforms TEXT NOT NULL DEFAULT '["youtube_shorts","instagram_reels"]',
        default_caption_preset TEXT NOT NULL DEFAULT 'kinetic_bold',
        storage_quota_bytes INTEGER NOT NULL DEFAULT 2147483648,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        target_platforms TEXT NOT NULL DEFAULT '["youtube_shorts","instagram_reels"]',
        preferred_min_sec INTEGER NOT NULL DEFAULT 20,
        preferred_max_sec INTEGER NOT NULL DEFAULT 58,
        default_caption_preset TEXT NOT NULL DEFAULT 'kinetic_bold',
        status TEXT NOT NULL DEFAULT 'draft',
        provider_mode TEXT NOT NULL DEFAULT 'demo',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

      CREATE TABLE IF NOT EXISTS source_assets (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        source_type TEXT NOT NULL,
        original_filename TEXT NOT NULL,
        source_url TEXT,
        storage_path TEXT,
        mime_type TEXT NOT NULL,
        file_size_bytes INTEGER NOT NULL DEFAULT 0,
        duration_sec REAL NOT NULL DEFAULT 0,
        width INTEGER NOT NULL DEFAULT 0,
        height INTEGER NOT NULL DEFAULT 0,
        fps REAL NOT NULL DEFAULT 30,
        has_audio INTEGER NOT NULL DEFAULT 1,
        rights_confirmed INTEGER NOT NULL DEFAULT 0,
        metadata_title TEXT,
        metadata_channel TEXT,
        thumbnail_url TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_source_assets_project ON source_assets(project_id);
      CREATE INDEX IF NOT EXISTS idx_source_assets_user ON source_assets(user_id);

      CREATE TABLE IF NOT EXISTS processing_jobs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        idempotency_key TEXT,
        status TEXT NOT NULL DEFAULT 'queued',
        current_stage TEXT NOT NULL DEFAULT 'queued',
        progress_pct INTEGER NOT NULL DEFAULT 0,
        provider_mode TEXT NOT NULL DEFAULT 'demo',
        is_demo_result INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        logs_json TEXT NOT NULL DEFAULT '[]',
        started_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_processing_jobs_project ON processing_jobs(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_processing_jobs_status ON processing_jobs(status);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_processing_jobs_idempotency ON processing_jobs(project_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

      CREATE TABLE IF NOT EXISTS speakers (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        display_name TEXT NOT NULL,
        color_hex TEXT NOT NULL DEFAULT '#6366F1'
      );
      CREATE INDEX IF NOT EXISTS idx_speakers_project ON speakers(project_id);

      CREATE TABLE IF NOT EXISTS transcript_segments (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        speaker_id TEXT REFERENCES speakers(id) ON DELETE SET NULL,
        speaker_name TEXT NOT NULL,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL,
        text TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.95
      );
      CREATE INDEX IF NOT EXISTS idx_transcript_project ON transcript_segments(project_id, start_ms ASC);

      CREATE TABLE IF NOT EXISTS clip_candidates (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        editorial_title TEXT NOT NULL,
        is_editorial_suggestion INTEGER NOT NULL DEFAULT 1,
        category TEXT NOT NULL,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL,
        duration_sec REAL NOT NULL,
        overall_score REAL NOT NULL,
        score_breakdown_json TEXT NOT NULL,
        explanation TEXT NOT NULL,
        transcript_excerpt TEXT NOT NULL,
        hook_quote TEXT NOT NULL,
        recommended_platforms TEXT NOT NULL DEFAULT '["youtube_shorts","instagram_reels"]',
        preview_path TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_clips_project_score ON clip_candidates(project_id, overall_score DESC);

      CREATE TABLE IF NOT EXISTS clip_edits (
        id TEXT PRIMARY KEY,
        clip_candidate_id TEXT NOT NULL UNIQUE REFERENCES clip_candidates(id) ON DELETE CASCADE,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL,
        crop_mode TEXT NOT NULL DEFAULT 'auto_speaker',
        focal_point_x REAL NOT NULL DEFAULT 0.5,
        caption_style_json TEXT NOT NULL,
        burn_in_captions INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS caption_segments (
        id TEXT PRIMARY KEY,
        clip_candidate_id TEXT NOT NULL REFERENCES clip_candidates(id) ON DELETE CASCADE,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL,
        text TEXT NOT NULL,
        emphasis_word TEXT,
        order_index INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_captions_clip ON caption_segments(clip_candidate_id, order_index ASC);

      CREATE TABLE IF NOT EXISTS exports (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        clip_candidate_id TEXT NOT NULL REFERENCES clip_candidates(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        target_platform TEXT NOT NULL,
        resolution TEXT NOT NULL DEFAULT '1080x1920',
        aspect_ratio TEXT NOT NULL DEFAULT '9:16',
        video_codec TEXT NOT NULL DEFAULT 'h264',
        audio_codec TEXT NOT NULL DEFAULT 'aac',
        burn_in_captions INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'queued',
        progress_pct INTEGER NOT NULL DEFAULT 0,
        storage_path TEXT,
        file_size_bytes INTEGER,
        duration_sec REAL,
        error_message TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_exports_project ON exports(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_exports_status ON exports(status);
      CREATE INDEX IF NOT EXISTS idx_exports_user ON exports(user_id);
    `,
  },
];

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>;
  const applied = new Set(appliedRows.map((r) => r.version));

  for (const migration of MIGRATIONS) {
    if (!applied.has(migration.version)) {
      const tx = db.transaction(() => {
        db.exec(migration.sql);
        db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
          migration.version,
          migration.name,
          new Date().toISOString()
        );
      });
      tx();
    }
  }
}
