import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from 'node:os';
import path from 'node:path';
import { promisify } from "node:util";
import { env } from "../config/env.js";
import { executeQuery, pool } from "../db/pool.js";
import { withTransaction } from "../db/transaction.js";
import { documentRepository, type QueuedLatexJob } from "../repositories/document.repository.js";
import { gateTransactionRepository } from "../repositories/gate-transaction.repository.js";
import { logger } from "../utils/logger.js";
import { documentStorage } from "../utils/storage.js";

const execFileAsync = promisify(execFile);

export class LatexCompilerWorker {
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private readonly pollIntervalMs: number;

  constructor(pollIntervalMs = 1500) {
    this.pollIntervalMs = pollIntervalMs;
  }

  start(): void {
    if (this.timer) return;
    logger.info({ pollIntervalMs: this.pollIntervalMs }, 'LaTeX Compiler Worker dimulai');
    this.timer = setInterval(() => {
      void this.drainQueue();
    }, this.pollIntervalMs);
    void this.drainQueue();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('LaTeX Compiler Worker dihentikan');
    }
  }

  /**
   * Memicu pemrosesan antrean segera tanpa menunggu interval polling berikutnya.
   */
  triggerNow(): void {
    void this.drainQueue();
  }

  async drainQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      while (true) {
        const job = await documentRepository.claimNextQueuedJob(pool);
        if (!job) break;
        await this.processJob(job);
      }
    } catch (err) {
      logger.error({ err }, 'Error tak terduga saat polling antrean LaTeX');
    } finally {
      this.isProcessing = false;
    }
  }

  private async compileTexToPdf(latexSource: string): Promise<Buffer> {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'warehouse-latex-'));
    const texPath = path.join(tempDir, 'document.tex');
    const pdfPath = path.join(tempDir, 'document.pdf');

    try {
      await writeFile(texPath, latexSource, 'utf8');

      const args = [
        '-no-shell-escape',
        '-interaction=nonstopmode',
        '-halt-on-error',
        '-output-directory',
        tempDir,
        texPath,
      ];

      // Jalankan 2 pass agar longtable column alignment & LastPage reference akurat
      for (let pass = 1; pass <= 2; pass++) {
        try {
          await execFileAsync(env.LATEX_BIN, args, {
            cwd: tempDir,
            timeout: env.LATEX_TIMEOUT_MS,
            maxBuffer: 4 * 1024 * 1024,
          });
        } catch (err: unknown) {
          const execErr = err as { stdout?: string; stderr?: string; message?: string };
          const combinedOutput = [execErr.stderr, execErr.stdout, execErr.message]
            .filter((part): part is string => Boolean(part && part.trim().length > 0))
            .join('\n');
          const trimmedLog = combinedOutput.slice(-3500);
          throw new Error(`Kompilasi xelatex gagal pada pass ${pass}:\n${trimmedLog}`);
        }
      }

      return await readFile(pdfPath);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  private async processJob(job: QueuedLatexJob): Promise<void> {
    const startMs = performance.now();

    try {
      const pdfBuffer = await this.compileTexToPdf(job.latexSource);
      const sha256 = createHash('sha256').update(pdfBuffer).digest('hex');

      const safeFilename = job.documentNumber.replace(/[^A-Za-z0-9_-]/g, '_');
      const periodSegment = job.documentNumber.split('/')[2] ?? 'general';
      const storageKey = `${job.docType.toLowerCase()}/${periodSegment}/${safeFilename}.pdf`;

      const savedPath = await documentStorage.putPdf(storageKey, pdfBuffer);

      await withTransaction(async (client) => {
        await documentRepository.markIssued(client, job.id, savedPath, sha256);

        // Jika BASTB atau SURAT_JALAN terbit, majukan status transaksi gate ke DOC_ISSUED
        if (
          job.gateTransactionId &&
          (job.docType === 'BASTB' || job.docType === 'SURAT_JALAN')
        ) {
          const tx = await gateTransactionRepository.findByIdForUpdate(
            client,
            job.gateTransactionId,
          );
          if (tx && tx.status === 'DOC_PENDING') {
            await executeQuery(
              client,
              `UPDATE gate_transactions SET status = 'DOC_ISSUED' WHERE id = $1`,
              [tx.id],
            );
            await gateTransactionRepository.insertStatusLog(client, {
              gateTransactionId: tx.id,
              fromStatus: 'DOC_PENDING',
              toStatus: 'DOC_ISSUED',
              notes: `Dokumen wajib ${job.docType} (${job.documentNumber}) berhasil dikompilasi dan berstatus ISSUED`,
              changedBy: tx.createdBy,
            });
          }
        }
      });

      const elapsedMs = Math.round(performance.now() - startMs);
      logger.info(
        { documentNumber: job.documentNumber, docType: job.docType, elapsedMs, sha256 },
        'Dokumen PDF LaTeX berhasil diterbitkan',
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown LaTeX compilation error';
      const nextStatus = await documentRepository.markFailedOrScheduleRetry(
        pool,
        job.id,
        errorMessage,
        3,
      );
      logger.error(
        { documentNumber: job.documentNumber, nextStatus, err: errorMessage },
        'Gagal mengompilasi dokumen LaTeX',
      );
    }
  }
}

export const latexCompilerWorker = new LatexCompilerWorker();
