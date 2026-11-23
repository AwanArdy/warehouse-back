import { pool } from '../db/pool.js';
import { withTransaction } from '../db/transaction.js';
import { auditLogRepository } from '../repositories/audit-log.repository.js';
import { vehicleRepository } from '../repositories/vehicle.repository.js';
import { warehouseDockRepository } from '../repositories/warehouse-dock.repository.js';
import type { DockStatus, TransportCategory, VehicleType } from '../types/domain.js';
import { ConflictError, NotFoundError, UnprocessableEntityError } from '../utils/errors.js';

export function normalizePlateNumber(raw: string): string {
  return raw.toUpperCase().replace(/\s+/g, '').trim();
}

export class MasterService {
  async createWarehouse(
    actorId: string,
    input: { code: string; name: string; maxVolumeM3: number },
    ipAddress: string | null,
  ) {
    const normalizedCode = input.code.toUpperCase().trim();
    return withTransaction(async (client) => {
      const warehouse = await warehouseDockRepository.createWarehouse(client, {
        code: normalizedCode,
        name: input.name.trim(),
        maxVolumeM3: input.maxVolumeM3,
      });

      await auditLogRepository.record(client, {
        actorId,
        entityName: 'warehouses',
        entityId: warehouse.id,
        action: 'CREATE',
        newValues: {
          code: warehouse.code,
          name: warehouse.name,
          maxVolumeM3: warehouse.maxVolumeM3,
        },
        ipAddress,
      });

      return warehouse;
    });
  }

  async listWarehouses() {
    return warehouseDockRepository.listWarehouses(pool);
  }

  async createDock(
    actorId: string,
    input: { warehouseId: string; dockNumber: string; category: TransportCategory },
    ipAddress: string | null,
  ) {
    const normalizedDock = input.dockNumber.toUpperCase().trim();
    return withTransaction(async (client) => {
      const warehouse = await warehouseDockRepository.findWarehouseById(client, input.warehouseId);
      if (!warehouse) {
        throw new NotFoundError('Gudang tujuan tidak ditemukan');
      }

      const dock = await warehouseDockRepository.createDock(client, {
        warehouseId: input.warehouseId,
        dockNumber: normalizedDock,
        category: input.category,
      });

      await auditLogRepository.record(client, {
        actorId,
        entityName: 'loading_docks',
        entityId: dock.id,
        action: 'CREATE',
        newValues: {
          warehouseCode: warehouse.code,
          dockNumber: dock.dockNumber,
          category: dock.category,
        },
        ipAddress,
      });

      return dock;
    });
  }

  async listDocks(filters: {
    warehouseId?: string | undefined;
    category?: TransportCategory | undefined;
    status?: DockStatus | undefined;
  }) {
    return warehouseDockRepository.listDocks(pool, filters);
  }

  async updateDockStatus(
    actorId: string,
    dockId: string,
    newStatus: DockStatus,
    ipAddress: string | null,
  ) {
    return withTransaction(async (client) => {
      const existing = await warehouseDockRepository.findDockByIdForUpdate(client, dockId);
      if (!existing) {
        throw new NotFoundError('Loading dock tidak ditemukan');
      }

      if (existing.status === 'OCCUPIED' && newStatus === 'MAINTENANCE') {
        throw new ConflictError(
          'Loading dock sedang digunakan (OCCUPIED). Selesaikan transaksi kendaraan terlebih dahulu sebelum mengubah ke MAINTENANCE.',
          'DOCK_CURRENTLY_OCCUPIED',
        );
      }

      const updated = await warehouseDockRepository.updateDockStatus(client, dockId, newStatus);

      await auditLogRepository.record(client, {
        actorId,
        entityName: 'loading_docks',
        entityId: dockId,
        action: 'UPDATE',
        oldValues: { status: existing.status },
        newValues: { status: updated.status },
        ipAddress,
      });

      return updated;
    });
  }

  async registerVehicle(
    actorId: string,
    input: {
      plateNumber: string;
      category: TransportCategory;
      vType: VehicleType;
      companyName: string;
      maxWeightKg: number;
    },
    ipAddress: string | null,
  ) {
    // Penegakan aturan armada di lapisan aplikasi sebelum menyentuh database
    const isValidPair =
      (input.category === 'CARGO' && input.vType === 'MOBIL_BOX') ||
      (input.category === 'CONTAINER' &&
        (input.vType === 'TRAILER' || input.vType === 'TRONTON'));

    if (!isValidPair) {
      throw new UnprocessableEntityError(
        'Kombinasi kategori dan tipe kendaraan ditolak: CARGO hanya mengizinkan MOBIL_BOX, sedangkan CONTAINER hanya mengizinkan TRAILER atau TRONTON.',
        'INVALID_VEHICLE_CATEGORY_PAIR',
      );
    }

    const plateNumber = normalizePlateNumber(input.plateNumber);

    return withTransaction(async (client) => {
      const vehicle = await vehicleRepository.create(client, {
        plateNumber,
        category: input.category,
        vType: input.vType,
        companyName: input.companyName.trim(),
        maxWeightKg: input.maxWeightKg,
      });

      await auditLogRepository.record(client, {
        actorId,
        entityName: 'vehicles',
        entityId: vehicle.id,
        action: 'CREATE',
        newValues: {
          plateNumber: vehicle.plateNumber,
          category: vehicle.category,
          vType: vehicle.vType,
          companyName: vehicle.companyName,
          maxWeightKg: vehicle.maxWeightKg,
        },
        ipAddress,
      });

      return vehicle;
    });
  }

  async lookupVehicleByPlate(rawPlate: string) {
    const normalized = normalizePlateNumber(rawPlate);
    const vehicle = await vehicleRepository.findByPlateNumber(pool, normalized);
    if (!vehicle) {
      throw new NotFoundError(`Kendaraan dengan nomor polisi '${normalized}' tidak terdaftar`);
    }
    return vehicle;
  }

  async listVehicles(filters: {
    search?: string | undefined;
    category?: TransportCategory | undefined;
    limit: number;
    offset: number;
  }) {
    return vehicleRepository.list(pool, filters);
  }
}

export const masterService = new MasterService();
