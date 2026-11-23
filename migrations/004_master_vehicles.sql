-- Up Migration
CREATE TABLE vehicles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plate_number VARCHAR(20) NOT NULL UNIQUE,
    category transport_category NOT NULL,
    v_type vehicle_type NOT NULL,
    company_name VARCHAR(150) NOT NULL,
    max_weight_kg NUMERIC(10, 2) NOT NULL CHECK (max_weight_kg > 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- HARD CONSTRAINT: CARGO hanya MOBIL_BOX; CONTAINER hanya TRAILER atau TRONTON
    CONSTRAINT chk_vehicle_category_type_strict CHECK (
        (category = 'CARGO' AND v_type = 'MOBIL_BOX') OR
        (category = 'CONTAINER' AND v_type IN ('TRAILER', 'TRONTON'))
    )
);

CREATE TRIGGER trg_vehicles_updated_at
BEFORE UPDATE ON vehicles FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Down Migration
DROP TRIGGER IF EXISTS trg_vehicles_updated_at ON vehicles;
DROP TABLE IF EXISTS vehicles;
