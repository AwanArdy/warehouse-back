import type { Request, Response } from 'express';
import { getAuthContext } from '../middlewares/auth.middleware.js';
import { masterService } from '../services/master.service.js';
import { extractClientIp, getRouteParam } from '../utils/http.js';
import {
  createDockSchema,
  createVehicleSchema,
  createWarehouseSchema,
  listDocksQuerySchema,
  listVehiclesQuerySchema,
  updateDockStatusSchema,
} from '../validators/master.validator.js';

export class MasterController {
  async createWarehouse(req: Request, res: Response): Promise<void> {
    const auth = getAuthContext(req);
    const body = createWarehouseSchema.parse(req.body);
    const warehouse = await masterService.createWarehouse(auth.sub, body, extractClientIp(req));
    res.status(201).json({ success: true, data: warehouse });
  }

  async listWarehouses(_req: Request, res: Response): Promise<void> {
    const warehouses = await masterService.listWarehouses();
    res.status(200).json({ success: true, data: warehouses });
  }

  async createDock(req: Request, res: Response): Promise<void> {
    const auth = getAuthContext(req);
    const body = createDockSchema.parse(req.body);
    const dock = await masterService.createDock(auth.sub, body, extractClientIp(req));
    res.status(201).json({ success: true, data: dock });
  }

  async listDocks(req: Request, res: Response): Promise<void> {
    const query = listDocksQuerySchema.parse(req.query);
    const docks = await masterService.listDocks(query);
    res.status(200).json({ success: true, data: docks });
  }

  async updateDockStatus(req: Request, res: Response): Promise<void> {
    const auth = getAuthContext(req);
    const dockId = getRouteParam(req, 'id', 'ID dock');
    const body = updateDockStatusSchema.parse(req.body);
    const updated = await masterService.updateDockStatus(
      auth.sub,
      dockId,
      body.status,
      extractClientIp(req),
    );
    res.status(200).json({ success: true, data: updated });
  }

  async registerVehicle(req: Request, res: Response): Promise<void> {
    const auth = getAuthContext(req);
    const body = createVehicleSchema.parse(req.body);
    const vehicle = await masterService.registerVehicle(auth.sub, body, extractClientIp(req));
    res.status(201).json({ success: true, data: vehicle });
  }

  async lookupVehicleByPlate(req: Request, res: Response): Promise<void> {
    const plate = getRouteParam(req, 'plateNumber', 'nomor polisi');
    const vehicle = await masterService.lookupVehicleByPlate(plate);
    res.status(200).json({ success: true, data: vehicle });
  }

  async listVehicles(req: Request, res: Response): Promise<void> {
    const query = listVehiclesQuerySchema.parse(req.query);
    const result = await masterService.listVehicles(query);
    res.status(200).json({
      success: true,
      data: result.items,
      meta: { total: result.total, limit: query.limit, offset: query.offset },
    });
  }
}

export const masterController = new MasterController();
