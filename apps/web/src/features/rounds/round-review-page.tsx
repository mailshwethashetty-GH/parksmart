import {
  formatDayShort,
  formatSiteTime,
  type ReviewDecision,
  type RoundDetail,
} from '@parksmart/shared';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, Td, Th } from '@/components/ui/table';
import { useApproveRound, useOverride, useRoundDetail, useSite } from '@/lib/admin-api';
import { errorMessage } from '@/lib/api';

const OUTCOME_VARIANT = {
  confirmed: 'success',
  waitlisted: 'warning',
  ineligible: 'secondary',
} as const;

/** /admin/rounds/:id (FR-16): every decision with its breakdown; approve or override. */
export function RoundReviewPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const round = useRoundDetail(id);
  const site = useSite();
  const approve = useApproveRound(id);
  const [note, setNote] = useState('');
  const tz = site.data?.timezone ?? 'Asia/Kolkata';
  const r = round.data;

  if (round.isError) return <Alert tone="error">{errorMessage(round.error)}</Alert>;
  if (!r) return null;
  const pending = r.status === 'pending_review';
  const dates = [...new Set(r.decisions.map((d) => d.date))];

  return (
    <div className="flex flex-col gap-4">
      <Link to="/admin/rounds" className="text-sm text-muted-foreground hover:underline">
        ← {t('rounds.title')}
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            {t(`booking.round.${r.roundType}`)} · {formatDayShort(r.targetDateFrom)}
            {r.targetDateTo !== r.targetDateFrom && ` – ${formatDayShort(r.targetDateTo)}`}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('review.meta', {
              ran: r.runAt ? formatSiteTime(r.runAt, tz) : '—',
              version: r.policyVersion,
              seed: r.seed.slice(0, 8),
            })}
          </p>
        </div>
        <StatusBadge round={r} tz={tz} />
      </div>

      {pending && (
        <Card>
          <CardHeader>
            <CardTitle>{t('review.approveTitle')}</CardTitle>
            <CardDescription>
              {r.approvalDeadline &&
                t('review.deadline', { time: formatSiteTime(r.approvalDeadline, tz) })}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex flex-1 flex-col gap-1.5 text-sm font-medium">
              {t('review.note')}
              <Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
            </label>
            <Button disabled={approve.isPending} onClick={() => approve.mutate(note)}>
              {t('review.approve', { count: r.counts.confirmed })}
            </Button>
          </CardContent>
          {approve.isError && (
            <CardContent>
              <Alert tone="error">{errorMessage(approve.error)}</Alert>
            </CardContent>
          )}
        </Card>
      )}

      {dates.map((date) => (
        <Card key={date}>
          <CardHeader>
            <CardTitle>{formatDayShort(date)}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <thead>
                <tr>
                  <Th className="w-12">#</Th>
                  <Th>{t('review.employee')}</Th>
                  <Th>{t('review.outcome')}</Th>
                  <Th className="text-right">{t('review.score')}</Th>
                  <Th>{t('review.why')}</Th>
                  {pending && <Th>{t('review.override')}</Th>}
                </tr>
              </thead>
              <tbody>
                {r.decisions
                  .filter((d) => d.date === date)
                  .map((d) => (
                    <DecisionRow key={d.allocationId} decision={d} round={r} pending={pending} />
                  ))}
              </tbody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function StatusBadge({ round, tz }: { round: RoundDetail; tz: string }) {
  const { t } = useTranslation();
  if (round.status === 'pending_review') {
    return (
      <Badge variant={round.delayed ? 'destructive' : 'warning'}>
        {round.delayed ? t('rounds.delayed') : t('rounds.pending')}
      </Badge>
    );
  }
  return (
    <Badge variant="success">
      {t('rounds.published')}
      {round.publishedAt && ` · ${formatSiteTime(round.publishedAt, tz)}`}
    </Badge>
  );
}

function DecisionRow({
  decision: d,
  round,
  pending,
}: {
  decision: ReviewDecision;
  round: RoundDetail;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <tr className="align-top">
      <Td>{d.rank || '—'}</Td>
      <Td>
        <div className="font-medium">{d.employee.name}</div>
        <div className="text-xs text-muted-foreground">
          {t(`bayTypes.${d.requestedBayType}`)}
          {d.reasonCategory && ` · ${t(`booking.reasons.${d.reasonCategory}`)}`}
        </div>
      </Td>
      <Td>
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant={OUTCOME_VARIANT[d.outcome]}>{t(`review.outcomes.${d.outcome}`)}</Badge>
          {d.bayCode && <span className="font-mono text-xs">{d.bayCode}</span>}
          {d.fallbackUsed && <Badge variant="outline">{t('review.fallback')}</Badge>}
          {d.capReached && <Badge variant="outline">{t('review.capped')}</Badge>}
          {d.overridden && <Badge variant="outline">{t('review.overridden')}</Badge>}
        </div>
      </Td>
      <Td className="text-right tabular-nums">
        <button
          type="button"
          className="hover:underline"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {d.score.toFixed(3)}
        </button>
        {open && (
          <ul className="mt-1 text-left text-xs text-muted-foreground">
            {d.factors.map((f) => (
              <li key={f.key}>
                {f.key.replace(/_/g, ' ')}: {f.weight}% × {f.value.toFixed(2)}
                {f.neutral ? ` (${t('review.neutral')})` : ''}
              </li>
            ))}
          </ul>
        )}
      </Td>
      <Td className="max-w-xs text-sm">{d.reasonText}</Td>
      {pending && (
        <Td>
          <OverrideControl decision={d} round={round} />
        </Td>
      )}
    </tr>
  );
}

function OverrideControl({ decision: d, round }: { decision: ReviewDecision; round: RoundDetail }) {
  const { t } = useTranslation();
  const override = useOverride(round.id);
  const [editing, setEditing] = useState(false);
  const [bayId, setBayId] = useState('');
  const [reason, setReason] = useState('');
  const free = round.freeBays.find((f) => f.date === d.date)?.bays ?? [];
  const action = d.outcome === 'confirmed' ? 'waitlist' : 'assign';

  if (!editing) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
        {action === 'waitlist' ? t('review.toWaitlist') : t('review.assign')}
      </Button>
    );
  }
  const submit = (e: FormEvent) => {
    e.preventDefault();
    override.mutate(
      action === 'assign'
        ? { allocationId: d.allocationId, action, bayId, reason }
        : { allocationId: d.allocationId, action, reason },
      { onSuccess: () => setEditing(false) },
    );
  };
  return (
    <form onSubmit={submit} className="flex min-w-56 flex-col gap-2">
      {action === 'assign' && (
        <Select
          required
          aria-label={t('review.bay')}
          value={bayId}
          onChange={(e) => setBayId(e.target.value)}
        >
          <option value="">{free.length ? t('review.pickBay') : t('review.noFreeBay')}</option>
          {free.map((b) => (
            <option key={b.id} value={b.id}>
              {b.code} ({t(`bayTypes.${b.bayType}`)})
            </option>
          ))}
        </Select>
      )}
      <Input
        required
        minLength={3}
        maxLength={500}
        aria-label={t('review.reason')}
        placeholder={t('review.reason')}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      {override.isError && <Alert tone="error">{errorMessage(override.error)}</Alert>}
      <div className="flex gap-1">
        <Button size="sm" type="submit" disabled={override.isPending}>
          {t('common.save')}
        </Button>
        <Button size="sm" type="button" variant="ghost" onClick={() => setEditing(false)}>
          {t('review.cancel')}
        </Button>
      </div>
    </form>
  );
}
