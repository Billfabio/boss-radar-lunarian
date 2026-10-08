-- Boss Radar AI Lab. Additive and idempotent; runtime still uses the persistent state store.
BEGIN;

CREATE TABLE IF NOT EXISTS mlops_ai_experiments (
 id TEXT PRIMARY KEY,
 fingerprint CHAR(64) NOT NULL,
 hypothesis TEXT NOT NULL,
 kind TEXT NOT NULL,
 world TEXT NOT NULL,
 boss TEXT,
 model_id TEXT NOT NULL,
 model_version TEXT NOT NULL,
 status TEXT NOT NULL,
 feature_version TEXT NOT NULL,
 code_version TEXT NOT NULL,
 dataset_version TEXT,
 parameters_json JSONB NOT NULL DEFAULT '{}'::jsonb,
 features_json JSONB NOT NULL DEFAULT '[]'::jsonb,
 result_json JSONB,
 created_at TIMESTAMPTZ NOT NULL,
 started_at TIMESTAMPTZ,
 completed_at TIMESTAMPTZ,
 shadow_started_at TIMESTAMPTZ,
 promoted_at TIMESTAMPTZ,
 archived_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS mlops_ai_decisions (
 id BIGSERIAL PRIMARY KEY,
 experiment_id TEXT REFERENCES mlops_ai_experiments(id),
 decision TEXT NOT NULL,
 actor TEXT NOT NULL,
 reason TEXT NOT NULL DEFAULT '',
 canary_id TEXT,
 created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS mlops_ai_canaries (
 id TEXT PRIMARY KEY,
 experiment_id TEXT NOT NULL REFERENCES mlops_ai_experiments(id),
 scope TEXT NOT NULL,
 world TEXT NOT NULL,
 boss TEXT,
 model_id TEXT NOT NULL,
 model_version TEXT NOT NULL,
 status TEXT NOT NULL,
 stage INTEGER NOT NULL DEFAULT 0,
 percentage INTEGER NOT NULL CHECK (percentage BETWEEN 0 AND 100),
 previous_champion_json JSONB NOT NULL,
 metrics_json JSONB,
 started_at TIMESTAMPTZ NOT NULL,
 stage_started_at TIMESTAMPTZ NOT NULL,
 promoted_at TIMESTAMPTZ,
 rolled_back_at TIMESTAMPTZ,
 rollback_reason TEXT
);

CREATE TABLE IF NOT EXISTS mlops_ai_champion_history (
 id BIGSERIAL PRIMARY KEY,
 scope TEXT NOT NULL,
 previous_json JSONB NOT NULL,
 champion_json JSONB NOT NULL,
 promoted_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS mlops_ai_knowledge (
 id BIGSERIAL PRIMARY KEY,
 experiment_id TEXT NOT NULL REFERENCES mlops_ai_experiments(id),
 world TEXT NOT NULL,
 boss TEXT,
 hypothesis TEXT NOT NULL,
 model_id TEXT NOT NULL,
 status TEXT NOT NULL,
 sample_size INTEGER NOT NULL DEFAULT 0,
 holdout_improvement_pct DOUBLE PRECISION,
 result_json JSONB,
 created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_experiments_scope_status ON mlops_ai_experiments(world,boss,status);
CREATE INDEX IF NOT EXISTS idx_ai_experiments_fingerprint ON mlops_ai_experiments(fingerprint);
CREATE INDEX IF NOT EXISTS idx_ai_decisions_experiment_time ON mlops_ai_decisions(experiment_id,created_at);
CREATE INDEX IF NOT EXISTS idx_ai_canaries_scope_status ON mlops_ai_canaries(scope,status);
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_scope ON mlops_ai_knowledge(world,boss,created_at);

COMMIT;
