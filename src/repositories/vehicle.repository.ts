import type { QueryResultRow } from 'pg';
import { executeQuery, type Queryable } from '../db/pool.js';
import type { TransportCategory, VehicleType } from '../types/domain.js';

export interface VehicleEntity {
  id: string;
  plateNumber: string;
  category: TransportCategory;
  vType: VehicleType;
  companyName: string;
  maxWeightKg: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface VehicleRow extends QueryResultRow {
  id: string;
  plate_number: string;
  category: TransportCategory;
  v_type: VehicleType;
  company_name: string;
  max_weight_kg: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

function mapVehicleRow(row: VehicleRow): VehicleEntity {
  return {
    id: row.id,
    plateNumber: row.plate_number,
    category: row.category,
    vType: row.v_type,
    companyName: row.company_name,
    maxWeightKg: Number(row.max_weight_kg),
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class VehicleRepository {
  async create(
    db: Queryable,
    input: {
      plateNumber: string;
      category: TransportCategory;
      vType: VehicleType;
      companyName: string;
      maxWeightKg: number;
    },
  ): Promise<VehicleEntity> {
    const res = await executeQuery<VehicleRow>(
      db,
      `INSERT INTO vehicles (plate_number, category, v_type, company_name, max_weight_kg)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, plate_number, category, v_type, company_name, max_weight_kg, is_active, created_at, updated_at`,
      [input.plateNumber, input.category, input.vType, input.companyName, input.maxWeightKg],
    );
    const row = res.rows[0];
    if (!row) throw new Error('Gagal mendaftarkan master kendaraan');
    return mapVehicleRow(row);
  }

  async findById(db: Queryable, id: string): Promise<VehicleEntity | null> {
    const res = await executeQuery<VehicleRow>(
      db,
      `SELECT id, plate_number, category, v_type, company_name, max_weight_kg, is_active, created_at, updated_at
       FROM vehicles
       WHERE id = $1`,
      [id],
    );
    const row = res.rows[0];
    return row ? mapVehicleRow(row) : null;
  }

  async findByPlateNumber(db: Queryable, normalizedPlate: string): Promise<VehicleEntity | null> {
    const res = await executeQuery<VehicleRow>(
      db,
      `SELECT id, plate_number, category, v_type, company_name, max_weight_kg, is_active, created_at, updated_at
       FROM vehicles
       WHERE plate_number = $1`,
      [normalizedPlate],
    );
    const row = res.rows[0];
    return row ? mapVehicleRow(row) : null;
  }

  async list(
    db: Queryable,
    filters: {
      search?: string | undefined;
      category?: TransportCategory | undefined;
      limit: number;
      offset: number;
    },
  ): Promise<{ items: VehicleEntity[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.search) {
      params.push(`%${filters.search}%`);
      conditions.push(`(plate_number ILIKE $${params.length} OR company_name ILIKE $${params.length})`);
    }
    if (filters.category) {
      params.push(filters.category);
      conditions.push(`category = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(filters.limit, filters.offset);
    const limitIdx = params.length - 1;
    const offsetIdx = params.length;

    const res = await executeQuery<VehicleRow & { total_count: string }>(
      db,
      `SELECT
         id, plate_number, category, v_type, company_name, max_weight_kg, is_active, created_at, updated_at,
         COUNT(*) OVER()::text AS total_count
       FROM vehicles
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    const total = Number(res.rows[0]?.total_count ?? '0');
    return {
      items: res.rows.map(mapVehicleRow),
      total,
    };
  }
}

export const vehicleRepository = new VehicleRepository();
