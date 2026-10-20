/**
 * The shared Employee Capability Registry (Commercial MVP milestone —
 * see docs/venture-hq-commercial-mvp-progress.md). A single, static,
 * framework-agnostic source of truth for presentation-layer metadata
 * about every agent in Venture HQ's 10-employee roster — reused by the
 * Employee Directory, Focus View, Office View, and (in future) Chief of
 * Staff's delegation target list, onboarding, and billing.
 *
 * This is deliberately NOT a replacement for the real `agents` database
 * table — `status` (active/planned), `role_summary`, and real
 * capabilities are already owned by `lib/db/client.ts`'s
 * `CANONICAL_AGENTS` + the `agents`/`agent_capabilities` tables, and stay
 * that way. This registry adds the customer-facing metadata that table
 * was never meant to carry (department, job title, plain-language
 * description, setup requirements, world-scene mapping) and is always
 * read TOGETHER with a live `agents` row (see
 * `lib/domain/employeeWorkflow.ts`'s `listEmployeeDirectory`) — never
 * instead of one. No DB access, no secrets, safe to import from a client
 * component directly.
 *
 * `key` matches `agents.key` for the seven real agents exactly. The
 * three future agents (`website_developer`, `ai_receptionist`,
 * `sales_specialist`) have no `agents` row at all — never seeded, never
 * shown as having any capability, consistent with CLAUDE.md's own
 * standing "never fabricate activity" rule applied to the roster itself.
 */

export type ImplementationStatus = "available" | "requires_setup" | "coming_soon";

export interface EmployeeDefinition {
  /** Matches `agents.key` for the 7 real agents; a plain identifier (no DB row) for the 3 future ones. */
  key: string;
  displayName: string;
  jobTitle: string;
  department: string;
  /** Plain-language, customer-facing — no technical jargon. */
  description: string;
  /** Plain-language capability bullets — never more than what's genuinely built. */
  capabilities: string[];
  implementationStatus: ImplementationStatus;
  /** Whether a founder can recruit/remove this employee at all — false for every "coming_soon" entry. */
  recruitable: boolean;
  /** Real env var / integration names this employee's genuine capability depends on. */
  requiredIntegrations: string[];
  supportedTaskTypes: string[];
  permissionRequirements: string[];
  /** Matches a real `WorldTarget` string in `components/founders-desk/world/layout.ts`, or null if this employee has no office presence yet. */
  worldTarget: string | null;
  /** The accent color already used for this employee's rig/desk in the 3D scene, or a neutral default for a not-yet-built employee. */
  accentColor: string;
  /**
   * A real static portrait rendered from this employee's own approved 3D
   * rig (`components/founders-desk/world/scout.ts`'s character-building
   * functions — see `app/dev-portrait-capture/page.tsx`, the one-off
   * capture harness used to generate these), not a fabricated image or a
   * different art style. Null for the three not-yet-built future
   * employees, which have no rig to render — `EmployeeDirectory.tsx`
   * falls back to a plain, honestly-generic silhouette for those, never
   * initials claiming to be a finished portrait.
   */
  portraitUrl: string | null;
}

/**
 * Plain-language, customer-facing labels for the real env-var integration
 * names in `requiredIntegrations` above — never shown to a founder/
 * customer as a raw variable name like "ANTHROPIC_API_KEY" (Master
 * Development Mission 5, Section 4). The variable NAMES themselves are
 * not secret (only their values are, and those never leave the server —
 * see `lib/domain/employeeWorkflow.ts`'s `integrationsReady`), but a raw
 * env var string is still inappropriate, confusing customer-facing
 * language.
 */
export const INTEGRATION_LABELS: Record<string, string> = {
  ANTHROPIC_API_KEY: "AI research & writing",
  FAL_KEY: "AI image generation",
  ELEVENLABS_API_KEY: "AI voice narration",
  SHOTSTACK_API_KEY: "Video assembly",
};

