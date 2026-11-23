import { executeQuery, pool } from '../db/pool.js';
import { withTransaction } from '../db/transaction.js';
import { auditLogRepository } from '../repositories/audit-log.repository.js';
import { cargoItemRepository } from '../repositories/cargo-item.repository.js';
import { gateTransactionRepository } from '../repositories/gate-transaction.repository.js';
import { inventoryRepository } from '../repositories/inventory.repository.js';
import { itemMasterRepository } from '../repositories/item-master.repository.js';
import { vehicleRepository } from '../repositories/vehicle.repository.js';
import { NotFoundError, UnprocessableEntityError } from '../utils/errors.js';

export interface CargoItemInput {
  itemId: string;
  quantity: number;
  weightKg?: number | undefined;
  conditionNotes?: string | undefined;
}

export class CargoService {
  async createItemMaster(
    actorId: string,
    input: {
      skuCode: string;
      name: string;
      unit: string;
      unitVolumeM3: number;
      unitWeightKg: number;
    },
    ipAddress: string | null,
  ) {
    const normalizedSku = input.skuCode.toUpperCase().trim();
    return withTransaction(async (client) => {
      const item = await itemMasterRepository.create(client, {
        skuCode: normalizedSku,
        name: input.name.trim(),
        unit: input.unit.toUpperCase().trim(),
        unitVolumeM3: input.unitVolumeM3,
        unitWeightKg: input.unitWeightKg,
      });

      await auditLogRepository.record(client, {
        actorId,
        entityName: 'items_master',
        entityId: item.id,
        action: 'CREATE',
        newValues: {
          skuCode: item.skuCode,
          name: item.name,
          unit: item.unit,
          unitVolumeM3: item.unitVolumeM3,
          unitWeightKg: item.unitWeightKg,
        },
        ipAddress,
      });

      return item;
    });
  }

  async listItemsMaster(filters: { search?: string | undefined; limit: number; offset: number }) {
    return itemMasterRepository.list(pool, filters);
  }

  /**
   * M4.1: Mencatat atau memperbarui daftar rincian barang bongkar/muat pada transaksi gate.
   */
  async recordTransactionCargoItems(
    actorId: string,
    gateTransactionId: string,
    rawItems: readonly CargoItemInput[],
    ipAddress: string | null,
  ) {
    return withTransaction(async (client) => {
      const tx = await gateTransactionRepository.findByIdForUpdate(client, gateTransactionId);
      if (!tx) {
        throw new NotFoundError('Transaksi gerbang tidak ditemukan');
      }

      if (tx.status !== 'DOCKING' && tx.status !== 'LOADING_UNLOADING') {
        throw new UnprocessableEntityError(
          `Pencatatan rincian barang hanya diizinkan saat armada berstatus DOCKING atau LOADING_UNLOADING (status saat ini: ${tx.status})`,
          'INVALID_STATE_FOR_CARGO_RECORD',
        );
      }

      const uniqueIds = [...new Set(rawItems.map((i) => i.itemId))];
      const masterItems = await itemMasterRepository.findByIds(client, uniqueIds);
      const itemMap = new Map(masterItems.map((m) => [m.id, m]));

      if (itemMap.size !== uniqueIds.length) {
        throw new NotFoundError('Satu atau lebih item_id tidak ditemukan di master barang');
      }

      const preparedItems = rawItems.map((entry) => {
        const master = itemMap.get(entry.itemId);
        if (!master) {
          throw new NotFoundError(`Master barang ${entry.itemId} tidak ditemukan`);
        }
        const computedWeight =
          entry.weightKg !== undefined
            ? entry.weightKg
            : Number((entry.quantity * master.unitWeightKg).toFixed(2));

        return {
          itemId: entry.itemId,
          quantity: entry.quantity,
          weightKg: computedWeight,
          conditionNotes: entry.conditionNotes,
        };
      });

      // Validasi kapasitas tonase kendaraan
      const vehicle = await vehicleRepository.findById(client, tx.vehicleId);
      if (vehicle) {
        const totalWeightKg = preparedItems.reduce((sum, item) => sum + item.weightKg, 0);
        if (totalWeightKg > vehicle.maxWeightKg) {
          throw new UnprocessableEntityError(
            `Total berat muatan (${totalWeightKg.toFixed(2)} kg) melebihi kapasitas maksimal armada ${vehicle.plateNumber} (${vehicle.maxWeightKg} kg)`,
            'VEHICLE_MAX_WEIGHT_EXCEEDED',
          );
        }
      }

      await cargoItemRepository.replaceItemsForTransaction(client, tx.id, preparedItems);

      if (tx.status === 'DOCKING') {
        await executeQuery(
          client,
          `UPDATE gate_transactions SET status = 'LOADING_UNLOADING' WHERE id = $1`,
          [tx.id],
        );
        await gateTransactionRepository.insertStatusLog(client, {
          gateTransactionId: tx.id,
          fromStatus: 'DOCKING',
          toStatus: 'LOADING_UNLOADING',
          notes: `Rincian muatan dicatat (${preparedItems.length} baris item)`,
          changedBy: actorId,
        });
      }

      await auditLogRepository.record(client, {
        actorId,
        entityName: 'transaction_cargo_items',
        entityId: tx.id,
        action: 'UPDATE',
        newValues: {
          ticketNumber: tx.ticketNumber,
          itemCount: preparedItems.length,
        },
        ipAddress,
      });

      const items = await cargoItemRepository.listByTransactionId(client, tx.id);
      return {
        gateTransactionId: tx.id,
        ticketNumber: tx.ticketNumber,
        status: 'LOADING_UNLOADING',
        items,
      };
    });
  }

