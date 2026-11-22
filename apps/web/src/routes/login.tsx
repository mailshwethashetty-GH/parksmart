import { homePathForRole } from '@parksmart/shared';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useDevSignIn, useDevUsers, useMe, useSsoSignIn } from '@/lib/auth';

export function LoginPage() {
  const { t } = useTranslation();
  const me = useMe();
  const [email, setEmail] = useState('');
  const sso = useSsoSignIn();
  // Dev login is shown only in a dev build AND when the server has it enabled.
  const devUsers = useDevUsers(import.meta.env.DEV);
  const devSignIn = useDevSignIn();

  if (me.data) return <Navigate to={homePathForRole(me.data.role)} replace />;

  const onSso = (e: FormEvent) => {
    e.preventDefault();
    sso.mutate(email);
  };
  const error = sso.error ?? devSignIn.error;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4">
      <div>
        <h1 className="text-2xl font-semibold">{t('appName')}</h1>
        <p className="text-sm text-muted-foreground">{t('tagline')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('login.title')}</CardTitle>
          <CardDescription>{t('login.ssoHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSso} className="flex flex-col gap-3">
            <label htmlFor="email" className="text-sm font-medium">
              {t('login.ssoLabel')}
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-10 rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button type="submit" disabled={sso.isPending}>
              {t('login.ssoButton')}
            </Button>
          </form>
        </CardContent>
      </Card>

      {devUsers.data && (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>{t('login.devTitle')}</CardTitle>
            <CardDescription>{t('login.devHint')}</CardDescription>
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
                <span className="text-xs text-muted-foreground">{u.role}</span>
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
