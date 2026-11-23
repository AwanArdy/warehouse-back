import { z } from 'zod';
import { transportCategorySchema } from './master.validator.js';

export const movementDirectionSchema = z.enum(['INBOUND', 'OUTBOUND']);
export const containerSizeSchema = z.enum(['20FT', '40FT', '40HC']);
export const gateStatusSchema = z.enum([
  'GATE_IN',
  'DOCKING',
  'LOADING_UNLOADING',
  'DOC_PENDING',
  'DOC_ISSUED',
  'GATE_OUT',
  'CANCELLED',
]);

export const containerMetadataSchema = z.object({
  containerNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      /^[A-Z]{4}[0-9]{7}$/,
      'Nomor kontainer wajib mengikuti standar ISO 6346 (4 huruf kapital + 7 angka, contoh: MSCU1234567)',
    ),
  size: containerSizeSchema,
  sealNumber: z.string().trim().min(3, 'Nomor segel kontainer minimal 3 karakter').max(50),
  isEmpty: z.boolean().default(false),
});

export const gateInSchema = z.object({
  vehicleId: z.string().uuid('vehicleId harus berupa UUID valid'),
  warehouseId: z.string().uuid('warehouseId harus berupa UUID valid'),
  driverName: z.string().trim().min(2, 'Nama pengemudi minimal 2 karakter').max(120),
  driverLicenseNo: z.string().trim().min(4, 'Nomor SIM pengemudi minimal 4 karakter').max(50),
  direction: movementDirectionSchema,
  container: containerMetadataSchema.optional(),
});

export const assignDockSchema = z.object({
  dockId: z.string().uuid('dockId harus berupa UUID valid'),
});

export const gateOutSchema = z.object({
  notes: z.string().trim().max(500).optional(),
});

export const listGateTransactionsQuerySchema = z.object({
  status: gateStatusSchema.optional(),
  warehouseId: z.string().uuid().optional(),
  direction: movementDirectionSchema.optional(),
  category: transportCategorySchema.optional(),
  search: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
