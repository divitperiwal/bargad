import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { cors } from 'hono/cors';
import { requestId } from 'hono/request-id';
import { CORS_OPTIONS } from '#constant';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware';
import { requestLogger } from './middlewares/logger.middleware';
import { routes } from './routes';

export const app = new Hono()
  .use(contextStorage())
  .use(requestId())
  .use(requestLogger)
  .use(cors(CORS_OPTIONS))
  .route('/', routes);

app.onError(errorHandler);
app.notFound(notFoundHandler);

// The frontend imports this type for hc<AppType>, its typed API client.
export type AppType = typeof app;
