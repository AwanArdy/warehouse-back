import type { QueryResultRow } from 'pg';
import { executeQuery, type Queryable } from '../db/pool.js';

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'VOID' | 'LOGIN';

export interface AuditLogInput {
  actorId: string | null;
  entityName: string;
  entityId: string;
  action: AuditAction;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  ipAddress?: string | null;
}

export interface AuditLogEntity {
  id: string;
  actorId: string | null;
  actorUsername: string | null;
  entityName: string;
  entityId: string;
  action: string;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: Date;
}

interface AuditLogRow extends QueryResultRow {
  id: string;
  actor_id: string | null;
  actor_username: string | null;
  entity_name: string;
  entity_id: string;
  action: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: Date;
}

function mapAuditLogRow(row: AuditLogRow): AuditLogEntity {
  return {
    id: row.id,
    actorId: row.actor_id,
    actorUsername: row.actor_username,
    entityName: row.entity_name,
    entityId: row.entity_id,
    action: row.action,
    oldValues: row.old_values,
    newValues: row.new_values,
    ipAddress: row.ip_address,
    createdAt: row.created_at,
  };
}

export class AuditLogRepository {
  async record(db: Queryable, input: AuditLogInput): Promise<void> {
    await executeQuery(
      db,
      `INSERT INTO audit_logs (actor_id, entity_name, entity_id, action, old_values, new_values, ip_address)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::inet)`,
      [
        input.actorId,
        input.entityName,
        input.entityId,
        input.action,
        input.oldValues ? JSON.stringify(input.oldValues) : null,
        input.newValues ? JSON.stringify(input.newValues) : null,
        input.ipAddress ?? null,
      ],
    );
  }

  async listRecent(db: Queryable, limit = 50, offset = 0): Promise<AuditLogEntity[]> {
    const res = await executeQuery<AuditLogRow>(
      db,
      `SELECT
         al.id,
         al.actor_id,
         u.username AS actor_username,
         al.entity_name,
         al.entity_id,
         al.action,
         al.old_values,
         al.new_values,
         HOST(al.ip_address) AS ip_address,
         al.created_at
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.actor_id
       ORDER BY al.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return res.rows.map(mapAuditLogRow);
  }
}

export const auditLogRepository = new AuditLogRepository();
