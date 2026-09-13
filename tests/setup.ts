process.env.VENTURE_DB_PATH = ":memory:";
process.env.REQUIRE_FOUNDER_APPROVAL = "true";
// Deliberately no ANTHROPIC_API_KEY — tests must never make a real API call.
delete process.env.ANTHROPIC_API_KEY;
