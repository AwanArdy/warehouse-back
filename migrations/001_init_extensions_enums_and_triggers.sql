-- Up Migration
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE transport_category AS ENUM ('CARGO', 'CONTAINER');
CREATE TYPE vehicle_type AS ENUM ('MOBIL_BOX', 'TRAILER', 'TRONTON');
CREATE TYPE container_size AS ENUM ('20FT', '40FT', '40HC');
CREATE TYPE movement_direction AS ENUM ('INBOUND', 'OUTBOUND');
CREATE TYPE dock_status AS ENUM ('AVAILABLE', 'OCCUPIED', 'MAINTENANCE');
CREATE TYPE gate_status AS ENUM (
    'GATE_IN',
    'DOCKING',
    'LOADING_UNLOADING',
    'DOC_PENDING',
    'DOC_ISSUED',
    'GATE_OUT',
    'CANCELLED'
);
CREATE TYPE doc_type AS ENUM ('GATE_PASS', 'BASTB', 'SURAT_JALAN', 'REKAP_HARIAN');
CREATE TYPE doc_status AS ENUM ('QUEUED', 'COMPILING', 'ISSUED', 'FAILED', 'VOID');

CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Down Migration
DROP FUNCTION IF EXISTS trigger_set_updated_at();

DROP TYPE IF EXISTS doc_status;
DROP TYPE IF EXISTS doc_type;
DROP TYPE IF EXISTS gate_status;
DROP TYPE IF EXISTS dock_status;
DROP TYPE IF EXISTS movement_direction;
DROP TYPE IF EXISTS container_size;
DROP TYPE IF EXISTS vehicle_type;
DROP TYPE IF EXISTS transport_category;
