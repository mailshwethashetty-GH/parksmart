import type { FeasibilityResponse, RuleInput } from '@parksmart/shared';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox, Input, Textarea } from '@/components/ui/input';
import { Table, Td, Th } from '@/components/ui/table';
import { cn } from '@/lib/utils';

type Props = {
  rules: RuleInput[];
  onChange?: (rules: RuleInput[]) => void;
  feasibility?: FeasibilityResponse;
  maxFactor: number;
};

const NEUTRAL_KEYS = new Set([
  'business_need',
  'no_show_history',
  'commute_distance',
  'client_facing',
  'seniority',
]);

/** Rule table. Editable when `onChange` is given (drafts), read-only otherwise. */
export function RuleEditor({ rules, onChange, feasibility, maxFactor }: Props) {
  const { t } = useTranslation();
  const editable = !!onChange;
  const sorted = [...rules].sort((a, b) => a.order - b.order);
  const update = (key: string, patch: Partial<RuleInput>) =>
    onChange?.(rules.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const setConfig = (
    rule: RuleInput,
    field: string,
    raw: string,
    kind: 'number' | 'text' = 'number',
  ) => {
    const config = { ...rule.config };
    if (raw === '') delete config[field];
    else config[field] = kind === 'number' ? Number(raw) : raw;
    update(rule.key, { config });
  };
  const move = (index: number, delta: number) => {
    const target = sorted[index + delta];
    const current = sorted[index];
    if (!target || !current) return;
    onChange?.(
      rules.map((r) =>
        r.key === current.key
          ? { ...r, order: target.order }
          : r.key === target.key
            ? { ...r, order: current.order }
            : r,
      ),
    );
  };
  const feasibilityOf = (key: string) => feasibility?.items.find((i) => i.key === key);
  const total = rules
    .filter((r) => r.enabled && r.ruleType === 'weighted')
    .reduce((sum, r) => sum + (r.weight ?? 0), 0);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-sm" aria-live="polite">
        <span className="text-muted-foreground">{t('policy.totalWeight')}</span>
        <Badge variant={Math.abs(total - 100) < 1e-9 ? 'success' : 'destructive'}>{total}%</Badge>
        <span className="text-muted-foreground">{t('policy.totalHint', { max: maxFactor })}</span>
      </div>
      <Table>
        <thead>
          <tr>
            {editable && <Th className="w-16">{t('policy.order')}</Th>}
            <Th className="w-12">{t('policy.on')}</Th>
            <Th>{t('policy.rule')}</Th>
            <Th className="w-28">{t('policy.weight')}</Th>
            <Th className="w-48">{t('policy.settings')}</Th>
            <Th>{t('policy.feasibility')}</Th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((rule, i) => {
            const f = feasibilityOf(rule.key);
            const overCap = rule.ruleType === 'weighted' && (rule.weight ?? 0) > maxFactor;
            return (
              <tr key={rule.key} className={cn(!rule.enabled && 'text-muted-foreground')}>
                {editable && (
                  <Td>
                    <div className="flex">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={t('policy.moveUp')}
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      >
                        ↑
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={t('policy.moveDown')}
                        disabled={i === sorted.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        ↓
                      </Button>
                    </div>
                  </Td>
                )}
                <Td>
                  <Checkbox
                    aria-label={t('policy.enable', { rule: rule.label })}
                    checked={rule.enabled}
                    disabled={!editable}
                    onChange={(e) => update(rule.key, { enabled: e.target.checked })}
                  />
                </Td>
                <Td>
                  <div className="font-medium">{rule.label}</div>
                  <Badge variant="outline" className="mt-1">
                    {t(`ruleTypes.${rule.ruleType}`)}
                  </Badge>
                </Td>
                <Td>
                  {rule.ruleType === 'weighted' ? (
                    editable ? (
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        className="min-w-20"
                        aria-label={t('policy.weightFor', { rule: rule.label })}
                        aria-invalid={overCap || undefined}
                        value={rule.weight ?? 0}
                        onChange={(e) => update(rule.key, { weight: Number(e.target.value) })}
                      />
                    ) : (
                      `${rule.weight}%`
                    )
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </Td>
                <Td>
                  <RuleSettings rule={rule} editable={editable} setConfig={setConfig} />
                </Td>
                <Td>
                  {f && (
                    <div className="flex flex-col gap-1">
                      <div className="flex flex-wrap gap-1">
                        {f.coverage !== null && (
                          <Badge variant={f.coverage >= 0.9 ? 'success' : 'warning'}>
                            {t('policy.coverage', { pct: Math.round(f.coverage * 100) })}
                          </Badge>
                        )}
                        <Badge variant={f.privacyClass === 'sensitive' ? 'warning' : 'secondary'}>
                          {t(`privacy.${f.privacyClass}`)}
                        </Badge>
                        {f.gamingRisk !== 'low' && (
                          <Badge variant="warning">{t(`gaming.${f.gamingRisk}`)}</Badge>
                        )}
                      </div>
                      {f.issues.map((issue) => (
                        <p
                          key={issue.code}
                          className={cn(
                            'text-xs',
                            issue.severity === 'block'
                              ? 'text-destructive'
                              : 'text-muted-foreground',
                          )}
                        >
                          {issue.severity === 'block' ? '⛔ ' : ''}
                          {issue.message}
                        </p>
                      ))}
                    </div>
                  )}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}

function RuleSettings({
  rule,
  editable,
  setConfig,
}: {
  rule: RuleInput;
  editable: boolean;
  setConfig: (rule: RuleInput, field: string, raw: string, kind?: 'number' | 'text') => void;
}) {
  const { t } = useTranslation();
  const numberField = (
    field: string,
    label: string,
    props: { min: number; max: number; step?: number },
  ) => {
    const value = rule.config[field];
    return (
      <label className="flex items-center justify-between gap-2 text-xs">
        <span>{label}</span>
        {editable ? (
          <Input
            type="number"
            className="h-7 w-20"
            {...props}
            value={typeof value === 'number' ? value : ''}
            onChange={(e) => setConfig(rule, field, e.target.value)}
          />
        ) : (
          <span>{typeof value === 'number' ? value : '—'}</span>
        )}
      </label>
    );
  };
  return (
    <div className="flex flex-col gap-1">
      {NEUTRAL_KEYS.has(rule.key) &&
        numberField('missing', t('policy.neutral'), { min: 0, max: 1, step: 0.1 })}
      {rule.key === 'business_need' &&
        numberField('spotCheckPercent', t('policy.spotCheck'), { min: 0, max: 100 })}
      {rule.key === 'peak_day_cap' &&
        numberField('maxDays', t('policy.maxDays'), { min: 1, max: 7 })}
      {(rule.key === 'rolling_fairness' || rule.key === 'no_show_history') &&
        numberField('lookbackWeeks', t('policy.lookback'), { min: 1, max: 12 })}
      {rule.key === 'accessibility_reservation' && (
        <label className="flex flex-col gap-1 text-xs">
          <span>{t('policy.purpose')}</span>
          {editable ? (
            <Textarea
              className="min-h-14 text-xs"
              maxLength={300}
              value={typeof rule.config.purpose === 'string' ? rule.config.purpose : ''}
              onChange={(e) => setConfig(rule, 'purpose', e.target.value, 'text')}
            />
          ) : (
            <span>{typeof rule.config.purpose === 'string' ? rule.config.purpose : '—'}</span>
          )}
        </label>
      )}
    </div>
  );
}
