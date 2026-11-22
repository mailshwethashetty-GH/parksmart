import { formatIsoDate } from '@parksmart/shared';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Field } from '@/components/field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, Td, Th } from '@/components/ui/table';
import {
  useBayBlocks,
  useBays,
  useCreateBayBlock,
  useDeleteBayBlock,
  useZones,
} from '@/lib/admin-api';
import { errorMessage } from '@/lib/api';

export function BayBlocks() {
  const { t } = useTranslation();
  const zones = useZones();
  const bays = useBays();
  const blocks = useBayBlocks();
  const create = useCreateBayBlock();
  const remove = useDeleteBayBlock();
  const [target, setTarget] = useState<'zone' | 'bays'>('bays');
  const [zoneId, setZoneId] = useState('');
  const [codes, setCodes] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [reason, setReason] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    let bayIds: string[] | undefined;
    if (target === 'bays') {
      const wanted = codes
        .split(/[\s,]+/)
        .filter(Boolean)
        .map((c) => c.toUpperCase());
      const byCode = new Map((bays.data?.items ?? []).map((b) => [b.code.toUpperCase(), b.id]));
      const unknown = wanted.filter((c) => !byCode.has(c));
      if (unknown.length)
        return setLocalError(t('site.unknownBays', { codes: unknown.join(', ') }));
      bayIds = wanted.map((c) => byCode.get(c)!);
    }
    create.mutate(
      {
        bayIds,
        zoneId: target === 'zone' ? zoneId : undefined,
        dateFrom,
        dateTo: dateTo || dateFrom,
        reason,
      },
      {
        onSuccess: () => {
          setCodes('');
          setReason('');
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('site.blocks')}</CardTitle>
        <CardDescription>{t('site.blocksHint')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={onSubmit} className="grid items-end gap-3 sm:grid-cols-4">
          <Field label={t('site.blockTarget')}>
            <Select value={target} onChange={(e) => setTarget(e.target.value as 'zone' | 'bays')}>
              <option value="bays">{t('site.specificBays')}</option>
              <option value="zone">{t('site.wholeZone')}</option>
            </Select>
          </Field>
          {target === 'zone' ? (
            <Field label={t('site.zone')} className="sm:col-span-3">
              <Select required value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
                <option value="">{t('common.choose')}</option>
                {(zones.data?.items ?? []).map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field
              label={t('site.bayCodes')}
              hint={t('site.bayCodesHint')}
              className="sm:col-span-3"
            >
              <Input
                required
                value={codes}
                onChange={(e) => setCodes(e.target.value)}
                placeholder="B1-001, B1-002"
              />
            </Field>
          )}
          <Field label={t('site.from')}>
            <Input
              type="date"
              required
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </Field>
          <Field label={t('site.to')}>
            <Input
              type="date"
              min={dateFrom}
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </Field>
          <Field label={t('site.reason')} hint={t('site.reasonHint')} className="sm:col-span-2">
            <Input
              required
              minLength={3}
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <Button
            type="submit"
            variant="secondary"
            disabled={create.isPending}
            className="sm:w-fit"
          >
            {t('site.addBlock')}
          </Button>
        </form>
        {(localError || create.isError) && (
          <Alert tone="error">{localError ?? errorMessage(create.error)}</Alert>
        )}

        <Table>
          <thead>
            <tr>
              <Th>{t('site.dates')}</Th>
              <Th>{t('site.blocked')}</Th>
              <Th>{t('site.reason')}</Th>
              <Th className="text-right">{t('common.actions')}</Th>
            </tr>
          </thead>
          <tbody>
            {(blocks.data?.items ?? []).map((b) => (
              <tr key={b.id}>
                <Td className="whitespace-nowrap">
                  {formatIsoDate(b.dateFrom)}
                  {b.dateTo !== b.dateFrom && ` – ${formatIsoDate(b.dateTo)}`}
                </Td>
                <Td>{b.bayCode ?? `${t('site.zone')}: ${b.zoneName}`}</Td>
                <Td>{b.reason}</Td>
                <Td className="text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(b.id)}
                  >
                    {t('common.remove')}
                  </Button>
                </Td>
              </tr>
            ))}
            {blocks.data?.items.length === 0 && (
              <tr>
                <Td colSpan={4} className="text-muted-foreground">
                  {t('site.noBlocks')}
                </Td>
              </tr>
            )}
          </tbody>
        </Table>
      </CardContent>
    </Card>
  );
}
