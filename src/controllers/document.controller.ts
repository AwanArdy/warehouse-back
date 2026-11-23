import type { Request, Response } from 'express';
import { getAuthContext } from '../middlewares/auth.middleware.js';
import { documentService } from '../services/document.service.js';
import { extractClientIp, getRouteParam } from '../utils/http.js';
import {
  generateDailyRecapSchema,
  generateTransactionDocSchema,
  listDocumentsQuerySchema,
  voidDocumentSchema,
} from '../validators/document.validator.js';

export class DocumentController {
  async generateForTransaction(req: Request, res: Response): Promise<void> {
    const auth = getAuthContext(req);
    const txId = getRouteParam(req, 'id', 'ID transaksi gate');
    const body = generateTransactionDocSchema.parse(req.body);
    const doc = await documentService.generateTransactionDocument(
      auth.sub,
      txId,
      body.docType,
      extractClientIp(req),
    );
    res.status(202).json({ success: true, data: doc });
  }

  async generateDailyRecap(req: Request, res: Response): Promise<void> {
    const auth = getAuthContext(req);
    const body = generateDailyRecapSchema.parse(req.body);
    const doc = await documentService.generateDailyRecapDocument(
      auth.sub,
      body.warehouseId,
      body.reportDate,
      extractClientIp(req),
    );
    res.status(202).json({ success: true, data: doc });
  }

  async listDocuments(req: Request, res: Response): Promise<void> {
    const query = listDocumentsQuerySchema.parse(req.query);
    const result = await documentService.listDocuments(query);
    res.status(200).json({
      success: true,
      data: result.items,
      meta: { total: result.total, limit: query.limit, offset: query.offset },
    });
  }

  async getDocumentDetail(req: Request, res: Response): Promise<void> {
    const docId = getRouteParam(req, 'id', 'ID dokumen');
    const doc = await documentService.getDocumentById(docId);
    res.status(200).json({ success: true, data: doc });
  }

  async downloadPdf(req: Request, res: Response): Promise<void> {
    const docId = getRouteParam(req, 'id', 'ID dokumen');
    const file = await documentService.getCompiledPdfBuffer(docId);

    // Hapus batasan X-Frame-Options agar dokumen dapat dipratinjau dalam iframe di antarmuka web
    res.removeHeader('X-Frame-Options');
    res.setHeader('Content-Security-Policy', "frame-ancestors *");
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${file.filename}"`);
    res.setHeader('X-Document-SHA256', file.sha256);
    res.setHeader('X-Document-Status', file.status);
    res.status(200).send(file.pdfBuffer);
  }

  async voidDocument(req: Request, res: Response): Promise<void> {
    const auth = getAuthContext(req);
    const docId = getRouteParam(req, 'id', 'ID dokumen');
    const body = voidDocumentSchema.parse(req.body);
    const voided = await documentService.voidDocument(
      auth.sub,
      docId,
      body.voidReason,
      extractClientIp(req),
    );
    res.status(200).json({ success: true, data: voided });
  }

  async retryDocument(req: Request, res: Response): Promise<void> {
    const auth = getAuthContext(req);
    const docId = getRouteParam(req, 'id', 'ID dokumen');
    const retried = await documentService.retryFailedDocument(
      auth.sub,
      docId,
      extractClientIp(req),
    );
    res.status(202).json({ success: true, data: retried });
  }
}

export const documentController = new DocumentController();
