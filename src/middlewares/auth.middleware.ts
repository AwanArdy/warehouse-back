import type { NextFunction, Request, Response } from 'express';
import { authService, type AccessTokenClaims } from '../services/auth.service.js';
import { ForbiddenError, UnauthorizedError } from '../utils/errors.js';

export interface AuthenticatedRequest extends Request {
  auth?: AccessTokenClaims;
}

export function getAuthContext(req: Request): AccessTokenClaims {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) {
    throw new UnauthorizedError();
  }
  return auth;
}

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    next(new UnauthorizedError('Header Authorization Bearer wajib disertakan'));
    return;
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    next(new UnauthorizedError('Token autentikasi kosong'));
    return;
  }

  try {
    const claims = await authService.verifyAccessToken(token);
    (req as AuthenticatedRequest).auth = claims;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Guard otorisasi RBAC: mewajibkan pengguna memiliki SELURUH permission yang diminta.
 */
export function requirePermission(...requiredPermissions: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const auth = (req as AuthenticatedRequest).auth;
    if (!auth) {
      next(new UnauthorizedError());
      return;
    }

    const userPerms = new Set(auth.permissions);
    const missing = requiredPermissions.filter((perm) => !userPerms.has(perm));

    if (missing.length > 0) {
      next(
        new ForbiddenError(
          `Akses ditolak: membutuhkan permission [${missing.join(', ')}]`,
          'INSUFFICIENT_PERMISSIONS',
        ),
      );
      return;
    }

    next();
  };
}
