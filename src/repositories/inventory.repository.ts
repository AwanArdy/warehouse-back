import type { QueryResultRow } from 'pg';
import { executeQuery, type Queryable } from '../db/pool.js';

export interface LockedStockRow {
  id: string;
  availableQty: number;
}

export interface WarehouseStockDetailEntity {
  id: string;
  warehouseId: string;
  warehouseCode: string;
  itemId: string;
  skuCode: string;
  itemName: string;
  unit: string;
  unitVolumeM3: number;
  unitWeightKg: number;
  availableQty: number;
  totalVolumeM3: number;
  totalWeightKg: number;
  updatedAt: Date;
}

export interface StockMovementEntity {
  id: string;
  warehouseId: string;
  warehouseCode: string;
  itemId: string;
  skuCode: string;
  itemName: string;
  unit: string;
  gateTransactionId: string;
  ticketNumber: string;
  movementType: 'IN' | 'OUT';
  qtyDelta: number;
  balanceAfter: number;
  createdByUsername: string;
  createdAt: Date;
}

export interface WarehouseUtilizationSummary {
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  maxVolumeM3: number;
  usedVolumeM3: number;
  remainingVolumeM3: number;
  utilizationPercent: number;
  utilizationPercentage?: number;
  totalDistinctItems: number;
}

interface RawStockDetailRow extends QueryResultRow {
  id: string;
  warehouse_id: string;
  warehouse_code: string;
  item_id: string;
  sku_code: string;
  item_name: string;
  unit: string;
  unit_volume_m3: string;
  unit_weight_kg: string;
  available_qty: string;
  total_volume_m3: string;
  total_weight_kg: string;
  updated_at: Date;
}

interface RawMovementRow extends QueryResultRow {
  id: string;
  warehouse_id: string;
  warehouse_code: string;
  item_id: string;
  sku_code: string;
  item_name: string;
  unit: string;
  gate_transaction_id: string;
  ticket_number: string;
  movement_type: 'IN' | 'OUT';
  qty_delta: string;
  balance_after: string;
  created_by_username: string;
  created_at: Date;
}

export class InventoryRepository {
  /**
   * M4.2: Mengunci baris stok gudang per item menggunakan SELECT ... FOR UPDATE.
   */
  async lockStockForUpdate(
    db: Queryable,
    warehouseId: string,
    itemId: string,
  ): Promise<LockedStockRow | null> {
    const res = await executeQuery<{ id: string; available_qty: string }>(
      db,
      `SELECT id, available_qty
       FROM warehouse_stocks
       WHERE warehouse_id = $1 AND item_id = $2
       FOR UPDATE`,
      [warehouseId, itemId],
    );
    const row = res.rows[0];
    return row ? { id: row.id, availableQty: Number(row.available_qty) } : null;
  }

  /**
   * Penambahan stok atomik untuk proses INBOUND (insert baru jika item belum ada di gudang).
   */
  async upsertInboundStock(
    db: Queryable,
    warehouseId: string,
    itemId: string,
    qtyToAdd: number,
  ): Promise<number> {
    const res = await executeQuery<{ available_qty: string }>(
      db,
      `INSERT INTO warehouse_stocks (warehouse_id, item_id, available_qty)
       VALUES ($1, $2, $3)
       ON CONFLICT (warehouse_id, item_id)
       DO UPDATE SET available_qty = warehouse_stocks.available_qty + EXCLUDED.available_qty
       RETURNING available_qty`,
      [warehouseId, itemId, qtyToAdd],
    );
    const row = res.rows[0];
    if (!row) throw new Error('Gagal memperbarui saldo stok inbound');
    return Number(row.available_qty);
  }

  /**
   * Pengurangan stok atomik setelah baris dikunci dengan lockStockForUpdate.
   */
  async deductOutboundStock(
    db: Queryable,
    stockId: string,
    qtyToDeduct: number,
  ): Promise<number> {
    const res = await executeQuery<{ available_qty: string }>(
      db,
      `UPDATE warehouse_stocks
       SET available_qty = available_qty - $2
       WHERE id = $1
       RETURNING available_qty`,
      [stockId, qtyToDeduct],
    );
    const row = res.rows[0];
    if (!row) throw new Error('Gagal mengurangi saldo stok outbound');
    return Number(row.available_qty);
  }

