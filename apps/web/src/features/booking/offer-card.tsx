import { formatDayShort } from '@parksmart/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/api';
import { useAcceptOffer, useDeclineOffer } from '@/lib/request-api';

function useSecondsLeft(expiresAt: string): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
}

/** A same-day offer with a live countdown (FR-20). */
export function OfferCard({
  date,
  offer,
}: {
  date: string;
  offer: { id: string; bayCode: string; expiresAt: string };
}) {
  const { t } = useTranslation();
  const accept = useAcceptOffer();
  const decline = useDeclineOffer();
  const left = useSecondsLeft(offer.expiresAt);
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, '0');
  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-primary p-3"
      role="region"
      aria-label={t('booking.offerTitle')}
    >
      <p className="font-medium">
        {t('booking.offerBody', { day: formatDayShort(date), bay: offer.bayCode })}
      </p>
      {/* Not a live region: a per-second countdown would flood screen readers. */}
      <p className="text-sm text-muted-foreground">
        {left > 0 ? t('booking.offerLeft', { time: `${mm}:${ss}` }) : t('booking.offerExpired')}
      </p>
      {(accept.isError || decline.isError) && (
        <Alert tone="error">{errorMessage(accept.error ?? decline.error)}</Alert>
      )}
      <div className="flex gap-2">
        <Button disabled={left === 0 || accept.isPending} onClick={() => accept.mutate(offer.id)}>
          {t('booking.accept')}
        </Button>
        <Button
          variant="outline"
          disabled={left === 0 || decline.isPending}
          onClick={() => decline.mutate(offer.id)}
        >
          {t('booking.decline')}
        </Button>
      </div>
    </div>
  );
}
