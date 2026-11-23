import { createHash } from 'node:crypto';
import { executeQuery, pool } from '../db/pool.js';
import { withTransaction } from '../db/transaction.js';
import {
  renderCargoManifestTex,
  renderDailyRecapTex,
  renderGatePassTex,
  type DailyRecapRowItem,
} from '../latex/renderer.js';
import { auditLogRepository } from '../repositories/audit-log.repository.js';
import { cargoItemRepository } from '../repositories/cargo-item.repository.js';
import { documentRepository } from '../repositories/document.repository.js';
import { gateTransactionRepository } from '../repositories/gate-transaction.repository.js';
import { userRepository } from '../repositories/user.repository.js';
import { warehouseDockRepository } from '../repositories/warehouse-dock.repository.js';
import type { DocStatus, DocType } from '../types/domain.js';
import {
  ConflictError,
  NotFoundError,
  UnprocessableEntityError,
} from '../utils/errors.js';
import { documentStorage } from '../utils/storage.js';
import { latexCompilerWorker } from '../workers/latex-compiler.worker.js';

export class DocumentService {
  /**
   * Mengajukan pembuatan dokumen resmi (GATE_PASS, BASTB, atau SURAT_JALAN) untuk transaksi gate.
   */
  async generateTransactionDocument(
    actorId: string,
    gateTransactionId: string,
    docType: Exclude<DocType, 'REKAP_HARIAN'>,
    ipAddress: string | null,
  ) {
    const createdDoc = await withTransaction(async (client) => {
      const tx = await gateTransactionRepository.findDetailById(client, gateTransactionId);
      if (!tx) {
        throw new NotFoundError('Transaksi gerbang tidak ditemukan');
      }

      if (tx.status === 'CANCELLED') {
        throw new UnprocessableEntityError(
          'Tidak dapat menerbitkan dokumen untuk transaksi yang sudah dibatalkan (CANCELLED)',
          'TRANSACTION_CANCELLED',
        );
      }

      // Validasi kesesuaian jenis dokumen dengan arah & tahapan transaksi
      if (docType === 'BASTB') {
        if (tx.direction !== 'INBOUND') {
          throw new UnprocessableEntityError(
            'Dokumen BASTB hanya dapat diterbitkan untuk transaksi arah INBOUND',
            'INVALID_DOC_FOR_DIRECTION',
          );
        }
        if (tx.status !== 'DOC_PENDING' && tx.status !== 'DOC_ISSUED') {
          throw new UnprocessableEntityError(
            `BASTB hanya dapat diterbitkan setelah bongkar barang difinalisasi (status saat ini: ${tx.status})`,
            'CARGO_NOT_FINALIZED',
          );
        }
      }

      if (docType === 'SURAT_JALAN') {
        if (tx.direction !== 'OUTBOUND') {
          throw new UnprocessableEntityError(
            'Dokumen Surat Jalan hanya dapat diterbitkan untuk transaksi arah OUTBOUND',
            'INVALID_DOC_FOR_DIRECTION',
          );
        }
        if (tx.status !== 'DOC_PENDING' && tx.status !== 'DOC_ISSUED') {
          throw new UnprocessableEntityError(
            `Surat Jalan hanya dapat diterbitkan setelah muat barang difinalisasi (status saat ini: ${tx.status})`,
            'CARGO_NOT_FINALIZED',
          );
        }
      }

      // Cek aturan Immutability 4.3: tidak boleh terbitkan ulang jika masih ada dokumen aktif/ISSUED
      const existingActive = await documentRepository.findNonVoidByTransactionAndType(
        client,
        tx.id,
        docType,
      );
      if (existingActive) {
        throw new ConflictError(
          `Dokumen ${docType} (${existingActive.documentNumber}) sudah ada dengan status ${existingActive.status}. Batalkan (VOID) terlebih dahulu jika ingin menerbitkan dokumen revisi.`,
          'ACTIVE_DOCUMENT_ALREADY_EXISTS',
        );
      }

      const actor = await userRepository.findById(client, actorId);
      const issuedByName = actor?.fullName ?? 'Petugas Operasional';

      const { documentNumber } = await documentRepository.generateAtomicDocumentNumber(
        client,
        docType,
        tx.warehouse.code,
      );

      let latexSource: string;
      if (docType === 'GATE_PASS') {
        latexSource = await renderGatePassTex({
          documentNumber,
          tx,
          issuedByName,
        });
      } else {
        const cargoItems = await cargoItemRepository.listByTransactionId(client, tx.id);
        if (cargoItems.length === 0) {
          throw new UnprocessableEntityError(
            'Tidak dapat membuat dokumen manifest karena daftar barang kosong',
            'EMPTY_CARGO_ITEMS',
          );
        }
        latexSource = await renderCargoManifestTex({
          templateFile: docType === 'BASTB' ? 'bastb.tex' : 'surat_jalan.tex',
          documentNumber,
          tx,
          items: cargoItems,
          issuedByName,
        });
      }

      const queuedDoc = await documentRepository.createQueued(client, {
        documentNumber,
        gateTransactionId: tx.id,
        docType,
        latexSource,
        createdBy: actorId,
      });

      // Jika ini merupakan revisi dari dokumen yang baru di-VOID, hubungkan rantai revisinya
      const unlinkedVoidDoc = await documentRepository.findLatestUnlinkedVoidDoc(
        client,
        tx.id,
        docType,
      );
      if (unlinkedVoidDoc) {
        await documentRepository.linkVoidReplacement(client, unlinkedVoidDoc.id, queuedDoc.id);
      }

      await auditLogRepository.record(client, {
        actorId,
        entityName: 'official_documents',
        entityId: queuedDoc.id,
        action: 'CREATE',
        newValues: {
          documentNumber: queuedDoc.documentNumber,
          docType: queuedDoc.docType,
          ticketNumber: tx.ticketNumber,
          status: queuedDoc.status,
        },
        ipAddress,
      });

      return queuedDoc;
    });

    latexCompilerWorker.triggerNow();
    return createdDoc;
  }

