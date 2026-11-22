import { zodResolver } from '@hookform/resolvers/zod';
import { siteSettingsSchema, WEEKDAY_NAMES, type SiteResponse } from '@parksmart/shared';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { Field } from '@/components/field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { useUpdateSettings, useUsers } from '@/lib/admin-api';
import { errorMessage } from '@/lib/api';

type FormIn = z.input<typeof siteSettingsSchema>;
type FormOut = z.output<typeof siteSettingsSchema>;

export function SettingsForm({ site }: { site: SiteResponse }) {
  const { t } = useTranslation();
  const save = useUpdateSettings();
  const admins = useUsers('', 'admin');
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(siteSettingsSchema),
    defaultValues: site.settings,
  });
  const { register, handleSubmit, control, formState } = form;
  const err = (path: string) =>
    path
      .split('.')
      .reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], formState.errors) as
      { message?: string } | undefined;
  const num = { valueAsNumber: true } as const;

  return (
    <form
      onSubmit={handleSubmit((values) => save.mutate(values))}
      className="flex flex-col gap-4"
      noValidate
    >
      <Card>
        <CardHeader>
          <CardTitle>{t('site.rounds')}</CardTitle>
          <CardDescription>{t('site.roundsHint', { tz: site.timezone })}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <fieldset className="sm:col-span-3">
            <legend className="mb-2 text-sm font-medium">{t('site.workingDays')}</legend>
            <Controller
              control={control}
              name="workingDays"
              render={({ field }) => (
                <div className="flex flex-wrap gap-3">
                  {WEEKDAY_NAMES.map((name, i) => {
                    const day = i + 1;
                    const value = field.value ?? [];
                    return (
                      <label key={name} className="flex items-center gap-1.5 text-sm">
                        <Checkbox
                          checked={value.includes(day)}
                          onChange={(e) =>
                            field.onChange(
                              e.target.checked
                                ? [...value, day].sort((a, b) => a - b)
                                : value.filter((d) => d !== day),
                            )
                          }
                        />
                        {name}
                      </label>
                    );
                  })}
                </div>
              )}
            />
          </fieldset>
          <Field label={t('site.weeklyDay')} error={err('rounds.weekly.weekday')?.message}>
            <Select {...register('rounds.weekly.weekday', num)}>
              {WEEKDAY_NAMES.map((name, i) => (
                <option key={name} value={i + 1}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('site.weeklyTime')} error={err('rounds.weekly.time')?.message}>
            <Input type="time" {...register('rounds.weekly.time')} />
          </Field>
          <Field
            label={t('site.weeklyDeadline')}
            error={err('rounds.weekly.approvalDeadline')?.message}
          >
            <Input type="time" {...register('rounds.weekly.approvalDeadline')} />
          </Field>
          <Field
            label={t('site.dailyTime')}
            hint={t('site.dailyHint')}
            error={err('rounds.daily.time')?.message}
          >
            <Input type="time" {...register('rounds.daily.time')} />
          </Field>
          <Field
            label={t('site.dailyDeadline')}
            error={err('rounds.daily.approvalDeadline')?.message}
          >
            <Input type="time" {...register('rounds.daily.approvalDeadline')} />
          </Field>
          <Field label={t('site.sameDayStart')} error={err('rounds.sameDay.startTime')?.message}>
            <Input type="time" {...register('rounds.sameDay.startTime')} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('site.capacity')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Field
            label={t('site.poolPercent')}
            hint={t('site.poolHint')}
            error={err('sameDayPoolPercent')?.message}
          >
            <Input type="number" min={0} max={50} {...register('sameDayPoolPercent', num)} />
          </Field>
          <Field
            label={t('site.graceMinutes')}
            hint={t('site.graceHint')}
            error={err('graceMinutes')?.message}
          >
            <Input type="number" min={5} max={30} {...register('graceMinutes', num)} />
          </Field>
          <Field label={t('site.offerWindow')} error={err('offerWindowMinutes')?.message}>
            <Input type="number" min={5} max={60} {...register('offerWindowMinutes', num)} />
          </Field>
          <Field label={t('site.notificationCap')} error={err('notificationDailyCap')?.message}>
            <Input type="number" min={1} max={10} {...register('notificationDailyCap', num)} />
          </Field>
          <Field
            label={t('site.maxFactor')}
            hint={t('site.maxFactorHint')}
            error={err('maxFactorWeightPercent')?.message}
          >
            <Input type="number" min={10} max={100} {...register('maxFactorWeightPercent', num)} />
          </Field>
          <Field label={t('site.lateExtensions')} error={err('lateExtensionsPerWeek')?.message}>
            <Input type="number" min={0} max={5} {...register('lateExtensionsPerWeek', num)} />
          </Field>
          <div className="flex flex-col gap-2 sm:col-span-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox {...register('autoPublishAtDayStart')} /> {t('site.autoPublish')}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox {...register('evOverflowSameDay')} /> {t('site.evOverflow')}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox {...register('requireVehiclePlate')} /> {t('site.requirePlate')}
            </label>
          </div>
          <fieldset className="sm:col-span-3">
            <legend className="mb-2 text-sm font-medium">{t('site.backupAdmins')}</legend>
            <Controller
              control={control}
              name="backupAdminIds"
              render={({ field }) => (
                <div className="flex flex-wrap gap-3">
                  {(admins.data?.items ?? []).map((a) => {
                    const value = field.value ?? [];
                    return (
                      <label key={a.id} className="flex items-center gap-1.5 text-sm">
                        <Checkbox
                          checked={value.includes(a.id)}
                          onChange={(e) =>
                            field.onChange(
                              e.target.checked
                                ? [...value, a.id]
                                : value.filter((id) => id !== a.id),
                            )
                          }
                        />
                        {a.name}
                      </label>
                    );
                  })}
                </div>
              )}
            />
          </fieldset>
        </CardContent>
      </Card>

      {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
      {save.isSuccess && !formState.isDirty && <Alert tone="success">{t('common.saved')}</Alert>}
      <div>
        <Button type="submit" disabled={save.isPending}>
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}
