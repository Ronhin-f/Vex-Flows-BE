import express from 'express';
import cors from 'cors';
import flowsRoutes from './routes/flows.routes.js';
import triggersRoutes from './routes/triggers.routes.js';
import messagesRoutes from './routes/messages.routes.js';
import { schedulerLoop } from './services/scheduler.service.js';
import { initI18n } from './config/i18n.js';

export function createServer() {
  const app = express();
  app.use(express.json());
  app.use(cors({ origin: (process.env.ALLOWED_ORIGINS || '').split(',') }));
  app.use(initI18n());

  app.get('/health', (_, res) => res.json({ ok: true, service: 'vex-flows' }));

  app.use('/api/flows', flowsRoutes);
  app.use('/api/triggers', triggersRoutes);
  app.use('/api/messages', messagesRoutes);

  schedulerLoop(); // planificador simple (sin Redis)

  return app;
}
