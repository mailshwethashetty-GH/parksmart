import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { errorMessage } from '@/lib/api';
import { useBayCheckin } from '@/lib/checkin-api';

/** /app/checkin?bay=… — opened by scanning the sticker on a bay (FR-21, method qr_bay). */
export function BayCheckinPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('bay') ?? '';
  const checkin = useBayCheckin();
  const sent = useRef(false);

  // Check in once on arrival; the mutation is idempotent on the server anyway.
  useEffect(() => {
    if (token && !sent.current) {
      sent.current = true;
      checkin.mutate(token);
    }
  }, [token, checkin]);

  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <CardTitle>{t('checkin.bayTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3" aria-live="polite">
        {!token && <Alert tone="error">{t('checkin.noToken')}</Alert>}
        {checkin.isPending && (
          <p className="text-sm text-muted-foreground">{t('checkin.checking')}</p>
        )}
        {checkin.isSuccess && (
          <Alert tone="success">
            {checkin.data.alreadyCheckedIn ? t('checkin.already') : t('checkin.done')}{' '}
            {t('checkin.bayLine', {
              bay: checkin.data.booking.bayCode,
              zone: checkin.data.booking.zoneName,
            })}
          </Alert>
        )}
        {checkin.isError && <Alert tone="error">{errorMessage(checkin.error)}</Alert>}
        <Button asChild variant="outline" className="w-fit">
          <Link to="/app">{t('checkin.back')}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
