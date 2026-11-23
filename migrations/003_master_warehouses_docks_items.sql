-- Up Migration
CREATE TABLE warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(20) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    max_volume_m3 NUMERIC(12, 2) NOT NULL CHECK (max_volume_m3 > 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_warehouses_updated_at
BEFORE UPDATE ON warehouses FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE loading_docks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    dock_number VARCHAR(20) NOT NULL,
    category transport_category NOT NULL,
    status dock_status NOT NULL DEFAULT 'AVAILABLE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (warehouse_id, dock_number)
);

CREATE TRIGGER trg_loading_docks_updated_at
BEFORE UPDATE ON loading_docks FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE items_master (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku_code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(200) NOT NULL,
    unit VARCHAR(20) NOT NULL,
    unit_volume_m3 NUMERIC(10, 4) NOT NULL CHECK (unit_volume_m3 >= 0),
    unit_weight_kg NUMERIC(10, 2) NOT NULL CHECK (unit_weight_kg >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Down Migration
DROP TABLE IF EXISTS items_master;
DROP TRIGGER IF EXISTS trg_loading_docks_updated_at ON loading_docks;
DROP TABLE IF EXISTS loading_docks;
DROP TRIGGER IF EXISTS trg_warehouses_updated_at ON warehouses;
DROP TABLE IF EXISTS warehouses;
