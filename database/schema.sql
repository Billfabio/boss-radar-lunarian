-- Boss Radar intelligence schema (provider-neutral SQL, PostgreSQL-oriented types)
CREATE TABLE IF NOT EXISTS bosses (
  id BIGSERIAL PRIMARY KEY,
  canonical_name VARCHAR(140) NOT NULL UNIQUE,
  display_name VARCHAR(140) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS worlds (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS sources (
  id VARCHAR(80) PRIMARY KEY,
  name VARCHAR(180) NOT NULL,
  kind VARCHAR(40) NOT NULL,
  base_weight DOUBLE PRECISION NOT NULL,
  alpha DOUBLE PRECISION NOT NULL,
  beta DOUBLE PRECISION NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  requests BIGINT NOT NULL DEFAULT 0,
  successes BIGINT NOT NULL DEFAULT 0,
  records BIGINT NOT NULL DEFAULT 0,
  errors BIGINT NOT NULL DEFAULT 0,
  evaluated_records BIGINT NOT NULL DEFAULT 0,
  correct_records BIGINT NOT NULL DEFAULT 0,
  incorrect_records BIGINT NOT NULL DEFAULT 0,
  duplicates BIGINT NOT NULL DEFAULT 0,
  total_error_ms BIGINT NOT NULL DEFAULT 0,
  total_delay_ms BIGINT NOT NULL DEFAULT 0,
  delay_samples BIGINT NOT NULL DEFAULT 0,
  consistency_sum DOUBLE PRECISION NOT NULL DEFAULT 0,
  consistency_samples BIGINT NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  circuit_state VARCHAR(20) NOT NULL DEFAULT 'CLOSED',
  suspended_until TIMESTAMPTZ,
  last_attempt TIMESTAMPTZ,
  last_success TIMESTAMPTZ,
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS boss_events (
  id VARCHAR(180) PRIMARY KEY,
  boss_id BIGINT NOT NULL REFERENCES bosses(id),
  world_id BIGINT NOT NULL REFERENCES worlds(id),
  event_type VARCHAR(20) NOT NULL,
  status VARCHAR(30) NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  estimated_at TIMESTAMPTZ NOT NULL,
  confidence DOUBLE PRECISION NOT NULL,
  source_count INTEGER NOT NULL DEFAULT 0,
  confirmations INTEGER NOT NULL DEFAULT 0,
  anomaly_code VARCHAR(60),
  anomaly_detail TEXT,
  quality_status VARCHAR(40),
  data_quality_score DOUBLE PRECISION,
  consensus_json TEXT,
  corrected BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_boss_world_time ON boss_events(boss_id,world_id,estimated_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_status_time ON boss_events(status,estimated_at DESC);
CREATE TABLE IF NOT EXISTS evidences (
  evidence_id VARCHAR(220) PRIMARY KEY,
  event_id VARCHAR(180) NOT NULL REFERENCES boss_events(id) ON DELETE CASCADE,
  source_id VARCHAR(80) NOT NULL REFERENCES sources(id),
  event_type VARCHAR(20) NOT NULL,
  precision VARCHAR(20) NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  estimated_at TIMESTAMPTZ NOT NULL,
  source_ref TEXT,
  collection_method VARCHAR(80),
  source_observed_at TIMESTAMPTZ,
  collected_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  confirmed_by VARCHAR(120),
  reported_at TIMESTAMPTZ NOT NULL,
  confidence DOUBLE PRECISION NOT NULL,
  quality_score DOUBLE PRECISION,
  quality_status VARCHAR(40),
  quality_json TEXT,
  manual BOOLEAN NOT NULL DEFAULT FALSE,
  evaluated BOOLEAN NOT NULL DEFAULT FALSE,
  error_ms BIGINT,
  agreement_score DOUBLE PRECISION,
  detail_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_evidence_event ON evidences(event_id);
CREATE INDEX IF NOT EXISTS idx_evidence_source_time ON evidences(source_id,reported_at DESC);
CREATE TABLE IF NOT EXISTS forecasts (
  id VARCHAR(220) PRIMARY KEY,
  boss_id BIGINT NOT NULL REFERENCES bosses(id),
  world_id BIGINT NOT NULL REFERENCES worlds(id),
  base_event_id VARCHAR(180) NOT NULL REFERENCES boss_events(id),
  base_event_at TIMESTAMPTZ NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  likely_at TIMESTAMPTZ,
  probability DOUBLE PRECISION NOT NULL,
  confidence_raw DOUBLE PRECISION,
  confidence DOUBLE PRECISION NOT NULL,
  prediction_score DOUBLE PRECISION,
  data_quality_score DOUBLE PRECISION,
  uncertainty_ms BIGINT,
  probability_distribution_json TEXT,
  calibration_json TEXT,
  challengers_json TEXT,
  champion VARCHAR(100),
  prediction_engine_version VARCHAR(40),
  model_version VARCHAR(80),
  dataset_version VARCHAR(220),
  drift_json TEXT,
  trend VARCHAR(80),
  sample_size INTEGER NOT NULL,
  methods_json TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  last_updated_at TIMESTAMPTZ NOT NULL,
  revisions INTEGER NOT NULL DEFAULT 1,
  resolved_at TIMESTAMPTZ,
  actual_at TIMESTAMPTZ,
  window_hit BOOLEAN,
  error_minutes DOUBLE PRECISION,
  signed_error_minutes DOUBLE PRECISION
);
CREATE INDEX IF NOT EXISTS idx_forecasts_boss_world_created ON forecasts(boss_id,world_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_forecasts_resolved ON forecasts(resolved_at DESC);
CREATE TABLE IF NOT EXISTS model_method_performance (
  boss_id BIGINT NOT NULL REFERENCES bosses(id),
  world_id BIGINT NOT NULL REFERENCES worlds(id),
  method_name VARCHAR(80) NOT NULL,
  sample_count BIGINT NOT NULL DEFAULT 0,
  ema_error_minutes DOUBLE PRECISION,
  ema_hit_rate DOUBLE PRECISION,
  last_error_minutes DOUBLE PRECISION,
  last_updated_at TIMESTAMPTZ,
  PRIMARY KEY(boss_id,world_id,method_name)
);
CREATE TABLE IF NOT EXISTS corrections (
  id VARCHAR(220) PRIMARY KEY,
  event_id VARCHAR(180) NOT NULL REFERENCES boss_events(id),
  old_at TIMESTAMPTZ NOT NULL,
  new_at TIMESTAMPTZ NOT NULL,
  actor VARCHAR(120) NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id VARCHAR(220) PRIMARY KEY,
  event_type VARCHAR(80) NOT NULL,
  boss_id BIGINT REFERENCES bosses(id),
  world_id BIGINT REFERENCES worlds(id),
  source_id VARCHAR(80) REFERENCES sources(id),
  payload_json TEXT,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(created_at DESC);

CREATE TABLE IF NOT EXISTS intelligence_ledger (
  sequence BIGSERIAL PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  payload_json TEXT NOT NULL,
  previous_hash CHAR(64) NOT NULL,
  entry_hash CHAR(64) NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_intelligence_ledger_time ON intelligence_ledger(occurred_at DESC);

CREATE TABLE IF NOT EXISTS model_governance (
  boss_id BIGINT NOT NULL REFERENCES bosses(id),
  world_id BIGINT NOT NULL REFERENCES worlds(id),
  champion VARCHAR(100) NOT NULL,
  challenger VARCHAR(100),
  paired_samples INTEGER NOT NULL DEFAULT 0,
  champion_mae DOUBLE PRECISION,
  challenger_mae DOUBLE PRECISION,
  improvement_ci_low DOUBLE PRECISION,
  improvement_ci_high DOUBLE PRECISION,
  promotion_recommended BOOLEAN NOT NULL DEFAULT FALSE,
  evaluated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(boss_id,world_id)
);

CREATE TABLE IF NOT EXISTS intelligence_alerts (
  id VARCHAR(220) PRIMARY KEY,
  world_id BIGINT REFERENCES worlds(id),
  boss_id BIGINT REFERENCES bosses(id),
  source_id VARCHAR(80) REFERENCES sources(id),
  alert_type VARCHAR(80) NOT NULL,
  severity VARCHAR(20) NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_intelligence_alerts_open ON intelligence_alerts(resolved_at,created_at DESC);
