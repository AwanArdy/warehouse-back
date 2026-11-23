import type { PoolClient } from "pg";
import { pool } from "./pool.js";

export type IsolationLevel = 'READ COMMITED' | 'REPEATABLE READ' | 'SERIALIZABLE';

export interface TransactionOptions {
  isolationLevel?: IsolationLevel;
}

export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>,
  options?: TransactionOptions,
): Promise<T> {
  const client = await pool.connect();

  try {
    if (options?.isolationLevel) {
      await client.query(`BEGIN ISOLATION LEVEL ${options.isolationLevel}`);
    } else {
      await client.query('BEGIN');
    }

    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Gagal melakukan ROLLBACK transaksi:', rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}
