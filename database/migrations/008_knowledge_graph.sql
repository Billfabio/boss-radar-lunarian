-- Boss Knowledge Graph / Temporal Intelligence.
-- Additive and idempotent. PostgreSQL remains sufficient for the initial graph workload;
-- no external graph database is required at this stage.
BEGIN;

CREATE TABLE IF NOT EXISTS knowledge_relationships (
  id TEXT PRIMARY KEY,
  world TEXT NOT NULL,
  kind TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  window_from_hours DOUBLE PRECISION,
  window_to_hours DOUBLE PRECISION,
  status TEXT NOT NULL,
  support INTEGER NOT NULL DEFAULT 0,
  sample_size INTEGER NOT NULL DEFAULT 0,
  baseline_samples INTEGER NOT NULL DEFAULT 0,
  baseline_probability DOUBLE PRECISION,
  conditional_probability DOUBLE PRECISION,
  lift DOUBLE PRECISION,
  confidence DOUBLE PRECISION,
  raw_significance DOUBLE PRECISION,
  adjusted_significance DOUBLE PRECISION,
  direction TEXT,
  quality_score DOUBLE PRECISION,
  drift_score DOUBLE PRECISION,
  valid_from TIMESTAMPTZ NOT NULL,
  valid_until TIMESTAMPTZ,
  discovered_at TIMESTAMPTZ NOT NULL,
  last_validated TIMESTAMPTZ NOT NULL,
  metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  lineage_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  causality_proven BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS knowledge_relationship_versions (
  relationship_id TEXT NOT NULL REFERENCES knowledge_relationships(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (relationship_id, version)
);

CREATE TABLE IF NOT EXISTS graph_features (
  id TEXT PRIMARY KEY,
  relationship_id TEXT NOT NULL REFERENCES knowledge_relationships(id),
  world TEXT NOT NULL,
  source_boss TEXT,
  target_boss TEXT NOT NULL,
  feature_name TEXT NOT NULL,
  status TEXT NOT NULL,
  production_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  configuration_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  discovered_at TIMESTAMPTZ NOT NULL,
  last_updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS graph_hypotheses (
  id TEXT PRIMARY KEY,
  feature_id TEXT REFERENCES graph_features(id),
  relationship_id TEXT REFERENCES knowledge_relationships(id),
  world TEXT NOT NULL,
  boss TEXT,
  hypothesis TEXT NOT NULL,
  status TEXT NOT NULL,
  rank_score DOUBLE PRECISION,
  support INTEGER NOT NULL DEFAULT 0,
  lift DOUBLE PRECISION,
  adjusted_significance DOUBLE PRECISION,
  parameters_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS server_state_snapshots (
  id TEXT PRIMARY KEY,
  world TEXT NOT NULL,
  event_id TEXT,
  event_time TIMESTAMPTZ,
  available_at TIMESTAMPTZ NOT NULL,
  captured_as_known_at TIMESTAMPTZ NOT NULL,
  state_json JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_relationship_scope_status
  ON knowledge_relationships(world, target_id, status, last_validated DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_relationship_source
  ON knowledge_relationships(world, source_id, status, last_validated DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_relationship_drift
  ON knowledge_relationships(world, status, drift_score DESC);
CREATE INDEX IF NOT EXISTS idx_graph_features_scope_status
  ON graph_features(world, target_boss, status);
CREATE INDEX IF NOT EXISTS idx_graph_hypotheses_rank
  ON graph_hypotheses(world, status, rank_score DESC);
CREATE INDEX IF NOT EXISTS idx_server_state_as_known
  ON server_state_snapshots(world, captured_as_known_at DESC);

COMMIT;
