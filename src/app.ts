import express, { type Request, type Response } from 'express';
import { authController } from './controllers/auth.controller.js';
import { gateController } from './controllers/gate.controller.js';
import { masterController } from './controllers/master.controller.js';
import { cargoController } from './controllers/cargo.controller.js';
import { authenticate, requirePermission } from './middlewares/auth.middleware.js';
import { errorHandler } from './utils/errors.js';
import { checkSystemHealth } from './utils/health.js';

export function createApp() {
  const app = express();

  app.use(express.json({ limit: '1mb' }));

  app.get('/health', async (_req: Request, res: Response) => {
    const health = await checkSystemHealth();
    const httpStatus = health.status === 'ok' ? 200 : 503;
    res.status(httpStatus).json(health);
  });

  // =========================================================================
  // Auth & RBAC Endpoints (Milestone 2)
  // =========================================================================
  app.post('/api/v1/auth/bootstrap-admin', (req, res) => authController.bootstrapAdmin(req, res));
  app.post('/api/v1/auth/login', (req, res) => authController.login(req, res));
  app.post('/api/v1/auth/refresh', (req, res) => authController.refresh(req, res));
  app.post('/api/v1/auth/logout', (req, res) => authController.logout(req, res));

  app.get('/api/v1/auth/me', authenticate, (req, res) => authController.me(req, res));
  app.get('/api/v1/roles', authenticate, requirePermission('user:manage'), (req, res) =>
    authController.listRoles(req, res),
  );
  app.get('/api/v1/users', authenticate, requirePermission('user:manage'), (req, res) =>
    authController.listUsers(req, res),
  );
  app.post('/api/v1/users', authenticate, requirePermission('user:manage'), (req, res) =>
    authController.createUser(req, res),
  );
  app.get('/api/v1/audit-logs', authenticate, requirePermission('audit:read'), (req, res) =>
    authController.listAuditLogs(req, res),
  );

  // =========================================================================
  // Master Warehouses, Loading Docks, & Vehicles (Milestone 3)
  // =========================================================================
  app.get('/api/v1/warehouses', authenticate, requirePermission('master:read'), (req, res) =>
    masterController.listWarehouses(req, res),
  );
  app.post('/api/v1/warehouses', authenticate, requirePermission('master:manage'), (req, res) =>
    masterController.createWarehouse(req, res),
  );

  app.get('/api/v1/docks', authenticate, requirePermission('master:read'), (req, res) =>
    masterController.listDocks(req, res),
  );
  app.post('/api/v1/docks', authenticate, requirePermission('master:manage'), (req, res) =>
    masterController.createDock(req, res),
  );
  app.patch('/api/v1/docks/:id/status', authenticate, requirePermission('dock:manage'), (req, res) =>
    masterController.updateDockStatus(req, res),
  );

  app.get('/api/v1/vehicles', authenticate, requirePermission('master:read'), (req, res) =>
    masterController.listVehicles(req, res),
  );
  app.get(
    '/api/v1/vehicles/plate/:plateNumber',
    authenticate,
    requirePermission('master:read'),
    (req, res) => masterController.lookupVehicleByPlate(req, res),
  );
  app.post('/api/v1/vehicles', authenticate, requirePermission('master:manage'), (req, res) =>
    masterController.registerVehicle(req, res),
  );

  // =========================================================================
  // Gate Operations & Dock Assignment (Milestone 3)
  // =========================================================================
  app.get('/api/v1/gate/transactions', authenticate, requirePermission('gate:read'), (req, res) =>
    gateController.listTransactions(req, res),
  );
  app.get('/api/v1/gate/transactions/:id', authenticate, requirePermission('gate:read'), (req, res) =>
    gateController.getTransactionDetail(req, res),
  );
  app.post('/api/v1/gate/in', authenticate, requirePermission('gate:checkin'), (req, res) =>
    gateController.processGateIn(req, res),
  );
  app.post(
    '/api/v1/gate/transactions/:id/assign-dock',
    authenticate,
    requirePermission('dock:assign'),
    (req, res) => gateController.assignDock(req, res),
  );
  app.post(
    '/api/v1/gate/transactions/:id/gate-out',
    authenticate,
    requirePermission('gate:checkout'),
    (req, res) => gateController.processGateOut(req, res),
  );

  // =========================================================================
  // Master Items, Cargo Operations, & Inventory Ledger (Milestone 4)
  // =========================================================================
  app.get('/api/v1/items', authenticate, requirePermission('master:read'), (req, res) =>
    cargoController.listItemsMaster(req, res),
  );
  app.post('/api/v1/items', authenticate, requirePermission('master:manage'), (req, res) =>
    cargoController.createItemMaster(req, res),
  );

  app.get(
    '/api/v1/gate/transactions/:id/cargo-items',
    authenticate,
    requirePermission('gate:read'),
    (req, res) => cargoController.getTransactionCargoItems(req, res),
  );
  app.put(
    '/api/v1/gate/transactions/:id/cargo-items',
    authenticate,
    requirePermission('cargo:record'),
    (req, res) => cargoController.recordTransactionCargoItems(req, res),
  );
  app.post(
    '/api/v1/gate/transactions/:id/finalize-inbound',
    authenticate,
    requirePermission('cargo:finalize'),
    (req, res) => cargoController.finalizeInbound(req, res),
  );
  app.post(
    '/api/v1/gate/transactions/:id/finalize-outbound',
    authenticate,
    requirePermission('cargo:finalize'),
    (req, res) => cargoController.finalizeOutbound(req, res),
  );

  app.get(
    '/api/v1/warehouses/:warehouseId/inventory',
    authenticate,
    requirePermission('inventory:read'),
    (req, res) => cargoController.getWarehouseInventory(req, res),
  );
  app.get(
    '/api/v1/inventory/movements',
    authenticate,
    requirePermission('inventory:read'),
    (req, res) => cargoController.listStockMovements(req, res),
  );

  app.use(errorHandler);

  return app;
}
