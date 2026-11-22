import { useTranslation } from 'react-i18next';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useMe } from '@/lib/auth';

/** M0 placeholders for each route group. Replaced feature by feature from M2. */
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

export function AdminHome() {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('home.adminTitle')}</CardTitle>
        <CardDescription>{t('home.adminBody')}</CardDescription>
      </CardHeader>
    </Card>
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
