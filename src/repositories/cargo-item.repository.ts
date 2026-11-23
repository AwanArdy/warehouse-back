import type { QueryResultRow } from 'pg';
import { executeQuery, type Queryable } from '../db/pool.js';

export interface TransactionCargoItemEntity {
  id: string;
  gateTransactionId: string;
  itemId: string;
  skuCode: string;
  itemName: string;
  unit: string;
  unitVolumeM3: number;
  quantity: number;
  weightKg: number;
  conditionNotes: string | null;
  createdAt: Date;
}

export interface AggregatedCargoItem {
  itemId: string;
  skuCode: string;
  itemName: string;
  unit: string;
  totalQuantity: number;
  totalVolumeM3: number;
  totalWeightKg: number;
}

interface JoinedCargoItemRow extends QueryResultRow {
  id: string;
  gate_transaction_id: string;
  item_id: string;
  sku_code: string;
  item_name: string;
  unit: string;
  unit_volume_m3: string;
  quantity: string;
  weight_kg: string;
  condition_notes: string | null;
  created_at: Date;
}

function mapCargoItemRow(row: JoinedCargoItemRow): TransactionCargoItemEntity {
  return {
    id: row.id,
    gateTransactionId: row.gate_transaction_id,
    itemId: row.item_id,
    skuCode: row.sku_code,
    itemName: row.item_name,
    unit: row.unit,
    unitVolumeM3: Number(row.unit_volume_m3),
    quantity: Number(row.quantity),
    weightKg: Number(row.weight_kg),
    conditionNotes: row.condition_notes,
    createdAt: row.created_at,
  };
}

export class CargoItemRepository {
  async replaceItemsForTransaction(
    db: Queryable,
    gateTransactionId: string,
    items: readonly {
      itemId: string;
      quantity: number;
      weightKg: number;
      conditionNotes?: string | undefined;
    }[],
  ): Promise<void> {
    await executeQuery(
      db,
      'DELETE FROM transaction_cargo_items WHERE gate_transaction_id = $1',
      [gateTransactionId],
    );

    for (const item of items) {
      await executeQuery(
        db,
        `INSERT INTO transaction_cargo_items (
           gate_transaction_id, item_id, quantity, weight_kg, condition_notes
         )
         VALUES ($1, $2, $3, $4, $5)`,
        [
          gateTransactionId,
          item.itemId,
          item.quantity,
          item.weightKg,
          item.conditionNotes ?? null,
        ],
      );
    }
  }

  async listByTransactionId(
    db: Queryable,
    gateTransactionId: string,
  ): Promise<TransactionCargoItemEntity[]> {
    const res = await executeQuery<JoinedCargoItemRow>(
      db,
      `SELECT
         tci.id,
         tci.gate_transaction_id,
         tci.item_id,
         im.sku_code,
         im.name AS item_name,
         im.unit,
         im.unit_volume_m3,
         tci.quantity,
         tci.weight_kg,
         tci.condition_notes,
         tci.created_at
       FROM transaction_cargo_items tci
       INNER JOIN items_master im ON im.id = tci.item_id
       WHERE tci.gate_transaction_id = $1
       ORDER BY tci.created_at ASC, im.sku_code ASC`,
      [gateTransactionId],
    );
    return res.rows.map(mapCargoItemRow);
  }

  /**
   * Mengagregasi kuantitas per item_id yang diurutkan deterministik (ORDER BY item_id ASC)
   * untuk mencegah deadlock saat melakukan row-level locking pada warehouse_stocks.
   */
  async listAggregatedByTransactionId(
    db: Queryable,
    gateTransactionId: string,
  ): Promise<AggregatedCargoItem[]> {
    const res = await executeQuery<{
      item_id: string;
      sku_code: string;
      item_name: string;
      unit: string;
      total_qty: string;
      total_vol: string;
      total_weight: string;
    }>(
      db,
      `SELECT
         tci.item_id,
         im.sku_code,
         im.name AS item_name,
         im.unit,
         SUM(tci.quantity)::text AS total_qty,
         SUM(tci.quantity * im.unit_volume_m3)::text AS total_vol,
         SUM(tci.weight_kg)::text AS total_weight
       FROM transaction_cargo_items tci
       INNER JOIN items_master im ON im.id = tci.item_id
       WHERE tci.gate_transaction_id = $1
       GROUP BY tci.item_id, im.sku_code, im.name, im.unit
       ORDER BY tci.item_id ASC`,
      [gateTransactionId],
    );

    return res.rows.map((r) => ({
      itemId: r.item_id,
      skuCode: r.sku_code,
      itemName: r.item_name,
      unit: r.unit,
      totalQuantity: Number(r.total_qty),
      totalVolumeM3: Number(r.total_vol),
      totalWeightKg: Number(r.total_weight),
    }));
  }
}

export const cargoItemRepository = new CargoItemRepository();
