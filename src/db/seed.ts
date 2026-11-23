import { executeQuery, pool } from './pool.js';
import { authService } from '../services/auth.service.js';
import { logger } from '../utils/logger.js';

export async function runSeed(): Promise<void> {
  logger.info('Menjalankan database seed...');

  // Ensure sequence tables exist
  await executeQuery(
    pool,
    `CREATE TABLE IF NOT EXISTS gate_ticket_sequences (
       period_ymd VARCHAR(8) PRIMARY KEY,
       last_number INT NOT NULL DEFAULT 0 CHECK (last_number >= 0)
     )`,
  );

  await executeQuery(
    pool,
    `CREATE TABLE IF NOT EXISTS document_sequences (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       doc_type doc_type NOT NULL,
       warehouse_code VARCHAR(20) NOT NULL,
       period_ym VARCHAR(6) NOT NULL,
       last_number INT NOT NULL DEFAULT 0 CHECK (last_number >= 0),
       UNIQUE (doc_type, warehouse_code, period_ym)
     )`,
  );

  const passAdmin = await authService.hashPassword('PasswordAdmin123!');
  const passPetugas = await authService.hashPassword('PasswordPetugas123!');
  const passGudang = await authService.hashPassword('PasswordGudang123!');
  const passSurat = await authService.hashPassword('PasswordSurat123!');

  // 1. Seed Pengguna & Assign Role
  const usersToSeed = [
    { username: 'admin_utama', fullName: 'Super Admin Operasional', hash: passAdmin, role: 'SUPER_ADMIN' },
    { username: 'petugas_pos1', fullName: 'Budi Santoso - Petugas Pos 1', hash: passPetugas, role: 'PETUGAS_GATE' },
    { username: 'admin_gudang1', fullName: 'Siti Rahma - Admin Gudang', hash: passGudang, role: 'ADMIN_GUDANG' },
    { username: 'admin_persuratan1', fullName: 'Dewi Lestari - Admin Persuratan', hash: passSurat, role: 'ADMIN_PERSURATAN' },
  ];

  for (const u of usersToSeed) {
    const userRes = await executeQuery<{ id: string }>(
      pool,
      `INSERT INTO users (username, full_name, password_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (username) DO UPDATE SET full_name = EXCLUDED.full_name, password_hash = EXCLUDED.password_hash
       RETURNING id`,
      [u.username, u.fullName, u.hash],
    );
    const userId = userRes.rows[0]?.id;

    if (userId) {
      const roleRes = await executeQuery<{ id: string }>(
        pool,
        'SELECT id FROM roles WHERE code = $1',
        [u.role],
      );
      const roleId = roleRes.rows[0]?.id;
      if (roleId) {
        await executeQuery(
          pool,
          `INSERT INTO user_roles (user_id, role_id)
           VALUES ($1, $2)
           ON CONFLICT (user_id, role_id) DO NOTHING`,
          [userId, roleId],
        );
      }
    }
  }

  // 2. Seed Master Gudang
  const warehousesToSeed = [
    { code: 'GDG-PUSAT', name: 'Gudang Pusat Konsolidasi Logistik', maxVolumeM3: 15000 },
    { code: 'GDG-UTARA', name: 'Gudang Distribusi Regional Utara', maxVolumeM3: 8500 },
  ];

  const warehouseMap = new Map<string, string>();
  for (const w of warehousesToSeed) {
    const res = await executeQuery<{ id: string }>(
      pool,
      `INSERT INTO warehouses (code, name, max_volume_m3)
       VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, max_volume_m3 = EXCLUDED.max_volume_m3
       RETURNING id`,
      [w.code, w.name, w.maxVolumeM3],
    );
    if (res.rows[0]?.id) {
      warehouseMap.set(w.code, res.rows[0].id);
    }
  }

  const pusatId = warehouseMap.get('GDG-PUSAT');
  const utaraId = warehouseMap.get('GDG-UTARA');

  // 3. Seed Loading Docks
  if (pusatId) {
    const docksPusat = [
      { dockNumber: 'DOCK-CRG-01', category: 'CARGO', status: 'AVAILABLE' },
      { dockNumber: 'DOCK-CRG-02', category: 'CARGO', status: 'AVAILABLE' },
      { dockNumber: 'DOCK-CNT-01', category: 'CONTAINER', status: 'AVAILABLE' },
      { dockNumber: 'DOCK-CNT-02', category: 'CONTAINER', status: 'AVAILABLE' },
      { dockNumber: 'DOCK-MNT-01', category: 'CARGO', status: 'MAINTENANCE' },
    ];
    for (const d of docksPusat) {
      await executeQuery(
        pool,
        `INSERT INTO loading_docks (warehouse_id, dock_number, category, status)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (warehouse_id, dock_number) DO UPDATE SET category = EXCLUDED.category`,
        [pusatId, d.dockNumber, d.category, d.status],
      );
    }
  }

  if (utaraId) {
    const docksUtara = [
      { dockNumber: 'DOCK-U-01', category: 'CARGO', status: 'AVAILABLE' },
      { dockNumber: 'DOCK-U-02', category: 'CONTAINER', status: 'AVAILABLE' },
    ];
    for (const d of docksUtara) {
      await executeQuery(
        pool,
        `INSERT INTO loading_docks (warehouse_id, dock_number, category, status)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (warehouse_id, dock_number) DO UPDATE SET category = EXCLUDED.category`,
        [utaraId, d.dockNumber, d.category, d.status],
      );
    }
  }

  // 4. Seed Master Armada (Vehicles)
  const vehiclesToSeed = [
    { plate: 'B 1234 BOX', category: 'CARGO', vType: 'MOBIL_BOX', company: 'PT Logistik Prima Express', maxWeight: 4000 },
    { plate: 'B 5678 BOX', category: 'CARGO', vType: 'MOBIL_BOX', company: 'CV Cepat Angkut Sejahtera', maxWeight: 5000 },
    { plate: 'B 9012 TRL', category: 'CONTAINER', vType: 'TRAILER', company: 'PT Samudera Kontainer Lines', maxWeight: 35000 },
    { plate: 'B 3456 TRN', category: 'CONTAINER', vType: 'TRONTON', company: 'PT Samudera Kontainer Lines', maxWeight: 30000 },
  ];

  for (const v of vehiclesToSeed) {
    await executeQuery(
      pool,
      `INSERT INTO vehicles (plate_number, category, v_type, company_name, max_weight_kg)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (plate_number) DO UPDATE SET category = EXCLUDED.category, v_type = EXCLUDED.v_type`,
      [v.plate, v.category, v.vType, v.company, v.maxWeight],
    );
  }

  // 5. Seed Master SKU Barang
  const itemsToSeed = [
    { sku: 'SKU-ELK-001', name: 'Laptop Stand Aluminium Ergo', unit: 'PCS', vol: 0.008, weight: 1.20, initialQty: 150 },
    { sku: 'SKU-ELK-002', name: 'Monitor LED 27 Inch UHD Pro', unit: 'UNIT', vol: 0.045, weight: 5.50, initialQty: 80 },
    { sku: 'SKU-LOG-001', name: 'Karton Boks Standar 40x30x30', unit: 'BOX', vol: 0.036, weight: 0.40, initialQty: 400 },
    { sku: 'SKU-FNB-001', name: 'Minyak Goreng Sawit 2L Refill', unit: 'DUS', vol: 0.024, weight: 12.00, initialQty: 250 },
    { sku: 'SKU-TX-001', name: 'Gulungan Kain Katun Kombed 30s', unit: 'ROLL', vol: 0.080, weight: 25.00, initialQty: 60 },
  ];

  for (const it of itemsToSeed) {
    const itemRes = await executeQuery<{ id: string }>(
      pool,
      `INSERT INTO items_master (sku_code, name, unit, unit_volume_m3, unit_weight_kg)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (sku_code) DO UPDATE SET name = EXCLUDED.name, unit_volume_m3 = EXCLUDED.unit_volume_m3, unit_weight_kg = EXCLUDED.unit_weight_kg
       RETURNING id`,
      [it.sku, it.name, it.unit, it.vol, it.weight],
    );
    const itemId = itemRes.rows[0]?.id;

    // 6. Seed Stok Awal di Gudang Pusat jika belum ada
    if (itemId && pusatId) {
      await executeQuery(
        pool,
        `INSERT INTO warehouse_stocks (warehouse_id, item_id, available_qty)
         VALUES ($1, $2, $3)
         ON CONFLICT (warehouse_id, item_id) DO NOTHING`,
        [pusatId, itemId, it.initialQty],
      );
    }
  }

  logger.info('Database seed selesai berhasil!');
}

if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  runSeed()
    .then(() => pool.end())
    .catch((err) => {
      console.error('Gagal menjalankan seed:', err);
      process.exit(1);
    });
}