  async getTransactionCargoItems(gateTransactionId: string) {
    const detail = await gateTransactionRepository.findDetailById(pool, gateTransactionId);
    if (!detail) {
      throw new NotFoundError('Transaksi gerbang tidak ditemukan');
    }
    const items = await cargoItemRepository.listByTransactionId(pool, gateTransactionId);
    return {
      gateTransactionId: detail.id,
      ticketNumber: detail.ticketNumber,
      direction: detail.direction,
      status: detail.status,
      items,
    };
  }

  /**
   * M4.3: Finalisasi bongkar barang INBOUND -> tambah stok gudang & catat ledger IN.
   */
  async finalizeInboundUnloading(
    actorId: string,
    gateTransactionId: string,
    ipAddress: string | null,
  ) {
    return withTransaction(async (client) => {
      const tx = await gateTransactionRepository.findByIdForUpdate(client, gateTransactionId);
      if (!tx) {
        throw new NotFoundError('Transaksi gerbang tidak ditemukan');
      }

      if (tx.direction !== 'INBOUND') {
        throw new UnprocessableEntityError(
          'Endpoint ini hanya berlaku untuk transaksi dengan arah INBOUND (bongkar ke gudang)',
          'INVALID_DIRECTION_FOR_INBOUND',
        );
      }

      if (tx.status !== 'LOADING_UNLOADING') {
        throw new UnprocessableEntityError(
          `Finalisasi bongkar hanya dapat dilakukan pada status LOADING_UNLOADING (status saat ini: ${tx.status})`,
          'INVALID_STATE_FOR_FINALIZE',
        );
      }

      const aggregated = await cargoItemRepository.listAggregatedByTransactionId(client, tx.id);
      if (aggregated.length === 0) {
        throw new UnprocessableEntityError(
          'Tidak dapat menyelesaikan bongkar: daftar rincian barang masih kosong',
          'EMPTY_CARGO_ITEMS',
        );
      }

      // Validasi sisa kapasitas volume gudang sebelum memasukkan stok
      const utilization = await inventoryRepository.getWarehouseUtilization(
        client,
        tx.warehouseId,
      );
      if (!utilization) {
        throw new NotFoundError('Gudang transaksi tidak ditemukan');
      }

      const incomingVolumeM3 = aggregated.reduce((sum, item) => sum + item.totalVolumeM3, 0);
      if (utilization.usedVolumeM3 + incomingVolumeM3 > utilization.maxVolumeM3) {
        throw new UnprocessableEntityError(
          `Kapasitas volume gudang ${utilization.warehouseCode} tidak mencukupi (terpakai: ${utilization.usedVolumeM3} m3, masuk: ${incomingVolumeM3.toFixed(4)} m3, maksimal: ${utilization.maxVolumeM3} m3)`,
          'WAREHOUSE_CAPACITY_EXCEEDED',
        );
      }

      const movements: {
        itemId: string;
        skuCode: string;
        qtyAdded: number;
        balanceAfter: number;
      }[] = [];

      for (const item of aggregated) {
        const balanceAfter = await inventoryRepository.upsertInboundStock(
          client,
          tx.warehouseId,
          item.itemId,
          item.totalQuantity,
        );

        await inventoryRepository.recordMovement(client, {
          warehouseId: tx.warehouseId,
          itemId: item.itemId,
          gateTransactionId: tx.id,
          movementType: 'IN',
          qtyDelta: item.totalQuantity,
          balanceAfter,
          createdBy: actorId,
        });

        movements.push({
          itemId: item.itemId,
          skuCode: item.skuCode,
          qtyAdded: item.totalQuantity,
          balanceAfter,
        });
      }

      await executeQuery(
        client,
        `UPDATE gate_transactions SET status = 'DOC_PENDING' WHERE id = $1`,
        [tx.id],
      );

      await gateTransactionRepository.insertStatusLog(client, {
        gateTransactionId: tx.id,
        fromStatus: 'LOADING_UNLOADING',
        toStatus: 'DOC_PENDING',
        notes: 'Bongkar muatan Inbound selesai & stok gudang telah diperbarui',
        changedBy: actorId,
      });

      await auditLogRepository.record(client, {
        actorId,
        entityName: 'gate_transactions',
        entityId: tx.id,
        action: 'UPDATE',
        oldValues: { status: 'LOADING_UNLOADING' },
        newValues: { status: 'DOC_PENDING', movementType: 'IN', movements },
        ipAddress,
      });

      return {
        gateTransactionId: tx.id,
        ticketNumber: tx.ticketNumber,
        status: 'DOC_PENDING',
        requiredDocument: 'BASTB',
        movements,
      };
    });
  }

