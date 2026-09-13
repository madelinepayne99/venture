import "server-only";
import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | undefined;

/**
 * The only place in the codebase that reads ANTHROPIC_API_KEY. This module
 * is marked server-only, so importing it from a client component fails the
 * build rather than shipping the key to the browser.
 */
export function getAnthropicClient(): Anthropic {
  if (client) return client;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Copy .env.example to .env.local and add a real key before running an agent.",
    );
  }
  client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}
