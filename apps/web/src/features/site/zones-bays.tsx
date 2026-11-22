import { BAY_TYPES, ZONE_KINDS, type BayType, type ZoneKind } from '@parksmart/shared';
import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Field } from '@/components/field';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, Td, Th } from '@/components/ui/table';
import { useBays, useBulkCreateBays, useCreateZone, useUpdateBay, useZones } from '@/lib/admin-api';
import { errorMessage } from '@/lib/api';

export function ZonesAndBays() {
  const { t } = useTranslation();
  const zones = useZones();
  const bays = useBays();
  const createZone = useCreateZone();
  const bulk = useBulkCreateBays();
  const updateBay = useUpdateBay();
  // '' = default to the first zone (150+ rows otherwise); 'all' shows every bay.
  const [zoneFilter, setZoneFilter] = useState('');
  const [newZone, setNewZone] = useState({ name: '', kind: 'basement' as ZoneKind });
  const [newBays, setNewBays] = useState({
    zoneId: '',
    prefix: '',
    start: 1,
    count: 10,
    bayType: 'car' as BayType,
  });

  const zoneName = useMemo(
    () => new Map((zones.data?.items ?? []).map((z) => [z.id, z.name])),
    [zones.data],
  );
  const selectedZone = zoneFilter || zones.data?.items[0]?.id || 'all';
  const shown = (bays.data?.items ?? []).filter(
    (b) => selectedZone === 'all' || b.zoneId === selectedZone,
  );
  const totals = BAY_TYPES.map((type) => ({
    type,
    n: (bays.data?.items ?? []).filter((b) => b.active && b.bayType === type).length,
  })).filter((x) => x.n > 0);

  const onCreateZone = (e: FormEvent) => {
    e.preventDefault();
    createZone.mutate(
      { ...newZone, capacity: null },
      { onSuccess: () => setNewZone({ ...newZone, name: '' }) },
    );
  };
  const onBulk = (e: FormEvent) => {
    e.preventDefault();
    bulk.mutate(newBays);
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('site.zones')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {(zones.data?.items ?? []).map((z) => (
              <Badge key={z.id} variant="outline">
                {z.name} · {z.capacity ?? z.bayCount} {t('site.bays').toLowerCase()}
              </Badge>
            ))}
          </div>
          <form
            onSubmit={onCreateZone}
            className="grid items-end gap-3 sm:grid-cols-[1fr_12rem_auto]"
          >
            <Field label={t('site.zoneName')}>
              <Input
                required
                maxLength={60}
                value={newZone.name}
                onChange={(e) => setNewZone({ ...newZone, name: e.target.value })}
              />
            </Field>
            <Field label={t('site.zoneKind')}>
              <Select
                value={newZone.kind}
                onChange={(e) => setNewZone({ ...newZone, kind: e.target.value as ZoneKind })}
              >
                {ZONE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`site.zoneKinds.${k}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" variant="secondary" disabled={createZone.isPending}>
              {t('site.addZone')}
            </Button>
          </form>
          {createZone.isError && <Alert tone="error">{errorMessage(createZone.error)}</Alert>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('site.bays')}</CardTitle>
          <div className="flex flex-wrap gap-2 pt-1">
            {totals.map((x) => (
              <Badge key={x.type} variant="secondary">
                {t(`bayTypes.${x.type}`)}: {x.n}
              </Badge>
            ))}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form onSubmit={onBulk} className="grid items-end gap-3 sm:grid-cols-6">
            <Field label={t('site.zone')} className="sm:col-span-2">
              <Select
                required
                value={newBays.zoneId}
                onChange={(e) => setNewBays({ ...newBays, zoneId: e.target.value })}
              >
                <option value="">{t('common.choose')}</option>
                {(zones.data?.items ?? []).map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('site.prefix')} hint={t('site.prefixHint')}>
              <Input
                required
                maxLength={12}
                value={newBays.prefix}
                onChange={(e) => setNewBays({ ...newBays, prefix: e.target.value })}
              />
            </Field>
            <Field label={t('site.startAt')}>
              <Input
                type="number"
                min={0}
                value={newBays.start}
                onChange={(e) => setNewBays({ ...newBays, start: Number(e.target.value) })}
              />
            </Field>
            <Field label={t('site.count')}>
              <Input
                type="number"
                min={1}
                max={500}
                value={newBays.count}
                onChange={(e) => setNewBays({ ...newBays, count: Number(e.target.value) })}
              />
            </Field>
            <Field label={t('site.bayType')}>
              <Select
                value={newBays.bayType}
                onChange={(e) => setNewBays({ ...newBays, bayType: e.target.value as BayType })}
              >
                {BAY_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`bayTypes.${type}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              type="submit"
              variant="secondary"
              disabled={bulk.isPending}
              className="sm:col-span-6 sm:w-fit"
            >
              {t('site.addBays')}
            </Button>
          </form>
          {bulk.isError && <Alert tone="error">{errorMessage(bulk.error)}</Alert>}
          {bulk.isSuccess && (
            <Alert tone="success">{t('site.baysAdded', { count: bulk.data.items.length })}</Alert>
          )}

          <div className="flex items-center gap-2">
            <label htmlFor="zone-filter" className="text-sm text-muted-foreground">
              {t('site.filterZone')}
            </label>
            <Select
              id="zone-filter"
              className="w-56"
              value={selectedZone}
              onChange={(e) => setZoneFilter(e.target.value)}
            >
              <option value="all">{t('common.all')}</option>
              {(zones.data?.items ?? []).map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </Select>
          </div>
          <Table>
            <thead>
              <tr>
                <Th>{t('site.code')}</Th>
                <Th>{t('site.zone')}</Th>
                <Th>{t('site.bayType')}</Th>
                <Th>{t('site.status')}</Th>
                <Th className="text-right">{t('common.actions')}</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((b) => (
                <tr key={b.id} className={b.active ? '' : 'text-muted-foreground'}>
                  <Td className="font-mono">{b.code}</Td>
                  <Td>{zoneName.get(b.zoneId)}</Td>
                  <Td>
                    {t(`bayTypes.${b.bayType}`)}
                    {b.hasCharger && b.bayType !== 'ev' ? ` · ${t('site.charger')}` : ''}
                  </Td>
                  <Td>
                    <Badge variant={b.active ? 'success' : 'secondary'}>
                      {b.active ? t('site.active') : t('site.inactive')}
                    </Badge>
                  </Td>
                  <Td className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={updateBay.isPending}
                      onClick={() => updateBay.mutate({ id: b.id, active: !b.active })}
                    >
                      {b.active ? t('site.deactivate') : t('site.activate')}
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {updateBay.isError && <Alert tone="error">{errorMessage(updateBay.error)}</Alert>}
        </CardContent>
      </Card>
    </div>
  );
}
