-- Boss Investigation Engine: schema aditivo para futura persistência relacional.
-- O runtime legado continua válido; nenhuma tabela existente é removida ou alterada.

CREATE TABLE IF NOT EXISTS investigation_cases (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL UNIQUE,
  boss TEXT NOT NULL,
  world TEXT NOT NULL,
  status TEXT NOT NULL,
  first_detection_at BIGINT,
  first_detection_source TEXT,
  raw_score NUMERIC(5,1),
  calibrated_confidence NUMERIC(5,1),
  calibration_status TEXT,
  recommendation TEXT,
  investigation_mode_until BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  final_boss TEXT,
  final_event_at BIGINT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_investigation_cases_world_boss_time ON investigation_cases(world,boss,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_investigation_cases_status ON investigation_cases(status,updated_at DESC);

CREATE TABLE IF NOT EXISTS investigation_evidence (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  evidence_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_kind TEXT,
  boss TEXT NOT NULL,
  world TEXT NOT NULL,
  observed_at BIGINT,
  received_at BIGINT,
  estimated_at BIGINT,
  reporter_hash TEXT,
  independence_key TEXT,
  reliability NUMERIC(6,5),
  evidence_strength NUMERIC(6,5),
  freshness NUMERIC(6,5),
  positive BOOLEAN NOT NULL DEFAULT FALSE,
  negative BOOLEAN NOT NULL DEFAULT FALSE,
  can_confirm BOOLEAN NOT NULL DEFAULT TRUE,
  source_health TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_investigation_evidence_candidate ON investigation_evidence(candidate_id,received_at);
CREATE INDEX IF NOT EXISTS idx_investigation_evidence_source ON investigation_evidence(source_id,received_at DESC);

CREATE TABLE IF NOT EXISTS investigation_decisions (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  boss TEXT NOT NULL,
  world TEXT NOT NULL,
  outcome TEXT NOT NULL,
  decided_at BIGINT NOT NULL,
  first_detection_at BIGINT,
  investigation_completed_at BIGINT,
  final_boss TEXT,
  final_event_at BIGINT,
  raw_score NUMERIC(5,1),
  calibrated_confidence NUMERIC(5,1),
  recommendation TEXT,
  reason TEXT,
  snapshot JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_investigation_decisions_world_boss ON investigation_decisions(world,boss,decided_at DESC);

CREATE TABLE IF NOT EXISTS investigation_outcomes (
  id BIGSERIAL PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  boss TEXT NOT NULL,
  source_id TEXT NOT NULL,
  reporter_hash TEXT,
  correct BOOLEAN NOT NULL,
  weight NUMERIC(6,5) NOT NULL,
  evaluated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_investigation_outcomes_source ON investigation_outcomes(source_id,evaluated_at DESC);
CREATE INDEX IF NOT EXISTS idx_investigation_outcomes_reporter ON investigation_outcomes(reporter_hash,evaluated_at DESC);

CREATE TABLE IF NOT EXISTS investigation_incidents (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  incident_type TEXT NOT NULL,
  occurred_at BIGINT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS investigation_missed_events (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  boss TEXT NOT NULL,
  world TEXT NOT NULL,
  event_at BIGINT NOT NULL,
  coverage_pct NUMERIC(5,1),
  classification TEXT NOT NULL,
  reason TEXT NOT NULL,
  recorded_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_investigation_missed_world_time ON investigation_missed_events(world,recorded_at DESC);
