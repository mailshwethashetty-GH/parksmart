import { formatIsoDate, type PolicyVersionDetail, type RuleInput } from '@parksmart/shared';
import { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/input';
import {
  useCreateDraft,
  useDiscardDraft,
  useFeasibility,
  usePolicy,
  usePolicyVersion,
  usePublishDraft,
  useSaveDraftRules,
} from '@/lib/admin-api';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { RuleEditor } from './rule-editor';

const STATUS_VARIANT = {
  draft: 'warning',
  scheduled: 'default',
  active: 'success',
  superseded: 'secondary',
} as const;

/** /admin/policy (FR-8, FR-9, FR-11, FR-12). */
export function PolicyPage() {
  const { t } = useTranslation();
  const policy = usePolicy();
  const createDraft = useCreateDraft();
  const versions = policy.data?.versions ?? [];
  const [selected, setSelected] = useState<number | undefined>();
  const current =
    selected ?? versions.find((v) => v.status === 'draft')?.version ?? versions[0]?.version;
  const detail = usePolicyVersion(current);
  const hasDraft = versions.some((v) => v.status === 'draft');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('policy.title')}</h1>
          {policy.data && (
            <p className="text-sm text-muted-foreground">
              {t('policy.nextRound', {
                week: formatIsoDate(policy.data.nextWeeklyRound.targetWeek),
              })}
            </p>
          )}
        </div>
        {!hasDraft && (
          <Button
            disabled={createDraft.isPending}
            onClick={() =>
              createDraft.mutate(undefined, { onSuccess: (d) => setSelected(d.version) })
            }
          >
            {t('policy.newDraft')}
          </Button>
        )}
      </div>
      {createDraft.isError && <Alert tone="error">{errorMessage(createDraft.error)}</Alert>}

      <nav aria-label={t('policy.versions')} className="flex flex-wrap gap-2">
        {versions.map((v) => (
          <button
            key={v.id}
            onClick={() => setSelected(v.version)}
            aria-current={v.version === current ? 'true' : undefined}
            className={cn(
              'flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm',
              v.version === current ? 'border-primary bg-secondary' : 'hover:bg-secondary',
            )}
          >
            v{v.version}
            <Badge variant={STATUS_VARIANT[v.status]}>{t(`policy.status.${v.status}`)}</Badge>
          </button>
        ))}
      </nav>

      {detail.data &&
        (detail.data.status === 'draft' ? (
          <DraftEditor
            key={detail.data.id}
            version={detail.data}
            maxFactor={policy.data?.maxFactorWeightPercent ?? 50}
            targetWeek={policy.data?.nextWeeklyRound.targetWeek}
            onGone={() => setSelected(undefined)}
          />
        ) : (
          <PublishedVersion
            version={detail.data}
            maxFactor={policy.data?.maxFactorWeightPercent ?? 50}
          />
        ))}
    </div>
  );
}

function PublishedVersion({
  version,
  maxFactor,
}: {
  version: PolicyVersionDetail;
  maxFactor: number;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>v{version.version}</CardTitle>
          <CardDescription>
            {version.effectiveFromWeek &&
              t('policy.effectiveFrom', { week: formatIsoDate(version.effectiveFromWeek) })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RuleEditor rules={version.rules} maxFactor={maxFactor} />
        </CardContent>
      </Card>
      <PlainLanguage text={version.plainLanguage} />
    </div>
  );
}

function DraftEditor({
  version,
  maxFactor,
  targetWeek,
  onGone,
}: {
  version: PolicyVersionDetail;
  maxFactor: number;
  targetWeek?: string;
  onGone: () => void;
}) {
  const { t } = useTranslation();
  const [rules, setRules] = useState<RuleInput[]>(version.rules);
  const [reason, setReason] = useState('');
  const save = useSaveDraftRules(version.version);
  const discard = useDiscardDraft();
  const publish = usePublishDraft(version.version);
  const deferred = useDeferredValue(rules);
  const feasibility = useFeasibility(deferred);
  const dirty = canonical(rules) !== canonical(version.rules);

  const blocking = version.issues.length > 0 || feasibility.data?.blocking;

  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>{t('policy.draftTitle', { v: version.version })}</CardTitle>
          <CardDescription>{t('policy.draftHint')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <RuleEditor
            rules={rules}
            onChange={setRules}
            feasibility={feasibility.data}
            maxFactor={maxFactor}
          />
          {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
          {!dirty && version.issues.length > 0 && (
            <Alert tone="error">
              <ul className="list-disc pl-4">
                {version.issues.map((i) => (
                  <li key={`${i.code}-${i.ruleKey ?? ''}`}>{i.message}</li>
                ))}
              </ul>
            </Alert>
          )}
          <div className="flex flex-wrap gap-2">
            <Button disabled={!dirty || save.isPending} onClick={() => save.mutate(rules)}>
              {t('policy.saveDraft')}
            </Button>
            <Button variant="outline" disabled={!dirty} onClick={() => setRules(version.rules)}>
              {t('policy.undo')}
            </Button>
            <Button
              variant="ghost"
              className="text-destructive"
              disabled={discard.isPending}
              onClick={() => {
                if (window.confirm(t('policy.discardConfirm')))
                  discard.mutate(version.version, { onSuccess: onGone });
              }}
            >
              {t('policy.discard')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>{t('policy.publish')}</CardTitle>
            <CardDescription>
              {targetWeek && t('policy.publishHint', { week: formatIsoDate(targetWeek) })}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <label htmlFor="publish-reason" className="text-sm font-medium">
              {t('policy.reason')}
            </label>
            <Textarea
              id="publish-reason"
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('policy.reasonPlaceholder')}
            />
            {dirty && <Alert tone="warning">{t('policy.saveFirst')}</Alert>}
            {!dirty && blocking && <Alert tone="warning">{t('policy.blocked')}</Alert>}
            {publish.isError && <Alert tone="error">{errorMessage(publish.error)}</Alert>}
            <Button
              disabled={dirty || !!blocking || reason.trim().length < 3 || publish.isPending}
              onClick={() => publish.mutate(reason.trim())}
            >
              {t('policy.publishButton')}
            </Button>
          </CardContent>
        </Card>
        <PlainLanguage text={version.plainLanguage} />
      </div>
    </div>
  );
}

function PlainLanguage({ text }: { text: string }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('policy.employeesSee')}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm whitespace-pre-line">{text}</p>
      </CardContent>
    </Card>
  );
}

/** Order-independent comparison of rule lists (array order and config key order ignored). */
function canonical(rules: RuleInput[]): string {
  const sortKeys = (value: unknown): unknown =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, sortKeys(v)]),
        )
      : value;
  return JSON.stringify([...rules].sort((a, b) => a.key.localeCompare(b.key)).map(sortKeys));
}
