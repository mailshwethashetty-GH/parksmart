/**
 * Policy versions (FR-8, FR-9, FR-12). One policy per site. Drafts are editable;
 * published versions are immutable and take effect from the next weekly round to run,
 * never mid-round (non-negotiable #8). Every change is audited (non-negotiable #5).
 */
import { validatePolicy } from '@parksmart/engine';
import {
  and,
  asc,
  type Db,
  desc,
  eq,
  isNull,
  policies,
  policyVersions,
  rules,
} from '@parksmart/db';
import {
  describePolicy,
  nextWeeklyRound,
  siteLocalDate,
  weekStart,
  type CurrentPolicyResponse,
  type PolicyIssue,
  type PolicyVersionDetail,
  type PolicyVersionStatus,
  type PolicyVersionSummary,
  type RuleInput,
} from '@parksmart/shared';
import { businessRule, conflict, notFound } from '../lib/errors';
import type { Actor } from '../types';
import { iso } from './_scope';
import { writeAudit } from './audit';
import { checkFeasibility } from './feasibility';
import { loadSite } from './site';

type VersionRow = typeof policyVersions.$inferSelect;

async function sitePolicy(db: Db, siteId: string) {
  const policy = await db.select().from(policies).where(eq(policies.siteId, siteId)).get();
  if (!policy) throw notFound('Policy');
  return policy;
}

async function versionRows(db: Db, policyId: string): Promise<VersionRow[]> {
  return await db
    .select()
    .from(policyVersions)
    .where(eq(policyVersions.policyId, policyId))
    .orderBy(desc(policyVersions.version))
    .all();
}

/**
 * Status of every version for the week containing `now`. Within one effective week the
 * highest version wins; the latest week that has started is active.
 */
function statuses(rows: VersionRow[], currentWeek: string): Map<string, PolicyVersionStatus> {
  const result = new Map<string, PolicyVersionStatus>();
  const winners = new Map<string, VersionRow>();
  for (const r of rows) {
    if (!r.publishedAt || !r.effectiveFromWeek) {
      result.set(r.id, 'draft');
      continue;
    }
    const w = winners.get(r.effectiveFromWeek);
    if (!w || r.version > w.version) winners.set(r.effectiveFromWeek, r);
  }
  const started = [...winners.values()]
    .filter((r) => r.effectiveFromWeek! <= currentWeek)
    .sort((a, b) => (a.effectiveFromWeek! < b.effectiveFromWeek! ? 1 : -1));
  const activeId = started[0]?.id;
  for (const r of rows) {
    if (result.has(r.id)) continue;
    if (r.id === activeId) result.set(r.id, 'active');
    else if (winners.get(r.effectiveFromWeek!)?.id === r.id && r.effectiveFromWeek! > currentWeek) {
      result.set(r.id, 'scheduled');
    } else result.set(r.id, 'superseded');
  }
  return result;
}

const currentWeekFor = async (db: Db, siteId: string, now: Date) =>
  weekStart(siteLocalDate(now, (await loadSite(db, siteId)).timezone));

function summary(r: VersionRow, status: PolicyVersionStatus): PolicyVersionSummary {
  return {
    id: r.id,
    version: r.version,
    status,
    effectiveFromWeek: r.effectiveFromWeek,
    publishedAt: r.publishedAt ? iso(r.publishedAt) : null,
    publishedBy: r.publishedBy,
  };
}

async function rulesOf(db: Db, versionId: string): Promise<RuleInput[]> {
  return (
    await db
      .select()
      .from(rules)
      .where(eq(rules.policyVersionId, versionId))
      .orderBy(asc(rules.order))
      .all()
  ).map((r) => ({
    key: r.key as RuleInput['key'],
    ruleType: r.ruleType,
    label: r.label,
    weight: r.weight,
    order: r.order,
    enabled: r.enabled,
    config: r.configJson,
  }));
}

async function guardrailIssues(
  db: Db,
  siteId: string,
  ruleList: RuleInput[],
): Promise<PolicyIssue[]> {
  const { settings } = await loadSite(db, siteId);
  return validatePolicy(ruleList, settings.maxFactorWeightPercent);
}

