-- Fly Next Social Hub: integration and audit foundation
-- Safe additive migration; no existing rows or tables are dropped.
CREATE TABLE IF NOT EXISTS social_connections (
  id BIGSERIAL PRIMARY KEY,
  platform TEXT NOT NULL UNIQUE CHECK (platform IN ('facebook','instagram','whatsapp','tiktok','youtube')),
  provider_account_id TEXT,
  display_name TEXT,
  connection_status TEXT NOT NULL DEFAULT 'not_connected'
    CHECK (connection_status IN ('not_connected','pending','connected','expired','error')),
  granted_scopes TEXT[] NOT NULL DEFAULT '{}',
  token_env_key TEXT,
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id BIGSERIAL PRIMARY KEY,
  platform TEXT NOT NULL,
  event_key TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  processing_error TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_platform_received
  ON webhook_events(platform, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created
  ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
  ON audit_logs(entity_type, entity_id);
