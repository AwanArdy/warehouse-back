import { z } from 'zod';

export const bootstrapAdminSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'Username minimal 3 karakter')
    .max(50)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Username hanya boleh berisi huruf, angka, titik, underscore, atau strip'),
  fullName: z.string().trim().min(2, 'Nama lengkap minimal 2 karakter').max(120),
  password: z.string().min(8, 'Password minimal 8 karakter').max(128),
});

export const createUserSchema = bootstrapAdminSchema.extend({
  roleCode: z.enum(['SUPER_ADMIN', 'PETUGAS_GATE', 'ADMIN_GUDANG', 'ADMIN_PERSURATAN']),
});

export const loginSchema = z.object({
  username: z.string().trim().min(1, 'Username wajib diisi'),
  password: z.string().min(1, 'Password wajib diisi'),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(10, 'Refresh token wajib diisi'),
});
