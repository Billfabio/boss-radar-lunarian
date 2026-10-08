-- Temporal Causal Discovery Lab.
-- Additive/idempotent. Stores observational quasi-experimental screening only;
-- causality_proven and production_eligible remain false unless a future stronger design explicitly changes policy.
BEGIN;

-- Before-Spawn features are intentionally allowed to exist without a traditional relationship edge.
ALTER TABLE graph_features
  ALTER COLUMN relationship_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS causal_hypotheses (
  id TEXT PRIMARY KEY,
  relationship_id TEXT REFERENCES knowledge_relationships(id) ON DELETE SET NULL,
  world TEXT NOT NULL,
  source_boss TEXT NOT NULL,
  target_boss TEXT NOT NULL,
  window_from_hours DOUBLE PRECISION NOT NULL,
  window_to_hours DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL,
  evidence_level TEXT NOT NULL,
  treated_eligible INTEGER NOT NULL DEFAULT 0,
  control_pool INTEGER NOT NULL DEFAULT 0,
  matched_pairs INTEGER NOT NULL DEFAULT 0,
  match_rate DOUBLE PRECISION,
  treated_risk DOUBLE PRECISION,
  matched_control_risk DOUBLE PRECISION,
  att DOUBLE PRECISION,
  risk_ratio DOUBLE PRECISION,
  causal_p DOUBLE PRECISION,
  causal_q DOUBLE PRECISION,
  placebo_p DOUBLE PRECISION,
  placebo_q DOUBLE PRECISION,
  placebo_effect DOUBLE PRECISION,
  max_abs_smd DOUBLE PRECISION,
  stability_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  gates_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  assumptions_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  lineage_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  causality_proven BOOLEAN NOT NULL DEFAULT FALSE,
  production_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  ai_lab_promotion_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  first_tested_at TIMESTAMPTZ NOT NULL,
  last_tested_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS causal_hypothesis_versions (
  causal_id TEXT NOT NULL REFERENCES causal_hypotheses(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  evidence_level TEXT,
  matched_pairs INTEGER NOT NULL DEFAULT 0,
  att DOUBLE PRECISION,
  causal_q DOUBLE PRECISION,
  placebo_q DOUBLE PRECISION,
  max_abs_smd DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (causal_id, version)
);

CREATE TABLE IF NOT EXISTS causal_discovery_runs (
  id TEXT PRIMARY KEY,
  world TEXT NOT NULL,
  analysis_as_of TIMESTAMPTZ NOT NULL,
  method TEXT NOT NULL,
  tested_relationships INTEGER NOT NULL DEFAULT 0,
  candidates INTEGER NOT NULL DEFAULT 0,
  rejected INTEGER NOT NULL DEFAULT 0,
  inconclusive INTEGER NOT NULL DEFAULT 0,
  configuration_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_causal_hypotheses_scope
  ON causal_hypotheses(world, target_boss, status, last_tested_at DESC);
CREATE INDEX IF NOT EXISTS idx_causal_hypotheses_relation
  ON causal_hypotheses(relationship_id, last_tested_at DESC);
CREATE INDEX IF NOT EXISTS idx_causal_runs_world_asof
  ON causal_discovery_runs(world, analysis_as_of DESC);

COMMIT;
