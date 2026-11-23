import { z } from 'zod';

export const transportCategorySchema = z.enum(['CARGO', 'CONTAINER']);
export const vehicleTypeSchema = z.enum(['MOBIL_BOX', 'TRAILER', 'TRONTON']);
export const dockStatusSchema = z.enum(['AVAILABLE', 'OCCUPIED', 'MAINTENANCE']);

export const createWarehouseSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, 'Kode gudang minimal 2 karakter')
    .max(20)
    .regex(/^[A-Za-z0-9-]+$/, 'Kode gudang hanya boleh berisi huruf, angka, dan tanda hubung'),
  name: z.string().trim().min(3, 'Nama gudang minimal 3 karakter').max(150),
  maxVolumeM3: z.coerce.number().positive('Kapasitas volume maksimal harus lebih dari 0'),
});

export const createDockSchema = z.object({
  warehouseId: z.string().uuid('warehouseId harus berupa UUID valid'),
  dockNumber: z.string().trim().min(2, 'Nomor dock minimal 2 karakter').max(20),
  category: transportCategorySchema,
});

export const updateDockStatusSchema = z.object({
  status: dockStatusSchema,
});

export const listDocksQuerySchema = z.object({
  warehouseId: z.string().uuid().optional(),
  category: transportCategorySchema.optional(),
  status: dockStatusSchema.optional(),
});

export const createVehicleSchema = z
  .object({
    plateNumber: z
      .string()
      .trim()
      .min(4, 'Nomor polisi minimal 4 karakter')
      .max(20)
      .regex(/^[A-Za-z0-9\s]+$/, 'Nomor polisi hanya boleh berisi huruf dan angka'),
    category: transportCategorySchema,
    vType: vehicleTypeSchema,
    companyName: z.string().trim().min(2, 'Nama perusahaan ekspedisi minimal 2 karakter').max(150),
    maxWeightKg: z.coerce.number().positive('Kapasitas berat maksimal harus lebih dari 0'),
  })
  .superRefine((data, ctx) => {
    if (data.category === 'CARGO' && data.vType !== 'MOBIL_BOX') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['vType'],
        message: 'Kategori CARGO hanya mengizinkan jenis kendaraan MOBIL_BOX',
      });
    }
    if (data.category === 'CONTAINER' && data.vType !== 'TRAILER' && data.vType !== 'TRONTON') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['vType'],
        message: 'Kategori CONTAINER hanya mengizinkan jenis kendaraan TRAILER atau TRONTON',
      });
    }
  });

export const listVehiclesQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  category: transportCategorySchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
