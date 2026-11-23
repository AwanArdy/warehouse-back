import { pool } from '../db/pool.js';
import { withTransaction } from '../db/transaction.js';
import { auditLogRepository } from '../repositories/audit-log.repository.js';
import { gateTransactionRepository } from '../repositories/gate-transaction.repository.js';
import { vehicleRepository } from '../repositories/vehicle.repository.js';
import { warehouseDockRepository } from '../repositories/warehouse-dock.repository.js';
import type {
  ContainerSize,
  DocType,
  GateStatus,
  MovementDirection,
  TransportCategory,
} from '../types/domain.js';
import {
  ConflictError,
  NotFoundError,
  UnprocessableEntityError,
} from '../utils/errors.js';

export interface GateInInput {
  vehicleId: string;
  warehouseId: string;
  driverName: string;
  driverLicenseNo: string;
  direction: MovementDirection;
  container?:
    | {
        containerNumber: string;
        size: ContainerSize;
        sealNumber: string;
        isEmpty: boolean;
      }
    | undefined;
}

export class GateService {
  /**
   * M3.4: Proses Gate-In kendaraan masuk kawasan pergudangan.
   */
  async processGateIn(actorId: string, input: GateInInput, ipAddress: string | null) {
    return withTransaction(async (client) => {
      const vehicle = await vehicleRepository.findById(client, input.vehicleId);
      if (!vehicle) {
        throw new NotFoundError('Master kendaraan tidak ditemukan');
      }
      if (!vehicle.isActive) {
        throw new UnprocessableEntityError(
          `Kendaraan ${vehicle.plateNumber} dalam status nonaktif dan tidak diizinkan masuk`,
          'VEHICLE_INACTIVE',
        );
      }

      const warehouse = await warehouseDockRepository.findWarehouseById(client, input.warehouseId);
      if (!warehouse) {
        throw new NotFoundError('Gudang tujuan tidak ditemukan');
      }
      if (!warehouse.isActive) {
        throw new UnprocessableEntityError(
          `Gudang ${warehouse.code} sedang nonaktif`,
          'WAREHOUSE_INACTIVE',
        );
      }

      // Cek apakah kendaraan masih memiliki transaksi aktif di dalam kawasan
      const hasActiveVisit = await gateTransactionRepository.hasActiveTransactionForVehicle(
        client,
        vehicle.id,
      );
      if (hasActiveVisit) {
        throw new ConflictError(
          `Kendaraan ${vehicle.plateNumber} masih memiliki transaksi aktif di dalam kawasan pergudangan`,
          'ACTIVE_VISIT_EXISTS',
        );
      }

      // Aturan Bisnis 4.1: Pemisahan CARGO (MOBIL_BOX) vs CONTAINER (TRAILER / TRONTON)
      if (vehicle.category === 'CARGO') {
        if (vehicle.vType !== 'MOBIL_BOX') {
          throw new UnprocessableEntityError(
            'Kategori CARGO hanya mengizinkan armada jenis MOBIL_BOX',
            'INVALID_CARGO_VEHICLE',
          );
        }
        if (input.container !== undefined) {
          throw new UnprocessableEntityError(
            'Transaksi kategori CARGO (Mobil Box) dilarang melampirkan data kontainer maupun segel',
            'CONTAINER_NOT_ALLOWED_FOR_CARGO',
          );
        }
      } else {
        if (vehicle.vType !== 'TRAILER' && vehicle.vType !== 'TRONTON') {
          throw new UnprocessableEntityError(
            'Kategori CONTAINER hanya mengizinkan armada jenis TRAILER atau TRONTON',
            'INVALID_CONTAINER_VEHICLE',
          );
        }
        if (!input.container) {
          throw new UnprocessableEntityError(
            'Transaksi kategori CONTAINER (Trailer/Tronton) wajib melampirkan nomor kontainer ISO 6346, ukuran, dan nomor segel',
            'CONTAINER_METADATA_REQUIRED',
          );
        }
      }

      const ticketNumber = await gateTransactionRepository.generateTicketNumber(client);

      const tx = await gateTransactionRepository.createTransaction(client, {
        ticketNumber,
        vehicleId: vehicle.id,
        warehouseId: warehouse.id,
        driverName: input.driverName.trim(),
        driverLicenseNo: input.driverLicenseNo.toUpperCase().trim(),
        direction: input.direction,
        category: vehicle.category,
        createdBy: actorId,
      });

      if (vehicle.category === 'CONTAINER' && input.container) {
        await gateTransactionRepository.createContainerDetail(client, {
          gateTransactionId: tx.id,
          containerNumber: input.container.containerNumber.toUpperCase().trim(),
          size: input.container.size,
          sealNumber: input.container.sealNumber.toUpperCase().trim(),
          isEmpty: input.container.isEmpty,
        });
      }

      await gateTransactionRepository.insertStatusLog(client, {
        gateTransactionId: tx.id,
        fromStatus: null,
        toStatus: 'GATE_IN',
        notes: `Gate-In dicatat untuk armada ${vehicle.plateNumber} (${vehicle.vType})`,
        changedBy: actorId,
      });

      await auditLogRepository.record(client, {
        actorId,
        entityName: 'gate_transactions',
        entityId: tx.id,
        action: 'CREATE',
        newValues: {
          ticketNumber: tx.ticketNumber,
          plateNumber: vehicle.plateNumber,
          category: tx.category,
          direction: tx.direction,
          warehouseCode: warehouse.code,
        },
        ipAddress,
      });

      return gateTransactionRepository.findDetailById(client, tx.id);
    });
  }

