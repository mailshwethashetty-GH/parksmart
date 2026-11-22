import { formatSiteTime, siteLocalDate, type EmployeeRequest } from '@parksmart/shared';
import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/api';
import { useBookingQr, useRunningLate } from '@/lib/checkin-api';

/** Check-in panel on a confirmed booking (FR-21/22): QR for today, deadline, running late. */
export function BookingCheckin({
  booking,
  date,
  timeZone,
}: {
  booking: NonNullable<EmployeeRequest['booking']>;
  date: string;
  timeZone: string;
}) {
  const { t } = useTranslation();
  const isToday = date === siteLocalDate(new Date(), timeZone);
  const [showQr, setShowQr] = useState(false);
  const qr = useBookingQr(booking.id, showQr);
  const late = useRunningLate();

  if (booking.status === 'checked_in') {
    return (
      <Badge variant="success" className="w-fit">
        {t('checkin.checkedIn', {
          time: booking.checkedInAt ? formatSiteTime(booking.checkedInAt, timeZone) : '',
        })}
      </Badge>
    );
  }
  if (booking.status === 'auto_released') {
    return <Alert tone="warning">{t('checkin.autoReleased')}</Alert>;
  }
  if (booking.status !== 'confirmed') return null;

  return (
    <div className="flex flex-col gap-2">
      {booking.checkInBy && (
        <span className="text-sm">
          {t('checkin.checkInBy', { time: formatSiteTime(booking.checkInBy, timeZone) })}
        </span>
      )}
      {isToday && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setShowQr((s) => !s)} aria-expanded={showQr}>
            {showQr ? t('checkin.hideQr') : t('checkin.showQr')}
          </Button>
          {!booking.lateExtensionUsed && (
            <Button
              size="sm"
              variant="outline"
              disabled={late.isPending}
              onClick={() => late.mutate(booking.id)}
            >
              {t('checkin.runningLate')}
            </Button>
          )}
        </div>
      )}
      {late.isError && <Alert tone="error">{errorMessage(late.error)}</Alert>}
      {showQr && qr.data && (
        <figure className="flex w-fit flex-col items-center gap-2 rounded-md border bg-white p-4">
          <QRCodeSVG value={qr.data.token} size={220} level="M" title={t('checkin.qrTitle')} />
          <figcaption className="text-xs text-slate-600">
            {t('checkin.qrHint', { bay: booking.bayCode })}
          </figcaption>
        </figure>
      )}
      {showQr && qr.isError && <Alert tone="error">{errorMessage(qr.error)}</Alert>}
    </div>
  );
}
