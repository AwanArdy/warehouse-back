-- Up Migration
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) NOT NULL UNIQUE,
    full_name VARCHAR(120) NOT NULL,
    password_hash TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(40) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    description TEXT
);

CREATE TABLE permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(80) NOT NULL UNIQUE,
    module VARCHAR(50) NOT NULL
);

CREATE TABLE user_roles (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, role_id)
);

CREATE TABLE role_permissions (
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- Seed Data Roles Awal
INSERT INTO roles (code, name, description) VALUES
    ('SUPER_ADMIN', 'Super Admin', 'Kepala Operasional / Administrator penuh seluruh kawasan pergudangan'),
    ('PETUGAS_GATE', 'Petugas Gate (Security)', 'Petugas pos gerbang masuk dan keluar kendaraan'),
    ('ADMIN_GUDANG', 'Admin Operasional Gudang', 'Staf administrasi alokasi loading dock dan realisasi bongkar muat'),
    ('ADMIN_PERSURATAN', 'Admin Persuratan', 'Staf administrasi dokumen resmi LaTeX dan pembatalan/revisi surat')
ON CONFLICT (code) DO NOTHING;

-- Seed Data Permissions Granular
INSERT INTO permissions (code, module) VALUES
    ('master:read', 'MASTER'),
    ('master:manage', 'MASTER'),
    ('user:manage', 'AUTH'),
    ('gate:checkin', 'GATE'),
    ('gate:checkout', 'GATE'),
    ('gate:read', 'GATE'),
    ('dock:assign', 'DOCK'),
    ('dock:manage', 'DOCK'),
    ('cargo:record', 'INVENTORY'),
    ('cargo:finalize', 'INVENTORY'),
    ('inventory:read', 'INVENTORY'),
    ('doc:generate', 'DOCUMENT'),
    ('doc:void', 'DOCUMENT'),
    ('doc:read', 'DOCUMENT'),
    ('audit:read', 'AUDIT')
ON CONFLICT (code) DO NOTHING;

-- Mapping Role -> Permissions
-- 1. SUPER_ADMIN mendapat semua permission
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'SUPER_ADMIN'
ON CONFLICT DO NOTHING;

-- 2. PETUGAS_GATE
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
    'master:read',
    'gate:checkin',
    'gate:checkout',
    'gate:read',
    'doc:generate',
    'doc:read'
)
WHERE r.code = 'PETUGAS_GATE'
ON CONFLICT DO NOTHING;

-- 3. ADMIN_GUDANG
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
    'master:read',
    'gate:read',
    'dock:assign',
    'dock:manage',
    'cargo:record',
    'cargo:finalize',
    'inventory:read',
    'doc:generate',
    'doc:read'
)
WHERE r.code = 'ADMIN_GUDANG'
ON CONFLICT DO NOTHING;

-- 4. ADMIN_PERSURATAN
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
    'master:read',
    'gate:read',
    'inventory:read',
    'doc:generate',
    'doc:void',
    'doc:read'
)
WHERE r.code = 'ADMIN_PERSURATAN'
ON CONFLICT DO NOTHING;

-- Down Migration
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS user_roles;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS roles;
DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
DROP TABLE IF EXISTS users;
