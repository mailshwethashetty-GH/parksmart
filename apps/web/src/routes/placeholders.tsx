import { formatIsoDate } from '@parksmart/shared';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { usePolicy, useSite, useZones } from '@/lib/admin-api';
import { useMe } from '@/lib/auth';

/** Placeholders replaced feature by feature (M3 booking, M6 gate). */
export function EmployeeHome() {
  const { t } = useTranslation();
  const me = useMe();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('home.employeeTitle')}</CardTitle>
        <CardDescription>{t('home.employeeBody', { site: me.data?.site.name })}</CardDescription>
      </CardHeader>
    </Card>
  );
}

/** Admin overview: what is set up so far, with links to each area. */
export function AdminHome() {
  const { t } = useTranslation();
  const site = useSite();
  const zones = useZones();
  const policy = usePolicy();
  const bayCount = (zones.data?.items ?? []).reduce((n, z) => n + z.bayCount, 0);
  const active = policy.data?.versions.find((v) => v.status === 'active');
  const pending = policy.data?.versions.find(
    (v) => v.status === 'draft' || v.status === 'scheduled',
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Link to="/admin/site" className="rounded-xl focus-visible:ring-2 focus-visible:ring-ring">
        <Card className="h-full hover:bg-secondary/40">
          <CardHeader>
            <CardTitle>{site.data?.name ?? t('admin.site')}</CardTitle>
            <CardDescription>
              {t('home.siteSummary', { zones: zones.data?.items.length ?? 0, bays: bayCount })}
            </CardDescription>
          </CardHeader>
        </Card>
      </Link>
      <Link to="/admin/policy" className="rounded-xl focus-visible:ring-2 focus-visible:ring-ring">
        <Card className="h-full hover:bg-secondary/40">
          <CardHeader>
            <CardTitle>{t('admin.policy')}</CardTitle>
            <CardDescription>
              {active ? t('home.policyActive', { v: active.version }) : t('home.noPolicy')}
              {pending &&
                ` · ${pending.status === 'draft' ? t('home.draftPending', { v: pending.version }) : t('home.scheduledFor', { v: pending.version, week: formatIsoDate(pending.effectiveFromWeek!) })}`}
            </CardDescription>
          </CardHeader>
        </Card>
      </Link>
    </div>
  );
}

export function GateHome() {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('home.gateTitle')}</CardTitle>
        <CardDescription>{t('home.gateBody')}</CardDescription>
      </CardHeader>
    </Card>
  );
}
