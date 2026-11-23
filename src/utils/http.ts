import type { Request } from 'express';
import { BadRequestError } from './errors.js';

export function getRouteParam(req: Request, name: string, label = name): string {
  const value = req.params[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestError(`Parameter ${label} wajib diisi dan harus berupa string tunggal`);
  }
  return value;
}

export function extractClientIp(req: Request): string | null {
  const raw = req.ip ?? req.socket.remoteAddress ?? null;
  if (!raw) return null;
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
}
