import express, { type Request, type Response } from 'express';
import { authController } from './controllers/auth.controller.js';
import { gateController } from './controllers/gate.controller.js';
import { masterController } from './controllers/master.controller.js';
import { cargoController } from './controllers/cargo.controller.js';
import { documentController } from './controllers/document.controller.js';
import { handleOpenApiJson, handleSwaggerUi } from './docs/openapi.js';
import { authenticate, requirePermission } from './middlewares/auth.middleware.js';
import { cors } from './middlewares/cors.middleware.js';
import { createRateLimiter } from './middlewares/rate-limiter.middleware.js';
import { securityHeaders } from './middlewares/security.middleware.js';
import { errorHandler } from './utils/errors.js';
import { checkSystemHealth } from './utils/health.js';

export function createApp() {
  const app = express();

  // M6.2: API Hardening - Security Headers & CORS
  app.use(securityHeaders);
  app.use(cors());

  app.use(express.json({ limit: '1mb' }));

  // M6.1: OpenAPI 3.1 & Interactive Documentation (Swagger UI)
  app.get('/openapi.json', handleOpenApiJson);
  app.get('/api-docs', handleSwaggerUi);
  app.get('/docs', handleSwaggerUi);

  app.get('/health', async (_req: Request, res: Response) => {
    const health = await checkSystemHealth();
    const httpStatus = health.status === 'ok' ? 200 : 503;
    res.status(httpStatus).json(health);
  });

  // M6.2: Rate Limiting
  const apiLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 1000,
    message: 'Batas frekuensi permintaan API tercapai. Silakan coba beberapa saat lagi.',
  });
  app.use('/api/', apiLimiter);

  const loginLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 50,
    message: 'Terlalu banyak percobaan login dari IP ini. Silakan coba 1 menit lagi.',
  });

  // =========================================================================
  // Auth & RBAC Endpoints (Milestone 2)
  // =========================================================================
  app.post('/api/v1/auth/bootstrap-admin', (req, res) => authController.bootstrapAdmin(req, res));
  app.post('/api/v1/auth/login', loginLimiter, (req, res) => authController.login(req, res));
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

  // =========================================================================
  // Official Documents & LaTeX Compilation (Milestone 5)
  // =========================================================================
  app.get('/api/v1/documents', authenticate, requirePermission('doc:read'), (req, res) =>
    documentController.listDocuments(req, res),
  );
  app.get('/api/v1/documents/:id', authenticate, requirePermission('doc:read'), (req, res) =>
    documentController.getDocumentDetail(req, res),
  );
  app.get('/api/v1/documents/:id/pdf', authenticate, requirePermission('doc:read'), (req, res) =>
    documentController.downloadPdf(req, res),
  );
  app.post(
    '/api/v1/gate/transactions/:id/documents',
    authenticate,
    requirePermission('doc:generate'),
    (req, res) => documentController.generateForTransaction(req, res),
  );
  app.post('/api/v1/documents/daily-recap', authenticate, requirePermission('doc:generate'), (req, res) =>
    documentController.generateDailyRecap(req, res),
  );
  app.post('/api/v1/documents/:id/void', authenticate, requirePermission('doc:void'), (req, res) =>
    documentController.voidDocument(req, res),
  );
  app.post('/api/v1/documents/:id/retry', authenticate, requirePermission('doc:generate'), (req, res) =>
    documentController.retryDocument(req, res),
  );

  app.use(errorHandler);

  return app;
}
