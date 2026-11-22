import { ROLES, type Role } from '@parksmart/shared';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Field } from '@/components/field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, Td, Th } from '@/components/ui/table';
import { useSetUserRole, useUsers } from '@/lib/admin-api';
import { errorMessage } from '@/lib/api';
import { useMe } from '@/lib/auth';

type User = { id: string; name: string; email: string; role: Role };

/** People (FR-29): everyone signs in as an employee; give security staff and backup admins their role. */
export function People() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const users = useUsers(search);
  const me = useMe();
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('site.people')}</CardTitle>
        <CardDescription>{t('site.peopleHint')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Field label={t('site.searchPeople')} className="max-w-sm">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('site.nameOrEmail')}
          />
        </Field>
        <Table>
          <thead>
            <tr>
              <Th>{t('site.name')}</Th>
              <Th>{t('site.email')}</Th>
              <Th>{t('site.role')}</Th>
              <Th>
                <span className="sr-only">{t('common.actions')}</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {(users.data?.items ?? []).map((u) =>
              editing === u.id ? (
                <tr key={u.id}>
                  <Td colSpan={4}>
                    <RoleForm user={u} onDone={() => setEditing(null)} />
                  </Td>
                </tr>
              ) : (
                <tr key={u.id}>
                  <Td>{u.name}</Td>
                  <Td className="text-muted-foreground">{u.email}</Td>
                  <Td>{t(`roles.${u.role}`)}</Td>
                  <Td className="text-right">
                    {u.id !== me.data?.id && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t('site.changeRoleFor', { name: u.name })}
                        onClick={() => setEditing(u.id)}
                      >
                        {t('site.changeRole')}
                      </Button>
                    )}
                  </Td>
                </tr>
              ),
            )}
          </tbody>
        </Table>
        {users.isError && <Alert tone="error">{errorMessage(users.error)}</Alert>}
      </CardContent>
    </Card>
  );
}

function RoleForm({ user, onDone }: { user: User; onDone: () => void }) {
  const { t } = useTranslation();
  const setRole = useSetUserRole();
  const [role, setRoleValue] = useState<Role>(user.role);
  const [reason, setReason] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setRole.mutate({ id: user.id, role, reason: reason.trim() }, { onSuccess: onDone });
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <span className="w-full text-sm font-medium">{user.name}</span>
      <Field label={t('site.role')} className="w-40">
        <Select value={role} onChange={(e) => setRoleValue(e.target.value as Role)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {t(`roles.${r}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('review.reason')} className="min-w-60 flex-1">
        <Input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} />
      </Field>
      <Button type="submit" disabled={setRole.isPending || role === user.role}>
        {t('common.save')}
      </Button>
      <Button type="button" variant="outline" onClick={onDone}>
        {t('common.cancel')}
      </Button>
      {setRole.isError && (
        <Alert tone="error" className="w-full">
          {errorMessage(setRole.error)}
        </Alert>
      )}
    </form>
  );
}
