import { Hono } from 'hono';
import { sendSuccess } from './utils/http/response.util';

export const routes = new Hono().get('/health', (c) => sendSuccess(c, { status: 'ok' }));