  /**
   * Menerbitkan Rekapitulasi Administrasi Harian (REKAP_HARIAN) per gudang dan tanggal.
   */
  async generateDailyRecapDocument(
    actorId: string,
    warehouseId: string,
    reportDate: string,
    ipAddress: string | null,
  ) {
    const createdDoc = await withTransaction(async (client) => {
      const warehouse = await warehouseDockRepository.findWarehouseById(client, warehouseId);
      if (!warehouse) {
        throw new NotFoundError('Gudang tidak ditemukan');
      }

      const actor = await userRepository.findById(client, actorId);
      const issuedByName = actor?.fullName ?? 'Admin Persuratan';

      const rowsRes = await executeQuery<{
        ticket_number: string;
        plate_number: string;
        v_type: string;
        direction: 'INBOUND' | 'OUTBOUND';
        container_number: string | null;
        seal_number: string | null;
        total_weight_kg: string;
        status: string;
      }>(
        client,
        `SELECT
           gt.ticket_number,
           v.plate_number,
           v.v_type,
           gt.direction,
           tc.container_number,
           tc.seal_number,
           COALESCE(SUM(tci.weight_kg), 0)::text AS total_weight_kg,
           gt.status
         FROM gate_transactions gt
         INNER JOIN vehicles v ON v.id = gt.vehicle_id
         LEFT JOIN transaction_containers tc ON tc.gate_transaction_id = gt.id
         LEFT JOIN transaction_cargo_items tci ON tci.gate_transaction_id = gt.id
         WHERE gt.warehouse_id = $1
           AND DATE(gt.gate_in_at AT TIME ZONE 'Asia/Makassar') = $2::date
         GROUP BY gt.id, gt.ticket_number, v.plate_number, v.v_type, gt.direction,
                  tc.container_number, tc.seal_number, gt.status, gt.gate_in_at
         ORDER BY gt.gate_in_at ASC`,
        [warehouse.id, reportDate],
      );

      const recapRows: DailyRecapRowItem[] = rowsRes.rows.map((r) => ({
        ticketNumber: r.ticket_number,
        plateNumber: r.plate_number,
        vType: r.v_type,
        direction: r.direction,
        containerInfo: r.container_number
          ? `${r.container_number} / ${r.seal_number ?? '-'}`
          : 'Non-Kontainer',
        totalWeightKg: Number(r.total_weight_kg),
        status: r.status,
      }));

      const { documentNumber } = await documentRepository.generateAtomicDocumentNumber(
        client,
        'REKAP_HARIAN',
        warehouse.code,
      );

      const latexSource = await renderDailyRecapTex({
        documentNumber,
        warehouseCode: warehouse.code,
        warehouseName: warehouse.name,
        reportDate,
        rows: recapRows,
        issuedByName,
      });

      const queuedDoc = await documentRepository.createQueued(client, {
        documentNumber,
        gateTransactionId: null,
        docType: 'REKAP_HARIAN',
        latexSource,
        createdBy: actorId,
      });

      await auditLogRepository.record(client, {
        actorId,
        entityName: 'official_documents',
        entityId: queuedDoc.id,
        action: 'CREATE',
        newValues: {
          documentNumber: queuedDoc.documentNumber,
          docType: queuedDoc.docType,
          warehouseCode: warehouse.code,
          reportDate,
        },
        ipAddress,
      });

      return queuedDoc;
    });

    latexCompilerWorker.triggerNow();
    return createdDoc;
  }

