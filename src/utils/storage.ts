import { constants } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { env } from '../config/env.js';

export interface StorageHealthResult {
  ok: boolean;
  driver: 'local' | 's3';
  location: string;
  error?: string;
}

export interface DocumentStorage {
  init(): Promise<void>;
  checkHealth(): Promise<StorageHealthResult>;
  putPdf(relativeKey: string, pdfBuffer: Buffer): Promise<string>;
  getPdf(relativeKey: string): Promise<Buffer>;
}

class LocalDiskStorage implements DocumentStorage {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = path.resolve(baseDir);
  }

  private resolveSafePath(relativeKey: string): string {
    const cleanKey = relativeKey.replace(/^\/+/, '');
    const fullPath = path.resolve(this.baseDir, cleanKey);
    if (!fullPath.startsWith(`${this.baseDir}${path.sep}`) && fullPath !== this.baseDir) {
      throw new Error('Path traversal terdeteksi pada key penyimpanan dokumen');
    }
    return fullPath;
  }

  async init(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
  }

  async checkHealth(): Promise<StorageHealthResult> {
    try {
      await access(this.baseDir, constants.R_OK | constants.W_OK);
      return { ok: true, driver: 'local', location: this.baseDir };
    } catch (err) {
      return {
        ok: false,
        driver: 'local',
        location: this.baseDir,
        error: err instanceof Error ? err.message : 'Direktori penyimpanan lokal tidak dapat diakses',
      };
    }
  }

  async putPdf(relativeKey: string, pdfBuffer: Buffer): Promise<string> {
    const fullPath = this.resolveSafePath(relativeKey);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, pdfBuffer);
    return relativeKey.replace(/^\/+/, '');
  }

  async getPdf(relativeKey: string): Promise<Buffer> {
    const fullPath = this.resolveSafePath(relativeKey);
    return readFile(fullPath);
  }
}

class S3ObjectStorage implements DocumentStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    this.bucket = env.S3_BUCKET;
    this.client = new S3Client({
      region: 'us-east-1',
      endpoint: `${env.S3_USE_SSL ? 'https' : 'http'}://${env.S3_ENDPOINT}:${env.S3_PORT}`,
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY ?? '',
        secretAccessKey: env.S3_SECRET_KEY ?? '',
      },
    });
  }

  async init(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (err: unknown) {
      const statusCode =
        typeof err === 'object' &&
        err !== null &&
        '$metadata' in err &&
        typeof (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode ===
          'number'
          ? (err as { $metadata: { httpStatusCode: number } }).$metadata.httpStatusCode
          : undefined;

      if (statusCode === 404 || (err instanceof Error && err.name === 'NotFound')) {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        return;
      }
      throw err;
    }
  }

  async checkHealth(): Promise<StorageHealthResult> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return { ok: true, driver: 's3', location: this.bucket };
    } catch (err) {
      return {
        ok: false,
        driver: 's3',
        location: this.bucket,
        error: err instanceof Error ? err.message : 'Bucket S3 tidak dapat diakses',
      };
    }
  }

  async putPdf(relativeKey: string, pdfBuffer: Buffer): Promise<string> {
    const cleanKey = relativeKey.replace(/^\/+/, '');
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: cleanKey,
        Body: pdfBuffer,
        ContentType: 'application/pdf',
      }),
    );
    return cleanKey;
  }

  async getPdf(relativeKey: string): Promise<Buffer> {
    const cleanKey = relativeKey.replace(/^\/+/, '');
    const res = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: cleanKey,
      }),
    );
    if (!res.Body) {
      throw new Error(`Objek PDF tidak ditemukan: ${cleanKey}`);
    }
    const bytes = await res.Body.transformToByteArray();
    return Buffer.from(bytes);
  }
}

export const documentStorage: DocumentStorage =
  env.STORAGE_DRIVER === 's3'
    ? new S3ObjectStorage()
    : new LocalDiskStorage(env.LOCAL_STORAGE_DIR);