export async function getPolicy(db: Db, siteId: string, now: Date) {
  const policy = await sitePolicy(db, siteId);
  const site = await loadSite(db, siteId);
  const rows = await versionRows(db, policy.id);
  const status = statuses(rows, await currentWeekFor(db, siteId, now));
  const next = nextWeeklyRound(now, site.timezone, site.settings.rounds.weekly);
  return {
    id: policy.id,
    name: policy.name,
    versions: rows.map((r) => summary(r, status.get(r.id)!)),
    maxFactorWeightPercent: site.settings.maxFactorWeightPercent,
    nextWeeklyRound: { runAt: next.runAt.toISOString(), targetWeek: next.targetWeek },
  };
}

async function versionRow(db: Db, siteId: string, version: number): Promise<VersionRow> {
  const policy = await sitePolicy(db, siteId);
  const row = await db
    .select()
    .from(policyVersions)
    .where(and(eq(policyVersions.policyId, policy.id), eq(policyVersions.version, version)))
    .get();
  if (!row) throw notFound(`Policy version ${version}`);
  return row;
}

export async function getPolicyVersion(
  db: Db,
  siteId: string,
  version: number,
  now: Date,
): Promise<PolicyVersionDetail> {
  const row = await versionRow(db, siteId, version);
  const status = statuses(
    await versionRows(db, row.policyId),
    await currentWeekFor(db, siteId, now),
  );
  const ruleList = await rulesOf(db, row.id);
  return {
    ...summary(row, status.get(row.id)!),
    rules: ruleList,
    plainLanguage:
      row.plainLanguage ??
      describePolicy(ruleList, { version: row.version, effectiveFromWeek: row.effectiveFromWeek }),
    issues: await guardrailIssues(db, siteId, ruleList),
  };
}

async function draftRow(db: Db, siteId: string, version: number): Promise<VersionRow> {
  const row = await versionRow(db, siteId, version);
  if (row.publishedAt) {
    throw conflict(`Version ${version} is published and cannot be changed. Create a new draft.`);
  }
  return row;
}

export async function createDraft(db: Db, actor: Actor, now: Date): Promise<PolicyVersionDetail> {
  const policy = await sitePolicy(db, actor.siteId);
  const rows = await versionRows(db, policy.id);
  const existing = rows.find((r) => !r.publishedAt);
  if (existing)
    throw conflict(`Draft version ${existing.version} already exists. Edit or discard it first.`);
  const latest = rows[0];
  const copied = latest ? await rulesOf(db, latest.id) : [];
  const version = (latest?.version ?? 0) + 1;
  await db.transaction(async (tx) => {
    const created = await tx
      .insert(policyVersions)
      .values({ policyId: policy.id, version, createdAt: now })
      .returning({ id: policyVersions.id })
      .get();
    if (copied.length) {
      await tx
        .insert(rules)
        .values(copied.map((r) => ({ ...toRow(r), policyVersionId: created.id })))
        .run();
    }
    await writeAudit(
      tx,
      {
        siteId: actor.siteId,
        actorId: actor.id,
        action: 'policy.draft.create',
        entity: 'policy_version',
        entityId: created.id,
        after: { version, copiedFrom: latest?.version ?? null },
      },
      now,
    );
  });
  return await getPolicyVersion(db, actor.siteId, version, now);
}

const toRow = (r: RuleInput) => ({
  ruleType: r.ruleType,
  key: r.key,
  label: r.label,
  configJson: r.config,
  weight: r.weight,
  order: r.order,
  enabled: r.enabled,
});

export async function updateDraftRules(
  db: Db,
  actor: Actor,
  version: number,
  ruleList: RuleInput[],
  now: Date,
): Promise<PolicyVersionDetail> {
  const row = await draftRow(db, actor.siteId, version);
  const before = await rulesOf(db, row.id);
  await db.transaction(async (tx) => {
    await tx.delete(rules).where(eq(rules.policyVersionId, row.id)).run();
    if (ruleList.length) {
      await tx
        .insert(rules)
        .values(ruleList.map((r) => ({ ...toRow(r), policyVersionId: row.id })))
        .run();
    }
    await writeAudit(
      tx,
      {
        siteId: actor.siteId,
        actorId: actor.id,
        action: 'policy.draft.update',
        entity: 'policy_version',
        entityId: row.id,
        before,
        after: ruleList,
      },
      now,
    );
  });
  return await getPolicyVersion(db, actor.siteId, version, now);
}