  async recordMovement(
    db: Queryable,
    input: {
      warehouseId: string;
      itemId: string;
      gateTransactionId: string;
      movementType: 'IN' | 'OUT';
      qtyDelta: number;
      balanceAfter: number;
      createdBy: string;
    },
  ): Promise<void> {
    await executeQuery(
      db,
      `INSERT INTO stock_movements (
         warehouse_id, item_id, gate_transaction_id, movement_type,
         qty_delta, balance_after, created_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.warehouseId,
        input.itemId,
        input.gateTransactionId,
        input.movementType,
        input.qtyDelta,
        input.balanceAfter,
        input.createdBy,
      ],
    );
  }

  /**
   * M4.5: Menghitung utilisasi kapasitas volume gudang berdasarkan rumus FR-C3.
   */
  async getWarehouseUtilization(
    db: Queryable,
    warehouseId: string,
  ): Promise<WarehouseUtilizationSummary | null> {
    const res = await executeQuery<{
      warehouse_id: string;
      warehouse_code: string;
      warehouse_name: string;
      max_volume_m3: string;
      used_volume_m3: string;
      total_distinct_items: string;
    }>(
      db,
      `SELECT
         w.id AS warehouse_id,
         w.code AS warehouse_code,
         w.name AS warehouse_name,
         w.max_volume_m3::text,
         COALESCE(SUM(ws.available_qty * im.unit_volume_m3), 0)::text AS used_volume_m3,
         COUNT(ws.id) FILTER (WHERE ws.available_qty > 0)::text AS total_distinct_items
       FROM warehouses w
       LEFT JOIN warehouse_stocks ws ON ws.warehouse_id = w.id
       LEFT JOIN items_master im ON im.id = ws.item_id
       WHERE w.id = $1
       GROUP BY w.id, w.code, w.name, w.max_volume_m3`,
      [warehouseId],
    );

    const row = res.rows[0];
    if (!row) return null;

    const maxVol = Number(row.max_volume_m3);
    const usedVol = Number(row.used_volume_m3);
    const remainingVol = Math.max(0, Number((maxVol - usedVol).toFixed(4)));
    const utilPercent = maxVol > 0 ? Number(((usedVol / maxVol) * 100).toFixed(2)) : 0;

    return {
      warehouseId: row.warehouse_id,
      warehouseCode: row.warehouse_code,
      warehouseName: row.warehouse_name,
      maxVolumeM3: maxVol,
      usedVolumeM3: Number(usedVol.toFixed(4)),
      remainingVolumeM3: remainingVol,
      utilizationPercent: utilPercent,
      utilizationPercentage: utilPercent,
      totalDistinctItems: Number(row.total_distinct_items),
    };
  }

  async listWarehouseStocks(
    db: Queryable,
    warehouseId: string,
  ): Promise<WarehouseStockDetailEntity[]> {
    const res = await executeQuery<RawStockDetailRow>(
      db,
      `SELECT
         ws.id,
         ws.warehouse_id,
         w.code AS warehouse_code,
         ws.item_id,
         im.sku_code,
         im.name AS item_name,
         im.unit,
         im.unit_volume_m3::text,
         im.unit_weight_kg::text,
         ws.available_qty::text,
         (ws.available_qty * im.unit_volume_m3)::text AS total_volume_m3,
         (ws.available_qty * im.unit_weight_kg)::text AS total_weight_kg,
         ws.updated_at
       FROM warehouse_stocks ws
       INNER JOIN warehouses w ON w.id = ws.warehouse_id
       INNER JOIN items_master im ON im.id = ws.item_id
       WHERE ws.warehouse_id = $1
       ORDER BY im.sku_code ASC`,
      [warehouseId],
    );

    return res.rows.map((r) => ({
      id: r.id,
      warehouseId: r.warehouse_id,
      warehouseCode: r.warehouse_code,
      itemId: r.item_id,
      skuCode: r.sku_code,
      name: r.item_name,
      itemName: r.item_name,
      unit: r.unit,
      unitVolumeM3: Number(r.unit_volume_m3),
      unitWeightKg: Number(r.unit_weight_kg),
      availableQty: Number(r.available_qty),
      totalVolumeM3: Number(Number(r.total_volume_m3).toFixed(4)),
      totalWeightKg: Number(Number(r.total_weight_kg).toFixed(2)),
      updatedAt: r.updated_at,
    }));
  }

  async listMovements(
    db: Queryable,
    filters: {
      warehouseId?: string | undefined;
      itemId?: string | undefined;
      limit: number;
      offset: number;
    },
  ): Promise<{ items: StockMovementEntity[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.warehouseId) {
      params.push(filters.warehouseId);
      conditions.push(`sm.warehouse_id = $${params.length}`);
    }
    if (filters.itemId) {
      params.push(filters.itemId);
      conditions.push(`sm.item_id = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(filters.limit, filters.offset);

    const res = await executeQuery<RawMovementRow & { total_count: string }>(
      db,
      `SELECT
         sm.id,
         sm.warehouse_id,
         w.code AS warehouse_code,
         sm.item_id,
         im.sku_code,
         im.name AS item_name,
         im.unit,
         sm.gate_transaction_id,
         gt.ticket_number,
         sm.movement_type,
         sm.qty_delta::text,
         sm.balance_after::text,
         u.username AS created_by_username,
         sm.created_at,
         COUNT(*) OVER()::text AS total_count
       FROM stock_movements sm
       INNER JOIN warehouses w ON w.id = sm.warehouse_id
       INNER JOIN items_master im ON im.id = sm.item_id
       INNER JOIN gate_transactions gt ON gt.id = sm.gate_transaction_id
       INNER JOIN users u ON u.id = sm.created_by
       ${whereClause}
       ORDER BY sm.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const total = Number(res.rows[0]?.total_count ?? '0');
    return {
      total,
      items: res.rows.map((r) => ({
        id: r.id,
        warehouseId: r.warehouse_id,
        warehouseCode: r.warehouse_code,
        itemId: r.item_id,
        skuCode: r.sku_code,
        itemName: r.item_name,
        unit: r.unit,
        gateTransactionId: r.gate_transaction_id,
        ticketNumber: r.ticket_number,
        movementType: r.movement_type,
        qtyDelta: Number(r.qty_delta),
        balanceAfter: Number(r.balance_after),
        createdByUsername: r.created_by_username,
        createdAt: r.created_at,
      })),
    };
  }
}

export const inventoryRepository = new InventoryRepository();
