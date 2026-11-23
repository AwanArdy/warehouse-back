import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DB_POOL_MAX,
  idleTimeoutMillis: env.DB_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: env.DB_CONNECTION_TIMEOUT_MS,
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected error pada idle client PostgreSQL');
});

export type Queryable = Pick<Pool | PoolClient, 'query'>;

export async function executeQuery<T extends QueryResultRow>(
  db: Queryable,
  sql: string,
  params: readonly unknown[] = [],
): Promise<QueryResult<T>> {
    return db.query<T>(sql, [...params]);
  }