  /**
   * M4.4: Finalisasi muat barang OUTBOUND -> kunci baris stok (FOR UPDATE), validasi saldo, & catat ledger OUT.
   */
  async finalizeOutboundLoading(
    actorId: string,
    gateTransactionId: string,
    ipAddress: string | null,
  ) {
    return withTransaction(async (client) => {
      const tx = await gateTransactionRepository.findByIdForUpdate(client, gateTransactionId);
      if (!tx) {
        throw new NotFoundError('Transaksi gerbang tidak ditemukan');
      }

      if (tx.direction !== 'OUTBOUND') {
        throw new UnprocessableEntityError(
          'Endpoint ini hanya berlaku untuk transaksi dengan arah OUTBOUND (muat dari gudang)',
          'INVALID_DIRECTION_FOR_OUTBOUND',
        );
      }

      if (tx.status !== 'LOADING_UNLOADING') {
        throw new UnprocessableEntityError(
          `Finalisasi muat hanya dapat dilakukan pada status LOADING_UNLOADING (status saat ini: ${tx.status})`,
          'INVALID_STATE_FOR_FINALIZE',
        );
      }

      const aggregated = await cargoItemRepository.listAggregatedByTransactionId(client, tx.id);
      if (aggregated.length === 0) {
        throw new UnprocessableEntityError(
          'Tidak dapat menyelesaikan muat: daftar rincian barang masih kosong',
          'EMPTY_CARGO_ITEMS',
        );
      }

      const movements: {
        itemId: string;
        skuCode: string;
        qtyDeducted: number;
        balanceAfter: number;
      }[] = [];

      // Kunci dan validasi setiap item secara berurutan (item_id ASC) untuk mencegah race condition & deadlock
      for (const item of aggregated) {
        const lockedStock = await inventoryRepository.lockStockForUpdate(
          client,
          tx.warehouseId,
          item.itemId,
        );

        const available = lockedStock?.availableQty ?? 0;
        if (!lockedStock || available < item.totalQuantity) {
          throw new UnprocessableEntityError(
            `Stok barang ${item.skuCode} (${item.itemName}) tidak mencukupi: tersedia ${available} ${item.unit}, diminta ${item.totalQuantity} ${item.unit}`,
            'INSUFFICIENT_WAREHOUSE_STOCK',
          );
        }

        const balanceAfter = await inventoryRepository.deductOutboundStock(
          client,
          lockedStock.id,
          item.totalQuantity,
        );

        await inventoryRepository.recordMovement(client, {
          warehouseId: tx.warehouseId,
          itemId: item.itemId,
          gateTransactionId: tx.id,
          movementType: 'OUT',
          qtyDelta: item.totalQuantity,
          balanceAfter,
          createdBy: actorId,
        });

        movements.push({
          itemId: item.itemId,
          skuCode: item.skuCode,
          qtyDeducted: item.totalQuantity,
          balanceAfter,
        });
      }

      await executeQuery(
        client,
        `UPDATE gate_transactions SET status = 'DOC_PENDING' WHERE id = $1`,
        [tx.id],
      );

      await gateTransactionRepository.insertStatusLog(client, {
        gateTransactionId: tx.id,
        fromStatus: 'LOADING_UNLOADING',
        toStatus: 'DOC_PENDING',
        notes: 'Muat barang Outbound selesai & stok gudang telah dikurangi',
        changedBy: actorId,
      });

      await auditLogRepository.record(client, {
        actorId,
        entityName: 'gate_transactions',
        entityId: tx.id,
        action: 'UPDATE',
        oldValues: { status: 'LOADING_UNLOADING' },
        newValues: { status: 'DOC_PENDING', movementType: 'OUT', movements },
        ipAddress,
      });

      return {
        gateTransactionId: tx.id,
        ticketNumber: tx.ticketNumber,
        status: 'DOC_PENDING',
        requiredDocument: 'SURAT_JALAN',
        movements,
      };
    });
  }

  /**
   * M4.5: Laporan posisi stok terkini dan persentase utilisasi volume gudang.
   */
  async getWarehouseInventoryReport(warehouseId: string) {
    const utilization = await inventoryRepository.getWarehouseUtilization(pool, warehouseId);
    if (!utilization) {
      throw new NotFoundError('Gudang tidak ditemukan');
    }
    const stocks = await inventoryRepository.listWarehouseStocks(pool, warehouseId);
    return {
      utilization,
      stocks,
    };
  }

  async listStockMovements(filters: {
    warehouseId?: string | undefined;
    itemId?: string | undefined;
    limit: number;
    offset: number;
  }) {
    return inventoryRepository.listMovements(pool, filters);
  }
}

export const cargoService = new CargoService();
