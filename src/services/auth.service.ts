import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { jwtVerify, SignJWT } from 'jose';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { withTransaction } from '../db/transaction.js';
import { auditLogRepository } from '../repositories/audit-log.repository.js';
import { refreshTokenRepository } from '../repositories/refresh-token.repository.js';
import { roleRepository } from '../repositories/role.repository.js';
import { userRepository } from '../repositories/user.repository.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '../utils/errors.js';

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 menit
const REFRESH_TOKEN_TTL_DAYS = 7;

const accessSecretKey = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const refreshSecretKey = new TextEncoder().encode(env.JWT_REFRESH_SECRET);

export interface AccessTokenClaims {
  sub: string;
  username: string;
  roles: string[];
  permissions: string[];
}

export interface AuthTokenPair {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  user: {
    id: string;
    username: string;
    fullName: string;
    roles: string[];
    permissions: string[];
  };
}

function sha256Hex(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export class AuthService {
  async hashPassword(plainPassword: string): Promise<string> {
    return argon2.hash(plainPassword, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });
  }

  async verifyPassword(hash: string, plainPassword: string): Promise<boolean> {
    return argon2.verify(hash, plainPassword);
  }

  private async signAccessToken(claims: AccessTokenClaims): Promise<string> {
    return new SignJWT({
      username: claims.username,
      roles: claims.roles,
      permissions: claims.permissions,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
      .sign(accessSecretKey);
  }

  private async signRefreshToken(userId: string): Promise<{ rawToken: string; expiresAt: Date }> {
    const jti = randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    const rawToken = await new SignJWT({ jti, type: 'refresh' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(`${REFRESH_TOKEN_TTL_DAYS}d`)
      .sign(refreshSecretKey);

    return { rawToken, expiresAt };
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(token, accessSecretKey);
      if (
        typeof payload.sub !== 'string' ||
        typeof payload.username !== 'string' ||
        !Array.isArray(payload.roles) ||
        !Array.isArray(payload.permissions)
      ) {
        throw new UnauthorizedError('Struktur payload access token tidak valid');
      }

      return {
        sub: payload.sub,
        username: payload.username,
        roles: payload.roles.filter((r): r is string => typeof r === 'string'),
        permissions: payload.permissions.filter((p): p is string => typeof p === 'string'),
      };
    } catch (err) {
      if (err instanceof UnauthorizedError) throw err;
      throw new UnauthorizedError('Access token tidak valid atau sudah kedaluwarsa');
    }
  }

  /**
   * Membuat akun SUPER_ADMIN pertama hanya jika tabel users masih kosong.
   */
  async bootstrapSuperAdmin(
    input: { username: string; fullName: string; password: string },
    ipAddress: string | null,
  ) {
    return withTransaction(async (client) => {
      const existingCount = await userRepository.countAll(client);
      if (existingCount > 0) {
        throw new ConflictError(
          'Bootstrap gagal: sistem sudah memiliki user terdaftar. Gunakan endpoint pembuatan user oleh Super Admin.',
          'BOOTSTRAP_ALREADY_COMPLETED',
        );
      }

      const superAdminRole = await roleRepository.findRoleByCode(client, 'SUPER_ADMIN');
      if (!superAdminRole) {
        throw new NotFoundError('Role SUPER_ADMIN tidak ditemukan. Pastikan migrasi M1 sudah dijalankan.');
      }

      const passwordHash = await this.hashPassword(input.password);
      const user = await userRepository.create(client, {
        username: input.username,
        fullName: input.fullName,
        passwordHash,
      });

      await roleRepository.assignRoleToUser(client, user.id, superAdminRole.id);

      await auditLogRepository.record(client, {
        actorId: user.id,
        entityName: 'users',
        entityId: user.id,
        action: 'CREATE',
        newValues: { username: user.username, fullName: user.fullName, role: 'SUPER_ADMIN' },
        ipAddress,
      });

      return {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        roles: ['SUPER_ADMIN'],
      };
    });
  }

  async createUserWithRole(
    actorId: string,
    input: { username: string; fullName: string; password: string; roleCode: string },
    ipAddress: string | null,
  ) {
    return withTransaction(async (client) => {
      const role = await roleRepository.findRoleByCode(client, input.roleCode);
      if (!role) {
        throw new NotFoundError(`Role '${input.roleCode}' tidak ditemukan`);
      }

      const passwordHash = await this.hashPassword(input.password);
      const user = await userRepository.create(client, {
        username: input.username,
        fullName: input.fullName,
        passwordHash,
      });

      await roleRepository.assignRoleToUser(client, user.id, role.id);

      await auditLogRepository.record(client, {
        actorId,
        entityName: 'users',
        entityId: user.id,
        action: 'CREATE',
        newValues: { username: user.username, fullName: user.fullName, role: role.code },
        ipAddress,
      });

      return {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        isActive: user.isActive,
        roles: [role.code],
      };
    });
  }

  async login(
    username: string,
    password: string,
    ipAddress: string | null,
  ): Promise<AuthTokenPair> {
    const user = await userRepository.findByUsernameWithPassword(pool, username);
    if (!user) {
      throw new UnauthorizedError('Username atau kata sandi salah', 'INVALID_CREDENTIALS');
    }

    if (!user.isActive) {
      throw new ForbiddenError('Akun pengguna dinonaktifkan', 'ACCOUNT_DISABLED');
    }

    const passwordValid = await this.verifyPassword(user.passwordHash, password);
    if (!passwordValid) {
      throw new UnauthorizedError('Username atau kata sandi salah', 'INVALID_CREDENTIALS');
    }

    const [roles, permissions] = await Promise.all([
      roleRepository.findRolesByUserId(pool, user.id),
      roleRepository.findPermissionsByUserId(pool, user.id),
    ]);

    const roleCodes = roles.map((r) => r.code);
    const permissionCodes = permissions.map((p) => p.code);

    const accessToken = await this.signAccessToken({
      sub: user.id,
      username: user.username,
      roles: roleCodes,
      permissions: permissionCodes,
    });

    const { rawToken: refreshToken, expiresAt } = await this.signRefreshToken(user.id);

    await withTransaction(async (client) => {
      await refreshTokenRepository.create(client, {
        userId: user.id,
        tokenHash: sha256Hex(refreshToken),
        expiresAt,
      });

      await auditLogRepository.record(client, {
        actorId: user.id,
        entityName: 'users',
        entityId: user.id,
        action: 'LOGIN',
        newValues: { username: user.username },
        ipAddress,
      });
    });

    return {
      accessToken,
      refreshToken,
      expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        roles: roleCodes,
        permissions: permissionCodes,
      },
    };
  }

  /**
   * Rotasi Refresh Token: mencabut token lama dan menerbitkan pasangan token baru secara atomik.
   */
  async rotateRefreshToken(rawRefreshToken: string): Promise<AuthTokenPair> {
    let userId: string;
    try {
      const { payload } = await jwtVerify(rawRefreshToken, refreshSecretKey);
      if (typeof payload.sub !== 'string' || payload.type !== 'refresh') {
        throw new UnauthorizedError('Refresh token tidak valid');
      }
      userId = payload.sub;
    } catch {
      throw new UnauthorizedError('Refresh token tidak valid atau sudah kedaluwarsa');
    }

    const tokenHash = sha256Hex(rawRefreshToken);

    return withTransaction(async (client) => {
      const storedToken = await refreshTokenRepository.findByHashForUpdate(client, tokenHash);
      if (!storedToken) {
        throw new UnauthorizedError('Sesi refresh token tidak ditemukan');
      }

      // Token reuse detection: jika token yang sudah dicabut dipakai lagi, cabut semua sesi user
      if (storedToken.revokedAt !== null) {
        await refreshTokenRepository.revokeAllForUser(client, storedToken.userId);
        throw new UnauthorizedError(
          'Terdeteksi penggunaan ulang refresh token. Seluruh sesi telah dicabut demi keamanan.',
          'TOKEN_REUSE_DETECTED',
        );
      }

      if (storedToken.expiresAt.getTime() <= Date.now()) {
        throw new UnauthorizedError('Refresh token sudah kedaluwarsa');
      }

      const user = await userRepository.findById(client, userId);
      if (!user || !user.isActive) {
        throw new ForbiddenError('Akun pengguna tidak aktif atau tidak ditemukan');
      }

      const [roles, permissions] = await Promise.all([
        roleRepository.findRolesByUserId(client, user.id),
        roleRepository.findPermissionsByUserId(client, user.id),
      ]);

      const roleCodes = roles.map((r) => r.code);
      const permissionCodes = permissions.map((p) => p.code);

      const newAccessToken = await this.signAccessToken({
        sub: user.id,
        username: user.username,
        roles: roleCodes,
        permissions: permissionCodes,
      });

      const { rawToken: newRefreshToken, expiresAt } = await this.signRefreshToken(user.id);
      const newStored = await refreshTokenRepository.create(client, {
        userId: user.id,
        tokenHash: sha256Hex(newRefreshToken),
        expiresAt,
      });

      await refreshTokenRepository.markRotated(client, storedToken.id, newStored.id);

      return {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
        user: {
          id: user.id,
          username: user.username,
          fullName: user.fullName,
          roles: roleCodes,
          permissions: permissionCodes,
        },
      };
    });
  }

  async logout(rawRefreshToken: string): Promise<void> {
    await refreshTokenRepository.revokeByHash(pool, sha256Hex(rawRefreshToken));
  }
}

export const authService = new AuthService();