export async function discardDraft(
  db: Db,
  actor: Actor,
  version: number,
  now: Date,
): Promise<void> {
  const row = await draftRow(db, actor.siteId, version);
  const before = await rulesOf(db, row.id);
  await db.transaction(async (tx) => {
    await tx.delete(rules).where(eq(rules.policyVersionId, row.id)).run();
    await tx
      .delete(policyVersions)
      .where(and(eq(policyVersions.id, row.id), isNull(policyVersions.publishedAt)))
      .run();
    await writeAudit(
      tx,
      {
        siteId: actor.siteId,
        actorId: actor.id,
        action: 'policy.draft.discard',
        entity: 'policy_version',
        entityId: row.id,
        before: { version, rules: before },
      },
      now,
    );
  });
}

export async function publishDraft(
  db: Db,
  actor: Actor,
  version: number,
  reason: string,
  now: Date,
): Promise<PolicyVersionDetail> {
  const row = await draftRow(db, actor.siteId, version);
  const ruleList = await rulesOf(db, row.id);
  const issues = await guardrailIssues(db, actor.siteId, ruleList);
  if (issues.length > 0) {
    throw businessRule(issues[0]!.code, issues[0]!.message, { issues });
  }
  const feasibility = await checkFeasibility(db, actor.siteId, ruleList);
  if (feasibility.blocking) {
    const blocked = feasibility.items.flatMap((i) =>
      i.issues.filter((x) => x.severity === 'block').map((x) => ({ ...x, ruleKey: i.key })),
    );
    throw businessRule('RULE_FEASIBILITY_BLOCKED', blocked[0]!.message, { issues: blocked });
  }
  const site = await loadSite(db, actor.siteId);
  const { targetWeek } = nextWeeklyRound(now, site.timezone, site.settings.rounds.weekly);
  const plainLanguage = describePolicy(ruleList, { version, effectiveFromWeek: targetWeek });
  await db.transaction(async (tx) => {
    await tx
      .update(policyVersions)
      .set({
        effectiveFromWeek: targetWeek,
        publishedAt: now,
        publishedBy: actor.id,
        plainLanguage,
      })
      .where(and(eq(policyVersions.id, row.id), isNull(policyVersions.publishedAt)))
      .run();
    await writeAudit(
      tx,
      {
        siteId: actor.siteId,
        actorId: actor.id,
        action: 'policy.publish',
        entity: 'policy_version',
        entityId: row.id,
        after: { version, effectiveFromWeek: targetWeek, rules: ruleList },
        reason,
      },
      now,
    );
  });
  return await getPolicyVersion(db, actor.siteId, version, now);
}

/** The policy in force this week, in plain language, for every employee. */
export async function getCurrentPolicy(
  db: Db,
  siteId: string,
  now: Date,
): Promise<CurrentPolicyResponse> {
  const policy = await sitePolicy(db, siteId);
  const rows = await versionRows(db, policy.id);
  const status = statuses(rows, await currentWeekFor(db, siteId, now));
  const active = rows.find((r) => status.get(r.id) === 'active');
  if (!active) throw notFound('Policy in force');
  const ruleList = (await rulesOf(db, active.id)).filter((r) => r.enabled);
  return {
    version: active.version,
    effectiveFromWeek: active.effectiveFromWeek!,
    plainLanguage:
      active.plainLanguage ??
      describePolicy(ruleList, {
        version: active.version,
        effectiveFromWeek: active.effectiveFromWeek,
      }),
    rules: ruleList.map((r) => ({
      key: r.key,
      label: r.label,
      ruleType: r.ruleType,
      weight: r.weight,
    })),
  };
}

/**
 * The published version in force for the week starting `week` (a Monday), with its
 * rules. Rounds use this, so a policy published mid-week never changes a round for
 * the current week (non-negotiable #8).
 */
export async function policyVersionForWeek(db: Db, siteId: string, week: string) {
  const policy = await sitePolicy(db, siteId);
  const rows = await versionRows(db, policy.id);
  const active = rows.find((r) => statuses(rows, week).get(r.id) === 'active');
  if (!active) throw notFound(`Policy in force for the week of ${week}`);
  return { version: active, rules: await rulesOf(db, active.id) };
}
