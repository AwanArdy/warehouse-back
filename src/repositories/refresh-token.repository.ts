import type { QueryResultRow } from 'pg';
import { executeQuery, type Queryable } from '../db/pool.js';

export interface RefreshTokenEntity {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedById: string | null;
  createdAt: Date;
}

interface RefreshTokenRow extends QueryResultRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  replaced_by_id: string | null;
  created_at: Date;
}

function mapRefreshTokenRow(row: RefreshTokenRow): RefreshTokenEntity {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    replacedById: row.replaced_by_id,
    createdAt: row.created_at,
  };
}

export class RefreshTokenRepository {
  async create(
    db: Queryable,
    input: { userId: string; tokenHash: string; expiresAt: Date },
  ): Promise<RefreshTokenEntity> {
    const res = await executeQuery<RefreshTokenRow>(
      db,
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)
       RETURNING id, user_id, token_hash, expires_at, revoked_at, replaced_by_id, created_at`,
      [input.userId, input.tokenHash, input.expiresAt],
    );
    const row = res.rows[0];
    if (!row) {
      throw new Error('Gagal menyimpan refresh token');
    }
    return mapRefreshTokenRow(row);
  }

  async findByHashForUpdate(db: Queryable, tokenHash: string): Promise<RefreshTokenEntity | null> {
    const res = await executeQuery<RefreshTokenRow>(
      db,
      `SELECT id, user_id, token_hash, expires_at, revoked_at, replaced_by_id, created_at
       FROM refresh_tokens
       WHERE token_hash = $1
       FOR UPDATE`,
      [tokenHash],
    );
    const row = res.rows[0];
    return row ? mapRefreshTokenRow(row) : null;
  }

  async markRotated(db: Queryable, tokenId: string, replacedById: string): Promise<void> {
    await executeQuery(
      db,
      `UPDATE refresh_tokens
       SET revoked_at = NOW(), replaced_by_id = $2
       WHERE id = $1`,
      [tokenId, replacedById],
    );
  }

  async revokeByHash(db: Queryable, tokenHash: string): Promise<void> {
    await executeQuery(
      db,
      `UPDATE refresh_tokens
       SET revoked_at = NOW()
       WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash],
    );
  }

  async revokeAllForUser(db: Queryable, userId: string): Promise<void> {
    await executeQuery(
      db,
      `UPDATE refresh_tokens
       SET revoked_at = NOW()
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
  }
}

export const refreshTokenRepository = new RefreshTokenRepository();