  /**
   * M3.5: Penugasan armada dari antrean GATE_IN ke Loading Dock yang sesuai.
   */
  async assignDock(
    actorId: string,
    gateTransactionId: string,
    dockId: string,
    ipAddress: string | null,
  ) {
    return withTransaction(async (client) => {
      const tx = await gateTransactionRepository.findByIdForUpdate(client, gateTransactionId);
      if (!tx) {
        throw new NotFoundError('Transaksi gerbang tidak ditemukan');
      }

      if (tx.status !== 'GATE_IN') {
        throw new UnprocessableEntityError(
          `Penugasan dock hanya dapat dilakukan pada transaksi berstatus GATE_IN (status saat ini: ${tx.status})`,
          'INVALID_GATE_STATE_FOR_DOCK_ASSIGN',
        );
      }

      const dock = await warehouseDockRepository.findDockByIdForUpdate(client, dockId);
      if (!dock) {
        throw new NotFoundError('Loading dock tidak ditemukan');
      }

      if (dock.warehouseId !== tx.warehouseId) {
        throw new UnprocessableEntityError(
          'Loading dock yang dipilih tidak berada pada gudang tujuan transaksi ini',
          'DOCK_WAREHOUSE_MISMATCH',
        );
      }

      if (dock.status !== 'AVAILABLE') {
        throw new ConflictError(
          `Loading dock ${dock.dockNumber} tidak tersedia (status saat ini: ${dock.status})`,
          'DOCK_NOT_AVAILABLE',
        );
      }

      // Aturan Bisnis 4.2.2: Kesesuaian kategori dock (CARGO <-> CARGO, CONTAINER <-> CONTAINER)
      if (dock.category !== tx.category) {
        throw new UnprocessableEntityError(
          `Ketidakcocokan jalur dock: transaksi ${tx.category} tidak dapat ditempatkan di dock bertipe ${dock.category}`,
          'DOCK_CATEGORY_MISMATCH',
        );
      }

      await warehouseDockRepository.updateDockStatus(client, dock.id, 'OCCUPIED');
      const updatedTx = await gateTransactionRepository.assignDock(client, tx.id, dock.id);

      await gateTransactionRepository.insertStatusLog(client, {
        gateTransactionId: tx.id,
        fromStatus: tx.status,
        toStatus: 'DOCKING',
        notes: `Dialokasikan ke ${dock.dockNumber}`,
        changedBy: actorId,
      });

      await auditLogRepository.record(client, {
        actorId,
        entityName: 'gate_transactions',
        entityId: tx.id,
        action: 'UPDATE',
        oldValues: { status: tx.status, dockId: tx.dockId },
        newValues: { status: updatedTx.status, dockId: dock.id, dockNumber: dock.dockNumber },
        ipAddress,
      });

      return gateTransactionRepository.findDetailById(client, tx.id);
    });
  }

