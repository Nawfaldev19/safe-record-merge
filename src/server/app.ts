import { openDatabase } from './db/database';
import type { Database } from './db/database';
import { createRateLimiter } from './domain/rate-limit';
import type { Deps } from './services/records';

/** Wires up the dependencies every service needs. Tests call this too. */
export async function createDeps(options: {
  dataDir: string;
  sessionTtlHours: number;
  now?: () => Date;
}): Promise<Deps & { db: Database }> {
  return {
    db: await openDatabase(options.dataDir),
    now: options.now ?? (() => new Date()),
    sessionTtlHours: options.sessionTtlHours,
    loginLimiter: createRateLimiter({ limit: 8, windowMs: 60_000 }),
  };
}
