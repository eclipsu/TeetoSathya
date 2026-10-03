import { Router } from 'express';
import { APP_NAME, type HealthResponse } from '@teeto/shared';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  const body: HealthResponse = { ok: true, app: APP_NAME, serverNow: Date.now() };
  res.json(body);
});
