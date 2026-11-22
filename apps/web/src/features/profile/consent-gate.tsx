import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { errorMessage } from '@/lib/api';
import { useProfile, useSetConsent } from '@/lib/me-api';

/**
 * DPDP consent gate for /app: parking allocation needs the employee's consent before
 * any request is made (the API refuses with CONSENT_REQUIRED otherwise).
 */
export function ConsentGate() {
  const { t } = useTranslation();
  const profile = useProfile();
  const setConsent = useSetConsent();

  if (profile.isPending) return <p className="text-muted-foreground">…</p>;
  if (profile.isError) return <Alert tone="error">{errorMessage(profile.error)}</Alert>;
  const required = profile.data.consents.find((c) => c.purpose === 'parking_allocation');
  if (!required || required.granted) return <Outlet />;

  return (
    <Card className="mx-auto max-w-xl">
      <CardHeader>
        <CardTitle>{t('consent.title')}</CardTitle>
        <CardDescription>{t('consent.intro')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm">{required.text}</p>
        <ul className="list-disc pl-5 text-sm text-muted-foreground">
          <li>{t('consent.point1')}</li>
          <li>{t('consent.point2')}</li>
          <li>{t('consent.point3')}</li>
        </ul>
        {setConsent.isError && <Alert tone="error">{errorMessage(setConsent.error)}</Alert>}
        <Button
          className="w-fit"
          disabled={setConsent.isPending}
          onClick={() => setConsent.mutate({ purpose: 'parking_allocation', granted: true })}
        >
          {t('consent.agree')}
        </Button>
      </CardContent>
    </Card>
  );
}
