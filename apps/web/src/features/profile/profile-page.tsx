import {
  DISTANCE_BANDS,
  VEHICLE_TYPES,
  type DistanceBand,
  type VehicleType,
} from '@parksmart/shared';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { Field } from '@/components/field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, Input, Label, Select } from '@/components/ui/input';
import { errorMessage } from '@/lib/api';
import {
  useAddVehicle,
  useDeleteAccount,
  useProfile,
  useRemoveVehicle,
  useSetConsent,
  useSetDistanceBand,
} from '@/lib/me-api';

/** /app/profile (M7): vehicles, optional distance band, consent and data rights. */
export function ProfilePage() {
  const { t } = useTranslation();
  const profile = useProfile();

  if (profile.isPending) return <p className="text-muted-foreground">…</p>;
  if (profile.isError) return <Alert tone="error">{errorMessage(profile.error)}</Alert>;
  const p = profile.data;
  const vehicleConsent = p.consents.find((c) => c.purpose === 'vehicle_details')?.granted ?? false;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t('profile.title')}</h1>
      <VehiclesCard vehicles={p.vehicles} requirePlate={p.requirePlate} allowed={vehicleConsent} />
      <DistanceCard value={p.distanceBand} />
      <ConsentsCard consents={p.consents} />
      <DataRightsCard />
    </div>
  );
}

function VehiclesCard({
  vehicles,
  requirePlate,
  allowed,
}: {
  vehicles: { id: string; type: VehicleType; isEv: boolean; plate: string | null }[];
  requirePlate: boolean;
  allowed: boolean;
}) {
  const { t } = useTranslation();
  const add = useAddVehicle();
  const remove = useRemoveVehicle();
  const [type, setType] = useState<VehicleType>('car');
  const [isEv, setIsEv] = useState(false);
  const [plate, setPlate] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate(
      { type, isEv, plate: plate.trim() || undefined },
      { onSuccess: () => (setPlate(''), setIsEv(false)) },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('profile.vehicles')}</CardTitle>
        <CardDescription>
          {requirePlate ? t('profile.vehiclesHintPlate') : t('profile.vehiclesHint')}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {vehicles.length > 0 && (
          <ul className="flex flex-col divide-y rounded-md border">
            {vehicles.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span>
                  {t(`profile.vehicleType.${v.type}`)}
                  {v.isEv && ` · ${t('profile.ev')}`}
                  {v.plate && <span className="text-muted-foreground"> · {v.plate}</span>}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(v.id)}
                >
                  {t('profile.remove')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {!allowed ? (
          <Alert>{t('profile.vehicleConsentNeeded')}</Alert>
        ) : (
          <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
            <Field label={t('profile.type')} className="w-40">
              <Select value={type} onChange={(e) => setType(e.target.value as VehicleType)}>
                {VEHICLE_TYPES.map((vt) => (
                  <option key={vt} value={vt}>
                    {t(`profile.vehicleType.${vt}`)}
                  </option>
                ))}
              </Select>
            </Field>
            {requirePlate && (
              <Field label={t('profile.plate')} className="w-44">
                <Input
                  value={plate}
                  onChange={(e) => setPlate(e.target.value)}
                  maxLength={15}
                  required
                  autoComplete="off"
                />
              </Field>
            )}
            <Label className="flex h-9 items-center gap-2 font-normal">
              <Checkbox checked={isEv} onChange={(e) => setIsEv(e.target.checked)} />
              {t('profile.isEv')}
            </Label>
            <Button type="submit" disabled={add.isPending}>
              {t('profile.addVehicle')}
            </Button>
          </form>
        )}
        {(add.isError || remove.isError) && (
          <Alert tone="error">{errorMessage(add.error ?? remove.error)}</Alert>
        )}
      </CardContent>
    </Card>
  );
}

function DistanceCard({ value }: { value: DistanceBand | null }) {
  const { t } = useTranslation();
  const set = useSetDistanceBand();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('profile.distance')}</CardTitle>
        <CardDescription>{t('profile.distanceWhy')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Field
          label={t('profile.distanceLabel')}
          hint={t('profile.distanceSkip')}
          className="max-w-xs"
        >
          <Select
            value={value ?? ''}
            disabled={set.isPending}
            onChange={(e) => set.mutate((e.target.value || null) as DistanceBand | null)}
          >
            <option value="">{t('profile.distanceNone')}</option>
            {DISTANCE_BANDS.map((b) => (
              <option key={b} value={b}>
                {t(`profile.band.${b}`)}
              </option>
            ))}
          </Select>
        </Field>
        {set.isSuccess && (
          <p className="text-xs text-muted-foreground" role="status">
            {t('profile.saved')}
          </p>
        )}
        {set.isError && <Alert tone="error">{errorMessage(set.error)}</Alert>}
      </CardContent>
    </Card>
  );
}

function ConsentsCard({
  consents,
}: {
  consents: {
    purpose: 'parking_allocation' | 'vehicle_details' | 'ai_processing';
    granted: boolean;
    required: boolean;
    text: string;
  }[];
}) {
  const { t } = useTranslation();
  const set = useSetConsent();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('profile.consents')}</CardTitle>
        <CardDescription>{t('profile.consentsHint')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {consents.map((c) => (
          <div key={c.purpose} className="flex items-start gap-3 text-sm">
            <Checkbox
              id={`consent-${c.purpose}`}
              className="mt-0.5"
              checked={c.granted}
              disabled={c.required || set.isPending}
              onChange={(e) => set.mutate({ purpose: c.purpose, granted: e.target.checked })}
            />
            <label htmlFor={`consent-${c.purpose}`} className="flex flex-col gap-0.5">
              <span className="font-medium">{t(`profile.purpose.${c.purpose}`)}</span>
              <span className="text-muted-foreground">{c.text}</span>
              {c.required && (
                <span className="text-xs text-muted-foreground">
                  {t('profile.requiredConsent')}
                </span>
              )}
              {c.purpose === 'vehicle_details' && c.granted && (
                <span className="text-xs text-muted-foreground">{t('profile.revokeVehicles')}</span>
              )}
            </label>
          </div>
        ))}
        {set.isError && <Alert tone="error">{errorMessage(set.error)}</Alert>}
      </CardContent>
    </Card>
  );
}

function DataRightsCard() {
  const { t } = useTranslation();
  const del = useDeleteAccount();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('profile.data')}</CardTitle>
        <CardDescription>{t('profile.dataHint')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Button asChild variant="outline" className="w-fit">
          <a href="/api/v1/me/data-export" download>
            {t('profile.export')}
          </a>
        </Button>
        {!confirming ? (
          <Button
            variant="outline"
            className="w-fit text-destructive"
            onClick={() => setConfirming(true)}
          >
            {t('profile.delete')}
          </Button>
        ) : (
          <Alert tone="warning" className="flex flex-col gap-3">
            <p>{t('profile.deleteConfirm')}</p>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                disabled={del.isPending}
                onClick={() =>
                  del.mutate(undefined, { onSuccess: () => navigate('/login', { replace: true }) })
                }
              >
                {t('profile.deleteYes')}
              </Button>
              <Button variant="outline" onClick={() => setConfirming(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          </Alert>
        )}
        {del.isError && <Alert tone="error">{errorMessage(del.error)}</Alert>}
      </CardContent>
    </Card>
  );
}
