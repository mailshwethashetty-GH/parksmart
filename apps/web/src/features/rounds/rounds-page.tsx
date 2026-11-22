import { formatDayShort, formatSiteTime } from '@parksmart/shared';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, Td, Th } from '@/components/ui/table';
import { useRounds, useSite } from '@/lib/admin-api';
import { errorMessage } from '@/lib/api';

/** /admin/rounds: every round with its status. Review and approval arrive in M5 (FR-16). */
export function RoundsPage() {
  const { t } = useTranslation();
  const rounds = useRounds();
  const site = useSite();
  const tz = site.data?.timezone ?? 'Asia/Kolkata';
  const items = rounds.data?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t('rounds.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('rounds.hint')}</p>
      </div>
      {rounds.isError && <Alert tone="error">{errorMessage(rounds.error)}</Alert>}
      <Card>
        <CardHeader>
          <CardTitle>{t('rounds.recent')}</CardTitle>
          <CardDescription>{t('rounds.reviewSoon')}</CardDescription>
        </CardHeader>
        <CardContent>
          {items.length === 0 && rounds.isSuccess && (
            <p className="text-sm text-muted-foreground">{t('rounds.none')}</p>
          )}
          {items.length > 0 && (
            <Table>
              <thead>
                <tr>
                  <Th>{t('rounds.type')}</Th>
                  <Th>{t('rounds.days')}</Th>
                  <Th>{t('rounds.ran')}</Th>
                  <Th>{t('rounds.statusCol')}</Th>
                  <Th className="text-right">{t('rounds.confirmed')}</Th>
                  <Th className="text-right">{t('rounds.waitlisted')}</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id}>
                    <Td>
                      <Link to={`/admin/rounds/${r.id}`} className="font-medium hover:underline">
                        {t(`booking.round.${r.roundType}`)}
                      </Link>
                    </Td>
                    <Td className="whitespace-nowrap">
                      {formatDayShort(r.targetDateFrom)}
                      {r.targetDateTo !== r.targetDateFrom &&
                        ` – ${formatDayShort(r.targetDateTo)}`}
                    </Td>
                    <Td className="whitespace-nowrap">{r.runAt && formatSiteTime(r.runAt, tz)}</Td>
                    <Td>
                      {r.status === 'pending_review' ? (
                        <Badge variant={r.delayed ? 'destructive' : 'warning'}>
                          {r.delayed ? t('rounds.delayed') : t('rounds.pending')}
                        </Badge>
                      ) : (
                        <Badge variant="success">
                          {t('rounds.published')}
                          {r.publishMode &&
                            r.publishMode !== 'admin' &&
                            ` · ${t(`rounds.mode.${r.publishMode}`)}`}
                        </Badge>
                      )}
                    </Td>
                    <Td className="text-right">{r.counts.confirmed}</Td>
                    <Td className="text-right">{r.counts.waitlisted}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
