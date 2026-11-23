import type { Request, Response } from 'express';
import { getAuthContext } from '../middlewares/auth.middleware.js';
import { cargoService } from '../services/cargo.service.js';
import { extractClientIp, getRouteParam } from '../utils/http.js';
import {
  createItemMasterSchema,
  listItemsQuerySchema,
  listMovementsQuerySchema,
  recordCargoItemsSchema,
} from '../validators/cargo.validator.js';

export class CargoController {
  async createItemMaster(req: Request, res: Response): Promise<void> {
    const auth = getAuthContext(req);
    const body = createItemMasterSchema.parse(req.body);
    const item = await cargoService.createItemMaster(auth.sub, body, extractClientIp(req));
    res.status(201).json({ success: true, data: item });
  }

  async listItemsMaster(req: Request, res: Response): Promise<void> {
    const query = listItemsQuerySchema.parse(req.query);
    const result = await cargoService.listItemsMaster(query);
    res.status(200).json({
      success: true,
      data: result.items,
      meta: { total: result.total, limit: query.limit, offset: query.offset },
    });
  }

  async recordTransactionCargoItems(req: Request, res: Response): Promise<void> {
    const auth = getAuthContext(req);
    const txId = getRouteParam(req, 'id', 'ID transaksi gate');
    const body = recordCargoItemsSchema.parse(req.body);
    const result = await cargoService.recordTransactionCargoItems(
      auth.sub,
      txId,
      body.items,
      extractClientIp(req),
    );
    res.status(200).json({ success: true, data: result });
  }

  async getTransactionCargoItems(req: Request, res: Response): Promise<void> {
    const txId = getRouteParam(req, 'id', 'ID transaksi gate');
    const result = await cargoService.getTransactionCargoItems(txId);
    res.status(200).json({ success: true, data: result });
  }

  async finalizeInbound(req: Request, res: Response): Promise<void> {
    const auth = getAuthContext(req);
    const txId = getRouteParam(req, 'id', 'ID transaksi gate');
    const result = await cargoService.finalizeInboundUnloading(
      auth.sub,
      txId,
      extractClientIp(req),
    );
    res.status(200).json({ success: true, data: result });
  }

  async finalizeOutbound(req: Request, res: Response): Promise<void> {
    const auth = getAuthContext(req);
    const txId = getRouteParam(req, 'id', 'ID transaksi gate');
    const result = await cargoService.finalizeOutboundLoading(
      auth.sub,
      txId,
      extractClientIp(req),
    );
    res.status(200).json({ success: true, data: result });
  }

  async getWarehouseInventory(req: Request, res: Response): Promise<void> {
    const warehouseId = getRouteParam(req, 'warehouseId', 'ID gudang');
    const report = await cargoService.getWarehouseInventoryReport(warehouseId);
    res.status(200).json({ success: true, data: report });
  }

  async listStockMovements(req: Request, res: Response): Promise<void> {
    const query = listMovementsQuerySchema.parse(req.query);
    const result = await cargoService.listStockMovements(query);
    res.status(200).json({
      success: true,
      data: result.items,
      meta: { total: result.total, limit: query.limit, offset: query.offset },
    });
  }
}

export const cargoController = new CargoController();