  /**
   * M5.5: Membatalkan (VOID) dokumen yang berstatus ISSUED beserta alasan pembatalan.
   */
  async voidDocument(
    actorId: string,
    documentId: string,
    voidReason: string,
    ipAddress: string | null,
  ) {
    return withTransaction(async (client) => {
      const doc = await documentRepository.findByIdForUpdate(client, documentId);
      if (!doc) {
        throw new NotFoundError('Dokumen resmi tidak ditemukan');
      }

      if (doc.status !== 'ISSUED') {
        throw new UnprocessableEntityError(
          `Hanya dokumen berstatus ISSUED yang dapat dibatalkan (status saat ini: ${doc.status})`,
          'ONLY_ISSUED_CAN_BE_VOIDED',
        );
      }

      const voided = await documentRepository.markVoid(client, doc.id, voidReason.trim());

      // Jika dokumen wajib Gate-Out (BASTB / SURAT_JALAN) di-VOID saat transaksi masih DOC_ISSUED,
      // kembalikan status transaksi ke DOC_PENDING agar kendaraan tidak bisa Gate-Out sebelum revisi terbit.
      if (
        doc.gateTransactionId &&
        (doc.docType === 'BASTB' || doc.docType === 'SURAT_JALAN')
      ) {
        const tx = await gateTransactionRepository.findByIdForUpdate(
          client,
          doc.gateTransactionId,
        );
        if (tx && tx.status === 'DOC_ISSUED') {
          await executeQuery(
            client,
            `UPDATE gate_transactions SET status = 'DOC_PENDING' WHERE id = $1`,
            [tx.id],
          );
          await gateTransactionRepository.insertStatusLog(client, {
            gateTransactionId: tx.id,
            fromStatus: 'DOC_ISSUED',
            toStatus: 'DOC_PENDING',
            notes: `Dokumen ${doc.docType} (${doc.documentNumber}) dibatalkan (VOID): ${voidReason.trim()}`,
            changedBy: actorId,
          });
        }
      }

      await auditLogRepository.record(client, {
        actorId,
        entityName: 'official_documents',
        entityId: doc.id,
        action: 'VOID',
        oldValues: { status: 'ISSUED' },
        newValues: { status: 'VOID', voidReason: voided.voidReason },
        ipAddress,
      });

      return voided;
    });
  }

  async retryFailedDocument(actorId: string, documentId: string, ipAddress: string | null) {
    const updated = await withTransaction(async (client) => {
      const doc = await documentRepository.findByIdForUpdate(client, documentId);
      if (!doc) {
        throw new NotFoundError('Dokumen resmi tidak ditemukan');
      }
      if (doc.status !== 'FAILED') {
        throw new UnprocessableEntityError(
          `Kompilasi ulang manual hanya berlaku untuk dokumen berstatus FAILED (status saat ini: ${doc.status})`,
          'DOCUMENT_NOT_FAILED',
        );
      }

      const resetDoc = await documentRepository.resetFailedForManualRetry(client, doc.id);

      await auditLogRepository.record(client, {
        actorId,
        entityName: 'official_documents',
        entityId: doc.id,
        action: 'UPDATE',
        oldValues: { status: 'FAILED' },
        newValues: { status: 'QUEUED' },
        ipAddress,
      });

      return resetDoc;
    });

    latexCompilerWorker.triggerNow();
    return updated;
  }

  async getDocumentById(documentId: string) {
    const doc = await documentRepository.findById(pool, documentId);
    if (!doc) {
      throw new NotFoundError('Dokumen resmi tidak ditemukan');
    }
    return doc;
  }

  async listDocuments(filters: {
    gateTransactionId?: string | undefined;
    docType?: DocType | undefined;
    status?: DocStatus | undefined;
    limit: number;
    offset: number;
  }) {
    return documentRepository.list(pool, filters);
  }

  /**
   * Mengambil file PDF hasil kompilasi dan memverifikasi integritas SHA-256 checksum-nya.
   */
  async getCompiledPdfBuffer(documentId: string): Promise<{
    filename: string;
    pdfBuffer: Buffer;
    sha256: string;
    status: DocStatus;
  }> {
    const doc = await documentRepository.findById(pool, documentId);
    if (!doc) {
      throw new NotFoundError('Dokumen resmi tidak ditemukan');
    }

    if (!doc.storagePath || (doc.status !== 'ISSUED' && doc.status !== 'VOID')) {
      throw new UnprocessableEntityError(
        `File PDF belum tersedia karena dokumen masih berstatus ${doc.status}`,
        'PDF_NOT_READY',
      );
    }

    const pdfBuffer = await documentStorage.getPdf(doc.storagePath);
    const actualSha256 = createHash('sha256').update(pdfBuffer).digest('hex');

    if (doc.fileSha256 && actualSha256 !== doc.fileSha256) {
      throw new ConflictError(
        'Verifikasi integritas file PDF gagal: checksum SHA-256 tidak cocok dengan catatan database',
        'PDF_CHECKSUM_MISMATCH',
      );
    }

    const filename = `${doc.documentNumber.replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`;
    return {
      filename,
      pdfBuffer,
      sha256: actualSha256,
      status: doc.status,
    };
  }
}

export const documentService = new DocumentService();
