// Shared contracts between server and client. Keep runtime code here tiny and dependency-free.
export const APP_NAME = 'TeetoSathya';

export interface HealthResponse {
  ok: true;
  app: string;
  serverNow: number;
}

export * from './limits';
export * from './types';
export * from './validation';
export * from './events';
export * from './factCheckRule';
export * from './score';
