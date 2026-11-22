import {
  ARRIVAL_WINDOWS,
  formatDayShort,
  isoWeekday,
  REASON_CATEGORIES,
  type ArrivalWindow,
  type BayType,
  type CalendarDay,
  type ReasonCategory,
} from '@parksmart/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { Field } from '@/components/field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, Select } from '@/components/ui/input';
import { ApiError, errorMessage } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useCalendar, useCreateRequests } from '@/lib/request-api';
import { cn } from '@/lib/utils';
import { decidedByText } from './labels';

const LOCKED = new Set(['allocated', 'waitlisted']);

/** /app/book (FR-1): pick days, a bay type, and see which round decides each day. */
export function BookPage() {
  const { t } = useTranslation();
  const me = useMe();
  const calendar = useCalendar();
  const create = useCreateRequests();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [selected, setSelected] = useState<string[]>(() => {
    const date = params.get('date');
    return date ? [date] : [];
  });
  const [bayType, setBayType] = useState<BayType>('car');
  const [arrivalWindow, setArrivalWindow] = useState<ArrivalWindow>('before_9');
  const [reasonCategory, setReasonCategory] = useState<ReasonCategory | null>(null);
  const [typeOnly, setTypeOnly] = useState(false);

  const tz = me.data?.site.timezone ?? 'Asia/Kolkata';
  const days = calendar.data?.days ?? [];
  const types = calendar.data?.bayTypes ?? ['car'];
  const toggle = (date: string) =>
    setSelected((s) => (s.includes(date) ? s.filter((d) => d !== date) : [...s, date].sort()));
  const chosen = days.filter((d) => selected.includes(d.date) && d.open);
  const canFallback = bayType === 'ev' || bayType === 'accessible';

  const submit = () =>
    create.mutate(
      {
        dates: chosen.map((d) => d.date),
        bayType,
        arrivalWindow,
        reasonCategory,
        allowFallback: !(canFallback && typeOnly),
      },
      { onSuccess: (res) => navigate('/app', { state: { requested: res.items.length } }) },
    );

  const problems =
    create.error instanceof ApiError
      ? ((create.error.details.problems as { date: string; message: string }[] | undefined) ?? [])
      : [];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t('booking.title')}</h1>
      <Alert>{t('booking.fairness')}</Alert>
      {calendar.data?.notices.map((n) => (
        <Alert key={`${n.dateFrom}-${n.reason}`} tone="warning">
          {t('booking.notice', {
            dates:
              n.dateFrom === n.dateTo
                ? formatDayShort(n.dateFrom)
                : `${formatDayShort(n.dateFrom)} – ${formatDayShort(n.dateTo)}`,
            reason: n.reason,
          })}
        </Alert>
      ))}

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card>
          <CardHeader>
            <CardTitle>{t('booking.pickDays')}</CardTitle>
            <CardDescription>{t('booking.pickDaysHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <DayGrid days={days} selected={selected} onToggle={toggle} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('booking.details')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <fieldset>
              <legend className="mb-2 text-sm font-medium">{t('booking.bayType')}</legend>
              <div className="flex flex-wrap gap-2" role="radiogroup">
                {types.map((type) => (
                  <Button
                    key={type}
                    type="button"
                    role="radio"
                    aria-checked={bayType === type}
                    variant={bayType === type ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setBayType(type)}
                  >
                    {t(`bayTypes.${type}`)}
                  </Button>
                ))}
              </div>
            </fieldset>
            {canFallback && (
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  className="mt-0.5"
                  checked={typeOnly}
                  onChange={(e) => setTypeOnly(e.target.checked)}
                />
                <span>
                  {t('booking.typeOnly', { type: t(`bayTypes.${bayType}`) })}
                  <span className="block text-xs text-muted-foreground">
                    {t('booking.typeOnlyHint', { type: t(`bayTypes.${bayType}`) })}
                  </span>
                </span>
              </label>
            )}
            <Field label={t('booking.arrival')}>
              <Select
                value={arrivalWindow}
                onChange={(e) => setArrivalWindow(e.target.value as ArrivalWindow)}
              >
                {ARRIVAL_WINDOWS.map((w) => (
                  <option key={w} value={w}>
                    {t(`booking.arrivalWindows.${w}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('booking.reason')} hint={t('booking.reasonHint')}>
              <Select
                value={reasonCategory ?? ''}
                onChange={(e) =>
                  setReasonCategory((e.target.value || null) as ReasonCategory | null)
                }
              >
                <option value="">{t('booking.noReason')}</option>
                {REASON_CATEGORIES.map((r) => (
                  <option key={r} value={r}>
                    {t(`booking.reasons.${r}`)}
                  </option>
                ))}
              </Select>
            </Field>

            {chosen.length > 0 && (
              <div className="flex flex-col gap-1 rounded-md border p-3 text-sm" aria-live="polite">
                <p className="font-medium">{t('booking.whoDecides')}</p>
                {chosen.map((d) => (
                  <p key={d.date}>
                    <span className="font-medium">{formatDayShort(d.date)}</span>
                    {d.request?.status === 'requested' && (
                      <span className="text-muted-foreground"> ({t('booking.replaces')})</span>
                    )}
                    {d.decidedBy && (
                      <span className="block text-muted-foreground">
                        {decidedByText(t, d.decidedBy, tz)}
                      </span>
                    )}
                  </p>
                ))}
              </div>
            )}

            {create.isError && (
              <Alert tone="error">
                {problems.length ? (
                  <ul className="list-disc pl-4">
                    {problems.map((p) => (
                      <li key={p.date}>
                        {formatDayShort(p.date)}: {p.message}
                      </li>
                    ))}
                  </ul>
                ) : (
                  errorMessage(create.error)
                )}
              </Alert>
            )}
            <Button size="lg" disabled={chosen.length === 0 || create.isPending} onClick={submit}>
              {chosen.length > 1
                ? t('booking.requestMany', { count: chosen.length })
                : t('booking.requestOne')}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DayGrid({
  days,
  selected,
  onToggle,
}: {
  days: CalendarDay[];
  selected: string[];
  onToggle: (date: string) => void;
}) {
  const { t } = useTranslation();
  if (days.length === 0) return null;
  const blanks = isoWeekday(days[0]!.date) - 1;
  return (
    <div>
      <div
        className="mb-1 grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground"
        aria-hidden
      >
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: blanks }, (_, i) => (
          <span key={`b${i}`} />
        ))}
        {days.map((d) => {
          const locked = d.request && LOCKED.has(d.request.status);
          const isSelected = selected.includes(d.date);
          const day = Number(d.date.slice(8));
          return (
            <button
              key={d.date}
              type="button"
              disabled={!d.open || !!locked}
              aria-pressed={isSelected}
              aria-label={`${formatDayShort(d.date)}${d.request ? `, ${t(`booking.status.${d.request.status}`)}` : ''}${!d.open && d.closedReason ? `, ${t(`booking.closed.${d.closedReason}`)}` : ''}`}
              onClick={() => onToggle(d.date)}
              className={cn(
                'flex aspect-square flex-col items-center justify-center rounded-md border text-sm transition-colors',
                'disabled:cursor-not-allowed disabled:border-transparent disabled:text-muted-foreground/50',
                isSelected
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'hover:bg-secondary',
                locked && 'bg-emerald-600/10',
              )}
            >
              {day}
              {d.request && (
                <span
                  className={cn(
                    'mt-0.5 size-1.5 rounded-full',
                    isSelected ? 'bg-primary-foreground' : 'bg-primary',
                  )}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
