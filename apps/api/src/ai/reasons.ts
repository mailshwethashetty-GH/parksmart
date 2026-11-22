/**
 * AI-written reasons (FR-15, AI stage 1 "explain"). After a round runs, rewrite each
 * template reason into friendlier English. The template stays unless the rewrite passes
 * every check: under 40 words and keeps all facts (bay codes and numbers). Every call is
 * logged in `ai_logs` with its pseudonymous input.
 */
import Anthropic from '@anthropic-ai/sdk';
import { aiLogs, allocations, and, type Db, eq, requests, rounds } from '@parksmart/db';
import { loadSite } from '../services/site';
import { MAX_REASON_WORDS, topFactors, wordCount } from '../services/reasons';
import type { AiClient, ReasonRewriteInput } from './client';

/** Lowest AI stage at which AI may explain decisions (docs/03 §4: stage 1 = explain). */
const EXPLAIN_STAGE = 1;

/** Decisions whose reason could reveal a sensitive (medical/accessibility) signal stay templated. */
const TEMPLATE_ONLY = new Set(['accessible_not_approved']);

const BAY_CODE = /\b[A-Z][A-Z0-9]*(?:-[A-Z]+)*-\d+\b/g;
const NUMBER = /(?<![\w-])\d+(?![\w-])/g;

/**
 * Facts the rewrite must keep: every bay code (whole) and every other number as a
 * standalone token — so "B1-EV-001" can't stand in for a dropped "1 Dec".
 */
export function keepsFacts(template: string, rewrite: string): boolean {
  const codes: string[] = template.match(BAY_CODE) ?? [];
  const rewriteCodes: string[] = rewrite.match(BAY_CODE) ?? [];
  if (!codes.every((code) => rewriteCodes.includes(code))) return false;
  const numbersIn = (text: string): string[] => text.replace(BAY_CODE, ' ').match(NUMBER) ?? [];
  const available = numbersIn(rewrite);
  return numbersIn(template).every((n) => {
    const i = available.indexOf(n);
    if (i === -1) return false;
    available.splice(i, 1); // each occurrence must be matched
    return true;
  });
}

export function acceptable(template: string, rewrite: string | null): rewrite is string {
  return !!rewrite && wordCount(rewrite) < MAX_REASON_WORDS && keepsFacts(template, rewrite);
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]!);
  });
  await Promise.all(workers);
}

export type RewriteSummary =
  | { status: 'skipped'; reason: 'NO_AI' | 'AI_STAGE' | 'NOT_FOUND' }
  | { status: 'done'; attempted: number; rewritten: number; failed: number };

export async function rewriteRoundReasons(
  db: Db,
  ai: AiClient | null,
  roundId: string,
  opts: { concurrency?: number; now?: () => Date } = {},
): Promise<RewriteSummary> {
  if (!ai) return { status: 'skipped', reason: 'NO_AI' };
  const round = await db.select().from(rounds).where(eq(rounds.id, roundId)).get();
  if (!round) return { status: 'skipped', reason: 'NOT_FOUND' };
  // Server-side stage check (non-negotiable #4).
  if ((await loadSite(db, round.siteId)).aiStage < EXPLAIN_STAGE)
    return { status: 'skipped', reason: 'AI_STAGE' };

  const rows = await db
    .select({ allocation: allocations, requestedType: requests.bayType })
    .from(allocations)
    .innerJoin(requests, eq(requests.id, allocations.requestId))
    .where(eq(allocations.roundId, roundId))
    .all();
  const rankedCount = new Map<string, number>();
  for (const { allocation: a } of rows) {
    const date = (a.scoreBreakdownJson as { date: string }).date;
    rankedCount.set(date, Math.max(rankedCount.get(date) ?? 0, a.rank));
  }
  const now = opts.now ?? (() => new Date());
  let rewritten = 0;
  let failed = 0;
  const work = rows.filter(
    ({ allocation: a }) =>
      a.reasonText &&
      !TEMPLATE_ONLY.has(String((a.scoreBreakdownJson as { reasonCode: string }).reasonCode)),
  );

  await mapLimit(work, opts.concurrency ?? 4, async ({ allocation: a, requestedType }) => {
    const breakdown = a.scoreBreakdownJson as {
      date: string;
      reasonCode: string;
      factors: Parameters<typeof topFactors>[0];
    };
    const template = a.reasonText!;
    const input: ReasonRewriteInput = {
      outcome: a.outcome,
      reasonCode: breakdown.reasonCode,
      requestedBayType: requestedType,
      roundType: round.roundType,
      rank: a.rank || null,
      rankedCount: rankedCount.get(breakdown.date) ?? 0,
      waitlistPosition: null,
      topFactors: topFactors(breakdown.factors ?? []),
      template,
    };
    const started = performance.now();
    let output: unknown = null;
    let error: string | null = null;
    try {
      const result = await ai.rewriteReason(input);
      const ok = acceptable(template, result.text);
      output = { ...result, accepted: ok };
      if (ok) {
        // Only replace the reason we rewrote (an admin override may have changed it).
        await db
          .update(allocations)
          .set({ reasonText: result.text })
          .where(and(eq(allocations.id, a.id), eq(allocations.reasonText, template)))
          .run();
        rewritten++;
      }
    } catch (err) {
      failed++;
      error =
        err instanceof Anthropic.APIError ? `${err.constructor.name} ${err.status}` : String(err);
    }
    await db
      .insert(aiLogs)
      .values({
        siteId: round.siteId,
        purpose: 'reason_rewrite',
        model: ai.model,
        inputJson: input,
        outputJson: output,
        latencyMs: Math.round(performance.now() - started),
        error,
        createdAt: now(),
      })
      .run();
  });
  return { status: 'done', attempted: work.length, rewritten, failed };
}
