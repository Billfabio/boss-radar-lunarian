-- Additive PostgreSQL migration. The legacy file runtime still owns persistence.
-- Apply after database/schema.sql and 002/003; this does not switch runtime to SQL.
BEGIN;
CREATE TABLE IF NOT EXISTS canonical_boss_event_versions (
 event_id TEXT NOT NULL, version_hash TEXT NOT NULL, boss TEXT NOT NULL,
 world TEXT NOT NULL, available_at TIMESTAMPTZ NOT NULL, status TEXT NOT NULL,
 spawn_lower TIMESTAMPTZ, spawn_upper TIMESTAMPTZ, payload JSONB NOT NULL,
 PRIMARY KEY (event_id, available_at, version_hash), CHECK (spawn_upper >= spawn_lower)
);
CREATE INDEX IF NOT EXISTS canonical_events_world_available ON canonical_boss_event_versions(world,available_at);
CREATE TABLE IF NOT EXISTS signal_discovery_experiments (
 id TEXT PRIMARY KEY, dataset_hash TEXT NOT NULL, world TEXT NOT NULL,
 boss TEXT NOT NULL, signal TEXT NOT NULL, status TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL, production_eligible BOOLEAN NOT NULL DEFAULT FALSE,
 payload JSONB NOT NULL, UNIQUE(dataset_hash,world,boss,signal)
);
CREATE TABLE IF NOT EXISTS discovery_context_events (
 id TEXT PRIMARY KEY, world TEXT NOT NULL, type TEXT NOT NULL,
 start_at TIMESTAMPTZ NOT NULL, end_at TIMESTAMPTZ NOT NULL,
 known_at TIMESTAMPTZ NOT NULL, source_ref TEXT NOT NULL, payload JSONB NOT NULL,
 CHECK(end_at >= start_at)
);
CREATE TABLE IF NOT EXISTS discovery_observation_coverage (
 id TEXT PRIMARY KEY, boss TEXT NOT NULL, world TEXT NOT NULL,
 start_at TIMESTAMPTZ NOT NULL, end_at TIMESTAMPTZ NOT NULL,
 known_at TIMESTAMPTZ NOT NULL, verified BOOLEAN NOT NULL DEFAULT FALSE,
 source_ref TEXT NOT NULL, payload JSONB NOT NULL, CHECK(end_at > start_at)
);
CREATE TABLE IF NOT EXISTS discovery_source_candidates (
 id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, status TEXT NOT NULL,
 discovered_at TIMESTAMPTZ NOT NULL, mode TEXT NOT NULL DEFAULT 'shadow',
 production_eligible BOOLEAN NOT NULL DEFAULT FALSE, payload JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS discovery_source_samples (
 id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES discovery_source_candidates(id),
 collected_at TIMESTAMPTZ NOT NULL, payload JSONB NOT NULL
);
COMMIT;
