import type { QueryResultRow } from 'pg';
import { executeQuery, type Queryable } from '../db/pool.js';

export interface ItemMasterEntity {
  id: string;
  skuCode: string;
  name: string;
  unit: string;
  unitVolumeM3: number;
  unitWeightKg: number;
  createdAt: Date;
}

interface ItemMasterRow extends QueryResultRow {
  id: string;
  sku_code: string;
  name: string;
  unit: string;
  unit_volume_m3: string;
  unit_weight_kg: string;
  created_at: Date;
}

function mapItemMasterRow(row: ItemMasterRow): ItemMasterEntity {
  return {
    id: row.id,
    skuCode: row.sku_code,
    name: row.name,
    unit: row.unit,
    unitVolumeM3: Number(row.unit_volume_m3),
    unitWeightKg: Number(row.unit_weight_kg),
    createdAt: row.created_at,
  };
}

export class ItemMasterRepository {
  async create(
    db: Queryable,
    input: {
      skuCode: string;
      name: string;
      unit: string;
      unitVolumeM3: number;
      unitWeightKg: number;
    },
  ): Promise<ItemMasterEntity> {
    const res = await executeQuery<ItemMasterRow>(
      db,
      `INSERT INTO items_master (sku_code, name, unit, unit_volume_m3, unit_weight_kg)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, sku_code, name, unit, unit_volume_m3, unit_weight_kg, created_at`,
      [input.skuCode, input.name, input.unit, input.unitVolumeM3, input.unitWeightKg],
    );
    const row = res.rows[0];
    if (!row) throw new Error('Gagal menyimpan master barang');
    return mapItemMasterRow(row);
  }

  async findByIds(db: Queryable, ids: readonly string[]): Promise<ItemMasterEntity[]> {
    if (ids.length === 0) return [];
    const res = await executeQuery<ItemMasterRow>(
      db,
      `SELECT id, sku_code, name, unit, unit_volume_m3, unit_weight_kg, created_at
       FROM items_master
       WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    return res.rows.map(mapItemMasterRow);
  }

  async list(
    db: Queryable,
    filters: { search?: string | undefined; limit: number; offset: number },
  ): Promise<{ items: ItemMasterEntity[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.search) {
      params.push(`%${filters.search}%`);
      conditions.push(`(sku_code ILIKE $${params.length} OR name ILIKE $${params.length})`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(filters.limit, filters.offset);

    const res = await executeQuery<ItemMasterRow & { total_count: string }>(
      db,
      `SELECT
         id, sku_code, name, unit, unit_volume_m3, unit_weight_kg, created_at,
         COUNT(*) OVER()::text AS total_count
       FROM items_master
       ${whereClause}
       ORDER BY sku_code ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const total = Number(res.rows[0]?.total_count ?? '0');
    return { items: res.rows.map(mapItemMasterRow), total };
  }
}

export const itemMasterRepository = new ItemMasterRepository();
