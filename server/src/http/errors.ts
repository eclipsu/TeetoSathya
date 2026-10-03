import type { Response } from 'express';
import type { ApiError } from '@teeto/shared';

export function sendError(res: Response, status: number, code: string, message: string, details?: string[]) {
  const body: ApiError = { error: { code, message, ...(details ? { details } : {}) } };
  res.status(status).json(body);
}
