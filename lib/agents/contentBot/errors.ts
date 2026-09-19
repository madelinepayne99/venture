export interface ContentBotPartialUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Mirrors ScoutResearchError exactly — carries partial token usage on any
 * failure so real cost is never lost, whether the failure happened in the
 * planning step or the safety-review step (see contentWorkflow.ts's
 * runContentProductionPipeline, which prices and records this on the
 * catch path exactly like runScoutPipeline already does for Scout).
 */
export class ContentBotError extends Error {
  constructor(
    message: string,
    readonly usage: ContentBotPartialUsage,
    readonly cause_?: unknown,
  ) {
    super(message);
    this.name = "ContentBotError";
  }
}
