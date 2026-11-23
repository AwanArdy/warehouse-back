-- Up Migration
ALTER TABLE official_documents
ALTER COLUMN gate_transaction_id DROP NOT NULL;

ALTER TABLE official_documents
ADD CONSTRAINT chk_official_doc_gate_tx_required CHECK (
    doc_type = 'REKAP_HARIAN' OR gate_transaction_id IS NOT NULL
);

-- Down Migration
ALTER TABLE official_documents
DROP CONSTRAINT IF EXISTS chk_official_doc_gate_tx_required;

ALTER TABLE official_documents
ALTER COLUMN gate_transaction_id SET NOT NULL;
