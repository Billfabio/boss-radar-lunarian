-- PostgreSQL, additive and idempotent. Runtime continues using the legacy store.
BEGIN;
CREATE TABLE IF NOT EXISTS mlops_datasets (
 id TEXT PRIMARY KEY, content_hash CHAR(64) NOT NULL, feature_version TEXT NOT NULL,
 world TEXT NOT NULL, boss TEXT NOT NULL, as_of TIMESTAMPTZ NOT NULL,
 snapshot_json JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS mlops_model_registry (
 id TEXT PRIMARY KEY, version TEXT NOT NULL, status TEXT NOT NULL,
 metadata_json JSONB NOT NULL, promoted_at TIMESTAMPTZ, promoted_by TEXT
);
CREATE TABLE IF NOT EXISTS mlops_prediction_runs (
 id TEXT PRIMARY KEY, forecast_id TEXT NOT NULL, dataset_id TEXT NOT NULL REFERENCES mlops_datasets(id),
 model_id TEXT NOT NULL REFERENCES mlops_model_registry(id), model_version TEXT NOT NULL,
 mode TEXT NOT NULL, as_of TIMESTAMPTZ NOT NULL, snapshot_json JSONB NOT NULL, outcome_json JSONB,
 UNIQUE(forecast_id,dataset_id,model_id,model_version)
);
CREATE TABLE IF NOT EXISTS mlops_experiments (
 id TEXT PRIMARY KEY, world TEXT NOT NULL, model_id TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL, result_json JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS mlops_error_memory (
 forecast_id TEXT PRIMARY KEY, boss TEXT NOT NULL, world TEXT NOT NULL, analysis_json JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS mlops_timeline (
 id TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL, event_json JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS pipeline_dead_letters (
 id TEXT PRIMARY KEY, origin TEXT NOT NULL, attempts INTEGER NOT NULL CHECK(attempts>0),
 created_at TIMESTAMPTZ NOT NULL, status TEXT NOT NULL, payload_json JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mlops_runs_model_time ON mlops_prediction_runs(model_id,model_version,as_of);
CREATE INDEX IF NOT EXISTS idx_mlops_dataset_scope ON mlops_datasets(world,boss,as_of);
COMMIT;
