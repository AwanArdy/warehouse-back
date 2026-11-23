import type { Request, Response } from 'express';

export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Sistem Administrasi Kawasan Pergudangan API',
    version: '1.0.0',
    description:
      'Platform backend terpusat untuk mengelola seluruh siklus administrasi keluar-masuk armada angkutan (Mobil Box & Trailer/Tronton), operasional loading dock, realisasi bongkar muat, buku besar mutasi inventori, serta penerbitan dokumen legal berstandar cetak tinggi (LaTeX PDF).',
    contact: {
      name: 'Tim Pengembang Sistem Pergudangan',
    },
  },
  servers: [
    {
      url: 'http://127.0.0.1:3000',
      description: 'Local Development Server',
    },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Masukkan Access Token JWT dengan format: Bearer <token>',
      },
    },
    schemas: {
      ErrorResponse: {
        type: 'object',
        required: ['success', 'error'],
        properties: {
          success: { type: 'boolean', example: false },
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { type: 'string', example: 'BAD_REQUEST' },
              message: { type: 'string', example: 'Pesan deskripsi kesalahan' },
              details: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    path: { type: 'string', example: 'plateNumber' },
                    message: { type: 'string', example: 'Nomor polisi minimal 4 karakter' },
                  },
                },
              },
            },
          },
        },
      },
      SystemHealth: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ok', 'degraded', 'down'] },
          timestamp: { type: 'string', format: 'date-time' },
          checks: {
            type: 'object',
            properties: {
              postgres: {
                type: 'object',
                properties: { ok: { type: 'boolean' }, latencyMs: { type: 'number' } },
              },
              storage: {
                type: 'object',
                properties: { ok: { type: 'boolean' }, driver: { type: 'string' }, location: { type: 'string' } },
              },
              xelatex: {
                type: 'object',
                properties: { ok: { type: 'boolean' }, version: { type: 'string' } },
              },
            },
          },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          username: { type: 'string' },
          fullName: { type: 'string' },
          isActive: { type: 'boolean' },
          roles: { type: 'array', items: { type: 'string' } },
        },
      },
      Warehouse: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          code: { type: 'string', example: 'GUD-A' },
          name: { type: 'string', example: 'Gudang Utama Distribusi A' },
          maxVolumeM3: { type: 'number', example: 50000 },
          isActive: { type: 'boolean' },
          currentVolumeM3: { type: 'number', example: 1250 },
          utilizationPercentage: { type: 'number', example: 2.5 },
        },
      },
      Dock: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          warehouseId: { type: 'string', format: 'uuid' },
          dockNumber: { type: 'string', example: 'DOCK-01' },
          category: { type: 'string', enum: ['CARGO', 'CONTAINER'] },
          status: { type: 'string', enum: ['AVAILABLE', 'OCCUPIED', 'MAINTENANCE'] },
        },
      },
      Vehicle: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          plateNumber: { type: 'string', example: 'B 1234 ABC' },
          category: { type: 'string', enum: ['CARGO', 'CONTAINER'] },
          vType: { type: 'string', enum: ['MOBIL_BOX', 'TRAILER', 'TRONTON'] },
          companyName: { type: 'string', example: 'PT Ekspedisi Cepat' },
          maxWeightKg: { type: 'number', example: 5000 },
          isActive: { type: 'boolean' },
        },
      },
      ItemMaster: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          skuCode: { type: 'string', example: 'SKU-ELEK-01' },
          name: { type: 'string', example: 'Laptop Stand' },
          unit: { type: 'string', example: 'PCS' },
          unitVolumeM3: { type: 'number', example: 0.015 },
          unitWeightKg: { type: 'number', example: 1.2 },
        },
      },
      GateTransaction: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          ticketNumber: { type: 'string', example: 'TKT-20261123-0001' },
          vehicleId: { type: 'string', format: 'uuid' },
          warehouseId: { type: 'string', format: 'uuid' },
          dockId: { type: 'string', format: 'uuid', nullable: true },
          driverName: { type: 'string' },
          driverLicenseNo: { type: 'string' },
          direction: { type: 'string', enum: ['INBOUND', 'OUTBOUND'] },
          category: { type: 'string', enum: ['CARGO', 'CONTAINER'] },
          status: {
            type: 'string',
            enum: ['GATE_IN', 'DOCKING', 'LOADING_UNLOADING', 'DOC_PENDING', 'DOC_ISSUED', 'GATE_OUT', 'CANCELLED'],
          },
          gateInAt: { type: 'string', format: 'date-time' },
          gateOutAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      OfficialDocument: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          documentNumber: { type: 'string', example: 'BASTB/GUD-A/202611/0001' },
          gateTransactionId: { type: 'string', format: 'uuid', nullable: true },
          docType: { type: 'string', enum: ['GATE_PASS', 'BASTB', 'SURAT_JALAN', 'REKAP_HARIAN'] },
          status: { type: 'string', enum: ['QUEUED', 'COMPILING', 'ISSUED', 'FAILED', 'VOID'] },
          fileSha256: { type: 'string', nullable: true },
          issuedAt: { type: 'string', format: 'date-time', nullable: true },
          voidReason: { type: 'string', nullable: true },
        },
      },
    },
  },
  tags: [
    { name: 'System', description: 'Pemeriksaan status kesehatan sistem & infrastruktur' },
    { name: 'Auth & RBAC', description: 'Autentikasi JWT, rotasi refresh token, dan audit log' },
    { name: 'Master Warehouses & Docks', description: 'Pengelolaan gudang dan alokasi loading dock' },
    { name: 'Master Vehicles', description: 'Pendaftaran dan pencarian armada (Mobil Box vs Trailer/Tronton)' },
    { name: 'Master Items', description: 'Katalog SKU barang dan dimensi satuan' },
    { name: 'Gate Operations', description: 'Pencatatan Gate-In, penugasan dock, dan Gate-Out' },
    { name: 'Cargo & Inventory', description: 'Rincian muatan kargo dan mutasi buku besar gudang' },
    { name: 'Official Documents', description: 'Penerbitan dokumen resmi LaTeX (PDF), unduhan, dan pembatalan' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Pemeriksaan kesehatan sistem (Liveness & Readiness probe)',
        responses: {
          '200': {
            description: 'Sistem dan seluruh dependensi sehat',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SystemHealth' } } },
          },
          '503': {
            description: 'Ada infrastruktur dependensi yang mengalami kendala',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SystemHealth' } } },
          },
        },
      },
    },
    '/api/v1/auth/bootstrap-admin': {
      post: {
        tags: ['Auth & RBAC'],
        summary: 'Inisialisasi akun Super Admin pertama sistem',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['username', 'fullName', 'password'],
                properties: {
                  username: { type: 'string', example: 'admin_utama' },
                  fullName: { type: 'string', example: 'Super Administrator' },
                  password: { type: 'string', example: 'PasswordAdmin123!' },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Super Admin berhasil dibuat' },
          '409': { description: 'Sistem sudah memiliki pengguna (bootstrap ditolak)' },
        },
      },
    },
    '/api/v1/auth/login': {
      post: {
        tags: ['Auth & RBAC'],
        summary: 'Masuk dan peroleh pasangan JWT Access & Refresh Token',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['username', 'password'],
                properties: {
                  username: { type: 'string', example: 'admin_utama' },
                  password: { type: 'string', example: 'PasswordAdmin123!' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Login berhasil, token JWT diberikan' },
          '401': { description: 'Kredensial tidak valid' },
        },
      },
    },
    '/api/v1/auth/refresh': {
      post: {
        tags: ['Auth & RBAC'],
        summary: 'Rotasi refresh token dan terbitkan pasangan token baru',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['refreshToken'],
                properties: { refreshToken: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Token berhasil dirotasi' },
          '401': { description: 'Refresh token tidak valid, kedaluwarsa, atau terdeteksi penggunaan ulang' },
        },
      },
    },
    '/api/v1/auth/logout': {
      post: {
        tags: ['Auth & RBAC'],
        summary: 'Pencabutan sesi refresh token pengguna',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['refreshToken'],
                properties: { refreshToken: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Sesi berhasil dicabut' },
        },
      },
    },
    '/api/v1/auth/me': {
      get: {
        tags: ['Auth & RBAC'],
        summary: 'Ambil profil pengguna yang sedang login',
        security: [{ BearerAuth: [] }],
        responses: {
          '200': { description: 'Profil pengguna berhasil diambil' },
          '401': { description: 'Token tidak disertakan atau tidak valid' },
        },
      },
    },
    '/api/v1/roles': {
      get: {
        tags: ['Auth & RBAC'],
        summary: 'Daftar role sistem yang tersedia',
        security: [{ BearerAuth: [] }],
        responses: {
          '200': { description: 'Daftar role berhasil diambil' },
        },
      },
    },
    '/api/v1/users': {
      get: {
        tags: ['Auth & RBAC'],
        summary: 'Daftar seluruh pengguna sistem',
        security: [{ BearerAuth: [] }],
        responses: {
          '200': { description: 'Daftar pengguna berhasil diambil' },
        },
      },
      post: {
        tags: ['Auth & RBAC'],
        summary: 'Pembuatan akun pengguna baru dengan role spesifik',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['username', 'fullName', 'password', 'roleCode'],
                properties: {
                  username: { type: 'string', example: 'petugas_pos1' },
                  fullName: { type: 'string', example: 'Budi Santoso' },
                  password: { type: 'string', example: 'PasswordPetugas123!' },
                  roleCode: {
                    type: 'string',
                    enum: ['SUPER_ADMIN', 'PETUGAS_GATE', 'ADMIN_GUDANG', 'ADMIN_PERSURATAN'],
                  },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Pengguna berhasil dibuat' },
          '403': { description: 'Tidak memiliki izin user:manage' },
        },
      },
    },
    '/api/v1/audit-logs': {
      get: {
        tags: ['Auth & RBAC'],
        summary: 'Daftar jejak audit mutasi data sistem',
        security: [{ BearerAuth: [] }],
        responses: {
          '200': { description: 'Daftar audit log berhasil diambil' },
        },
      },
    },
    '/api/v1/warehouses': {
      get: {
        tags: ['Master Warehouses & Docks'],
        summary: 'Daftar seluruh gudang aktif beserta utilisasi kapasitasnya',
        security: [{ BearerAuth: [] }],
        responses: {
          '200': { description: 'Daftar gudang' },
        },
      },
      post: {
        tags: ['Master Warehouses & Docks'],
        summary: 'Pendaftaran gudang baru',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['code', 'name', 'maxVolumeM3'],
                properties: {
                  code: { type: 'string', example: 'GUD-A' },
                  name: { type: 'string', example: 'Gudang Utama Distribusi A' },
                  maxVolumeM3: { type: 'number', example: 50000 },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Gudang berhasil dibuat' },
        },
      },
    },
    '/api/v1/docks': {
      get: {
        tags: ['Master Warehouses & Docks'],
        summary: 'Daftar loading dock dengan filter gudang, kategori, dan status',
        security: [{ BearerAuth: [] }],
        responses: {
          '200': { description: 'Daftar loading dock' },
        },
      },
      post: {
        tags: ['Master Warehouses & Docks'],
        summary: 'Pendaftaran loading dock baru pada gudang',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['warehouseId', 'dockNumber', 'category'],
                properties: {
                  warehouseId: { type: 'string', format: 'uuid' },
                  dockNumber: { type: 'string', example: 'DOCK-01' },
                  category: { type: 'string', enum: ['CARGO', 'CONTAINER'] },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Dock berhasil didaftarkan' },
        },
      },
    },
    '/api/v1/docks/{id}/status': {
      patch: {
        tags: ['Master Warehouses & Docks'],
        summary: 'Pembaruan status operasional dock (AVAILABLE/OCCUPIED/MAINTENANCE)',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status'],
                properties: {
                  status: { type: 'string', enum: ['AVAILABLE', 'OCCUPIED', 'MAINTENANCE'] },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Status dock berhasil diperbarui' },
        },
      },
    },
    '/api/v1/vehicles': {
      get: {
        tags: ['Master Vehicles'],
        summary: 'Daftar master kendaraan terdaftar',
        security: [{ BearerAuth: [] }],
        responses: {
          '200': { description: 'Daftar kendaraan' },
        },
      },
      post: {
        tags: ['Master Vehicles'],
        summary: 'Pendaftaran armada baru (Validasi ketat CARGO vs CONTAINER)',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['plateNumber', 'category', 'vType', 'companyName', 'maxWeightKg'],
                properties: {
                  plateNumber: { type: 'string', example: 'B 1234 ABC' },
                  category: { type: 'string', enum: ['CARGO', 'CONTAINER'] },
                  vType: { type: 'string', enum: ['MOBIL_BOX', 'TRAILER', 'TRONTON'] },
                  companyName: { type: 'string', example: 'PT Ekspedisi Cepat' },
                  maxWeightKg: { type: 'number', example: 5000 },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Kendaraan berhasil didaftarkan' },
          '400': { description: 'Kombinasi kategori dan tipe kendaraan tidak valid' },
        },
      },
    },
    '/api/v1/vehicles/plate/{plateNumber}': {
      get: {
        tags: ['Master Vehicles'],
        summary: 'Pencarian cepat kendaraan berdasarkan nomor polisi saat tiba di pos gerbang',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'plateNumber', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Data kendaraan ditemukan' },
          '404': { description: 'Kendaraan tidak ditemukan' },
        },
      },
    },
    '/api/v1/items': {
      get: {
        tags: ['Master Items'],
        summary: 'Daftar katalog master barang (SKU)',
        security: [{ BearerAuth: [] }],
        responses: {
          '200': { description: 'Daftar SKU barang' },
        },
      },
      post: {
        tags: ['Master Items'],
        summary: 'Pendaftaran master SKU barang baru',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['skuCode', 'name', 'unit', 'unitVolumeM3', 'unitWeightKg'],
                properties: {
                  skuCode: { type: 'string', example: 'SKU-ELEK-01' },
                  name: { type: 'string', example: 'Ergonomic Laptop Stand' },
                  unit: { type: 'string', example: 'PCS' },
                  unitVolumeM3: { type: 'number', example: 0.015 },
                  unitWeightKg: { type: 'number', example: 1.2 },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Item master berhasil didaftarkan' },
        },
      },
    },
    '/api/v1/gate/in': {
      post: {
        tags: ['Gate Operations'],
        summary: 'Pencatatan Gate-In kedatangan armada ke kawasan pergudangan',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['vehicleId', 'warehouseId', 'driverName', 'driverLicenseNo', 'direction'],
                properties: {
                  vehicleId: { type: 'string', format: 'uuid' },
                  warehouseId: { type: 'string', format: 'uuid' },
                  driverName: { type: 'string', example: 'Agus Kurniawan' },
                  driverLicenseNo: { type: 'string', example: 'SIM-B2-998877' },
                  direction: { type: 'string', enum: ['INBOUND', 'OUTBOUND'] },
                  container: {
                    type: 'object',
                    required: ['containerNumber', 'size', 'sealNumber'],
                    properties: {
                      containerNumber: { type: 'string', example: 'MSCU1234567' },
                      size: { type: 'string', enum: ['20FT', '40FT', '40HC'] },
                      sealNumber: { type: 'string', example: 'SEAL-998877' },
                      isEmpty: { type: 'boolean', default: false },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Transaksi Gate-In berhasil dicatat' },
          '409': { description: 'Kendaraan masih memiliki transaksi aktif di dalam kawasan' },
          '422': { description: 'Pelanggaran aturan kontainer untuk Mobil Box atau Trailer' },
        },
      },
    },
    '/api/v1/gate/transactions': {
      get: {
        tags: ['Gate Operations'],
        summary: 'Daftar transaksi pos gerbang dengan filter status dan arah pergerakan',
        security: [{ BearerAuth: [] }],
        responses: {
          '200': { description: 'Daftar transaksi gate' },
        },
      },
    },
    '/api/v1/gate/transactions/{id}': {
      get: {
        tags: ['Gate Operations'],
        summary: 'Rincian transaksi gerbang beserta seluruh jejak riwayat status logs',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': { description: 'Rincian transaksi ditemukan' },
          '404': { description: 'Transaksi tidak ditemukan' },
        },
      },
    },
    '/api/v1/gate/transactions/{id}/assign-dock': {
      post: {
        tags: ['Gate Operations'],
        summary: 'Penugasan armada ke loading dock (Kesesuaian kategori CARGO vs CONTAINER)',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['dockId'],
                properties: { dockId: { type: 'string', format: 'uuid' } },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Dock berhasil dialokasikan' },
          '422': { description: 'Kategori dock tidak sesuai atau dock tidak dalam status AVAILABLE' },
        },
      },
    },
    '/api/v1/gate/transactions/{id}/cargo-items': {
      get: {
        tags: ['Cargo & Inventory'],
        summary: 'Ambil rincian barang muatan pada transaksi gerbang',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': { description: 'Daftar barang muatan' },
        },
      },
      put: {
        tags: ['Cargo & Inventory'],
        summary: 'Pencatatan rincian barang muatan pada transaksi gerbang',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['items'],
                properties: {
                  items: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['itemId', 'quantity'],
                      properties: {
                        itemId: { type: 'string', format: 'uuid' },
                        quantity: { type: 'number', example: 100 },
                        weightKg: { type: 'number', example: 120 },
                        conditionNotes: { type: 'string', example: 'Segel rapi' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Rincian muatan berhasil dicatat' },
        },
      },
    },
    '/api/v1/gate/transactions/{id}/finalize-inbound': {
      post: {
        tags: ['Cargo & Inventory'],
        summary: 'Finalisasi bongkar barang Inbound (Stok gudang bertambah atomik, dock dilepas)',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': { description: 'Inbound berhasil difinalisasi' },
        },
      },
    },
    '/api/v1/gate/transactions/{id}/finalize-outbound': {
      post: {
        tags: ['Cargo & Inventory'],
        summary: 'Finalisasi muat barang Outbound (Validasi stok mencukupi, stok berkurang atomik)',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': { description: 'Outbound berhasil difinalisasi' },
          '422': { description: 'Stok barang tidak mencukupi' },
        },
      },
    },
    '/api/v1/gate/transactions/{id}/gate-out': {
      post: {
        tags: ['Gate Operations'],
        summary: 'Penyelesaian Gate-Out armada keluar kawasan pergudangan',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { notes: { type: 'string', example: 'Dokumen lengkap dibawa driver' } },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Kendaraan berhasil Gate-Out' },
          '422': { description: 'Aktivitas kargo belum selesai atau dokumen wajib belum berstatus ISSUED' },
        },
      },
    },
    '/api/v1/gate/transactions/{id}/documents': {
      post: {
        tags: ['Official Documents'],
        summary: 'Penerbitan dokumen resmi transaksi (GATE_PASS, BASTB, atau SURAT_JALAN)',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['docType'],
                properties: {
                  docType: { type: 'string', enum: ['GATE_PASS', 'BASTB', 'SURAT_JALAN'] },
                },
              },
            },
          },
        },
        responses: {
          '202': { description: 'Permintaan dokumen diterima dan masuk antrean kompilasi LaTeX' },
        },
      },
    },
    '/api/v1/warehouses/{warehouseId}/inventory': {
      get: {
        tags: ['Cargo & Inventory'],
        summary: 'Daftar saldo stok inventori barang pada gudang tertentu',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'warehouseId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': { description: 'Daftar saldo stok gudang' },
        },
      },
    },
    '/api/v1/inventory/movements': {
      get: {
        tags: ['Cargo & Inventory'],
        summary: 'Daftar buku besar mutasi stok barang gudang (IN dan OUT)',
        security: [{ BearerAuth: [] }],
        responses: {
          '200': { description: 'Daftar mutasi stok' },
        },
      },
    },
    '/api/v1/documents': {
      get: {
        tags: ['Official Documents'],
        summary: 'Daftar seluruh dokumen resmi yang diterbitkan sistem',
        security: [{ BearerAuth: [] }],
        responses: {
          '200': { description: 'Daftar dokumen' },
        },
      },
    },
    '/api/v1/documents/{id}': {
      get: {
        tags: ['Official Documents'],
        summary: 'Rincian metadata dokumen resmi dan status kompilasi',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': { description: 'Rincian dokumen ditemukan' },
          '404': { description: 'Dokumen tidak ditemukan' },
        },
      },
    },
    '/api/v1/documents/{id}/pdf': {
      get: {
        tags: ['Official Documents'],
        summary: 'Unduh file biner PDF resmi hasil kompilasi LaTeX (disertai SHA256 checksum)',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': {
            description: 'File biner PDF resmi',
            content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
            headers: {
              'X-Document-SHA256': { schema: { type: 'string' }, description: 'SHA-256 hash dokumen' },
              'X-Document-Status': { schema: { type: 'string' }, description: 'Status dokumen (ISSUED)' },
            },
          },
        },
      },
    },
    '/api/v1/documents/daily-recap': {
      post: {
        tags: ['Official Documents'],
        summary: 'Penerbitan dokumen Rekapitulasi Administrasi Harian (REKAP_HARIAN)',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['warehouseId', 'reportDate'],
                properties: {
                  warehouseId: { type: 'string', format: 'uuid' },
                  reportDate: { type: 'string', format: 'date', example: '2026-11-23' },
                },
              },
            },
          },
        },
        responses: {
          '202': { description: 'Permintaan rekap harian diterima dan masuk antrean kompilasi' },
        },
      },
    },
    '/api/v1/documents/{id}/void': {
      post: {
        tags: ['Official Documents'],
        summary: 'Pembatalan resmi dokumen berstatus ISSUED (Wajib menyertakan alasan pembatalan)',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['voidReason'],
                properties: {
                  voidReason: { type: 'string', example: 'Terdapat revisi fisik kuantitas barang' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Dokumen berhasil dibatalkan (status menjadi VOID)' },
        },
      },
    },
    '/api/v1/documents/{id}/retry': {
      post: {
        tags: ['Official Documents'],
        summary: 'Pemicu ulang kompilasi jika status dokumen FAILED',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '202': { description: 'Dokumen dimasukkan kembali ke antrean kompilasi' },
        },
      },
    },
  },
};

export function renderSwaggerHtml(specUrl = '/openapi.json'): string {
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>API Docs - Sistem Administrasi Kawasan Pergudangan</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    body { margin: 0; background: #fafafa; }
    .topbar { display: none !important; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '${specUrl}',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.SwaggerUIStandalonePreset
        ],
        layout: "BaseLayout"
      });
    };
  </script>
</body>
</html>`;
}

export function handleOpenApiJson(_req: Request, res: Response): void {
  res.status(200).json(openApiSpec);
}

export function handleSwaggerUi(_req: Request, res: Response): void {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(renderSwaggerHtml('/openapi.json'));
}
