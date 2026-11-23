import type { QueryResultRow } from 'pg';
import { executeQuery, type Queryable } from '../db/pool.js';
import type { DocStatus, DocType } from '../types/domain.js';

export interface OfficialDocumentEntity {
  id: string;
  documentNumber: string;
  gateTransactionId: string | null;
  docType: DocType;
  status: DocStatus;
  storagePath: string | null;
  fileSha256: string | null;
  errorLog: string | null;
  retryCount: number;
  issuedAt: Date | null;
  voidedByDocId: string | null;
  voidReason: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface QueuedLatexJob {
  id: string;
  documentNumber: string;
  gateTransactionId: string | null;
  docType: DocType;
  latexSource: string;
  retryCount: number;
}

interface OfficialDocRow extends QueryResultRow {
  id: string;
  document_number: string;
  gate_transaction_id: string | null;
  doc_type: DocType;
  status: DocStatus;
  latex_source?: string;
  storage_path: string | null;
  file_sha256: string | null;
  error_log: string | null;
  retry_count: number;
  issued_at: Date | null;
  voided_by_doc_id: string | null;
  void_reason: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

const DOC_PREFIX_MAP: Record<DocType, string> = {
  GATE_PASS: 'GP',
  BASTB: 'BASTB',
  SURAT_JALAN: 'SJ',
  REKAP_HARIAN: 'RKP',
};

function mapOfficialDocRow(row: OfficialDocRow): OfficialDocumentEntity {
  return {
    id: row.id,
    documentNumber: row.document_number,
    gateTransactionId: row.gate_transaction_id,
    docType: row.doc_type,
    status: row.status,
    storagePath: row.storage_path,
    fileSha256: row.file_sha256,
    errorLog: row.error_log,
    retryCount: row.retry_count,
    issuedAt: row.issued_at,
    voidedByDocId: row.voided_by_doc_id,
    voidReason: row.void_reason,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class DocumentRepository {
  /**
   * M5.3: Generator nomor surat resmi atomik per (doc_type, warehouse_code, period_ym).
   * Contoh keluaran: SJ/GDG-A/202611/000001
   */
  async generateAtomicDocumentNumber(
    db: Queryable,
    docType: DocType,
    warehouseCode: string,
  ): Promise<{ documentNumber: string; periodYm: string }> {
    const res = await executeQuery<{ period_ym: string; last_number: number }>(
      db,
      `WITH current_period AS (
         SELECT TO_CHAR(NOW() AT TIME ZONE 'Asia/Makassar', 'YYYYMM') AS ym
       )
       INSERT INTO document_sequences (doc_type, warehouse_code, period_ym, last_number)
       SELECT $1, $2, ym, 1 FROM current_period
       ON CONFLICT (doc_type, warehouse_code, period_ym)
       DO UPDATE SET last_number = document_sequences.last_number + 1
       RETURNING period_ym, last_number`,
      [docType, warehouseCode],
    );

    const row = res.rows[0];
    if (!row) {
      throw new Error('Gagal menghasilkan nomor urut dokumen resmi');
    }

    const prefix = DOC_PREFIX_MAP[docType];
    const seqPadded = String(row.last_number).padStart(6, '0');
    return {
      documentNumber: `${prefix}/${warehouseCode}/${row.period_ym}/${seqPadded}`,
      periodYm: row.period_ym,
    };
  }

  async findNonVoidByTransactionAndType(
    db: Queryable,
    gateTransactionId: string,
    docType: DocType,
  ): Promise<OfficialDocumentEntity | null> {
    const res = await executeQuery<OfficialDocRow>(
      db,
      `SELECT id, document_number, gate_transaction_id, doc_type, status,
              storage_path, file_sha256, error_log, retry_count, issued_at,
              voided_by_doc_id, void_reason, created_by, created_at, updated_at
       FROM official_documents
       WHERE gate_transaction_id = $1
         AND doc_type = $2
         AND status IN ('QUEUED', 'COMPILING', 'ISSUED')
       ORDER BY created_at DESC
       LIMIT 1`,
      [gateTransactionId, docType],
    );
    const row = res.rows[0];
    return row ? mapOfficialDocRow(row) : null;
  }

  async findLatestUnlinkedVoidDoc(
    db: Queryable,
    gateTransactionId: string,
    docType: DocType,
  ): Promise<OfficialDocumentEntity | null> {
    const res = await executeQuery<OfficialDocRow>(
      db,
      `SELECT id, document_number, gate_transaction_id, doc_type, status,
              storage_path, file_sha256, error_log, retry_count, issued_at,
              voided_by_doc_id, void_reason, created_by, created_at, updated_at
       FROM official_documents
       WHERE gate_transaction_id = $1
         AND doc_type = $2
         AND status = 'VOID'
         AND voided_by_doc_id IS NULL
       ORDER BY updated_at DESC
       LIMIT 1`,
      [gateTransactionId, docType],
    );
    const row = res.rows[0];
    return row ? mapOfficialDocRow(row) : null;
  }

  async linkVoidReplacement(
    db: Queryable,
    voidedDocId: string,
    replacementDocId: string,
  ): Promise<void> {
    await executeQuery(
      db,
      `UPDATE official_documents
       SET voided_by_doc_id = $2
       WHERE id = $1`,
      [voidedDocId, replacementDocId],
    );
  }

  async createQueued(
    db: Queryable,
    input: {
      documentNumber: string;
      gateTransactionId: string | null;
      docType: DocType;
      latexSource: string;
      createdBy: string;
    },
  ): Promise<OfficialDocumentEntity> {
    const res = await executeQuery<OfficialDocRow>(
      db,
      `INSERT INTO official_documents (
         document_number, gate_transaction_id, doc_type, status, latex_source, created_by
       )
       VALUES ($1, $2, $3, 'QUEUED', $4, $5)
       RETURNING id, document_number, gate_transaction_id, doc_type, status,
                 storage_path, file_sha256, error_log, retry_count, issued_at,
                 voided_by_doc_id, void_reason, created_by, created_at, updated_at`,
      [
        input.documentNumber,
        input.gateTransactionId,
        input.docType,
        input.latexSource,
        input.createdBy,
      ],
    );
    const row = res.rows[0];
    if (!row) throw new Error('Gagal memasukkan dokumen ke antrean LaTeX');
    return mapOfficialDocRow(row);
  }

  /**
   * M5.4: Mengambil 1 pekerjaan QUEUED secara atomik menggunakan FOR UPDATE SKIP LOCKED.
   */
  async claimNextQueuedJob(db: Queryable): Promise<QueuedLatexJob | null> {
    const res = await executeQuery<{
      id: string;
      document_number: string;
      gate_transaction_id: string | null;
      doc_type: DocType;
      latex_source: string;
      retry_count: number;
    }>(
      db,
      `UPDATE official_documents
       SET status = 'COMPILING'
       WHERE id = (
         SELECT id
         FROM official_documents
         WHERE status = 'QUEUED'
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       RETURNING id, document_number, gate_transaction_id, doc_type, latex_source, retry_count`,
    );

    const row = res.rows[0];
    if (!row) return null;

    return {
      id: row.id,
      documentNumber: row.document_number,
      gateTransactionId: row.gate_transaction_id,
      docType: row.doc_type,
      latexSource: row.latex_source,
      retryCount: row.retry_count,
    };
  }

  async markIssued(
    db: Queryable,
    id: string,
    storagePath: string,
    fileSha256: string,
  ): Promise<void> {
    await executeQuery(
      db,
      `UPDATE official_documents
       SET status = 'ISSUED',
           storage_path = $2,
           file_sha256 = $3,
           issued_at = NOW(),
           error_log = NULL
       WHERE id = $1`,
      [id, storagePath, fileSha256],
    );
  }

  /**
   * M5.5: Re-queue otomatis jika percobaan belum mencapai batas maksimal, atau tandai FAILED.
   */
  async markFailedOrScheduleRetry(
    db: Queryable,
    id: string,
    errorLog: string,
    maxRetries = 3,
  ): Promise<'QUEUED' | 'FAILED'> {
    const res = await executeQuery<{ status: 'QUEUED' | 'FAILED' }>(
      db,
      `UPDATE official_documents
       SET retry_count = retry_count + 1,
           error_log = $2,
           status = CASE WHEN retry_count + 1 < $3 THEN 'QUEUED'::doc_status ELSE 'FAILED'::doc_status END
       WHERE id = $1
       RETURNING status`,
      [id, errorLog, maxRetries],
    );
    return res.rows[0]?.status ?? 'FAILED';
  }

  async findById(db: Queryable, id: string): Promise<OfficialDocumentEntity | null> {
    const res = await executeQuery<OfficialDocRow>(
      db,
      `SELECT id, document_number, gate_transaction_id, doc_type, status,
              storage_path, file_sha256, error_log, retry_count, issued_at,
              voided_by_doc_id, void_reason, created_by, created_at, updated_at
       FROM official_documents
       WHERE id = $1`,
      [id],
    );
    const row = res.rows[0];
    return row ? mapOfficialDocRow(row) : null;
  }

  async findByIdForUpdate(db: Queryable, id: string): Promise<OfficialDocumentEntity | null> {
    const res = await executeQuery<OfficialDocRow>(
      db,
      `SELECT id, document_number, gate_transaction_id, doc_type, status,
              storage_path, file_sha256, error_log, retry_count, issued_at,
              voided_by_doc_id, void_reason, created_by, created_at, updated_at
       FROM official_documents
       WHERE id = $1
       FOR UPDATE`,
      [id],
    );
    const row = res.rows[0];
    return row ? mapOfficialDocRow(row) : null;
  }

  async markVoid(db: Queryable, id: string, voidReason: string): Promise<OfficialDocumentEntity> {
    const res = await executeQuery<OfficialDocRow>(
      db,
      `UPDATE official_documents
       SET status = 'VOID', void_reason = $2
       WHERE id = $1
       RETURNING id, document_number, gate_transaction_id, doc_type, status,
                 storage_path, file_sha256, error_log, retry_count, issued_at,
                 voided_by_doc_id, void_reason, created_by, created_at, updated_at`,
      [id, voidReason],
    );
    const row = res.rows[0];
    if (!row) throw new Error('Dokumen tidak ditemukan saat proses VOID');
    return mapOfficialDocRow(row);
  }

  async resetFailedForManualRetry(db: Queryable, id: string): Promise<OfficialDocumentEntity> {
    const res = await executeQuery<OfficialDocRow>(
      db,
      `UPDATE official_documents
       SET status = 'QUEUED', retry_count = 0, error_log = NULL
       WHERE id = $1
       RETURNING id, document_number, gate_transaction_id, doc_type, status,
                 storage_path, file_sha256, error_log, retry_count, issued_at,
                 voided_by_doc_id, void_reason, created_by, created_at, updated_at`,
      [id],
    );
    const row = res.rows[0];
    if (!row) throw new Error('Dokumen tidak ditemukan saat retry');
    return mapOfficialDocRow(row);
  }

  async list(
    db: Queryable,
    filters: {
      gateTransactionId?: string | undefined;
      docType?: DocType | undefined;
      status?: DocStatus | undefined;
      limit: number;
      offset: number;
    },
  ): Promise<{ items: OfficialDocumentEntity[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.gateTransactionId) {
      params.push(filters.gateTransactionId);
      conditions.push(`gate_transaction_id = $${params.length}`);
    }
    if (filters.docType) {
      params.push(filters.docType);
      conditions.push(`doc_type = $${params.length}`);
    }
    if (filters.status) {
      params.push(filters.status);
      conditions.push(`status = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(filters.limit, filters.offset);

    const res = await executeQuery<OfficialDocRow & { total_count: string }>(
      db,
      `SELECT
         id, document_number, gate_transaction_id, doc_type, status,
         storage_path, file_sha256, error_log, retry_count, issued_at,
         voided_by_doc_id, void_reason, created_by, created_at, updated_at,
         COUNT(*) OVER()::text AS total_count
       FROM official_documents
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const total = Number(res.rows[0]?.total_count ?? '0');
    return {
      items: res.rows.map(mapOfficialDocRow),
      total,
    };
  }
}

export const documentRepository = new DocumentRepository();
