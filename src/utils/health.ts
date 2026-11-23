import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { documentStorage, type StorageHealthResult } from './storage.js';

const execFileAsync = promisify(execFile);

export interface SystemHealthStatus {
  status: 'ok' | 'degraded';
  timestamp: string;
  checks: {
    postgres: { ok: boolean; latencyMs: number; error?: string };
    storage: StorageHealthResult;
    xelatex: { ok: boolean; version?: string; error?: string };
  };
}

export async function checkSystemHealth(): Promise<SystemHealthStatus> {
  const pgStart = performance.now();
  let pgStatus: SystemHealthStatus['checks']['postgres'];
  try {
    await pool.query('SELECT 1');
    pgStatus = { ok: true, latencyMs: Math.round(performance.now() - pgStart) };
  } catch (err) {
    pgStatus = {
      ok: false,
      latencyMs: Math.round(performance.now() - pgStart),
      error: err instanceof Error ? err.message : 'Unknown PostgreSQL error',
    };
  }

  const storageStatus = await documentStorage.checkHealth();

  let latexStatus: SystemHealthStatus['checks']['xelatex'];
  try {
    const { stdout } = await execFileAsync(env.LATEX_BIN, ['--version'], {
      timeout: env.LATEX_TIMEOUT_MS,
    });
    const firstLine = stdout.split('\n')[0]?.trim() ?? 'xelatex available';
    latexStatus = { ok: true, version: firstLine };
  } catch (err) {
    latexStatus = {
      ok: false,
      error: err instanceof Error ? err.message : 'Binary xelatex tidak ditemukan',
    };
  }

  const allOk = pgStatus.ok && storageStatus.ok && latexStatus.ok;

  return {
    status: allOk ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    checks: {
      postgres: pgStatus,
      storage: storageStatus,
      xelatex: latexStatus,
    },
  };
}
