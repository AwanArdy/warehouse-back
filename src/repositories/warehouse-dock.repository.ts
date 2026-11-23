import type { QueryResultRow } from "pg";
import { executeQuery, type Queryable } from "../db/pool.js";
import type { DockStatus, TransportCategory } from "../types/domain.js";

export interface WarehouseEntity {
  id: string;
  code: string;
  name: string;
  maxVolumeM3: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface LoadingDockEntity {
  id: string;
  warehouseId: string;
  warehouseCode?: string;
  warehouseName?: string;
  dockNumber: string;
  category: TransportCategory;
  status: DockStatus;
  createdAt: Date;
  updatedAt: Date;
}

interface WarehouseRow extends QueryResultRow {
  id: string;
  code: string;
  name: string;
  max_volume_m3: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

interface LoadingDockRow extends QueryResultRow {
  id: string;
  warehouse_id: string;
  warehouse_code?: string;
  warehouse_name?: string;
  dock_number: string;
  category: TransportCategory;
  status: DockStatus;
  created_at: Date;
  updatedAt: Date;
}

function mapWarehouseRow(row: WarehouseRow): WarehouseEntity {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    maxVolumeM3: Number(row.max_volume_m3),
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapLoadingDockRow(row: LoadingDockRow): LoadingDockEntity {
  return {
    id: row.id,
    warehouseId: row.warehouse_id,
    ...(row.warehouse_code !== undefined ? { warehouseCode: row.warehouse_code } : {}),
    ...(row.warehouse_name !== undefined ? { warehouseName: row.warehouse_name } : {}),
    dockNumber: row.dock_number,
    category: row.category,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class WarehouseDockRepository {
  async createWarehouse(
    db: Queryable,
    input: { code: string; name: string; maxVolumeM3: number },
  ): Promise<WarehouseEntity> {
    const res = await executeQuery<WarehouseRow>(
      db,
      `INSERT INTO warehouses (code, name, max_volume_m3)
       VALUES ($1, $2, $3)
       RETURNING id, code, name, max_volume_m3, is_active, created_at, updated_at`,
      [input.code, input.name, input.maxVolumeM3],
    );
    const row = res.rows[0];
    if (!row) throw new Error('Gagal menyimpan data master gudang');
    return mapWarehouseRow(row);
  }

  async findWarehouseById(db: Queryable, id: string): Promise<WarehouseEntity | null> {
    const res = await executeQuery<WarehouseRow>(
      db,
      `SELECT id, code, name, max_volume_m3, is_active, created_at, updated_at
       FROM warehouses
       WHERE id = $1`,
      [id],
    );
    const row = res.rows[0];
    return row ? mapWarehouseRow(row) : null;
  }

  async listWarehouses(db: Queryable): Promise<WarehouseEntity[]> {
    const res = await executeQuery<WarehouseRow>(
      db,
      `SELECT id, code, name, max_volume_m3, is_active, created_at, updated_at
       FROM warehouses
       ORDER BY code ASC`,
    );
    return res.rows.map(mapWarehouseRow);
  }

  async createDock(
    db: Queryable,
    input: { warehouseId: string; dockNumber: string; category: TransportCategory },
  ): Promise<LoadingDockEntity> {
    const res = await executeQuery<LoadingDockRow>(
      db,
      `INSERT INTO loading_docks (warehouse_id, dock_number, category)
       VALUES ($1, $2, $3)
       RETURNING id, warehouse_id, dock_number, category, status, created_at, updated_at`,
      [input.warehouseId, input.dockNumber, input.category],
    );
    const row = res.rows[0];
    if (!row) throw new Error('Gagal menyimpan data loading dock');
    return mapLoadingDockRow(row);
  }

  async findDockByIdForUpdate(db: Queryable, id: string): Promise<LoadingDockEntity | null> {
    const res = await executeQuery<LoadingDockRow>(
      db,
      `SELECT id, warehouse_id, dock_number, category, status, created_at, updated_at
       FROM loading_docks
       WHERE id = $1
       FOR UPDATE`,
      [id],
    );
    const row = res.rows[0];
    return row ? mapLoadingDockRow(row) : null;
  }

  async listDocks(
    db: Queryable,
    filters: {
      warehouseId?: string | undefined;
      category?: TransportCategory | undefined;
      status?: DockStatus | undefined;
    },
  ): Promise<LoadingDockEntity[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.warehouseId) {
      params.push(filters.warehouseId);
      conditions.push(`ld.warehouse_id = $${params.length}`);
    }
    if (filters.category) {
      params.push(filters.category);
      conditions.push(`ld.category = $${params.length}`);
    }
    if (filters.status) {
      params.push(filters.status);
      conditions.push(`ld.status = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const res = await executeQuery<LoadingDockRow>(
      db,
      `SELECT
         ld.id,
         ld.warehouse_id,
         w.code AS warehouse_code,
         w.name AS warehouse_name,
         ld.dock_number,
         ld.category,
         ld.status,
         ld.created_at,
         ld.updated_at
       FROM loading_docks ld
       INNER JOIN warehouses w ON w.id = ld.warehouse_id
       ${whereClause}
       ORDER BY w.code ASC, ld.dock_number ASC`,
      params,
    );

    return res.rows.map(mapLoadingDockRow);
  }

  async updateDockStatus(
    db: Queryable,
    dockId: string,
    status: DockStatus,
  ): Promise<LoadingDockEntity> {
    const res = await executeQuery<LoadingDockRow>(
      db,
      `UPDATE loading_docks
       SET status = $2
       WHERE id = $1
       RETURNING id, warehouse_id, dock_number, category, status, created_at, updated_at`,
      [dockId, status],
    );
    const row = res.rows[0];
    if (!row) throw new Error('Loading dock tidak ditemukan saat memperbarui status');
    return mapLoadingDockRow(row);
  }
}

export const warehouseDockRepository = new WarehouseDockRepository();
