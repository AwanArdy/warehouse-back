import type { QueryResultRow } from "pg";
import { executeQuery, type Queryable } from "../db/pool.js";

export interface RoleEntity {
  id: string;
  code: string;
  name: string;
  description: string | null;
}

export interface PermissionEntity {
  id: string;
  code: string;
  module: string;
}

interface RoleRow extends QueryResultRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
}

interface PermissionRow extends QueryResultRow {
  id: string;
  code: string;
  module: string;
}

function mapRoleRow(row: RoleRow): RoleEntity {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
  };
}

function mapPermissionRow(row: PermissionRow): PermissionEntity {
  return {
    id: row.id,
    code: row.code,
    module: row.module,
  };
}

export class RoleRepository {
  async findAllRoles(db: Queryable): Promise<RoleEntity[]> {
    const res = await executeQuery<RoleRow>(
      db,
      'SELECT id, code, name, description FROM roles ORDER BY code ASC',
    );
    return res.rows.map(mapRoleRow);
  }

  async findRoleByCode(db: Queryable, code: string): Promise<RoleEntity | null> {
    const res = await executeQuery<RoleRow>(
      db,
      'SELECT id, code, name, description FROM roles WHERE code = $1',
      [code],
    );
    const row = res.rows[0];
    return row ? mapRoleRow(row) : null;
  }

  async findRolesByUserId(db: Queryable, userId: string): Promise<RoleEntity[]> {
    const res = await executeQuery<RoleRow>(
      db,
      `SELECT r.id, r.code, r.name, r.description
       FROM roles r
       INNER JOIN user_roles ur ON ur.role_id = r.id
       WHERE ur.user_id = $1
       ORDER BY r.code ASC`,
      [userId],
    );
    return res.rows.map(mapRoleRow);
  }

  async findPermissionsByUserId(db: Queryable, userId: string): Promise<PermissionEntity[]> {
    const res = await executeQuery<PermissionRow>(
      db,
      `SELECT DISTINCT p.id, p.code, p.module
       FROM permissions p
       INNER JOIN role_permissions rp ON rp.permission_id = p.id
       INNER JOIN user_roles ur ON ur.role_id = rp.role_id
       WHERE ur.user_id = $1
       ORDER BY p.code ASC`,
      [userId],
    );
    return res.rows.map(mapPermissionRow);
  }

  async assignRoleToUser(db: Queryable, userId: string, roleId: string): Promise<void> {
    await executeQuery(
      db,
      `INSERT INTO user_roles (user_id, role_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, role_id) DO NOTHING`,
      [userId, roleId],
    );
  }
}

export const roleRepository = new RoleRepository();
