import { z } from 'zod';

export const createItemMasterSchema = z.object({
  skuCode: z
    .string()
    .trim()
    .min(2, 'Kode SKU minimal 2 karakter')
    .max(50)
    .regex(/^[A-Za-z0-9._-]+$/, 'Kode SKU hanya boleh berisi huruf, angka, titik, underscore, atau strip'),
  name: z.string().trim().min(2, 'Nama barang minimal 2 karakter').max(200),
  unit: z.string().trim().min(1, 'Satuan barang wajib diisi').max(20),
  unitVolumeM3: z.coerce.number().min(0, 'Volume satuan tidak boleh negatif'),
  unitWeightKg: z.coerce.number().min(0, 'Berat satuan tidak boleh negatif'),
});

export const listItemsQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const recordCargoItemsSchema = z.object({
  items: z
    .array(
      z.object({
        itemId: z.string().uuid('itemId harus berupa UUID valid'),
        quantity: z.coerce.number().positive('Kuantitas barang harus lebih dari 0'),
        weightKg: z.coerce.number().min(0, 'Berat tidak boleh negatif').optional(),
        conditionNotes: z.string().trim().max(500).optional(),
      }),
    )
    .min(1, 'Minimal harus ada 1 baris barang'),
});

export const listMovementsQuerySchema = z.object({
  warehouseId: z.string().uuid().optional(),
  itemId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
});
