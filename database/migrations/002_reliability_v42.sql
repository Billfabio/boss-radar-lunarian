-- Reliability Engine 4.2 metadata migration
-- PostgreSQL-oriented and idempotent. Does not delete or rewrite historical rows.

ALTER TABLE sources ADD COLUMN IF NOT EXISTS precise_evaluated_records BIGINT NOT NULL DEFAULT 0;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS precise_correct_records BIGINT NOT NULL DEFAULT 0;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS precise_total_error_ms BIGINT NOT NULL DEFAULT 0;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS total_latency_ms BIGINT NOT NULL DEFAULT 0;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS last_latency_ms BIGINT NOT NULL DEFAULT 0;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS last_record_at TIMESTAMPTZ;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS circuit_reason VARCHAR(30);
ALTER TABLE sources ADD COLUMN IF NOT EXISTS quality_recovery_successes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS recent_outcomes_json TEXT;

ALTER TABLE forecasts ADD COLUMN IF NOT EXISTS actual_precision VARCHAR(20);
ALTER TABLE forecasts ADD COLUMN IF NOT EXISTS confidence_breakdown_json TEXT;
ALTER TABLE forecasts ADD COLUMN IF NOT EXISTS source_usage_json TEXT;
ALTER TABLE forecasts ADD COLUMN IF NOT EXISTS excluded_evidence_json TEXT;
ALTER TABLE forecasts ADD COLUMN IF NOT EXISTS distribution_conditional BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_forecasts_model_version_resolved
  ON forecasts(model_version,resolved_at DESC);

CREATE INDEX IF NOT EXISTS idx_sources_circuit_state
  ON sources(circuit_state,suspended_until);
