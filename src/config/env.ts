import 'dotenv/config';
import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),

    DATABASE_URL: z.string().url('DATABASE_URL harus berupa connection string PostgreSQL yang valid'),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(20),
    DB_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),
    DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(1000).default(5000),

    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    LOCAL_STORAGE_DIR: z.string().min(1).default('./storage'),

    S3_ENDPOINT: z.string().optional(),
    S3_PORT: z.coerce.number().int().min(1).max(65535).default(9000),
    S3_USE_SSL: z
      .enum(['true', 'false'])
      .default('false')
      .transform((val) => val === 'true'),
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),
    S3_BUCKET: z.string().min(1).default('warehouse-documents'),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET minimal 32 karakter'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET minimal 32 karakter'),

    LATEX_BIN: z.string().min(1).default('xelatex'),
    LATEX_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),
  })
  .superRefine((data, ctx) => {
    if (data.STORAGE_DRIVER === 's3') {
      if (!data.S3_ENDPOINT) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['S3_ENDPOINT'],
          message: 'S3_ENDPOINT wajib diisi jika STORAGE_DRIVER=s3',
        });
      }
      if (!data.S3_ACCESS_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['S3_ACCESS_KEY'],
          message: 'S3_ACCESS_KEY wajib diisi jika STORAGE_DRIVER=s3',
        });
      }
      if (!data.S3_SECRET_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['S3_SECRET_KEY'],
          message: 'S3_SECRET_KEY wajib diisi jika STORAGE_DRIVER=s3',
        });
      }
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Konfigurasi environment tidak valid. Aplikasi dihentikan (fail-fast):');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