export const EMPLOYEE_REGISTRY: EmployeeDefinition[] = [
  {
    key: "scout",
    displayName: "Scout",
    jobTitle: "Research & Trends",
    department: "Research & Intelligence",
    description:
      "Investigates a real business opportunity — checks genuine demand, competition, and risk — and brings back an honest, evidence-backed report before you commit any time or money.",
    capabilities: [
      "Researches a specific business or product opportunity you describe",
      "Cites real, dated sources for every claim",
      "Flags risks and genuine uncertainty rather than overselling",
    ],
    implementationStatus: "available",
    recruitable: true,
    requiredIntegrations: ["ANTHROPIC_API_KEY"],
    supportedTaskTypes: ["opportunity_research"],
    permissionRequirements: ["founder_approval_to_dispatch"],
    worldTarget: "scout",
    accentColor: "#195a4d",
    portraitUrl: "/employee-portraits/scout.png",
  },
  {
    key: "content_bot",
    displayName: "Content Bot",
    jobTitle: "Video & Creative Production",
    department: "Creative & Digital",
    description:
      "Turns an approved opportunity into a real, finished short-form video — script, voiceover, visuals, and assembly — for you to review before anything is ever published.",
    capabilities: [
      "Writes a structured script and shot list from an approved brief",
      "Generates real narration, stills, and a finished edited video",
      "Never publishes anything — every version waits for your review",
    ],
    implementationStatus: "available",
    recruitable: true,
    requiredIntegrations: ["ANTHROPIC_API_KEY", "FAL_KEY", "ELEVENLABS_API_KEY", "SHOTSTACK_API_KEY"],
    supportedTaskTypes: ["production_planning", "voiceover", "visual_generation", "assembly"],
    permissionRequirements: ["founder_approval_for_production", "founder_review_of_every_version"],
    worldTarget: "content_bot",
    accentColor: "#1d4d7a",
    portraitUrl: "/employee-portraits/content_bot.png",
  },
  {
    key: "chief_of_staff",
    displayName: "Chief of Staff",
    jobTitle: "Delegation & Coordination",
    department: "Operations & Administration",
    description:
      "Breaks a goal into real subtasks and hands each one to the right teammate — Executive Assistant, Finance, Business Analyst, or Operations — so nothing falls through the cracks.",
    capabilities: [
      "Splits a stated goal into real subtasks for named teammates",
      "Tracks every delegated subtask through to completion",
    ],
    implementationStatus: "available",
    recruitable: true,
    requiredIntegrations: [],
    supportedTaskTypes: ["goal_delegation"],
    permissionRequirements: [],
    worldTarget: "chief_of_staff",
    accentColor: "#a9762f",
    portraitUrl: "/employee-portraits/chief_of_staff.png",
  },
  {
    key: "executive_assistant",
    displayName: "Executive Assistant",
    jobTitle: "Everyday Administration",
    department: "Operations & Administration",
    description:
      "Keeps track of your internal reminders and to-dos. No email or calendar connections yet — purely a reliable internal task list.",
    capabilities: [
      "Creates and tracks internal tasks and reminders",
      "Marks tasks complete or cancelled, with a real history",
    ],
    implementationStatus: "available",
    recruitable: true,
    requiredIntegrations: [],
    supportedTaskTypes: ["internal_tasks"],
    permissionRequirements: [],
    worldTarget: "executive_assistant",
    accentColor: "#7a4868",
    portraitUrl: "/employee-portraits/executive_assistant.png",
  },
  {
    key: "finance_agent",
    displayName: "Finance Agent",
    jobTitle: "Budgets & Expense Tracking",
    department: "Finance & Customer Front",
    description:
      "Logs real expenses against a category budget and tells you exactly what's left — in whatever real currency you're spending, never converted or guessed.",
    capabilities: [
      "Records a real expense with amount and currency",
      "Sets a category budget and reports actual spend against it",
    ],
    implementationStatus: "available",
    recruitable: true,
    requiredIntegrations: [],
    supportedTaskTypes: ["expense_and_budget_tracking"],
    permissionRequirements: [],
    worldTarget: "finance_agent",
    accentColor: "#8a5a2e",
    portraitUrl: "/employee-portraits/finance_agent.png",
  },
  {
    key: "business_analyst",
    displayName: "Business Analyst",
    jobTitle: "Business Research & Planning",
    department: "Research & Intelligence",
    description:
      "Answers a direct market or competitor question with real web research and cited sources — separate from Scout's own mission-scoped opportunity research.",
    capabilities: [
      "Answers a specific research question with real web sources",
      "Reports real opportunities and risks it actually found",
    ],
    implementationStatus: "available",
    recruitable: true,
    requiredIntegrations: ["ANTHROPIC_API_KEY"],
    supportedTaskTypes: ["sourced_research"],
    permissionRequirements: [],
    worldTarget: "business_analyst",
    accentColor: "#4f4a80",
    portraitUrl: "/employee-portraits/business_analyst.png",
  },
  {
    key: "operations_agent",
    displayName: "Operations Agent",
    jobTitle: "Workflows & Checklists",
    department: "Operations & Administration",
    description:
      "Builds a real, ordered checklist for a repeatable process — like launching a new channel or onboarding a client — that you can add to and check off together.",
    capabilities: [
      "Creates a real, ordered checklist with items you define",
      "Adds items and marks them done, independently of other work",
    ],
    implementationStatus: "available",
    recruitable: true,
    requiredIntegrations: [],
    supportedTaskTypes: ["checklists"],
    permissionRequirements: [],
    worldTarget: "operations_agent",
    accentColor: "#45606d",
    portraitUrl: "/employee-portraits/operations_agent.png",
  },
  // --- Future employees — COMING SOON, no capability exists yet -------
  {
    key: "website_developer",
    displayName: "Website Developer",
    jobTitle: "Websites & Landing Pages",
    department: "Creative & Digital",
    description: "Will eventually build real websites, landing pages, and digital assets for your business.",
    capabilities: [],
    implementationStatus: "coming_soon",
    recruitable: false,
    requiredIntegrations: [],
    supportedTaskTypes: [],
    permissionRequirements: [],
    worldTarget: null,
    accentColor: "#6b6456",
    portraitUrl: null,
  },
  {
    key: "ai_receptionist",
    displayName: "AI Receptionist",
    jobTitle: "Calls & Enquiries",
    department: "Finance & Customer Front",
    description: "Will eventually answer business calls, take messages, handle enquiries, and connect to your calendar.",
    capabilities: [],
    implementationStatus: "coming_soon",
    recruitable: false,
    requiredIntegrations: [],
    supportedTaskTypes: [],
    permissionRequirements: [],
    worldTarget: null,
    accentColor: "#6b6456",
    portraitUrl: null,
  },
  {
    key: "sales_specialist",
    displayName: "Sales Specialist",
    jobTitle: "Leads & Pipeline",
    department: "Finance & Customer Front",
    description: "Will eventually manage leads, quotations, customer follow-ups, and your sales pipeline.",
    capabilities: [],
    implementationStatus: "coming_soon",
    recruitable: false,
    requiredIntegrations: [],
    supportedTaskTypes: [],
    permissionRequirements: [],
    worldTarget: null,
    accentColor: "#6b6456",
    portraitUrl: null,
  },
];

export function getEmployeeDefinition(key: string): EmployeeDefinition | undefined {
  return EMPLOYEE_REGISTRY.find((e) => e.key === key);
}

/** The real agent keys Chief of Staff may genuinely delegate to — must stay a subset of DELEGATABLE_AGENT_KEYS in lib/domain/chiefOfStaffWorkflow.ts. */
export const DELEGATION_CAPABLE_KEYS = EMPLOYEE_REGISTRY.filter(
  (e) => e.implementationStatus === "available" && e.key !== "scout" && e.key !== "content_bot" && e.key !== "chief_of_staff",
).map((e) => e.key);
