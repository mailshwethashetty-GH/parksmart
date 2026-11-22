import {
  ARRIVAL_WINDOWS,
  formatDayShort,
  WEEKDAY_NAMES,
  type ArrivalWindow,
  type BayType,
  type RecurringPattern,
} from '@parksmart/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Field } from '@/components/field';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, Select } from '@/components/ui/input';
import { errorMessage } from '@/lib/api';
import {
  useCalendar,
  useCreatePattern,
  usePatterns,
  useToggleSkip,
  useUpdatePattern,
} from '@/lib/request-api';

/** /app/recurring (FR-3): a weekly pattern that feeds every weekly round, with skips. */
export function RecurringPage() {
  const { t } = useTranslation();
  const patterns = usePatterns();
  const calendar = useCalendar();
  const create = useCreatePattern();
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [bayType, setBayType] = useState<BayType>('car');
  const [arrivalWindow, setArrivalWindow] = useState<ArrivalWindow>('before_9');
  const types = calendar.data?.bayTypes ?? ['car'];
  const active = (patterns.data?.items ?? []).filter((p) => p.active);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t('booking.recurringTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('booking.recurringHint')}</p>
      </div>

      {active.map((p) => (
        <PatternCard key={p.id} pattern={p} />
      ))}

      <Card>
        <CardHeader>
          <CardTitle>{t('booking.newPattern')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <fieldset>
            <legend className="mb-2 text-sm font-medium">{t('booking.weekdays')}</legend>
            <div className="flex flex-wrap gap-3">
              {WEEKDAY_NAMES.slice(0, 5).map((name, i) => (
                <label key={name} className="flex items-center gap-1.5 text-sm">
                  <Checkbox
                    checked={weekdays.includes(i + 1)}
                    onChange={(e) =>
                      setWeekdays((w) =>
                        e.target.checked ? [...w, i + 1].sort() : w.filter((d) => d !== i + 1),
                      )
                    }
                  />
                  {name}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('booking.bayType')}>
              <Select value={bayType} onChange={(e) => setBayType(e.target.value as BayType)}>
                {types.map((type) => (
                  <option key={type} value={type}>
                    {t(`bayTypes.${type}`)}
                  </option>
                ))}
              </Select>
            </Field>
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
          </div>
          {create.isError && <Alert tone="error">{errorMessage(create.error)}</Alert>}
          <Button
            className="w-fit"
            disabled={weekdays.length === 0 || create.isPending}
            onClick={() =>
              create.mutate(
                { weekdays, bayType, arrivalWindow, allowFallback: true },
                { onSuccess: () => setWeekdays([]) },
              )
            }
          >
            {t('booking.savePattern')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function PatternCard({ pattern }: { pattern: RecurringPattern }) {
  const { t } = useTranslation();
  const update = useUpdatePattern();
  const skip = useToggleSkip();
  const days = pattern.weekdays.map((d) => WEEKDAY_NAMES[d - 1]).join(', ');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('booking.everyWeek', { days })}</CardTitle>
        <CardDescription>
          {t(`bayTypes.${pattern.bayType}`)} ·{' '}
          {t(`booking.arrivalWindows.${pattern.arrivalWindow}`)}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-col divide-y text-sm">
          {pattern.upcoming.map((u) => (
            <li key={u.date} className="flex items-center justify-between gap-2 py-2">
              <span className={u.skipped ? 'text-muted-foreground line-through' : ''}>
                {formatDayShort(u.date)}
              </span>
              <span className="flex items-center gap-2">
                {u.requestStatus && (
                  <Badge variant="outline">{t(`booking.status.${u.requestStatus}`)}</Badge>
                )}
                {u.skipped && <Badge variant="secondary">{t('booking.skipped')}</Badge>}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={skip.isPending || u.requestStatus === 'allocated'}
                  onClick={() => skip.mutate({ id: pattern.id, date: u.date, skipped: u.skipped })}
                >
                  {u.skipped ? t('booking.unskip') : t('booking.skip')}
                </Button>
              </span>
            </li>
          ))}
        </ul>
        {(skip.isError || update.isError) && (
          <Alert tone="error">{errorMessage(skip.error ?? update.error)}</Alert>
        )}
        <Button
          variant="ghost"
          className="w-fit text-destructive"
          disabled={update.isPending}
          onClick={() => update.mutate({ id: pattern.id, active: false })}
        >
          {t('booking.stopPattern')}
        </Button>
      </CardContent>
    </Card>
  );
}
