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
  reported_at TIMESTAMPTZ NOT NULL,
  confidence DOUBLE PRECISION NOT NULL,
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
  confidence DOUBLE PRECISION NOT NULL,
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
