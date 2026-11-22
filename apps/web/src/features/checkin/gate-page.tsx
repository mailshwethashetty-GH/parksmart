import { formatSiteTime, type CheckinResult } from '@parksmart/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useGateToday, useManualCheckin, useScanCheckin } from '@/lib/checkin-api';
import { cn } from '@/lib/utils';

const STATUS_VARIANT = {
  confirmed: 'warning',
  checked_in: 'success',
  auto_released: 'destructive',
  released: 'secondary',
  cancelled: 'secondary',
} as const;

const BAY_COLOURS = {
  free: 'bg-background',
  booked: 'bg-amber-500/20',
  checked_in: 'bg-emerald-600/25',
  blocked: 'bg-slate-500/25',
} as const;

/** /gate (security): scan QR codes, check people in by hand, see today's bays. */
export function GatePage() {
  const { t } = useTranslation();
  const me = useMe();
  const today = useGateToday();
  const scan = useScanCheckin();
  const manual = useManualCheckin();
  const tokenInput = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [last, setLast] = useState<CheckinResult | null>(null);
  const tz = me.data?.site.timezone ?? 'Asia/Kolkata';

  const submitToken = (value: string) => {
    if (!value.trim()) return;
    scan.mutate(value.trim(), { onSuccess: setLast });
  };
  // Read the field itself (not React state): handheld scanners type fast, sometimes
  // before the page has finished starting up.
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const input = tokenInput.current;
    if (!input) return;
    submitToken(input.value);
    input.value = '';
  };
  const q = search.trim().toLowerCase();
  const rows = (today.data?.bookings ?? []).filter(
    (b) => !q || b.employeeName.toLowerCase().includes(q) || b.bayCode.toLowerCase().includes(q),
  );
  const checkedIn = (today.data?.bookings ?? []).filter((b) => b.status === 'checked_in').length;
  const expected = (today.data?.bookings ?? []).filter((b) => b.status === 'confirmed').length;
  const error = scan.error ?? manual.error;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t('gate.title')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('gate.summary', { checkedIn, expected })}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('gate.scan')}</CardTitle>
            <CardDescription>{t('gate.scanHint')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <CameraScanner onCode={submitToken} />
            <form onSubmit={onSubmit} className="flex gap-2">
              <Input
                aria-label={t('gate.tokenLabel')}
                placeholder={t('gate.tokenLabel')}
                ref={tokenInput}
                autoComplete="off"
                defaultValue=""
              />
              <Button type="submit" disabled={scan.isPending}>
                {t('gate.checkIn')}
              </Button>
            </form>
            <div aria-live="assertive">
              {last && !scan.isError && (
                <Alert tone={last.alreadyCheckedIn ? 'info' : 'success'}>
                  <strong>{last.booking.employeeName}</strong> · {last.booking.bayCode} (
                  {last.booking.zoneName}) ·{' '}
                  {last.alreadyCheckedIn ? t('gate.already') : t('gate.ok')}
                </Alert>
              )}
              {error && <Alert tone="error">{errorMessage(error)}</Alert>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('gate.map')}</CardTitle>
            <CardDescription>{t('gate.mapHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul
              className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-1"
              aria-label={t('gate.map')}
            >
              {(today.data?.bays ?? []).map((b) => (
                <li
                  key={b.id}
                  title={`${b.code} · ${t(`gate.state.${b.state}`)}`}
                  className={cn(
                    'rounded border px-1 py-1 text-center font-mono text-[10px]',
                    BAY_COLOURS[b.state],
                  )}
                >
                  {b.code}
                  <span className="sr-only">: {t(`gate.state.${b.state}`)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('gate.today')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Input
            aria-label={t('gate.search')}
            placeholder={t('gate.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
          <Table>
            <thead>
              <tr>
                <Th>{t('gate.bay')}</Th>
                <Th>{t('gate.employee')}</Th>
                <Th>{t('gate.status')}</Th>
                <Th>{t('gate.time')}</Th>
                <Th className="text-right">{t('common.actions')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <Td className="font-mono">{b.bayCode}</Td>
                  <Td>{b.employeeName}</Td>
                  <Td>
                    <Badge variant={STATUS_VARIANT[b.status]}>
                      {t(`gate.statuses.${b.status}`)}
                    </Badge>
                  </Td>
                  <Td className="whitespace-nowrap text-sm">
                    {b.checkedInAt
                      ? formatSiteTime(b.checkedInAt, tz)
                      : b.checkInBy
                        ? t('gate.by', { time: formatSiteTime(b.checkInBy, tz) })
                        : '—'}
                  </Td>
                  <Td className="text-right">
                    {b.status === 'confirmed' && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={manual.isPending}
                        onClick={() => manual.mutate(b.id)}
                      >
                        {t('gate.manual')}
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

/** Camera QR scanner. Optional: hardware scanners type into the field below instead. */
function CameraScanner({ onCode }: { onCode: (code: string) => void }) {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
  const [on, setOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastCode = useRef<{ code: string; at: number } | null>(null);

  useEffect(() => {
    if (!on || !video.current) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    void import('@zxing/browser')
      .then(({ BrowserQRCodeReader }) =>
        new BrowserQRCodeReader().decodeFromVideoDevice(undefined, video.current!, (result) => {
          if (!result) return;
          const code = result.getText();
          // Ignore the same code seen again within 3 s (the camera reads many frames).
          const seen = lastCode.current;
          if (seen && seen.code === code && Date.now() - seen.at < 3000) return;
          lastCode.current = { code, at: Date.now() };
          onCode(code);
        }),
      )
      .then((controls) => {
        if (cancelled) controls.stop();
        else stop = () => controls.stop();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [on, onCode]);

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="outline" className="w-fit" onClick={() => setOn((v) => !v)}>
        {on ? t('gate.cameraOff') : t('gate.cameraOn')}
      </Button>
      {on && (
        <video ref={video} className="aspect-video w-full rounded-md bg-black" muted playsInline />
      )}
      {error && <Alert tone="warning">{t('gate.cameraError', { error })}</Alert>}
    </div>
  );
}
