-- Real-Time Decision Intelligence / Boss Operations Intelligence.
-- Additive and idempotent. PostgreSQL persistence mirrors the runtime state model.
BEGIN;

CREATE TABLE IF NOT EXISTS decision_models (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  model_kind TEXT NOT NULL,
  configuration_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  promoted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS boss_decision_snapshots (
  id TEXT PRIMARY KEY,
  world TEXT NOT NULL,
  boss TEXT NOT NULL,
  as_of TIMESTAMPTZ NOT NULL,
  decision_engine_version TEXT NOT NULL,
  priority_score DOUBLE PRECISION,
  decision_confidence DOUBLE PRECISION,
  model_probability DOUBLE PRECISION,
  predictability_score DOUBLE PRECISION,
  information_gap_score DOUBLE PRECISION,
  missed_detection_risk DOUBLE PRECISION,
  detection_coverage DOUBLE PRECISION,
  state TEXT NOT NULL,
  peak_probability_time TIMESTAMPTZ,
  window_start TIMESTAMPTZ,
  window_end TIMESTAMPTZ,
  next_best_action TEXT,
  next_best_source TEXT,
  polling_interval_ms BIGINT,
  inputs_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  explanation_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS decision_timeline (
  id TEXT PRIMARY KEY,
  world TEXT NOT NULL,
  boss TEXT NOT NULL,
  event_at TIMESTAMPTZ NOT NULL,
  previous_state TEXT,
  new_state TEXT NOT NULL,
  previous_priority DOUBLE PRECISION,
  priority_score DOUBLE PRECISION,
  reason_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  inputs_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  decision_engine_version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS operations_alerts (
  id TEXT PRIMARY KEY,
  world TEXT NOT NULL,
  boss TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  dispatched_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  level TEXT NOT NULL,
  alert_value_score DOUBLE PRECISION NOT NULL,
  priority_score DOUBLE PRECISION,
  previous_priority DOUBLE PRECISION,
  state TEXT,
  previous_state TEXT,
  model_probability DOUBLE PRECISION,
  decision_confidence DOUBLE PRECISION,
  missed_detection_risk DOUBLE PRECISION,
  detail_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS operations_attention (
  world TEXT NOT NULL,
  boss TEXT NOT NULL,
  acknowledged_at TIMESTAMPTZ,
  snoozed_until TIMESTAMPTZ,
  follow_closely BOOLEAN NOT NULL DEFAULT FALSE,
  follow_since TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (world,boss)
);

CREATE TABLE IF NOT EXISTS operations_action_outcomes (
  id TEXT PRIMARY KEY,
  world TEXT NOT NULL,
  boss TEXT NOT NULL,
  action TEXT NOT NULL,
  source_id TEXT,
  outcome TEXT NOT NULL,
  useful BOOLEAN,
  uncertainty_before DOUBLE PRECISION,
  uncertainty_after DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_boss_decision_snapshots_scope
  ON boss_decision_snapshots(world,boss,as_of DESC);
CREATE INDEX IF NOT EXISTS idx_boss_decision_snapshots_priority
  ON boss_decision_snapshots(world,as_of DESC,priority_score DESC);
CREATE INDEX IF NOT EXISTS idx_decision_timeline_scope
  ON decision_timeline(world,boss,event_at DESC);
CREATE INDEX IF NOT EXISTS idx_operations_alerts_scope
  ON operations_alerts(world,boss,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operations_action_outcomes_scope
  ON operations_action_outcomes(world,boss,created_at DESC);

COMMIT;
