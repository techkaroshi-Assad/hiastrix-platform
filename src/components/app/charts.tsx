/**
 * Charts — no charting library.
 *
 * A charting dependency would add hundreds of kilobytes to a dashboard bundle
 * for four simple shapes. These are flex boxes and inline SVG, server-rendered,
 * with no hooks and no client directive.
 *
 * Colour comes from --chart-* tokens, never a literal, so light mode is free.
 * Every chart carries a visually-hidden table of the same numbers: a bar you
 * cannot read is not a chart, it is decoration.
 */

import { cn } from "@/lib/utils"

const SERIES = [
  "bg-chart-1",
  "bg-chart-2",
  "bg-chart-3",
  "bg-chart-4",
  "bg-chart-5",
] as const

export const seriesColour = (i: number) => SERIES[i % SERIES.length]

/* ── Hidden data table ─────────────────────────────────────────────────── */

function DataTable({
  caption,
  rows,
  valueLabel,
}: {
  caption: string
  rows: { label: string; value: string }[]
  valueLabel: string
}) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Item</th>
          <th scope="col">{valueLabel}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.label}>
            <th scope="row">{r.label}</th>
            <td>{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/* ── Column chart ──────────────────────────────────────────────────────── */

export function ColumnChart({
  points,
  label,
  format = v => String(v),
}: {
  points: { day: string; value: number }[]
  label: string
  format?: (value: number) => string
}) {
  const max = Math.max(1, ...points.map(p => p.value))

  // Enough labels to orient, few enough to stay legible.
  const step = Math.max(1, Math.ceil(points.length / 7))

  return (
    <figure className="px-5 py-5" role="img" aria-label={label}>
      <div className="flex h-44 items-end gap-[3px]">
        {points.map((p, i) => {
          const pct = (p.value / max) * 100
          return (
            <div key={p.day} className="group relative flex flex-1 flex-col justify-end">
              <div
                className={cn(
                  "w-full rounded-t-[3px] transition-[height] duration-500",
                  p.value > 0 ? "bg-chart-1" : "bg-chart-track"
                )}
                // A zero day still needs a visible floor, or the axis looks broken.
                style={{ height: p.value > 0 ? `${Math.max(pct, 2)}%` : "2px" }}
              >
                <title>{`${p.day}: ${format(p.value)}`}</title>
              </div>
              {i % step === 0 && (
                <span className="mt-2 block truncate text-center text-[10px] text-subtle">
                  {p.day.slice(5)}
                </span>
              )}
            </div>
          )
        })}
      </div>

      <DataTable
        caption={label}
        valueLabel="Value"
        rows={points.map(p => ({ label: p.day, value: format(p.value) }))}
      />
    </figure>
  )
}

/* ── Horizontal bar list ───────────────────────────────────────────────── */

export function HBarList({
  rows,
  label,
  format = v => String(v),
  colour = 0,
}: {
  rows: { label: string; value: number }[]
  label: string
  format?: (value: number) => string
  colour?: number
}) {
  const max = Math.max(1, ...rows.map(r => r.value))

  if (rows.length === 0) {
    return <p className="px-5 py-8 text-center text-[13px] text-subtle">Nothing yet.</p>
  }

  return (
    <figure className="space-y-3 px-5 py-5" role="img" aria-label={label}>
      {rows.map(r => (
        <div key={r.label} className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-[13px]">{r.label}</span>
            <span className="shrink-0 text-[12.5px] tabular-nums text-muted">
              {format(r.value)}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-chart-track">
            <div
              className={cn("h-full rounded-full", seriesColour(colour))}
              style={{ width: `${Math.max((r.value / max) * 100, 1.5)}%` }}
            />
          </div>
        </div>
      ))}

      <DataTable
        caption={label}
        valueLabel="Value"
        rows={rows.map(r => ({ label: r.label, value: format(r.value) }))}
      />
    </figure>
  )
}

/* ── Stacked bar ───────────────────────────────────────────────────────── */

export function StackedBar({
  rows,
  label,
}: {
  rows: { label: string; value: number }[]
  label: string
}) {
  const total = rows.reduce((sum, r) => sum + r.value, 0)

  if (total === 0) {
    return <p className="px-5 py-8 text-center text-[13px] text-subtle">Nothing yet.</p>
  }

  return (
    <figure className="space-y-4 px-5 py-5" role="img" aria-label={label}>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-chart-track">
        {rows.map((r, i) => (
          <div
            key={r.label}
            className={seriesColour(i)}
            style={{ width: `${(r.value / total) * 100}%` }}
          >
            <title>{`${r.label}: ${r.value}`}</title>
          </div>
        ))}
      </div>

      <ul className="flex flex-wrap gap-x-5 gap-y-2">
        {rows.map((r, i) => (
          <li key={r.label} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={cn("h-2 w-2 shrink-0 rounded-full", seriesColour(i))}
            />
            <span className="text-[12.5px] text-muted">
              {r.label}{" "}
              <span className="tabular-nums text-subtle">
                {Math.round((r.value / total) * 100)}%
              </span>
            </span>
          </li>
        ))}
      </ul>

      <DataTable
        caption={label}
        valueLabel="Calls"
        rows={rows.map(r => ({ label: r.label, value: String(r.value) }))}
      />
    </figure>
  )
}
