import { ROUTE_GROUP_ROLES } from '@parksmart/shared';
import { useTranslation } from 'react-i18next';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useMe } from '@/lib/auth';

/** Guards a route group (/app, /admin, /gate). The API enforces roles too; this is UX only. */
export function RequireRole({ group }: { group: keyof typeof ROUTE_GROUP_ROLES }) {
  const { t } = useTranslation();
  const me = useMe();
  const location = useLocation();

  if (me.isPending) return <p className="p-6 text-muted-foreground">…</p>;
  if (me.isError) return <p className="p-6 text-destructive">{t('errors.generic')}</p>;
  if (!me.data) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!ROUTE_GROUP_ROLES[group].includes(me.data.role)) {
    return <p className="p-6">{t('errors.forbidden')}</p>;
  }
  return <Outlet />;
}
