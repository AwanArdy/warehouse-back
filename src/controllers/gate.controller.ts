import type { Request, Response } from 'express';
import { getAuthContext } from '../middlewares/auth.middleware.js';
import { gateService } from '../services/gate.service.js';
import { extractClientIp, getRouteParam } from '../utils/http.js';
import {
  assignDockSchema,
  gateInSchema,
  gateOutSchema,
  listGateTransactionsQuerySchema,
} from '../validators/gate.validator.js';

export class GateController {
  async processGateIn(req: Request, res: Response): Promise<void> {
    const auth = getAuthContext(req);
    const body = gateInSchema.parse(req.body);
    const detail = await gateService.processGateIn(auth.sub, body, extractClientIp(req));
    res.status(201).json({ success: true, data: detail });
  }

  async assignDock(req: Request, res: Response): Promise<void> {
    const auth = getAuthContext(req);
    const txId = getRouteParam(req, 'id', 'ID transaksi gate');
    const body = assignDockSchema.parse(req.body);
    const detail = await gateService.assignDock(auth.sub, txId, body.dockId, extractClientIp(req));
    res.status(200).json({ success: true, data: detail });
  }

  async processGateOut(req: Request, res: Response): Promise<void> {
    const auth = getAuthContext(req);
    const txId = getRouteParam(req, 'id', 'ID transaksi gate');
    const body = gateOutSchema.parse(req.body ?? {});
    const detail = await gateService.processGateOut(
      auth.sub,
      txId,
      body.notes,
      extractClientIp(req),
    );
    res.status(200).json({ success: true, data: detail });
  }

  async getTransactionDetail(req: Request, res: Response): Promise<void> {
    const txId = getRouteParam(req, 'id', 'ID transaksi gate');
    const detail = await gateService.getTransactionDetail(txId);
    res.status(200).json({ success: true, data: detail });
  }

  async listTransactions(req: Request, res: Response): Promise<void> {
    const query = listGateTransactionsQuerySchema.parse(req.query);
    const result = await gateService.listTransactions(query);
    res.status(200).json({
      success: true,
      data: result.items,
      meta: { total: result.total, limit: query.limit, offset: query.offset },
    });
  }
}

export const gateController = new GateController();
