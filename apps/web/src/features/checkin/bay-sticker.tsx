import { QRCodeSVG } from 'qrcode.react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/api';
import { bayCheckinUrl, useBayQr } from '@/lib/checkin-api';

/** /admin/site/bays/:id/sticker — printable QR sticker for a bay (FR-21, D4). */
export function BayStickerPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const qr = useBayQr(id);
  if (qr.isError) return <Alert tone="error">{errorMessage(qr.error)}</Alert>;
  if (!qr.data) return null;
  return (
    <div className="flex flex-col items-start gap-4">
      <div className="flex gap-2 print:hidden">
        <Button asChild variant="outline">
          <Link to="/admin/site">{t('sticker.back')}</Link>
        </Button>
        <Button onClick={() => window.print()}>{t('sticker.print')}</Button>
      </div>
      <figure className="flex flex-col items-center gap-3 rounded-xl border-2 border-black bg-white p-6 text-black">
        <span className="text-3xl font-bold">{qr.data.bayCode}</span>
        <QRCodeSVG
          value={bayCheckinUrl(qr.data.token)}
          size={240}
          level="M"
          title={qr.data.bayCode}
        />
        <figcaption className="max-w-60 text-center text-sm">{t('sticker.caption')}</figcaption>
      </figure>
    </div>
  );
}
