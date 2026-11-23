import { z } from 'zod';

export const transactionDocTypeSchema = z.enum(['GATE_PASS', 'BASTB', 'SURAT_JALAN']);
export const allDocTypeSchema = z.enum(['GATE_PASS', 'BASTB', 'SURAT_JALAN', 'REKAP_HARIAN']);
export const docStatusSchema = z.enum(['QUEUED', 'COMPILING', 'ISSUED', 'FAILED', 'VOID']);

export const generateTransactionDocSchema = z.object({
  docType: transactionDocTypeSchema,
});

export const generateDailyRecapSchema = z.object({
  warehouseId: z.string().uuid('warehouseId harus berupa UUID valid'),
  reportDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal laporan wajib YYYY-MM-DD'),
});

export const voidDocumentSchema = z.object({
  voidReason: z.string().trim().min(5, 'Alasan pembatalan dokumen minimal 5 karakter').max(500),
});

export const listDocumentsQuerySchema = z.object({
  gateTransactionId: z.string().uuid().optional(),
  docType: allDocTypeSchema.optional(),
  status: docStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