  /**
   * M3.6: Proses Gate-Out dengan validasi syarat mutlak bongkar muat & dokumen ISSUED.
   */
  async processGateOut(
    actorId: string,
    gateTransactionId: string,
    notes: string | undefined,
    ipAddress: string | null,
  ) {
    return withTransaction(async (client) => {
      const tx = await gateTransactionRepository.findByIdForUpdate(client, gateTransactionId);
      if (!tx) {
        throw new NotFoundError('Transaksi gerbang tidak ditemukan');
      }

      if (tx.status === 'GATE_OUT' || tx.status === 'CANCELLED') {
        throw new ConflictError(
          `Transaksi sudah ditutup dengan status ${tx.status}`,
          'TRANSACTION_ALREADY_CLOSED',
        );
      }

      // Syarat Mutlak 1: Bongkar muat harus sudah difinalisasi (status DOC_PENDING atau DOC_ISSUED)
      const allowedPreGateOutStatuses: GateStatus[] = ['DOC_PENDING', 'DOC_ISSUED'];
      if (!allowedPreGateOutStatuses.includes(tx.status)) {
        throw new UnprocessableEntityError(
          `Gate-Out ditolak: aktivitas bongkar/muat belum diselesaikan oleh Admin Gudang (status saat ini: ${tx.status})`,
          'CARGO_OPERATION_INCOMPLETE',
        );
      }

      // Syarat Mutlak 2: Dokumen wajib harus berstatus ISSUED
      const requiredDocType: DocType = tx.direction === 'INBOUND' ? 'BASTB' : 'SURAT_JALAN';
      const hasIssuedDoc = await gateTransactionRepository.hasIssuedRequiredDocument(
        client,
        tx.id,
        requiredDocType,
      );

      if (!hasIssuedDoc) {
        throw new UnprocessableEntityError(
          `Gate-Out ditolak: dokumen wajib ${requiredDocType} belum berstatus ISSUED`,
          'REQUIRED_DOCUMENT_NOT_ISSUED',
        );
      }

      // Bebaskan loading dock jika transaksi menggunakan dock
      if (tx.dockId) {
        const dock = await warehouseDockRepository.findDockByIdForUpdate(client, tx.dockId);
        if (dock && dock.status === 'OCCUPIED') {
          await warehouseDockRepository.updateDockStatus(client, dock.id, 'AVAILABLE');
        }
      }

      const closedTx = await gateTransactionRepository.markGateOut(client, tx.id);

      await gateTransactionRepository.insertStatusLog(client, {
        gateTransactionId: tx.id,
        fromStatus: tx.status,
        toStatus: 'GATE_OUT',
        notes: notes ?? `Gate-Out selesai dengan verifikasi dokumen ${requiredDocType}`,
        changedBy: actorId,
      });

      await auditLogRepository.record(client, {
        actorId,
        entityName: 'gate_transactions',
        entityId: tx.id,
        action: 'UPDATE',
        oldValues: { status: tx.status },
        newValues: {
          status: closedTx.status,
          gateOutAt: closedTx.gateOutAt?.toISOString() ?? null,
          releasedDockId: tx.dockId,
        },
        ipAddress,
      });

      return gateTransactionRepository.findDetailById(client, tx.id);
    });
  }

  async getTransactionDetail(id: string) {
    const detail = await gateTransactionRepository.findDetailById(pool, id);
    if (!detail) {
      throw new NotFoundError('Transaksi gerbang tidak ditemukan');
    }
    const statusLogs = await gateTransactionRepository.listStatusLogs(pool, id);
    return {
      ...detail,
      statusLogs,
    };
  }

  async listTransactions(filters: {
    status?: GateStatus | undefined;
    warehouseId?: string | undefined;
    direction?: MovementDirection | undefined;
    category?: TransportCategory | undefined;
    search?: string | undefined;
    limit: number;
    offset: number;
  }) {
    return gateTransactionRepository.listPaginated(pool, filters);
  }
}

export const gateService = new GateService();
