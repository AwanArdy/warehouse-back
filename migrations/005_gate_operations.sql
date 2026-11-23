-- Up Migration
CREATE TABLE gate_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_number VARCHAR(30) NOT NULL UNIQUE,
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    dock_id UUID REFERENCES loading_docks(id) ON DELETE RESTRICT,
    driver_name VARCHAR(120) NOT NULL,
    driver_license_no VARCHAR(50) NOT NULL,
    direction movement_direction NOT NULL,
    category transport_category NOT NULL,
    status gate_status NOT NULL DEFAULT 'GATE_IN',
    gate_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    gate_out_at TIMESTAMPTZ,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_gate_out_after_in CHECK (gate_out_at IS NULL OR gate_out_at >= gate_in_at)
);

CREATE TRIGGER trg_gate_transactions_updated_at
BEFORE UPDATE ON gate_transactions FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Mencegah kendaraan yang sama memiliki lebih dari 1 transaksi aktif di dalam kawasan
CREATE UNIQUE INDEX uq_active_vehicle_in_area
ON gate_transactions (vehicle_id)
WHERE status NOT IN ('GATE_OUT', 'CANCELLED');

CREATE TABLE transaction_containers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gate_transaction_id UUID NOT NULL UNIQUE REFERENCES gate_transactions(id) ON DELETE CASCADE,
    container_number VARCHAR(15) NOT NULL,
    size container_size NOT NULL,
    seal_number VARCHAR(50) NOT NULL,
    is_empty BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Validasi format ISO 6346: 4 huruf kapital + 7 angka
    CONSTRAINT chk_container_iso6346 CHECK (container_number ~ '^[A-Z]{4}[0-9]{7}$')
);

CREATE TABLE transaction_cargo_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gate_transaction_id UUID NOT NULL REFERENCES gate_transactions(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items_master(id) ON DELETE RESTRICT,
    quantity NUMERIC(12, 2) NOT NULL CHECK (quantity > 0),
    weight_kg NUMERIC(10, 2) NOT NULL CHECK (weight_kg >= 0),
    condition_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE gate_status_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gate_transaction_id UUID NOT NULL REFERENCES gate_transactions(id) ON DELETE CASCADE,
    from_status gate_status,
    to_status gate_status NOT NULL,
    notes TEXT,
    changed_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Down Migration
DROP TABLE IF EXISTS gate_status_logs;
DROP TABLE IF EXISTS transaction_cargo_items;
DROP TABLE IF EXISTS transaction_containers;
DROP INDEX IF EXISTS uq_active_vehicle_in_area;
DROP TRIGGER IF EXISTS trg_gate_transactions_updated_at ON gate_transactions;
DROP TABLE IF EXISTS gate_transactions;
