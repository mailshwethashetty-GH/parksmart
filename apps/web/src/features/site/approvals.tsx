import { formatIsoDate } from '@parksmart/shared';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Field } from '@/components/field';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, Td, Th } from '@/components/ui/table';
import { useApprovals, useCreateApproval, useRevokeApproval, useUsers } from '@/lib/admin-api';
import { errorMessage } from '@/lib/api';

/** FR-13: accessible-bay approvals. Only a flag and an expiry are stored. */
export function Approvals() {
  const { t } = useTranslation();
  const approvals = useApprovals();
  const create = useCreateApproval();
  const revoke = useRevokeApproval();
  const [search, setSearch] = useState('');
  const employees = useUsers(search, 'employee');
  const [userId, setUserId] = useState('');
  const [expiresOn, setExpiresOn] = useState('');

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate({ userId, expiresOn }, { onSuccess: () => setUserId('') });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('site.approvals')}</CardTitle>
        <CardDescription>{t('site.approvalsHint')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={onSubmit} className="grid items-end gap-3 sm:grid-cols-4">
          <Field label={t('site.searchEmployee')}>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('site.nameOrEmail')}
            />
          </Field>
          <Field label={t('site.employee')}>
            <Select required value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">{t('common.choose')}</option>
              {(employees.data?.items ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('site.validUntil')}>
            <Input
              type="date"
              required
              value={expiresOn}
              onChange={(e) => setExpiresOn(e.target.value)}
            />
          </Field>
          <Button
            type="submit"
            variant="secondary"
            disabled={create.isPending}
            className="sm:w-fit"
          >
            {t('site.approve')}
          </Button>
        </form>
        {create.isError && <Alert tone="error">{errorMessage(create.error)}</Alert>}

        <Table>
          <thead>
            <tr>
              <Th>{t('site.employee')}</Th>
              <Th>{t('site.validUntil')}</Th>
              <Th>{t('site.status')}</Th>
              <Th className="text-right">{t('common.actions')}</Th>
            </tr>
          </thead>
          <tbody>
            {(approvals.data?.items ?? []).map((a) => (
              <tr key={a.id}>
                <Td>{a.userName}</Td>
                <Td>{formatIsoDate(a.expiresOn)}</Td>
                <Td>
                  <Badge variant={a.active ? 'success' : 'secondary'}>
                    {a.active
                      ? t('site.active')
                      : a.revokedAt
                        ? t('site.revoked')
                        : t('site.expired')}
                  </Badge>
                </Td>
                <Td className="text-right">
                  {a.active && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(a.id)}
                    >
                      {t('site.revoke')}
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
            {approvals.data?.items.length === 0 && (
              <tr>
                <Td colSpan={4} className="text-muted-foreground">
                  {t('site.noApprovals')}
                </Td>
              </tr>
            )}
          </tbody>
        </Table>
      </CardContent>
    </Card>
  );
}
