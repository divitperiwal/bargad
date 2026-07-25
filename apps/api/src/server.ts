import { logger } from '#config/logger.config';
import { PORT } from '#constant';
import { app } from './app';
import { handleShutdown } from './shutdown';

const server = Bun.serve({ port: PORT, fetch: app.fetch });
handleShutdown(server);
logger.info({ url: server.url.href }, 'api server started');
