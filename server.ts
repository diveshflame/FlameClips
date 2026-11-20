import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config, ensureStorageDirectories } from './server/config.ts';
import { getDb } from './server/db/client.ts';
import { authRouter } from './server/routes/authRoutes.ts';
import { clipAndExportRouter } from './server/routes/clipAndExportRoutes.ts';
import { projectRouter } from './server/routes/projectRoutes.ts';
import { seedDemoWorkspace } from './server/seed.ts';
import { recoverInterruptedJobs } from './server/services/jobWorker.ts';

export function createApp(): express.Express {
  ensureStorageDirectories();
  getDb();

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'clipforge-api' });
  });

  app.use('/api/auth', authRouter);
  app.use('/api', projectRouter);
  app.use('/api', clipAndExportRouter);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API route not found' });
  });

  return app;
}

async function startServer(): Promise<void> {
  const app = createApp();
  recoverInterruptedJobs();

  // Ensure seeded demo user & studio sample video exist without blocking server boot
  seedDemoWorkspace().catch((err) => {
    console.error('Demo seed warning:', err);
  });

  if (config.nodeEnv !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  app.listen(config.port, '0.0.0.0', () => {
    console.log(`ClipForge AI studio running on http://0.0.0.0:${config.port}`);
  });
}

if (process.env.CLIPFORGE_TEST_MODE !== '1') {
  void startServer();
}
