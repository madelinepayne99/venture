import "server-only";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

let db: Database.Database | undefined;

function resolveDbPath(): string {
  const configured = process.env.VENTURE_DB_PATH;
  if (configured) return configured;
  return path.join(process.cwd(), "data", "venture.db");
}

function seed(instance: Database.Database) {
  const founderCount = instance
    .prepare("SELECT COUNT(*) as n FROM founders")
    .get() as { n: number };
  if (founderCount.n === 0) {
    const insertFounder = instance.prepare(
      "INSERT INTO founders (id, name, email) VALUES (?, ?, ?)",
    );
    insertFounder.run(randomUUID(), "Ellis Scott", null);
    insertFounder.run(randomUUID(), "Maddie", null);
  }

  const agentCount = instance
    .prepare("SELECT COUNT(*) as n FROM agents")
    .get() as { n: number };
  if (agentCount.n === 0) {
    const scoutId = randomUUID();
    instance
      .prepare(
        "INSERT INTO agents (id, key, name, role_summary, status) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        scoutId,
        "scout",
        "Scout",
        "Opportunity-research specialist. Turns a founder's mission into a structured research job covering demand evidence, competition, risk, and platform suitability.",
        "active",
      );
    const cap = instance.prepare(
      "INSERT INTO agent_capabilities (id, agent_id, capability, description) VALUES (?, ?, ?, ?)",
    );
    cap.run(
      randomUUID(),
      scoutId,
      "opportunity_research",
      "Researches digital-product opportunities (Etsy downloads, Amazon KDP print-on-demand) and returns a structured, evidence-labeled report.",
    );

    // Future agents are recorded as planned so the roster reflects real
    // architecture, not aspirational activity — none of these run yet.
    const planned: Array<[string, string, string]> = [
      ["inventor", "Inventor", "Product ideas and strategy."],
      ["creator", "Creator", "Product assets and production."],
      ["inspector", "Inspector", "Quality, compliance, and adversarial review."],
      ["merchant", "Merchant", "Listings, pricing, and marketplace performance."],
      [
        "tiktok_specialist",
        "TikTok Specialist",
        "Video concepts, scripts, assets, captions, scheduling, and performance analysis.",
      ],
      [
        "amazon_specialist",
        "Amazon Specialist",
        "KDP product preparation, listing management, and performance analysis.",
      ],
      [
        "etsy_specialist",
        "Etsy Specialist",
        "Downloadable-product listings and shop performance.",
      ],
      [
        "manager",
        "Manager",
        "Coordinates collaborative missions and prevents duplicated or conflicting work.",
      ],
    ];
    const insertAgent = instance.prepare(
      "INSERT INTO agents (id, key, name, role_summary, status) VALUES (?, ?, ?, ?, 'planned')",
    );
    for (const [key, name, roleSummary] of planned) {
      insertAgent.run(randomUUID(), key, name, roleSummary);
    }
  }

  const projectCount = instance
    .prepare("SELECT COUNT(*) as n FROM projects")
    .get() as { n: number };
  if (projectCount.n === 0) {
    instance
      .prepare(
        "INSERT INTO projects (id, name, description, platform_focus) VALUES (?, ?, ?, ?)",
      )
      .run(
        randomUUID(),
        "Digital Products",
        "Researching, creating, launching, and promoting digital products — no physical packing or posting.",
        "etsy,amazon-kdp",
      );
  }
}

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = resolveDbPath();
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const instance = new Database(dbPath);
  instance.pragma("journal_mode = WAL");
  instance.pragma("foreign_keys = ON");

  const schemaPath = path.join(process.cwd(), "lib", "db", "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf-8");
  instance.exec(schema);

  seed(instance);

  db = instance;
  return db;
}

/** Test-only: force a fresh in-memory database on the next getDb() call. */
export function resetDbForTests(): void {
  if (db) {
    db.close();
    db = undefined;
  }
}
