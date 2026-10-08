BEGIN;
CREATE TABLE IF NOT EXISTS intelligence_policies (
 id text PRIMARY KEY, kind text NOT NULL CHECK (kind IN ('signal','source','dependency')),
 world text, boss text, source_id text, status text NOT NULL,
 created_at timestamptz NOT NULL, stage_started_at timestamptz NOT NULL,
 percentage smallint NOT NULL DEFAULT 0 CHECK (percentage BETWEEN 0 AND 100),
 production_eligible boolean NOT NULL DEFAULT false, recipe jsonb NOT NULL DEFAULT '{}'::jsonb,
 gate jsonb, rollback_at timestamptz
);
CREATE TABLE IF NOT EXISTS discovery_datasets (
 hash text PRIMARY KEY, created_at timestamptz NOT NULL, world text NOT NULL, boss text NOT NULL,
 snapshot jsonb NOT NULL, CHECK (length(hash)=64)
);
CREATE TABLE IF NOT EXISTS prospective_signal_forecasts (
 id text PRIMARY KEY, policy_id text NOT NULL REFERENCES intelligence_policies(id),
 dataset_hash text NOT NULL REFERENCES discovery_datasets(hash), world text NOT NULL, boss text NOT NULL,
 issued_at timestamptz NOT NULL, window_end timestamptz NOT NULL,
 baseline double precision NOT NULL CHECK (baseline BETWEEN 0 AND 1),
 probability double precision NOT NULL CHECK (probability BETWEEN 0 AND 1),
 immutable_hash text NOT NULL, status text NOT NULL, outcome smallint CHECK (outcome IN (0,1)),
 resolved_at timestamptz, outcome_history jsonb NOT NULL DEFAULT '[]'::jsonb,
 CHECK (window_end>issued_at), CHECK (resolved_at IS NULL OR resolved_at>=window_end)
);
CREATE INDEX IF NOT EXISTS prospective_policy_time_idx ON prospective_signal_forecasts(policy_id,issued_at);
CREATE TABLE IF NOT EXISTS discovery_governance_history (
 id bigserial PRIMARY KEY, policy_id text NOT NULL REFERENCES intelligence_policies(id),
 available_at timestamptz NOT NULL, status text NOT NULL, gate jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS intelligence_configuration_versions (
 id text PRIMARY KEY, world text NOT NULL, available_at timestamptz NOT NULL,
 hash text NOT NULL, settings jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS intelligence_alert_history (
 id text PRIMARY KEY, world text NOT NULL, boss text NOT NULL, available_at timestamptz NOT NULL,
 configuration_id text REFERENCES intelligence_configuration_versions(id),
 alert_key text NOT NULL, status text NOT NULL CHECK (status IN ('planned','delivered','failed')),
 message jsonb
);
CREATE TABLE IF NOT EXISTS discovered_publications (
 id text PRIMARY KEY, source_id text NOT NULL, source_ref text NOT NULL,
 available_at timestamptz NOT NULL, published_at timestamptz,
 published_lower timestamptz, published_upper timestamptz, category text NOT NULL,
 payload_hash text NOT NULL, content jsonb NOT NULL, verified_execution boolean NOT NULL DEFAULT false,
 CHECK (published_lower IS NULL OR published_upper>=published_lower),
 CHECK (published_at IS NULL OR published_at<=available_at)
);
CREATE TABLE IF NOT EXISTS discovery_analysis_snapshots (
 id text PRIMARY KEY, world text NOT NULL, available_at timestamptz NOT NULL,
 kind text NOT NULL CHECK (kind IN ('regime','cluster','survival','red_team')),
 snapshot jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS public_collector_configuration (
 source_id text PRIMARY KEY, available_at timestamptz NOT NULL, configuration jsonb NOT NULL,
 CHECK (NOT configuration ? 'token'), CHECK (NOT configuration ? 'password')
);
CREATE INDEX IF NOT EXISTS publication_available_idx ON discovered_publications(available_at);
CREATE INDEX IF NOT EXISTS analysis_available_idx ON discovery_analysis_snapshots(world,available_at);
CREATE INDEX IF NOT EXISTS alerts_world_time_idx ON intelligence_alert_history(world,available_at);
CREATE INDEX IF NOT EXISTS configuration_world_time_idx ON intelligence_configuration_versions(world,available_at);
COMMIT;
