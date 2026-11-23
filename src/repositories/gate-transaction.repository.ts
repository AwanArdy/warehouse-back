import type { QueryResultRow } from 'pg';
import { executeQuery, type Queryable } from '../db/pool.js';
import type {
  ContainerSize,
  DocType,
  GateStatus,
  MovementDirection,
  TransportCategory,
  VehicleType,
} from '../types/domain.js';

export interface GateTransactionRowEntity {
  id: string;
  ticketNumber: string;
  vehicleId: string;
  warehouseId: string;
  dockId: string | null;
  driverName: string;
  driverLicenseNo: string;
  direction: MovementDirection;
  category: TransportCategory;
  status: GateStatus;
  gateInAt: Date;
  gateOutAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface GateTransactionDetailEntity extends GateTransactionRowEntity {
  plateNumber?: string;
  vType?: VehicleType;
  companyName?: string;
  maxWeightKg?: number;
  dockNumber?: string | null;
  warehouseCode?: string;
  warehouseName?: string;
  containerNumber?: string | null;
  containerSize?: ContainerSize | null;
  sealNumber?: string | null;
  vehicle: {
    plateNumber: string;
    vType: VehicleType;
    companyName: string;
    maxWeightKg: number;
  };
  warehouse: {
    code: string;
    name: string;
  };
  dock: {
    dockNumber: string;
  } | null;
  container: {
    id: string;
    containerNumber: string;
    size: ContainerSize;
    sealNumber: string;
    isEmpty: boolean;
  } | null;
  createdByUser: {
    username: string;
    fullName: string;
  };
}

export interface GateStatusLogEntity {
  id: string;
  fromStatus: GateStatus | null;
  toStatus: GateStatus;
  notes: string | null;
  changedBy: string;
  changedByUsername: string;
  changedAt: Date;
}

interface RawGateTxRow extends QueryResultRow {
  id: string;
  ticket_number: string;
  vehicle_id: string;
  warehouse_id: string;
  dock_id: string | null;
  driver_name: string;
  driver_license_no: string;
  direction: MovementDirection;
  category: TransportCategory;
  status: GateStatus;
  gate_in_at: Date;
  gate_out_at: Date | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

interface RawJoinedGateTxRow extends RawGateTxRow {
  plate_number: string;
  v_type: VehicleType;
  company_name: string;
  max_weight_kg: string;
  warehouse_code: string;
  warehouse_name: string;
  dock_number: string | null;
  container_id: string | null;
  container_number: string | null;
  container_size: ContainerSize | null;
  seal_number: string | null;
  is_empty: boolean | null;
  creator_username: string;
  creator_full_name: string;
}

interface RawStatusLogRow extends QueryResultRow {
  id: string;
  from_status: GateStatus | null;
  to_status: GateStatus;
  notes: string | null;
  changed_by: string;
  changed_by_username: string;
  changed_at: Date;
}

function mapBaseGateTxRow(row: RawGateTxRow): GateTransactionRowEntity {
  return {
    id: row.id,
    ticketNumber: row.ticket_number,
    vehicleId: row.vehicle_id,
    warehouseId: row.warehouse_id,
    dockId: row.dock_id,
    driverName: row.driver_name,
    driverLicenseNo: row.driver_license_no,
    direction: row.direction,
    category: row.category,
    status: row.status,
    gateInAt: row.gate_in_at,
    gateOutAt: row.gate_out_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapJoinedGateTxRow(row: RawJoinedGateTxRow): GateTransactionDetailEntity {
  return {
    ...mapBaseGateTxRow(row),
    plateNumber: row.plate_number,
    vType: row.v_type,
    companyName: row.company_name,
    maxWeightKg: Number(row.max_weight_kg),
    dockNumber: row.dock_number ?? null,
    warehouseCode: row.warehouse_code,
    warehouseName: row.warehouse_name,
    containerNumber: row.container_number ?? null,
    containerSize: row.container_size ?? null,
    sealNumber: row.seal_number ?? null,
    vehicle: {
      plateNumber: row.plate_number,
      vType: row.v_type,
      companyName: row.company_name,
      maxWeightKg: Number(row.max_weight_kg),
    },
    warehouse: {
      code: row.warehouse_code,
      name: row.warehouse_name,
    },
    dock: row.dock_number ? { dockNumber: row.dock_number } : null,
    container:
      row.container_id &&
      row.container_number &&
      row.container_size &&
      row.seal_number !== null &&
      row.is_empty !== null
        ? {
            id: row.container_id,
            containerNumber: row.container_number,
            size: row.container_size,
            sealNumber: row.seal_number,
            isEmpty: row.is_empty,
          }
        : null,
    createdByUser: {
      username: row.creator_username,
      fullName: row.creator_full_name,
    },
  };
}

export class GateTransactionRepository {
  async generateTicketNumber(db: Queryable): Promise<string> {
    await executeQuery(
      db,
      `CREATE TABLE IF NOT EXISTS gate_ticket_sequences (
         period_ymd VARCHAR(8) PRIMARY KEY,
         last_number INT NOT NULL DEFAULT 0 CHECK (last_number >= 0)
       )`,
    );

    const res = await executeQuery<{ period_ymd: string; last_number: number }>(
      db,
      `WITH current_period AS (
         SELECT TO_CHAR(NOW() AT TIME ZONE 'Asia/Makassar', 'YYYYMMDD') AS ymd
       )
       INSERT INTO gate_ticket_sequences (period_ymd, last_number)
       SELECT ymd, 1 FROM current_period
       ON CONFLICT (period_ymd)
       DO UPDATE SET last_number = gate_ticket_sequences.last_number + 1
       RETURNING period_ymd, last_number`,
    );
    const row = res.rows[0];
    if (!row) throw new Error('Gagal menghasilkan nomor tiket gerbang');
    return `TKT-${row.period_ymd}-${String(row.last_number).padStart(4, '0')}`;
  }

  async hasActiveTransactionForVehicle(db: Queryable, vehicleId: string): Promise<boolean> {
    const res = await executeQuery<{ exists: boolean }>(
      db,
      `SELECT EXISTS (
         SELECT 1
         FROM gate_transactions
         WHERE vehicle_id = $1
           AND status NOT IN ('GATE_OUT', 'CANCELLED')
       ) AS exists`,
      [vehicleId],
    );
    return res.rows[0]?.exists ?? false;
  }

  async createTransaction(
    db: Queryable,
    input: {
      ticketNumber: string;
      vehicleId: string;
      warehouseId: string;
      driverName: string;
      driverLicenseNo: string;
      direction: MovementDirection;
      category: TransportCategory;
      createdBy: string;
    },
  ): Promise<GateTransactionRowEntity> {
    const res = await executeQuery<RawGateTxRow>(
      db,
      `INSERT INTO gate_transactions (
         ticket_number, vehicle_id, warehouse_id, driver_name, driver_license_no,
         direction, category, status, created_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'GATE_IN', $8)
       RETURNING id, ticket_number, vehicle_id, warehouse_id, dock_id, driver_name,
                 driver_license_no, direction, category, status, gate_in_at, gate_out_at,
                 created_by, created_at, updated_at`,
      [
        input.ticketNumber,
        input.vehicleId,
        input.warehouseId,
        input.driverName,
        input.driverLicenseNo,
        input.direction,
        input.category,
        input.createdBy,
      ],
    );
    const row = res.rows[0];
    if (!row) throw new Error('Gagal menyimpan transaksi gate-in');
    return mapBaseGateTxRow(row);
  }

  async createContainerDetail(
    db: Queryable,
    input: {
      gateTransactionId: string;
      containerNumber: string;
      size: ContainerSize;
      sealNumber: string;
      isEmpty: boolean;
    },
  ): Promise<void> {
    await executeQuery(
      db,
      `INSERT INTO transaction_containers (
         gate_transaction_id, container_number, size, seal_number, is_empty
       )
       VALUES ($1, $2, $3, $4, $5)`,
      [
        input.gateTransactionId,
        input.containerNumber,
        input.size,
        input.sealNumber,
        input.isEmpty,
      ],
    );
  }

  async insertStatusLog(
    db: Queryable,
    input: {
      gateTransactionId: string;
      fromStatus: GateStatus | null;
      toStatus: GateStatus;
      notes?: string | null;
      changedBy: string;
    },
  ): Promise<void> {
    await executeQuery(
      db,
      `INSERT INTO gate_status_logs (gate_transaction_id, from_status, to_status, notes, changed_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        input.gateTransactionId,
        input.fromStatus,
        input.toStatus,
        input.notes ?? null,
        input.changedBy,
      ],
    );
  }

  async findByIdForUpdate(db: Queryable, id: string): Promise<GateTransactionRowEntity | null> {
    const res = await executeQuery<RawGateTxRow>(
      db,
      `SELECT id, ticket_number, vehicle_id, warehouse_id, dock_id, driver_name,
              driver_license_no, direction, category, status, gate_in_at, gate_out_at,
              created_by, created_at, updated_at
       FROM gate_transactions
       WHERE id = $1
       FOR UPDATE`,
      [id],
    );
    const row = res.rows[0];
    return row ? mapBaseGateTxRow(row) : null;
  }

  async assignDock(db: Queryable, txId: string, dockId: string): Promise<GateTransactionRowEntity> {
    const res = await executeQuery<RawGateTxRow>(
      db,
      `UPDATE gate_transactions
       SET dock_id = $2, status = 'DOCKING'
       WHERE id = $1
       RETURNING id, ticket_number, vehicle_id, warehouse_id, dock_id, driver_name,
                 driver_license_no, direction, category, status, gate_in_at, gate_out_at,
                 created_by, created_at, updated_at`,
      [txId, dockId],
    );
    const row = res.rows[0];
    if (!row) throw new Error('Transaksi gate tidak ditemukan saat assign dock');
    return mapBaseGateTxRow(row);
  }

  async hasIssuedRequiredDocument(
    db: Queryable,
    gateTransactionId: string,
    requiredDocType: DocType,
  ): Promise<boolean> {
    const res = await executeQuery<{ exists: boolean }>(
      db,
      `SELECT EXISTS (
         SELECT 1
         FROM official_documents
         WHERE gate_transaction_id = $1
           AND doc_type = $2
           AND status = 'ISSUED'
       ) AS exists`,
      [gateTransactionId, requiredDocType],
    );
    return res.rows[0]?.exists ?? false;
  }

  async markGateOut(db: Queryable, txId: string): Promise<GateTransactionRowEntity> {
    const res = await executeQuery<RawGateTxRow>(
      db,
      `UPDATE gate_transactions
       SET status = 'GATE_OUT', gate_out_at = NOW()
       WHERE id = $1
       RETURNING id, ticket_number, vehicle_id, warehouse_id, dock_id, driver_name,
                 driver_license_no, direction, category, status, gate_in_at, gate_out_at,
                 created_by, created_at, updated_at`,
      [txId],
    );
    const row = res.rows[0];
    if (!row) throw new Error('Transaksi gate tidak ditemukan saat gate-out');
    return mapBaseGateTxRow(row);
  }

  async findDetailById(db: Queryable, id: string): Promise<GateTransactionDetailEntity | null> {
    const res = await executeQuery<RawJoinedGateTxRow>(
      db,
      `SELECT
         gt.id, gt.ticket_number, gt.vehicle_id, gt.warehouse_id, gt.dock_id,
         gt.driver_name, gt.driver_license_no, gt.direction, gt.category, gt.status,
         gt.gate_in_at, gt.gate_out_at, gt.created_by, gt.created_at, gt.updated_at,
         v.plate_number, v.v_type, v.company_name, v.max_weight_kg,
         w.code AS warehouse_code, w.name AS warehouse_name,
         ld.dock_number,
         tc.id AS container_id, tc.container_number, tc.size AS container_size,
         tc.seal_number, tc.is_empty,
         u.username AS creator_username, u.full_name AS creator_full_name
       FROM gate_transactions gt
       INNER JOIN vehicles v ON v.id = gt.vehicle_id
       INNER JOIN warehouses w ON w.id = gt.warehouse_id
       LEFT JOIN loading_docks ld ON ld.id = gt.dock_id
       LEFT JOIN transaction_containers tc ON tc.gate_transaction_id = gt.id
       INNER JOIN users u ON u.id = gt.created_by
       WHERE gt.id = $1`,
      [id],
    );
    const row = res.rows[0];
    return row ? mapJoinedGateTxRow(row) : null;
  }

  async listStatusLogs(db: Queryable, gateTransactionId: string): Promise<GateStatusLogEntity[]> {
    const res = await executeQuery<RawStatusLogRow>(
      db,
      `SELECT
         gsl.id, gsl.from_status, gsl.to_status, gsl.notes,
         gsl.changed_by, u.username AS changed_by_username, gsl.changed_at
       FROM gate_status_logs gsl
       INNER JOIN users u ON u.id = gsl.changed_by
       WHERE gsl.gate_transaction_id = $1
       ORDER BY gsl.changed_at ASC`,
      [gateTransactionId],
    );
    return res.rows.map((r) => ({
      id: r.id,
      fromStatus: r.from_status,
      toStatus: r.to_status,
      notes: r.notes,
      changedBy: r.changed_by,
      changedByUsername: r.changed_by_username,
      changedAt: r.changed_at,
    }));
  }

  async listPaginated(
    db: Queryable,
    filters: {
      status?: GateStatus | undefined;
      warehouseId?: string | undefined;
      direction?: MovementDirection | undefined;
      category?: TransportCategory | undefined;
      search?: string | undefined;
      limit: number;
      offset: number;
    },
  ): Promise<{ items: GateTransactionDetailEntity[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.status) {
      params.push(filters.status);
      conditions.push(`gt.status = $${params.length}`);
    }
    if (filters.warehouseId) {
      params.push(filters.warehouseId);
      conditions.push(`gt.warehouse_id = $${params.length}`);
    }
    if (filters.direction) {
      params.push(filters.direction);
      conditions.push(`gt.direction = $${params.length}`);
    }
    if (filters.category) {
      params.push(filters.category);
      conditions.push(`gt.category = $${params.length}`);
    }
    if (filters.search) {
      params.push(`%${filters.search}%`);
      conditions.push(
        `(gt.ticket_number ILIKE $${params.length} OR v.plate_number ILIKE $${params.length} OR gt.driver_name ILIKE $${params.length})`,
      );
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(filters.limit, filters.offset);
    const limitIdx = params.length - 1;
    const offsetIdx = params.length;

    const res = await executeQuery<RawJoinedGateTxRow & { total_count: string }>(
      db,
      `SELECT
         gt.id, gt.ticket_number, gt.vehicle_id, gt.warehouse_id, gt.dock_id,
         gt.driver_name, gt.driver_license_no, gt.direction, gt.category, gt.status,
         gt.gate_in_at, gt.gate_out_at, gt.created_by, gt.created_at, gt.updated_at,
         v.plate_number, v.v_type, v.company_name, v.max_weight_kg,
         w.code AS warehouse_code, w.name AS warehouse_name,
         ld.dock_number,
         tc.id AS container_id, tc.container_number, tc.size AS container_size,
         tc.seal_number, tc.is_empty,
         u.username AS creator_username, u.full_name AS creator_full_name,
         COUNT(*) OVER()::text AS total_count
       FROM gate_transactions gt
       INNER JOIN vehicles v ON v.id = gt.vehicle_id
       INNER JOIN warehouses w ON w.id = gt.warehouse_id
       LEFT JOIN loading_docks ld ON ld.id = gt.dock_id
       LEFT JOIN transaction_containers tc ON tc.gate_transaction_id = gt.id
       INNER JOIN users u ON u.id = gt.created_by
       ${whereClause}
       ORDER BY gt.created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    const total = Number(res.rows[0]?.total_count ?? '0');
    return {
      items: res.rows.map(mapJoinedGateTxRow),
      total,
    };
  }
}

export const gateTransactionRepository = new GateTransactionRepository();
