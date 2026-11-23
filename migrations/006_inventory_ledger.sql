-- Up Migration
CREATE TABLE warehouse_stocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    item_id UUID NOT NULL REFERENCES items_master(id) ON DELETE RESTRICT,
    available_qty NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (available_qty >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (warehouse_id, item_id)
);

CREATE TRIGGER trg_warehouse_stocks_updated_at
BEFORE UPDATE ON warehouse_stocks FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE stock_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    item_id UUID NOT NULL REFERENCES items_master(id) ON DELETE RESTRICT,
    gate_transaction_id UUID NOT NULL REFERENCES gate_transactions(id) ON DELETE RESTRICT,
    movement_type VARCHAR(10) NOT NULL CHECK (movement_type IN ('IN', 'OUT')),
    qty_delta NUMERIC(14, 2) NOT NULL CHECK (qty_delta > 0),
    balance_after NUMERIC(14, 2) NOT NULL CHECK (balance_after >= 0),
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Down Migration
DROP TABLE IF EXISTS stock_movements;
DROP TRIGGER IF EXISTS trg_warehouse_stocks_updated_at ON warehouse_stocks;
DROP TABLE IF EXISTS warehouse_stocks;
