CREATE TABLE IF NOT EXISTS gate_ticket_sequences (
  period_ymd VARCHAR(8) PRIMARY KEY,
  last_number INT NOT NULL DEFAULT 0 CHECK (last_number >= 0)
);
