import { formatSiteTime } from '@parksmart/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/field';
import { Input, Select } from '@/components/ui/input';
import { Table, Td, Th } from '@/components/ui/table';
import { auditQueryString, useAudit, useSite, type AuditFilters } from '@/lib/admin-api';
import { errorMessage } from '@/lib/api';

const ACTIONS = [
  'round',
  'allocation',
  'offer',
  'booking',
  'policy',
  'site',
  'bay',
  'bay_block',
  'approval',
  'zone',
];

/** /admin/audit (FR-16): filterable, append-only log with CSV export. */
export function AuditPage() {
  const { t } = useTranslation();
  const site = useSite();
  const [filters, setFilters] = useState<AuditFilters>({});
  const audit = useAudit(filters);
  const tz = site.data?.timezone ?? 'Asia/Kolkata';
  const items = audit.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t('audit.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('audit.hint')}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t('audit.filters')}</CardTitle>
        </CardHeader>
        <CardContent className="grid items-end gap-3 sm:grid-cols-4">
          <Field label={t('audit.action')}>
            <Select
              value={filters.action ?? ''}
              onChange={(e) => setFilters({ ...filters, action: e.target.value || undefined })}
            >
              <option value="">{t('common.all')}</option>
              {ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('site.from')}>
            <Input
              type="date"
              value={filters.from ?? ''}
              onChange={(e) => setFilters({ ...filters, from: e.target.value || undefined })}
            />
          </Field>
          <Field label={t('audit.to')}>
            <Input
              type="date"
              value={filters.to ?? ''}
              onChange={(e) => setFilters({ ...filters, to: e.target.value || undefined })}
            />
          </Field>
          <Button asChild variant="outline" className="sm:w-fit">
            <a href={`/api/v1/admin/audit/export?${auditQueryString(filters)}`} download>
              {t('audit.export')}
            </a>
          </Button>
        </CardContent>
      </Card>
      {audit.isError && <Alert tone="error">{errorMessage(audit.error)}</Alert>}
      <Card>
        <CardContent className="pt-6">
          <Table>
            <thead>
              <tr>
                <Th>{t('audit.when')}</Th>
                <Th>{t('audit.who')}</Th>
                <Th>{t('audit.action')}</Th>
                <Th>{t('audit.reason')}</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id}>
                  <Td className="whitespace-nowrap">{formatSiteTime(e.at, tz)}</Td>
                  <Td>{e.actor?.name ?? t('audit.system')}</Td>
                  <Td className="font-mono text-xs">{e.action}</Td>
                  <Td className="max-w-md text-sm">{e.reason}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {audit.hasNextPage && (
            <Button
              className="mt-3"
              variant="outline"
              disabled={audit.isFetchingNextPage}
              onClick={() => audit.fetchNextPage()}
            >
              {t('audit.more')}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
