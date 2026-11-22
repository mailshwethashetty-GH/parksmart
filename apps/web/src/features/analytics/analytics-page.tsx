import { formatDayShort, siteLocalDate } from '@parksmart/shared';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, Td, Th } from '@/components/ui/table';
import { useMonthlyReport } from '@/lib/admin-api';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { UtilisationChart } from './utilisation-chart';

const pct = (x: number | null | undefined) =>
  x === null || x === undefined ? '—' : `${Math.round(x * 1000) / 10}%`;

/** On target / off target: status is icon + label, never color alone. */
function Status({ ok }: { ok: boolean | null }) {
  const { t } = useTranslation();
  if (ok === null)
    return <span className="text-xs text-muted-foreground">{t('analytics.noData')}</span>;
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
        {ok ? (
          <path
            d="M2 6.5 5 9.5 10 3"
            fill="none"
            stroke="var(--viz-good)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <path
            d="M3 3 9 9M9 3 3 9"
            fill="none"
            stroke="var(--viz-critical)"
            strokeWidth="2"
            strokeLinecap="round"
          />
        )}
      </svg>
      {ok ? t('analytics.onTarget') : t('analytics.offTarget')}
    </span>
  );
}

function Tile({
  label,
  value,
  target,
  ok,
  hero,
}: {
  label: string;
  value: ReactNode;
  target: string;
  ok: boolean | null;
  hero?: boolean;
}) {
  return (
    <Card className={cn('flex flex-col gap-1 p-4', hero && 'sm:col-span-2')}>
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn('font-semibold', hero ? 'text-5xl' : 'text-2xl')}>{value}</span>
      <span className="text-xs text-muted-foreground">{target}</span>
      <Status ok={ok} />
    </Card>
  );
}

/** /admin/analytics (FR-28): pilot metrics for a month, daily utilisation, CSV export. */
export function AnalyticsPage() {
  const { t } = useTranslation();
  const [month, setMonth] = useState(() => siteLocalDate(new Date(), 'Asia/Kolkata').slice(0, 7));
  const report = useMonthlyReport(month);
  const [showTable, setShowTable] = useState(false);
  const m = report.data?.metrics;
  const okIf = (x: number | null | undefined, test: (v: number) => boolean) =>
    x === null || x === undefined ? null : test(x);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t('analytics.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('analytics.hint')}</p>
      </div>
      {/* Filters: one row, above everything they scope. */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t('analytics.month')}
          <Input
            type="month"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            className="w-44"
          />
        </label>
        <Button asChild variant="outline">
          <a href={`/api/v1/admin/reports/export?month=${month}`} download>
            {t('analytics.export')}
          </a>
        </Button>
      </div>
      {report.isError && <Alert tone="error">{errorMessage(report.error)}</Alert>}

      {m && (
        <div
          className={cn(
            'flex flex-col gap-4 transition-opacity',
            report.isPlaceholderData && 'opacity-60',
          )}
        >
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Tile
              hero
              label={t('analytics.peakUtil')}
              value={pct(m.peakUtilisation)}
              target={t('analytics.peakTarget')}
              ok={okIf(m.peakUtilisation, (v) => v > 0.9)}
            />
            <Tile
              label={t('analytics.noShows')}
              value={pct(m.noShowRate)}
              target={t('analytics.noShowTarget')}
              ok={okIf(m.noShowRate, (v) => v < 0.05)}
            />
            <Tile
              label={t('analytics.fairness')}
              value={
                m.fairness.employees ? `${m.fairness.belowTarget} / ${m.fairness.employees}` : '—'
              }
              target={t('analytics.fairnessTarget')}
              ok={m.fairness.employees ? m.fairness.belowTarget === 0 : null}
            />
            <Tile
              label={t('analytics.overrides')}
              value={pct(m.overrideRate)}
              target={t('analytics.overrideTarget')}
              ok={okIf(m.overrideRate, (v) => v < 0.02)}
            />
            <Tile
              label={t('analytics.adoption')}
              value={pct(m.adoption.share)}
              target={t('analytics.adoptionTarget')}
              ok={okIf(m.adoption.share, (v) => v > 0.7)}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t('analytics.dailyTitle')}</CardTitle>
              <CardDescription>
                {t('analytics.dailyHint', { bays: report.data!.activeBays })}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <UtilisationChart days={report.data!.days} />
              <Button
                variant="ghost"
                size="sm"
                className="w-fit"
                aria-expanded={showTable}
                onClick={() => setShowTable((s) => !s)}
              >
                {showTable ? t('analytics.hideTable') : t('analytics.showTable')}
              </Button>
              {showTable && (
                <Table>
                  <thead>
                    <tr>
                      <Th>{t('analytics.day')}</Th>
                      <Th className="text-right">{t('analytics.requests')}</Th>
                      <Th className="text-right">{t('analytics.bookings')}</Th>
                      <Th className="text-right">{t('analytics.checkedIn')}</Th>
                      <Th className="text-right">{t('analytics.released')}</Th>
                      <Th className="text-right">{t('analytics.utilisation')}</Th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {report.data!.days.map((d) => (
                      <tr key={d.date}>
                        <Td>
                          {formatDayShort(d.date)}
                          {d.peak && (
                            <span className="text-muted-foreground">
                              {' '}
                              · {t('analytics.peakDay')}
                            </span>
                          )}
                        </Td>
                        <Td className="text-right">{d.requests}</Td>
                        <Td className="text-right">{d.confirmed}</Td>
                        <Td className="text-right">{d.checkedIn}</Td>
                        <Td className="text-right">{d.autoReleased}</Td>
                        <Td className="text-right">{pct(d.utilisation)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
