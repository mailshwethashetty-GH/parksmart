import { homePathForRole } from '@parksmart/shared';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useDevSignIn, useDevUsers, useLoginOptions, useMe, useSsoSignIn } from '@/lib/auth';

export function LoginPage() {
  const { t } = useTranslation();
  const me = useMe();
  const options = useLoginOptions();
  const sso = useSsoSignIn();
  const samplePeople = options.data?.samplePeople ?? null;
  // Sample people: local dev login, or the prototype demo (ADR-017). The server decides.
  const devUsers = useDevUsers(samplePeople !== null);
  const devSignIn = useDevSignIn();

  if (me.data) return <Navigate to={homePathForRole(me.data.role)} replace />;

  const provider = options.data?.sso ?? null;
  const error = sso.error ?? devSignIn.error;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4">
      <div>
        <h1 className="text-2xl font-semibold">{t('appName')}</h1>
        <p className="text-sm text-muted-foreground">{t('tagline')}</p>
      </div>

      {provider && (
        <Card>
          <CardHeader>
            <CardTitle>{t('login.title')}</CardTitle>
            <CardDescription>{t('login.ssoHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              className="w-full"
              disabled={sso.isPending}
              onClick={() => sso.mutate(provider)}
            >
              {t(`login.ssoButton.${provider}`)}
            </Button>
          </CardContent>
        </Card>
      )}

      {options.data && !provider && !samplePeople && (
        <p className="text-sm text-muted-foreground">{t('login.noMethods')}</p>
      )}

      {devUsers.data && samplePeople && (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>{t(`login.sample.${samplePeople}.title`)}</CardTitle>
            <CardDescription>{t(`login.sample.${samplePeople}.hint`)}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {devUsers.data.items.map((u) => (
              <Button
                key={u.email}
                variant="outline"
                className="justify-between"
                disabled={devSignIn.isPending}
                onClick={() => devSignIn.mutate(u.email)}
              >
                <span>{u.name}</span>
                <span className="text-xs text-muted-foreground">{t(`roles.${u.role}`)}</span>
              </Button>
            ))}
          </CardContent>
        </Card>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t('login.failed', { message: error.message })}
        </p>
      )}
    </main>
  );
}
