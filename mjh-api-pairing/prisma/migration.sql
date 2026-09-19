-- Pairing codes for printer agent onboarding (one-time use).
-- Merge into @mjh/api Prisma / SQL migrations.

CREATE TABLE IF NOT EXISTS printer_pair_codes (
  id            TEXT PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  restaurant_id TEXT NOT NULL,
  agent_key     TEXT NOT NULL DEFAULT 'kitchen-1',
  store_name    TEXT NOT NULL,
  used_at       TIMESTAMPTZ NULL,
  expires_at    TIMESTAMPTZ NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_printer_pair_codes_code ON printer_pair_codes (code);

-- Example seed (replace restaurant_id with real id):
-- INSERT INTO printer_pair_codes (id, code, restaurant_id, agent_key, store_name)
-- VALUES (gen_random_uuid()::text, 'MJH-KL-001', 'cmu82urxz0000pifptl0yiq9b', 'kitchen-1', '满江红');

-- printer_agents must already exist or be upserted by pair handler:
-- columns expected: id, restaurant_id / store_id, agent_key, token_hash, created_at, updated_at
