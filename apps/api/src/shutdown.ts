import type { Server } from 'bun';
import { logger } from '#config/logger.config';
import { db } from './config/database.config';

export function handleShutdown(server: Server<unknown>) {
  async function shutdown(exitCode: number) {
    await server.stop(); // finish in-flight requests first
    await db.$client.close();
    process.exit(exitCode);
  }

  // Docker stop and Ctrl+C.
  process.once('SIGTERM', () => shutdown(0));
  process.once('SIGINT', () => shutdown(0));

  // Errors inside a request already reach errorHandler; these catch anything that escapes one.
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandled rejection');
    void shutdown(1);
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception');
    void shutdown(1);
  });
}
