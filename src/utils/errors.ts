import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "./logger.js";

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, code = 'BAD_REQUEST', details?: unknown) {
    super(400, code, message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Autentikasi diperlukan atau token tidak valid', code = 'UNAUTHORIZED') {
    super(401, code, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(
    message = 'Anda tidak memiliki hak akses untuk melakukan tindakan ini',
    code = 'FORBIDDEN'
  ) {
    super(403, code, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Data yang diminta tidak ditemukan', code = 'NOT_FOUND') {
    super(404, code, message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = 'CONFLICT', details?: unknown) {
    super(409, code, message, details);
  }
}

export class UnprocessableEntityError extends AppError {
  constructor(message: string, code = 'BUSINESS_RULE_VIOLATION', details?: unknown) {
    super(422, code, message, details);
  }
}

export class SerializationFailureError extends AppError {
  constructor(
    message = 'Terjadi konflik transaksi konkuren, silakan ulangi permintaan',
    code = 'CONCURRENT_TRANSACTION_CONFLICT',
  ) {
    super(409, code, message);
  }
}

interface PgDatabaseError {
  code?: string;
  constraint?: string;
  detail?: string;
  table?: string;
}

const CONSTRAINT_MESSAGES: Record<string, string> = {
  users_username_key: 'Username sudah terdaftar',
  warehouses_code_key: 'Kode gudang sudah digunakan',
  loading_docks_warehouse_id_dock_number_key: 'Nomor loading dock sudah ada pada gudang tersebut',
  vehicles_plate_number_key: 'Nomor polisi kendaraan sudah terdaftar',
  chk_vehicle_category_type_strict:
    'Kombinasi kategori dan tipe kendaraan tidak valid: CARGO hanya untuk MOBIL_BOX, sedangkan CONTAINER hanya untuk TRAILER atau TRONTON',
  uq_active_vehicle_in_area:
    'Kendaraan ini masih memiliki transaksi aktif di dalam kawasan pergudangan',
  chk_container_iso6346:
    'Format nomor kontainer tidak sesuai standar ISO 6346 (wajib 4 huruf kapital diikuti 7 digit angka)',
  warehouse_stocks_available_qty_check: 'Stok barang di gudang tidak mencukupi (saldo tidak boleh negatif)',
  chk_gate_out_after_in: 'Waktu Gate-Out tidak boleh lebih awal dari waktu Gate-In',
};

/**
 * Menerjemahkan error native PostgreSQL (pg) menjadi AppError yang terstruktur.
 */
export function mapPostgresError(err: unknown): AppError | null {
  if (typeof err !== 'object' || err === null || !('code' in err)) {
    return null;
  }

  const pgErr = err as PgDatabaseError;
  const code = pgErr.code;
  const constraint = pgErr.constraint ?? '';

  switch (code) {
    case '23505': {
      const friendly =
        CONSTRAINT_MESSAGES[constraint] ?? 'Data duplikat melanggar aturan keunikan sistem';
      return new ConflictError(friendly, 'UNIQUE_VIOLATION', { constraint });
    }
    case '23503': {
      return new UnprocessableEntityError(
        'Referensi data induk tidak ditemukan atau data masih digunakan oleh transaksi lain',
        'FOREIGN_KEY_VIOLATION',
        { constraint },
      );
    }
    case '23514': {
      const friendly =
        CONSTRAINT_MESSAGES[constraint] ?? 'Data melanggar aturan validasi skema basis data';
      return new UnprocessableEntityError(friendly, 'CHECK_CONSTRAINT_VIOLATION', { constraint });
    }
    case '22P02': {
      return new BadRequestError(
        'Format parameter atau tipe data input tidak valid (misal UUID atau ENUM)',
        'INVALID_TEXT_REPRESENTATION',
      );
    }
    case '40001':
    case '40P01': {
      return new SerializationFailureError();
    }
    default:
      return null;
  }
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validasi input gagal',
        details: err.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
    });
    return;
  }

  const mappedPg = mapPostgresError(err);
  if (mappedPg) {
    res.status(mappedPg.statusCode).json({
      success: false,
      error: {
        code: mappedPg.code,
        message: mappedPg.message,
        ...(mappedPg.details !== undefined ? { details: mappedPg.details } : {}),
      },
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    });
    return;
  }

  logger.error({ err, method: req.method, path: req.originalUrl }, 'Unhandled server error');
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Terjadi kesalahan internal pada server',
    },
  });
}
