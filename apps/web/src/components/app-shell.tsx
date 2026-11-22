import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { useMe, useSignOut } from '@/lib/auth';
import { useLiveUpdates } from '@/lib/request-api';
import { cn } from '@/lib/utils';

export function AppShell() {
  const { t } = useTranslation();
  const me = useMe();
  const signOut = useSignOut();
  // Live updates for people who make requests (employees and admins).
  useLiveUpdates(me.data?.role === 'employee' || me.data?.role === 'admin');
  const navigate = useNavigate();
  const role = me.data?.role;

  const links = [
    {
      to: '/app',
      label: t('nav.employee'),
      show: role === 'employee' || role === 'admin',
      end: true,
    },
    { to: '/app/book', label: t('nav.book'), show: role === 'employee' || role === 'admin' },
    { to: '/app/policy', label: t('nav.policy'), show: role === 'employee' || role === 'admin' },
    { to: '/admin', label: t('nav.admin'), show: role === 'admin' },
    { to: '/gate', label: t('nav.gate'), show: role === 'security' || role === 'admin' },
  ].filter((l) => l.show);

  return (
    <div className="min-h-dvh">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
          <span className="font-semibold">{t('appName')}</span>
          <nav className="flex gap-1" aria-label="Main">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                className={({ isActive }) =>
                  cn(
                    'rounded-md px-3 py-1.5 text-sm',
                    isActive ? 'bg-secondary' : 'hover:bg-secondary',
                  )
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">{me.data?.name}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => signOut.mutate(undefined, { onSuccess: () => navigate('/login') })}
            >
              {t('nav.signOut')}
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
