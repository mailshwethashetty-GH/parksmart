import { formatDayShort, formatSiteTime } from '@parksmart/shared';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { errorMessage } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useCancelBooking, useRequests, useWithdrawRequest } from '@/lib/request-api';
import { decidedByText, STATUS_VARIANT } from './labels';
import { OfferCard } from './offer-card';

/** /app: upcoming requests with status and who decides them; change or withdraw (FR-4). */
export function EmployeeHomePage() {
  const { t } = useTranslation();
  const me = useMe();
  const requests = useRequests();
  const withdraw = useWithdrawRequest();
  const location = useLocation();
  const justRequested = (location.state as { requested?: number } | null)?.requested;
  const cancel = useCancelBooking();
  const tz = me.data?.site.timezone ?? 'Asia/Kolkata';
  const items = requests.data?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('home.employeeTitle')}</h1>
          <p className="text-sm text-muted-foreground">{me.data?.site.name}</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to="/app/recurring">{t('booking.recurringTitle')}</Link>
          </Button>
          <Button asChild>
            <Link to="/app/book">{t('booking.bookCta')}</Link>
          </Button>
        </div>
      </div>
      {justRequested ? (
        <Alert tone="success">{t('booking.requestedOk', { count: justRequested })}</Alert>
      ) : null}
      {withdraw.isError && <Alert tone="error">{errorMessage(withdraw.error)}</Alert>}
      {cancel.isError && <Alert tone="error">{errorMessage(cancel.error)}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>{t('booking.upcoming')}</CardTitle>
          <CardDescription>{t('booking.upcomingHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          {items.length === 0 && requests.isSuccess && (
            <p className="text-sm text-muted-foreground">{t('booking.none')}</p>
          )}
          <ul className="flex flex-col divide-y">
            {items.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{formatDayShort(r.date)}</span>
                    <Badge variant={STATUS_VARIANT[r.status]}>
                      {t(`booking.status.${r.status}`)}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {t(`bayTypes.${r.bayType}`)} ·{' '}
                      {t(`booking.arrivalWindows.${r.arrivalWindow}`)}
                      {r.recurringPatternId ? ` · ${t('booking.fromPattern')}` : ''}
                    </span>
                  </div>
                  {r.decidedBy && (
                    <span className="text-xs text-muted-foreground">
                      {decidedByText(t, r.decidedBy, tz)}
                    </span>
                  )}
                  {r.awaitingResults && (
                    <span
                      className={
                        r.awaitingResults.delayed
                          ? 'text-xs text-amber-700 dark:text-amber-300'
                          : 'text-xs text-muted-foreground'
                      }
                    >
                      {r.awaitingResults.delayed
                        ? t('booking.resultsDelayed')
                        : r.awaitingResults.resultsBy
                          ? t('booking.awaitingResults', {
                              time: formatSiteTime(r.awaitingResults.resultsBy, tz),
                            })
                          : t('booking.awaitingResultsSoon')}
                    </span>
                  )}
                  {r.waitlistPosition && !r.offer && (
                    <span className="text-xs text-muted-foreground">
                      {t('booking.position', { n: r.waitlistPosition })}
                    </span>
                  )}
                  {r.booking && (
                    <span className="text-sm font-medium">
                      {t('booking.yourBay', { bay: r.booking.bayCode, zone: r.booking.zoneName })}
                    </span>
                  )}
                  {r.reason && (
                    <span className="max-w-prose text-sm text-muted-foreground">{r.reason}</span>
                  )}
                  {r.offer && <OfferCard date={r.date} offer={r.offer} />}
                </div>
                <div className="flex gap-1">
                  {r.editable && (
                    <Button asChild size="sm" variant="ghost">
                      <Link to={`/app/book?date=${r.date}`}>{t('booking.change')}</Link>
                    </Button>
                  )}
                  {r.booking && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      disabled={cancel.isPending}
                      onClick={() => {
                        if (window.confirm(t('booking.cancelConfirm')))
                          cancel.mutate(r.booking!.id);
                      }}
                    >
                      {t('booking.cancelBooking')}
                    </Button>
                  )}
                  {(r.status === 'requested' || r.status === 'waitlisted') && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={withdraw.isPending}
                      onClick={() => withdraw.mutate(r.id)}
                    >
                      {t('booking.withdraw')}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
