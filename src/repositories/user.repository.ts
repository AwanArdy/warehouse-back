import type { QueryResult, QueryResultRow } from "pg";
import { executeQuery, type Queryable } from "../db/pool.js";

export interface UserEntity {
  id: string;
  username: string;
  fullName: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserWithPasswordEntity extends UserEntity {
  passwordHash: string;
}

interface UserRow extends QueryResultRow {
  id: string;
  username: string;
  full_name: string;
  password_hash?: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

function mapUserRow(row: UserRow): UserEntity {
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapUserWithPasswordRow(row: UserRow): UserWithPasswordEntity {
  return {
    ...mapUserRow(row),
    passwordHash: row.password_hash ?? '',
  };
}

export class UserRepository {
  async countAll(db: Queryable): Promise<number> {
    const res = await executeQuery<{ total: string }>(db, 'SELECT COUNT(*)::text AS total FROM users');
    return Number(res.rows[0]?.total ?? '0');
  }

  async findById(db: Queryable, id: string): Promise<UserEntity | null> {
    const res = await executeQuery<UserRow>(
      db,
      `
      SELECT id, username, full_name, is_active, created_at, updated_at
      FROM users
      WHERE id = $1
      `,
      [id],
    );
    const row = res.rows[0];
    return row ? mapUserRow(row) : null;
  }

  async findByUsernameWithPassword(
    db: Queryable,
    username: string,
  ): Promise<UserWithPasswordEntity | null> {
    const res = await executeQuery<UserRow>(
      db,
      `
      SELECT id, username, full_name, password_hash, is_active, created_at, updated_at
      FROM users
      WHERE username = $1
      `,
      [username],
    );
    const row = res.rows[0];
    return row ? mapUserWithPasswordRow(row) : null;
  }

  async create(
    db: Queryable,
    input: { username: string; fullName: string; passwordHash: string },
  ): Promise<UserEntity> {
    const res = await executeQuery<UserRow>(
      db,
      `
      INSERT INTO users (username, full_name, password_hash)
      VALUES ($1, $2, $3)
      RETURNING id, username, full_name, is_active, created_at, updated_at
      `,
      [input.username, input.fullName, input.passwordHash],
    );
    const row = res.rows[0];
    if (!row) {
      throw new Error('Gagal membuat record user baru');
    }
    return mapUserRow(row);
  }

  async listAll(db: Queryable): Promise<UserEntity[]> {
    const res = await executeQuery<UserRow>(
      db,
      `
      SELECT id, username, full_name, is_active, created_at, updated_at
      FROM users
      ORDER BY created_at DESC
      `,
    );
    return res.rows.map(mapUserRow);
  }
}

export const userRepository = new UserRepository();
