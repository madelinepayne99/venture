import "server-only";
import {
  createSupportRequest,
  listSupportRequestsForFounder,
  countSupportRequestsForFounderSince,
} from "@/lib/db/repositories";
import type { SupportRequest } from "@/lib/db/types";

/**
 * Real Help & Support workflow (Mission 10). A genuine, server-persisted
 * ticket — never a fire-and-forget form that only looks like it worked.
 * No email provider is configured anywhere in this codebase (confirmed by
 * inspecting both `.env.local` and the process environment, same
 * discipline as CLAUDE.md's own "Local verification vs. a real
 * deployment" sections), so `isEmailDeliveryConfigured()` below is the
 * one real gate that decides whether the UI is allowed to claim an email
 * confirmation was sent — it must never be hardcoded to true.
 */

export class SupportRequestValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join(" "));
    this.name = "SupportRequestValidationError";
  }
}

export class SupportRequestRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Too many support requests submitted recently — please wait before submitting another.");
    this.name = "SupportRequestRateLimitError";
  }
}

const MAX_SUBJECT_LENGTH = 200;
const MAX_MESSAGE_LENGTH = 5000;

// A real, deliberately small rate limit — spam/abuse protection per
// Mission 10's own explicit requirement, not a guess at what "sensible"
// means: five requests in a rolling hour is generous for a genuine
// support need and tight enough to make automated spam pointless.
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 5;

/**
 * A real, founder-configurable support contact address — read from the
 * environment, never hardcoded to a guessed or fabricated address (see
 * CLAUDE.md's standing rule against inventing contact details). Falls
 * back to a clearly-labeled placeholder the UI can detect and treat as
 * "not yet configured," rather than ever displaying a made-up email.
 */
export function getSupportContactAddress(): string | null {
  const configured = process.env.SUPPORT_CONTACT_EMAIL?.trim();
  return configured ? configured : null;
}

/**
 * Whether this deployment can actually send a real confirmation email —
 * currently always false, since no email-provider credential (e.g. a
 * future `RESEND_API_KEY`) exists anywhere in this codebase. Centralized
 * here so the UI has exactly one place to check before ever claiming an
 * email was sent — see this module's own doc comment.
 */
export function isEmailDeliveryConfigured(): boolean {
  return Boolean(process.env.SUPPORT_EMAIL_PROVIDER_API_KEY?.trim());
}

export async function submitSupportRequest(input: {
  founderId: string;
  organizationId: string | null;
  subject: string;
  message: string;
}): Promise<SupportRequest> {
  const subject = input.subject?.trim();
  const message = input.message?.trim();
  const errors: string[] = [];
  if (!subject) errors.push("A subject is required.");
  if (subject && subject.length > MAX_SUBJECT_LENGTH) errors.push(`Subject must be ${MAX_SUBJECT_LENGTH} characters or fewer.`);
  if (!message) errors.push("A message is required.");
  if (message && message.length > MAX_MESSAGE_LENGTH) errors.push(`Message must be ${MAX_MESSAGE_LENGTH} characters or fewer.`);
  if (errors.length > 0) throw new SupportRequestValidationError(errors);

  const windowStartIso = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const recentCount = await countSupportRequestsForFounderSince(input.founderId, windowStartIso);
  if (recentCount >= RATE_LIMIT_MAX_REQUESTS) {
    throw new SupportRequestRateLimitError(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000));
  }

  return createSupportRequest({
    organizationId: input.organizationId,
    founderId: input.founderId,
    subject: subject!,
    message: message!,
  });
}

export async function listMySupportRequests(founderId: string): Promise<SupportRequest[]> {
  return listSupportRequestsForFounder(founderId);
}
