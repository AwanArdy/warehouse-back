-- Up Migration
CREATE TABLE document_sequences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doc_type doc_type NOT NULL,
    warehouse_code VARCHAR(20) NOT NULL,
    period_ym VARCHAR(6) NOT NULL,
    last_number INT NOT NULL DEFAULT 0 CHECK (last_number >= 0),
    UNIQUE (doc_type, warehouse_code, period_ym)
);

CREATE TABLE official_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_number VARCHAR(60) NOT NULL UNIQUE,
    gate_transaction_id UUID NOT NULL REFERENCES gate_transactions(id) ON DELETE RESTRICT,
    doc_type doc_type NOT NULL,
    status doc_status NOT NULL DEFAULT 'QUEUED',
    latex_source TEXT NOT NULL,
    storage_path TEXT,
    file_sha256 VARCHAR(64),
    error_log TEXT,
    retry_count INT NOT NULL DEFAULT 0,
    issued_at TIMESTAMPTZ,
    voided_by_doc_id UUID REFERENCES official_documents(id) ON DELETE RESTRICT,
    void_reason TEXT,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_official_documents_updated_at
BEFORE UPDATE ON official_documents FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    entity_name VARCHAR(60) NOT NULL,
    entity_id UUID NOT NULL,
    action VARCHAR(30) NOT NULL,
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes untuk optimalisasi raw query & polling worker LaTeX
CREATE INDEX idx_gate_tx_status_created ON gate_transactions (status, created_at DESC);
CREATE INDEX idx_gate_tx_warehouse ON gate_transactions (warehouse_id, status);
CREATE INDEX idx_cargo_items_tx ON transaction_cargo_items (gate_transaction_id);
CREATE INDEX idx_stock_movements_item ON stock_movements (warehouse_id, item_id, created_at DESC);
CREATE INDEX idx_official_docs_tx ON official_documents (gate_transaction_id, doc_type, status);

CREATE INDEX idx_official_docs_latex_queue
ON official_documents (created_at ASC)
WHERE status = 'QUEUED';

CREATE INDEX idx_audit_logs_entity ON audit_logs (entity_name, entity_id, created_at DESC);

-- Down Migration
DROP INDEX IF EXISTS idx_audit_logs_entity;
DROP INDEX IF EXISTS idx_official_docs_latex_queue;
DROP INDEX IF EXISTS idx_official_docs_tx;
DROP INDEX IF EXISTS idx_stock_movements_item;
DROP INDEX IF EXISTS idx_cargo_items_tx;
DROP INDEX IF EXISTS idx_gate_tx_warehouse;
DROP INDEX IF EXISTS idx_gate_tx_status_created;

DROP TABLE IF EXISTS audit_logs;
DROP TRIGGER IF EXISTS trg_official_documents_updated_at ON official_documents;
DROP TABLE IF EXISTS official_documents;
DROP TABLE IF EXISTS document_sequences;
