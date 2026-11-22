import { formatDayShort, isoWeekday, type MonthlyReport } from '@parksmart/shared';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

type Day = MonthlyReport['days'][number];

const monthShort = new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' });
/** Week ticks: label each Monday, plus the first day when no Monday is close to it. */
function tickLabel(days: Day[], i: number): string | null {
  const d = days[i]!;
  const firstMonday = days.findIndex((x) => isoWeekday(x.date) === 1);
  const show = isoWeekday(d.date) === 1 || (i === 0 && (firstMonday === -1 || firstMonday >= 3));
  return show
    ? `${Number(d.date.slice(8))} ${monthShort.format(new Date(`${d.date}T00:00:00Z`))}`
    : null;
}

const HEIGHT = 220; // plot height
const AXIS = 28; // x-axis band (included in the SVG height, so labels never clip)
const LEFT = 36;
const TOP = 12;
const BAR_MAX = 24; // marks spec: bars <= 24px
const GAP = 2; // surface gap between adjacent bars
const TARGET = 0.9;
const MIN_SLOT = 12; // below this the chart scrolls sideways instead of squeezing

/** Rounded data-end (4px) at the top, square at the baseline. */
function columnPath(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/**
 * Daily utilisation (FR-28). Emphasis form: peak days in the accent, other days in the
 * de-emphasis gray, with a 90% target line. One axis, hairline grid, per-bar tooltip
 * on hover and keyboard focus; the table view below carries every value.
 */
export function UtilisationChart({ days }: { days: Day[] }) {
  const { t } = useTranslation();
  const [active, setActive] = useState<number | null>(null);
  // Fit the card's width; only a phone with a long month scrolls horizontally.
  const box = useRef<HTMLDivElement>(null);
  const [boxW, setBoxW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => e && setBoxW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const width = Math.max(boxW, days.length * MIN_SLOT + LEFT + 8);
  const plotW = width - LEFT - 8;
  const slot = days.length ? plotW / days.length : plotW;
  const barW = Math.min(BAR_MAX, Math.max(4, slot - GAP));
  const y = (v: number) => TOP + HEIGHT - v * HEIGHT;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const shown = active !== null ? days[active] : null;

  return (
    <figure className="flex flex-col gap-2">
      <ul className="flex flex-wrap gap-4 text-xs" aria-label={t('analytics.legend')}>
        <li className="flex items-center gap-1.5">
          <span
            className="size-3 rounded-sm"
            style={{ background: 'var(--viz-accent)' }}
            aria-hidden
          />
          {t('analytics.peakDays')}
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="size-3 rounded-sm"
            style={{ background: 'var(--viz-muted)' }}
            aria-hidden
          />
          {t('analytics.otherDays')}
        </li>
      </ul>
      <div ref={box} className="relative w-full overflow-x-auto">
        <svg
          width={width}
          height={TOP + HEIGHT + AXIS}
          role="group"
          aria-label={t('analytics.chartLabel')}
          className="block"
          onPointerLeave={() => setActive(null)}
        >
          {ticks.map((v) => (
            <g key={v}>
              <line
                x1={LEFT}
                x2={width - 8}
                y1={y(v)}
                y2={y(v)}
                stroke={v === 0 ? 'var(--viz-axis)' : 'var(--viz-grid)'}
                strokeWidth={1}
              />
              <text
                x={LEFT - 6}
                y={y(v) + 4}
                textAnchor="end"
                fontSize={11}
                fill="var(--viz-ink-2)"
                className="tabular-nums"
              >
                {Math.round(v * 100)}%
              </text>
            </g>
          ))}
          {/* Target: a threshold, so dashed (gridlines stay solid). */}
          <line
            x1={LEFT}
            x2={width - 8}
            y1={y(TARGET)}
            y2={y(TARGET)}
            stroke="var(--viz-ink-2)"
            strokeWidth={1}
            strokeDasharray="4 3"
          />
          <text
            x={width - 10}
            y={y(TARGET) - 4}
            textAnchor="end"
            fontSize={11}
            fill="var(--viz-ink-2)"
          >
            {t('analytics.target', { pct: 90 })}
          </text>
          {days.map((d, i) => {
            const x = LEFT + i * slot + (slot - barW) / 2;
            const v = d.utilisation ?? 0;
            const h = Math.max(0, v * HEIGHT);
            const label = `${formatDayShort(d.date)}: ${
              d.utilisation === null ? t('analytics.noData') : `${Math.round(v * 100)}%`
            }${d.peak ? `, ${t('analytics.peakDay')}` : ''}`;
            return (
              <g
                key={d.date}
                tabIndex={0}
                role="img"
                aria-label={label}
                onPointerEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                className="outline-none focus-visible:[&>rect:last-child]:stroke-[var(--viz-ink-2)]"
              >
                {h > 0 && (
                  <path
                    d={columnPath(x, y(v), barW, h)}
                    fill={d.peak ? 'var(--viz-accent)' : 'var(--viz-muted)'}
                    opacity={active === null || active === i ? 1 : 0.55}
                  />
                )}
                {/* Hit target: the whole slot, taller than the mark. */}
                <rect
                  x={LEFT + i * slot}
                  y={TOP}
                  width={slot}
                  height={HEIGHT}
                  fill="transparent"
                  strokeWidth={1}
                  rx={4}
                />
                {tickLabel(days, i) && (
                  <text
                    x={x + barW / 2}
                    y={TOP + HEIGHT + 18}
                    textAnchor="middle"
                    fontSize={10}
                    fill="var(--viz-ink-2)"
                  >
                    {tickLabel(days, i)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {shown && active !== null && (
          <div
            role="status"
            className="pointer-events-none absolute top-1 rounded-md border bg-card px-2.5 py-1.5 text-xs shadow-sm"
            style={{ left: Math.min(LEFT + active * slot + slot, width - 150) }}
          >
            <div className="text-sm font-semibold">
              {shown.utilisation === null
                ? t('analytics.noData')
                : `${Math.round(shown.utilisation * 100)}%`}
            </div>
            <div className="text-muted-foreground">
              {formatDayShort(shown.date)}
              {shown.peak && ` · ${t('analytics.peakDay')}`}
            </div>
            <div className="text-muted-foreground">
              {t('analytics.tooltipCounts', {
                checkedIn: shown.checkedIn,
                released: shown.autoReleased,
              })}
            </div>
          </div>
        )}
      </div>
    </figure>
  );
}
