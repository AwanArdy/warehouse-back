import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { documentStorage } from '../src/utils/storage.js';
import { latexCompilerWorker } from '../src/workers/latex-compiler.worker.js';

let server: Server;
let baseUrl: string;

let adminAccessToken = '';
let gateAccessToken = '';
let gudangAccessToken = '';

let warehouseId = '';
let cargoDockId = '';
let containerDockId = '';
let cargoVehicleId = '';
let containerVehicleId = '';
let item1Id = '';
let item2Id = '';

before(async () => {
  await documentStorage.init();

  // Bersihkan data tes secara bersih di database
  await pool.query('TRUNCATE users, warehouses, items_master, vehicles CASCADE;');

  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address === 'object' && address !== null) {
        baseUrl = `http://127.0.0.1:${address.port}`;
      }
      latexCompilerWorker.start();
      resolve();
    });
  });
});

after(async () => {
  latexCompilerWorker.stop();
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await pool.end();
});

async function apiRequest(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
  });
  const text = await response.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: response.status, headers: response.headers, data: json };
}

describe('Milestone 6: API Hardening, OpenAPI 3.1, & Integration Tests', () => {
  // =========================================================================
  // M6.1: OpenAPI 3.1 & Interactive Documentation (Swagger UI)
  // =========================================================================
  describe('M6.1: OpenAPI Spec & Documentation', () => {
    it('GET /openapi.json mengembalikan dokumen OpenAPI 3.1 valid', async () => {
      const res = await apiRequest('/openapi.json');
      assert.equal(res.status, 200);
      assert.equal(res.data.openapi, '3.1.0');
      assert.ok(res.data.info.title.includes('Sistem Administrasi Kawasan Pergudangan'));
      assert.ok(res.data.paths['/health']);
      assert.ok(res.data.paths['/api/v1/auth/login']);
      assert.ok(res.data.paths['/api/v1/gate/in']);
      assert.ok(res.data.paths['/api/v1/documents']);
      assert.ok(res.data.components.schemas.ErrorResponse);
    });

    it('GET /api-docs dan GET /docs mengembalikan Swagger UI HTML interaktif', async () => {
      const resDocs = await apiRequest('/api-docs');
      assert.equal(resDocs.status, 200);
      assert.ok(String(resDocs.data).includes('swagger-ui'));

      const resDocs2 = await apiRequest('/docs');
      assert.equal(resDocs2.status, 200);
      assert.ok(String(resDocs2.data).includes('swagger-ui'));
    });
  });

  // =========================================================================
  // M6.2: API Hardening (CORS, Security Headers, Rate Limiting)
  // =========================================================================
  describe('M6.2: Security Headers, CORS, & Rate Limiting', () => {
    it('Respons HTTP menyertakan Security Headers lengkap (Helmet-equivalent)', async () => {
      const res = await apiRequest('/health');
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(res.headers.get('x-frame-options'), 'DENY');
      assert.equal(res.headers.get('x-xss-protection'), '1; mode=block');
      assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
      assert.ok(res.headers.get('content-security-policy'));
    });

    it('CORS preflight (OPTIONS) merespons dengan 204 dan header yang diizinkan', async () => {
      const res = await apiRequest('/api/v1/auth/login', {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:5173',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Authorization, Content-Type',
        },
      });
      assert.equal(res.status, 204);
      assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
      assert.ok(res.headers.get('access-control-allow-methods')?.includes('POST'));
      assert.ok(res.headers.get('access-control-allow-headers')?.includes('Authorization'));
    });

    it('Header Rate Limiter terpasang pada endpoint sensitif', async () => {
      const res = await apiRequest('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: 'invalid_user', password: 'wrong_password' }),
      });
      assert.equal(res.status, 401);
      assert.ok(res.headers.has('x-ratelimit-limit'));
      assert.ok(res.headers.has('x-ratelimit-remaining'));
      assert.ok(res.headers.has('x-ratelimit-reset'));
    });
  });

  // =========================================================================
  // M6.3: Auth & RBAC Security Hardening
  // =========================================================================
  describe('M6.3: Autentikasi & Granular RBAC Tests', () => {
    it('Bootstrap Super Admin berhasil, bootstrap kedua ditolak (409 Conflict)', async () => {
      const res1 = await apiRequest('/api/v1/auth/bootstrap-admin', {
        method: 'POST',
        body: JSON.stringify({
          username: 'admin_m6',
          fullName: 'Super Admin M6',
          password: 'PasswordSuper123!',
        }),
      });
      assert.equal(res1.status, 201);
      assert.equal(res1.data.success, true);

      const res2 = await apiRequest('/api/v1/auth/bootstrap-admin', {
        method: 'POST',
        body: JSON.stringify({
          username: 'admin_m6_fake',
          fullName: 'Fake Admin',
          password: 'PasswordSuper123!',
        }),
      });
      assert.equal(res2.status, 409);
      assert.equal(res2.data.error.code, 'BOOTSTRAP_ALREADY_COMPLETED');
    });

    it('Login Super Admin menghasilkan Access Token dan Refresh Token valid', async () => {
      const res = await apiRequest('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          username: 'admin_m6',
          password: 'PasswordSuper123!',
        }),
      });
      assert.equal(res.status, 200);
      adminAccessToken = res.data.data.accessToken;
      assert.ok(adminAccessToken);
      assert.ok(res.data.data.refreshToken);
    });

    it('Super Admin membuat user Petugas Gate dan Admin Gudang', async () => {
      const resGate = await apiRequest('/api/v1/users', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminAccessToken}` },
        body: JSON.stringify({
          username: 'gate_officer_m6',
          fullName: 'Budi Petugas Gate',
          password: 'PasswordGate123!',
          roleCode: 'PETUGAS_GATE',
        }),
      });
      assert.equal(resGate.status, 201);

      const resGudang = await apiRequest('/api/v1/users', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminAccessToken}` },
        body: JSON.stringify({
          username: 'gudang_admin_m6',
          fullName: 'Siti Admin Gudang',
          password: 'PasswordGudang123!',
          roleCode: 'ADMIN_GUDANG',
        }),
      });
      assert.equal(resGudang.status, 201);

      // Login untuk mendapatkan token masing-masing role
      const loginGate = await apiRequest('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: 'gate_officer_m6', password: 'PasswordGate123!' }),
      });
      gateAccessToken = loginGate.data.data.accessToken;

      const loginGudang = await apiRequest('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: 'gudang_admin_m6', password: 'PasswordGudang123!' }),
      });
      gudangAccessToken = loginGudang.data.data.accessToken;
    });

    it('RBAC Enforcement: Petugas Gate dilarang mengakses manajemen pengguna (403 Forbidden)', async () => {
      const res = await apiRequest('/api/v1/users', {
        method: 'POST',
        headers: { Authorization: `Bearer ${gateAccessToken}` },
        body: JSON.stringify({
          username: 'hacker',
          fullName: 'Hacker',
          password: 'Password123!',
          roleCode: 'SUPER_ADMIN',
        }),
      });
      assert.equal(res.status, 403);
      assert.equal(res.data.error.code, 'INSUFFICIENT_PERMISSIONS');
    });

    it('Token Tampering: Request dengan token palsu atau rusak ditolak (401 Unauthorized)', async () => {
      const res = await apiRequest('/api/v1/auth/me', {
        headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.signature' },
      });
      assert.equal(res.status, 401);
      assert.equal(res.data.error.code, 'UNAUTHORIZED');
    });
  });

  // =========================================================================
  // M6.3: Domain Rule Enforcements (Master Data & Fleet Constraints)
  // =========================================================================
  describe('M6.3: Penegakan Aturan Armada & Master Data', () => {
    it('Setup Master Gudang & Loading Dock', async () => {
      const resWh = await apiRequest('/api/v1/warehouses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminAccessToken}` },
        body: JSON.stringify({
          code: 'GDG-M6',
          name: 'Gudang Pusat Konsolidasi M6',
          maxVolumeM3: 20000,
        }),
      });
      assert.equal(resWh.status, 201);
      warehouseId = resWh.data.data.id;

      const resDockCargo = await apiRequest('/api/v1/docks', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminAccessToken}` },
        body: JSON.stringify({
          warehouseId,
          dockNumber: 'DOCK-CRG-01',
          category: 'CARGO',
        }),
      });
      assert.equal(resDockCargo.status, 201);
      cargoDockId = resDockCargo.data.data.id;

      const resDockContainer = await apiRequest('/api/v1/docks', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminAccessToken}` },
        body: JSON.stringify({
          warehouseId,
          dockNumber: 'DOCK-CNT-01',
          category: 'CONTAINER',
        }),
      });
      assert.equal(resDockContainer.status, 201);
      containerDockId = resDockContainer.data.data.id;
    });

    it('Aturan 4.1: Registrasi armada selain Mobil Box untuk kategori CARGO wajib ditolak (400)', async () => {
      const res = await apiRequest('/api/v1/vehicles', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminAccessToken}` },
        body: JSON.stringify({
          plateNumber: 'B 1111 BAK',
          category: 'CARGO',
          vType: 'TRAILER', // Ilegal: CARGO hanya boleh MOBIL_BOX
          companyName: 'PT Logistik Liar',
          maxWeightKg: 8000,
        }),
      });
      assert.equal(res.status, 400);
      assert.equal(res.data.error.code, 'VALIDATION_ERROR');
    });

    it('Aturan 4.1: Registrasi Mobil Box untuk kategori CONTAINER wajib ditolak (400)', async () => {
      const res = await apiRequest('/api/v1/vehicles', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminAccessToken}` },
        body: JSON.stringify({
          plateNumber: 'B 2222 BOX',
          category: 'CONTAINER',
          vType: 'MOBIL_BOX', // Ilegal: CONTAINER hanya boleh TRAILER/TRONTON
          companyName: 'PT Logistik Kontainer',
          maxWeightKg: 15000,
        }),
      });
      assert.equal(res.status, 400);
      assert.equal(res.data.error.code, 'VALIDATION_ERROR');
    });

    it('Registrasi Armada Sah: Mobil Box (CARGO) & Trailer (CONTAINER)', async () => {
      const resCargo = await apiRequest('/api/v1/vehicles', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminAccessToken}` },
        body: JSON.stringify({
          plateNumber: 'B 8888 BOX',
          category: 'CARGO',
          vType: 'MOBIL_BOX',
          companyName: 'PT Ekspedisi Resmi',
          maxWeightKg: 4000,
        }),
      });
      assert.equal(resCargo.status, 201);
      cargoVehicleId = resCargo.data.data.id;

      const resContainer = await apiRequest('/api/v1/vehicles', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminAccessToken}` },
        body: JSON.stringify({
          plateNumber: 'B 9999 TRL',
          category: 'CONTAINER',
          vType: 'TRAILER',
          companyName: 'PT Samudera Maritim',
          maxWeightKg: 35000,
        }),
      });
      assert.equal(resContainer.status, 201);
      containerVehicleId = resContainer.data.data.id;
    });

    it('Setup Master SKU Barang', async () => {
      const res1 = await apiRequest('/api/v1/items', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminAccessToken}` },
        body: JSON.stringify({
          skuCode: 'SKU-M6-01',
          name: 'Monitor Komputer 27 Inch',
          unit: 'UNIT',
          unitVolumeM3: 0.05,
          unitWeightKg: 4.5,
        }),
      });
      assert.equal(res1.status, 201);
      item1Id = res1.data.data.id;

      const res2 = await apiRequest('/api/v1/items', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminAccessToken}` },
        body: JSON.stringify({
          skuCode: 'SKU-M6-02',
          name: 'Kabel Jaringan UTP Cat6',
          unit: 'ROLL',
          unitVolumeM3: 0.02,
          unitWeightKg: 8.0,
        }),
      });
      assert.equal(res2.status, 201);
      item2Id = res2.data.data.id;
    });
  });

  // =========================================================================
  // M6.3: Gate Operations & Workflow Hardening Tests
  // =========================================================================
  describe('M6.3: Aturan Gate-In, Alokasi Dock, & Pencegahan Pelanggaran SOP', () => {
    let activeInboundTxId = '';

    it('Aturan 4.1: Mobil Box dilarang melampirkan kontainer saat Gate-In (422)', async () => {
      const res = await apiRequest('/api/v1/gate/in', {
        method: 'POST',
        headers: { Authorization: `Bearer ${gateAccessToken}` },
        body: JSON.stringify({
          vehicleId: cargoVehicleId,
          warehouseId,
          driverName: 'Sopir A',
          driverLicenseNo: 'SIM-1234',
          direction: 'INBOUND',
          container: {
            containerNumber: 'MSCU1234567',
            size: '20FT',
            sealNumber: 'SEAL-01',
            isEmpty: false,
          },
        }),
      });
      assert.equal(res.status, 422);
      assert.equal(res.data.error.code, 'CONTAINER_NOT_ALLOWED_FOR_CARGO');
    });

    it('Aturan 4.1: Trailer wajib melampirkan kontainer berstandar ISO 6346 saat Gate-In (422/400)', async () => {
      // Tanpa kontainer sama sekali
      const resNoContainer = await apiRequest('/api/v1/gate/in', {
        method: 'POST',
        headers: { Authorization: `Bearer ${gateAccessToken}` },
        body: JSON.stringify({
          vehicleId: containerVehicleId,
          warehouseId,
          driverName: 'Sopir Trailer',
          driverLicenseNo: 'SIM-B2-0001',
          direction: 'INBOUND',
        }),
      });
      assert.equal(resNoContainer.status, 422);
      assert.equal(resNoContainer.data.error.code, 'CONTAINER_METADATA_REQUIRED');

      // Nomor kontainer cacat (tidak sesuai ISO 6346: 4 huruf kapital + 7 angka)
      const resBadIso = await apiRequest('/api/v1/gate/in', {
        method: 'POST',
        headers: { Authorization: `Bearer ${gateAccessToken}` },
        body: JSON.stringify({
          vehicleId: containerVehicleId,
          warehouseId,
          driverName: 'Sopir Trailer',
          driverLicenseNo: 'SIM-B2-0001',
          direction: 'INBOUND',
          container: {
            containerNumber: 'BADCONTAINER123',
            size: '40FT',
            sealNumber: 'SEAL-OK',
            isEmpty: false,
          },
        }),
      });
      assert.equal(resBadIso.status, 400);
      assert.equal(resBadIso.data.error.code, 'VALIDATION_ERROR');
    });

    it('Gate-In Sah untuk Mobil Box Inbound', async () => {
      const res = await apiRequest('/api/v1/gate/in', {
        method: 'POST',
        headers: { Authorization: `Bearer ${gateAccessToken}` },
        body: JSON.stringify({
          vehicleId: cargoVehicleId,
          warehouseId,
          driverName: 'Bambang Sudiro',
          driverLicenseNo: 'SIM-B1-778899',
          direction: 'INBOUND',
        }),
      });
      assert.equal(res.status, 201);
      activeInboundTxId = res.data.data.id;
      assert.ok(res.data.data.ticketNumber.startsWith('TKT-'));
    });

    it('Aturan 4.2: Pencegahan kunjungan ganda untuk kendaraan yang masih berada di kawasan (409)', async () => {
      const resDuplicate = await apiRequest('/api/v1/gate/in', {
        method: 'POST',
        headers: { Authorization: `Bearer ${gateAccessToken}` },
        body: JSON.stringify({
          vehicleId: cargoVehicleId, // Kendaraan ini masih berstatus GATE_IN
          warehouseId,
          driverName: 'Sopir Pengganti',
          driverLicenseNo: 'SIM-B1-999999',
          direction: 'INBOUND',
        }),
      });
      assert.equal(resDuplicate.status, 409);
      assert.equal(resDuplicate.data.error.code, 'ACTIVE_VISIT_EXISTS');
    });

    it('Aturan 4.2: Penolakan alokasi loading dock dengan kategori yang tidak cocok (422)', async () => {
      // Kendaraan CARGO tidak boleh dialokasikan ke DOCK bertipe CONTAINER
      const resMismatch = await apiRequest(`/api/v1/gate/transactions/${activeInboundTxId}/assign-dock`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${gudangAccessToken}` },
        body: JSON.stringify({ dockId: containerDockId }),
      });
      assert.equal(resMismatch.status, 422);
      assert.equal(resMismatch.data.error.code, 'DOCK_CATEGORY_MISMATCH');
    });

    it('Alokasi Dock yang Sesuai: CARGO ke Dock CARGO', async () => {
      const res = await apiRequest(`/api/v1/gate/transactions/${activeInboundTxId}/assign-dock`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${gudangAccessToken}` },
        body: JSON.stringify({ dockId: cargoDockId }),
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.data.status, 'DOCKING');
    });

    it('Aturan 4.2: Gate-Out ditolak jika aktivitas kargo belum difinalisasi (422)', async () => {
      const res = await apiRequest(`/api/v1/gate/transactions/${activeInboundTxId}/gate-out`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${gateAccessToken}` },
        body: JSON.stringify({ notes: 'Mencoba keluar tanpa bongkar' }),
      });
      assert.equal(res.status, 422);
      assert.equal(res.data.error.code, 'CARGO_OPERATION_INCOMPLETE');
    });

    it('Input rincian kargo dan finalisasi Inbound menambah stok gudang', async () => {
      // Input 50 unit Monitor dan 20 roll Kabel
      const resCargo = await apiRequest(`/api/v1/gate/transactions/${activeInboundTxId}/cargo-items`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${gudangAccessToken}` },
        body: JSON.stringify({
          items: [
            { itemId: item1Id, quantity: 50, weightKg: 225, conditionNotes: 'Kardus mulus' },
            { itemId: item2Id, quantity: 20, weightKg: 160, conditionNotes: 'Kondisi baik' },
          ],
        }),
      });
      assert.equal(resCargo.status, 200);

      // Finalisasi bongkar muat
      const resFinalize = await apiRequest(
        `/api/v1/gate/transactions/${activeInboundTxId}/finalize-inbound`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${gudangAccessToken}` },
        },
      );
      assert.equal(resFinalize.status, 200);
      assert.equal(resFinalize.data.data.status, 'DOC_PENDING');

      // Verifikasi stok bertambah di gudang
      const resStock = await apiRequest(`/api/v1/warehouses/${warehouseId}/inventory`, {
        headers: { Authorization: `Bearer ${gudangAccessToken}` },
      });
      assert.equal(resStock.status, 200);
      const stock1 = resStock.data.data.stocks.find((s: any) => s.itemId === item1Id);
      assert.equal(Number(stock1.availableQty), 50);
    });

    it('Aturan 4.2: Gate-Out ditolak jika dokumen wajib BASTB belum ISSUED (422)', async () => {
      const res = await apiRequest(`/api/v1/gate/transactions/${activeInboundTxId}/gate-out`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${gateAccessToken}` },
        body: JSON.stringify({ notes: 'Mencoba keluar sebelum BASTB terbit' }),
      });
      assert.equal(res.status, 422);
      assert.equal(res.data.error.code, 'REQUIRED_DOCUMENT_NOT_ISSUED');
    });

    it('Penerbitan BASTB, kompilasi worker, dan Gate-Out Inbound berhasil', async () => {
      const resDoc = await apiRequest(`/api/v1/gate/transactions/${activeInboundTxId}/documents`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminAccessToken}` },
        body: JSON.stringify({ docType: 'BASTB' }),
      });
      assert.equal(resDoc.status, 202);
      const docId = resDoc.data.data.id;

      // Beri jeda 2 detik agar worker mengompilasi
      await new Promise((r) => setTimeout(r, 2000));

      const resDocDetail = await apiRequest(`/api/v1/documents/${docId}`, {
        headers: { Authorization: `Bearer ${adminAccessToken}` },
      });
      assert.equal(resDocDetail.status, 200);
      assert.equal(resDocDetail.data.data.status, 'ISSUED');

      // Gate-Out sekarang diizinkan
      const resGateOut = await apiRequest(`/api/v1/gate/transactions/${activeInboundTxId}/gate-out`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${gateAccessToken}` },
        body: JSON.stringify({ notes: 'Bongkar selesai, driver membawa BASTB' }),
      });
      assert.equal(resGateOut.status, 200);
      assert.equal(resGateOut.data.data.status, 'GATE_OUT');
    });
  });

  // =========================================================================
  // M6.3: Outbound Integrity & Inventory Overdraft Prevention
  // =========================================================================
  describe('M6.3: Outbound Workflow & Validasi Stok Menipis', () => {
    let activeOutboundTxId = '';

    it('Registrasi Armada Outbound & Gate-In OUTBOUND', async () => {
      const resVeh = await apiRequest('/api/v1/vehicles', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminAccessToken}` },
        body: JSON.stringify({
          plateNumber: 'B 7777 OUT',
          category: 'CARGO',
          vType: 'MOBIL_BOX',
          companyName: 'PT Retail Niaga',
          maxWeightKg: 5000,
        }),
      });
      assert.equal(resVeh.status, 201);
      const vehId = resVeh.data.data.id;

      const resIn = await apiRequest('/api/v1/gate/in', {
        method: 'POST',
        headers: { Authorization: `Bearer ${gateAccessToken}` },
        body: JSON.stringify({
          vehicleId: vehId,
          warehouseId,
          driverName: 'Suryo Utomo',
          driverLicenseNo: 'SIM-B1-554433',
          direction: 'OUTBOUND',
        }),
      });
      assert.equal(resIn.status, 201);
      activeOutboundTxId = resIn.data.data.id;

      // Assign dock
      await apiRequest(`/api/v1/gate/transactions/${activeOutboundTxId}/assign-dock`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${gudangAccessToken}` },
        body: JSON.stringify({ dockId: cargoDockId }),
      });
    });

    it('Outbound Overdraft Rejection: Mengeluarkan barang melebihi stok yang ada wajib ditolak (422)', async () => {
      // Stok item1 hanya ada 50, kita coba minta 999 unit
      await apiRequest(`/api/v1/gate/transactions/${activeOutboundTxId}/cargo-items`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${gudangAccessToken}` },
        body: JSON.stringify({
          items: [{ itemId: item1Id, quantity: 999, weightKg: 4000 }],
        }),
      });

      const resFinalize = await apiRequest(
        `/api/v1/gate/transactions/${activeOutboundTxId}/finalize-outbound`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${gudangAccessToken}` },
        },
      );
      assert.equal(resFinalize.status, 422);
      assert.equal(resFinalize.data.error.code, 'INSUFFICIENT_WAREHOUSE_STOCK');
    });

    it('Outbound Valid: Mengambil 20 unit stok, stok berkurang ke 30 secara atomik', async () => {
      await apiRequest(`/api/v1/gate/transactions/${activeOutboundTxId}/cargo-items`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${gudangAccessToken}` },
        body: JSON.stringify({
          items: [{ itemId: item1Id, quantity: 20, weightKg: 90 }],
        }),
      });

      const resFinalize = await apiRequest(
        `/api/v1/gate/transactions/${activeOutboundTxId}/finalize-outbound`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${gudangAccessToken}` },
        },
      );
      assert.equal(resFinalize.status, 200);

      // Verifikasi stok sisa 30
      const resStock = await apiRequest(`/api/v1/warehouses/${warehouseId}/inventory`, {
        headers: { Authorization: `Bearer ${gudangAccessToken}` },
      });
      const stock1 = resStock.data.data.stocks.find((s: any) => s.itemId === item1Id);
      assert.equal(Number(stock1.availableQty), 30);

      // Terbitkan Surat Jalan & Gate-Out
      await apiRequest(`/api/v1/gate/transactions/${activeOutboundTxId}/documents`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminAccessToken}` },
        body: JSON.stringify({ docType: 'SURAT_JALAN' }),
      });
      await new Promise((r) => setTimeout(r, 2000));

      const resGateOut = await apiRequest(`/api/v1/gate/transactions/${activeOutboundTxId}/gate-out`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${gateAccessToken}` },
        body: JSON.stringify({ notes: 'Barang muat berhasil keluar' }),
      });
      assert.equal(resGateOut.status, 200);
      assert.equal(resGateOut.data.data.status, 'GATE_OUT');
    });
  });

  // =========================================================================
  // M6.3: LaTeX Sanitization & Security Injection Tests
  // =========================================================================
  describe('M6.3: Uji Keamanan LaTeX Injection & Netralisasi Karakter Jahat', () => {
    it('Input dengan sintaks jahat LaTeX berhasil disanitasi dan dikompilasi tanpa galat RCE', async () => {
      // Registrasi kendaraan dengan nama perusahaan memuat injeksi LaTeX
      const resVeh = await apiRequest('/api/v1/vehicles', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminAccessToken}` },
        body: JSON.stringify({
          plateNumber: 'B 6666 INJ',
          category: 'CARGO',
          vType: 'MOBIL_BOX',
          companyName: 'PT \\write18{rm -rf /} & \\input{/etc/passwd} 100% $50',
          maxWeightKg: 5000,
        }),
      });
      assert.equal(resVeh.status, 201);
      const vehId = resVeh.data.data.id;

      // Gate-In dengan nama driver memuat karakter khusus LaTeX
      const resIn = await apiRequest('/api/v1/gate/in', {
        method: 'POST',
        headers: { Authorization: `Bearer ${gateAccessToken}` },
        body: JSON.stringify({
          vehicleId: vehId,
          warehouseId,
          driverName: 'Driver $100 & #1 _special_ %done',
          driverLicenseNo: 'SIM-INJ-123',
          direction: 'INBOUND',
        }),
      });
      assert.equal(resIn.status, 201);
      const txId = resIn.data.data.id;

      // Terbitkan Gate-Pass untuk menguji kompilasi LaTeX dengan data tersanitasi
      const resDoc = await apiRequest(`/api/v1/gate/transactions/${txId}/documents`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminAccessToken}` },
        body: JSON.stringify({ docType: 'GATE_PASS' }),
      });
      assert.equal(resDoc.status, 202);
      const docId = resDoc.data.data.id;

      await new Promise((r) => setTimeout(r, 2000));

      const resDocDetail = await apiRequest(`/api/v1/documents/${docId}`, {
        headers: { Authorization: `Bearer ${adminAccessToken}` },
      });
      assert.equal(resDocDetail.status, 200);
      assert.equal(resDocDetail.data.data.status, 'ISSUED');
      assert.ok(resDocDetail.data.data.fileSha256);

      // Verifikasi di database bahwa latex_source tersimpan dengan escaping aman
      const dbRow = await pool.query<{ latex_source: string }>(
        'SELECT latex_source FROM official_documents WHERE id = $1',
        [docId],
      );
      assert.ok(dbRow.rows[0]);
      assert.ok(!dbRow.rows[0].latex_source.includes('\\write18{rm'));
      assert.ok(!dbRow.rows[0].latex_source.includes('\\input{/etc'));
    });
  });
});
