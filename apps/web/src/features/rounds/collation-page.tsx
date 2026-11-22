import { formatDayShort } from '@parksmart/shared';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, Td, Th } from '@/components/ui/table';
import { useCollation } from '@/lib/admin-api';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

/** /admin/collation (FR-7): requests vs supply by day and bay type. */
export function CollationPage() {
  const { t } = useTranslation();
  const collation = useCollation(undefined, 10);
  const days = collation.data?.days ?? [];
  const types = days[0]?.cells.map((c) => c.bayType) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t('rounds.collationTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('rounds.collationHint')}</p>
      </div>
      {collation.isError && <Alert tone="error">{errorMessage(collation.error)}</Alert>}
      {types.map((type) => (
        <Card key={type}>
          <CardHeader>
            <CardTitle>{t(`bayTypes.${type}`)}</CardTitle>
            <CardDescription>{t('rounds.ratioHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <thead>
                <tr>
                  <Th>{t('rounds.day')}</Th>
                  <Th className="text-right">{t('rounds.requests')}</Th>
                  <Th className="text-right">{t('rounds.supply')}</Th>
                  <Th className="text-right">{t('rounds.held')}</Th>
                  <Th className="text-right">{t('rounds.ratio')}</Th>
                  <Th className="text-right">{t('rounds.confirmed')}</Th>
                  <Th className="text-right">{t('rounds.waitlisted')}</Th>
                  <Th className="text-right">{t('rounds.forecast')}</Th>
                  <Th>{t('rounds.roundsCol')}</Th>
                </tr>
              </thead>
              <tbody>
                {days.map((day) => {
                  const c = day.cells.find((x) => x.bayType === type)!;
                  const ratio = c.oversubscription;
                  return (
                    <tr key={day.date}>
                      <Td className="whitespace-nowrap font-medium">{formatDayShort(day.date)}</Td>
                      <Td className="text-right">{c.requests}</Td>
                      <Td className="text-right">{c.supply}</Td>
                      <Td className="text-right">{c.heldForSameDay}</Td>
                      <Td className="text-right">
                        <span
                          className={cn(
                            'rounded px-1.5 py-0.5',
                            ratio !== null && ratio > 1 && 'bg-destructive/15 text-destructive',
                            ratio !== null && ratio > 0.8 && ratio <= 1 && 'bg-amber-500/15',
                          )}
                        >
                          {ratio === null ? '—' : `${ratio.toFixed(2)}×`}
                        </span>
                      </Td>
                      <Td className="text-right">{c.confirmed}</Td>
                      <Td className="text-right">{c.waitlisted}</Td>
                      <Td className="text-right">
                        {c.forecastRemaining === null ? '—' : `+${c.forecastRemaining}`}
                      </Td>
                      <Td>
                        <div className="flex flex-wrap gap-1">
                          {day.rounds.map((r) => (
                            <Badge
                              key={r.id}
                              variant={r.status === 'published' ? 'success' : 'warning'}
                            >
                              {t(`booking.round.${r.roundType}`)}
                            </Badge>
                          ))}
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
