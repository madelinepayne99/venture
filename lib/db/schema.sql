-- Venture HQ data model.
-- Every table here backs something genuinely displayed in the interface.
-- Do not add columns to fabricate activity — only to record it.

CREATE TABLE IF NOT EXISTS founders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE, -- stable machine name, e.g. "scout"
  name TEXT NOT NULL,
  role_summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned', -- 'active' | 'planned'
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS agent_capabilities (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  capability TEXT NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  platform_focus TEXT, -- e.g. "etsy,amazon-kdp"
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id),
  founder_id TEXT NOT NULL REFERENCES founders(id),
  title TEXT NOT NULL,
  brief TEXT NOT NULL, -- the founder's raw instruction
  interpreted_mission TEXT, -- Scout's restatement, filled after research
  state TEXT NOT NULL DEFAULT 'draft',
  final_status TEXT, -- 'reject' | 'investigate_further' | 'ready_for_founders_review', set by Scout
  failure_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS mission_stages (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id),
  stage_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | in_progress | completed | failed | skipped
  started_at TEXT,
  completed_at TEXT,
  detail TEXT
);

CREATE TABLE IF NOT EXISTS agent_assignments (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  role TEXT NOT NULL, -- e.g. "lead", "collaborator"
  assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id),
  source_url TEXT,
  source_title TEXT,
  source_date TEXT, -- date as reported by the source, may be unknown
  snippet TEXT,
  retrieved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  is_verified_fact INTEGER NOT NULL DEFAULT 0 -- 0 = inference/unverified, 1 = verified fact
);

CREATE TABLE IF NOT EXISTS deliverables (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  kind TEXT NOT NULL, -- e.g. "scout_research_report"
  content_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id),
  founder_id TEXT NOT NULL REFERENCES founders(id),
  decision TEXT NOT NULL, -- 'approved' | 'cancelled'
  note TEXT,
  decided_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS costs (
  id TEXT PRIMARY KEY,
  mission_id TEXT REFERENCES missions(id),
  agent_id TEXT REFERENCES agents(id),
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  usd_cost REAL, -- NULL means real tokens were spent but pricing for this
                 -- model is unknown — never fabricate a dollar figure here.
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  mission_id TEXT REFERENCES missions(id),
  category TEXT NOT NULL, -- 'agent_cost' | 'other'
  description TEXT NOT NULL,
  amount_usd REAL NOT NULL, -- negative = expense
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS activity_history (
  id TEXT PRIMARY KEY,
  mission_id TEXT REFERENCES missions(id),
  actor TEXT NOT NULL, -- 'founder:<id>' | 'agent:<key>' | 'system'
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_mission_stages_mission ON mission_stages(mission_id);
CREATE INDEX IF NOT EXISTS idx_evidence_mission ON evidence(mission_id);
CREATE INDEX IF NOT EXISTS idx_deliverables_mission ON deliverables(mission_id);
CREATE INDEX IF NOT EXISTS idx_costs_mission ON costs(mission_id);
CREATE INDEX IF NOT EXISTS idx_ledger_mission ON ledger_entries(mission_id);
CREATE INDEX IF NOT EXISTS idx_activity_mission ON activity_history(mission_id);
