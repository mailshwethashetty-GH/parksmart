/**
 * Claude API client (docs/06 "AI — Claude API"). Behind a small interface so tests can
 * inject a fake and the app runs without a key (template reasons only).
 *
 * Guardrails (non-negotiables #4 and #7): AI only explains — it never changes rules,
 * weights or allocations — and it only ever receives pseudonymous facts.
 */
import Anthropic from '@anthropic-ai/sdk';

/** Pseudonymous facts about one decision. No names, ids, plates or medical signals. */
export type ReasonRewriteInput = {
  outcome: 'confirmed' | 'waitlisted' | 'ineligible';
  reasonCode: string;
  requestedBayType: string;
  roundType: string;
  rank: number | null;
  rankedCount: number;
  waitlistPosition: number | null;
  topFactors: string[];
  /** The deterministic reason; the rewrite must keep every fact in it. */
  template: string;
};

export type RewriteResult = { text: string | null; stopReason: string | null };

export interface AiClient {
  readonly model: string;
  rewriteReason(input: ReasonRewriteInput): Promise<RewriteResult>;
}

const REASON_SYSTEM = `You rewrite one parking-allocation decision for the employee it concerns.
Use only the facts provided. Keep every fact from "template" exactly: bay codes, days, ranks and waitlist numbers.
Write plain, friendly English in the second person: one or two sentences, under 40 words.
Do not greet, do not apologise at length, do not promise future outcomes, and do not mention AI, models or formulas.
Reply with the rewritten text only.`;

export function createAiClient(opts: { apiKey?: string; model: string }): AiClient | null {
  if (!opts.apiKey) return null;
  // Reasons are short and many: bounded timeout, SDK retries on 429/5xx/connection errors.
  const client = new Anthropic({ apiKey: opts.apiKey, timeout: 20_000, maxRetries: 2 });
  return {
    model: opts.model,
    async rewriteReason(input) {
      const res = await client.messages.create({
        model: opts.model,
        max_tokens: 1024,
        // Short rewrite of given facts: low effort keeps it fast and cheap.
        output_config: { effort: 'low' },
        system: REASON_SYSTEM,
        messages: [{ role: 'user', content: JSON.stringify(input) }],
      });
      // A refusal or a truncated answer falls back to the template.
      if (res.stop_reason !== 'end_turn') return { text: null, stopReason: res.stop_reason };
      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join(' ')
        .trim();
      return { text: text || null, stopReason: res.stop_reason };
    },
  };
}
