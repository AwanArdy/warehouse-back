import type { Request, Response } from 'express';
import { pool } from '../db/pool.js';
import { getAuthContext } from '../middlewares/auth.middleware.js';
import { auditLogRepository } from '../repositories/audit-log.repository.js';
import { roleRepository } from '../repositories/role.repository.js';
import { userRepository } from '../repositories/user.repository.js';
import { authService } from '../services/auth.service.js';
import { 
  bootstrapAdminSchema,
  createUserSchema,
  loginSchema,
  refreshTokenSchema,
} from '../validators/auth.validators.js';

function extractClientIp(req: Request): string | null {
  const raw = req.ip ?? req.socket.remoteAddress ?? null;
  if (!raw) return null;
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
}

export class AuthController {
  async bootstrapAdmin(req: Request, res: Response): Promise<void> {
    const body = bootstrapAdminSchema.parse(req.body);
    const created = await authService.bootstrapSuperAdmin(body, extractClientIp(req));
    res.status(201).json({ success: true, data: created });
  }

  async login(req: Request, res: Response): Promise<void> {
    const body = loginSchema.parse(req.body);
    const result = await authService.login(body.username, body.password, extractClientIp(req));
    res.status(200).json({ success: true, data: result });
  }

  async refresh(req: Request, res: Response): Promise<void> {
    const body = refreshTokenSchema.parse(req.body);
    const result = await authService.rotateRefreshToken(body.refreshToken);
    res.status(200).json({ success: true, data: result });
  }

  async logout(req: Request, res: Response): Promise<void> {
    const body = refreshTokenSchema.parse(req.body);
    await authService.logout(body.refreshToken);
    res.status(200).json({ success: true, message: 'Logout berhasil' });
  }

  async me(req: Request, res: Response): Promise<void> {
    const auth = getAuthContext(req);
    const user = await userRepository.findById(pool, auth.sub);
    res.status(200).json({
      success: true,
      data: {
        id: auth.sub,
        username: auth.username,
        fullName: user?.fullName ?? auth.username,
        roles: auth.roles,
        permissions: auth.permissions,
      },
    });
  }

  async createUser(req: Request, res: Response): Promise<void> {
    const auth = getAuthContext(req);
    const body = createUserSchema.parse(req.body);
    const created = await authService.createUserWithRole(auth.sub, body, extractClientIp(req));
    res.status(201).json({ success: true, data: created });
  }

  async listUsers(_req: Request, res: Response): Promise<void> {
    const users = await userRepository.listAll(pool);
    res.status(200).json({ success: true, data: users });
  }

  async listRoles(_req: Request, res: Response): Promise<void> {
    const roles = await roleRepository.findAllRoles(pool);
    res.status(200).json({ success: true, data: roles });
  }

  async listAuditLogs(req: Request, res: Response): Promise<void> {
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0);
    const logs = await auditLogRepository.listRecent(pool, limit, offset);
    res.status(200).json({ success: true, data: logs });
  }
}

export const authController = new AuthController();
