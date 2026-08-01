/**
 * Charts — SVG, server-rendered, no charting library.
 *
 * ── WHY NOT A LIBRARY ─────────────────────────────────────────────────
 *
 * Recharts is around 400kB before your own code, and it needs a client
 * component and a mount before it draws anything — so the very first paint of
 * an analytics page is an empty box, on a page whose entire job is showing
 * numbers. Everything here renders on the server, in the HTML, with no
 * JavaScript at all. The chart is visible in the same paint as the heading
 * above it.
 *
 * ── WHY NOT THE DIVS THIS REPLACED ────────────────────────────────────
 *
 * The previous version drew everything with `<div>`s and inline widths. That is
 * genuinely fine for a progress bar and quietly hopeless for a chart, because a
 * div cannot have an axis. You got bars of relative height with no scale, so
 * "the tallest one" was the only readable fact — you could not tell whether the
 * peak was forty calls or four thousand, and two charts side by side looked
 * comparable when they were not. Every chart here has a labelled scale.
 *
 * ── HOVER WITHOUT JAVASCRIPT ──────────────────────────────────────────
 *
 * SVG has a native `<title>` element: the browser shows it as a tooltip on
 * hover, with no listener, no state and no hydration. It is slower to appear
 * than a JS tooltip and it works in a server component, which is the trade
 * being made. Wider invisible hit areas sit over thin marks so you do not have
 * to hover a two-pixel line.
 *
 * ── ACCESSIBILITY ─────────────────────────────────────────────────────
 *
 * Every chart carries a visually-hidden table of the same numbers. A bar you
 * cannot read is not a chart, it is decoration — and the table is also what
 * makes the data selectable and copyable, which people ask for far more often
 * than they ask for a chart.
 *
 * ── COLOUR ────────────────────────────────────────────────────────────
 *
 * Always a `--chart-*` token, never a literal, so light mode needs no second
 * implementation. SVG needs the CSS variable directly rather than a Tailwind
 * class, hence `stroke="var(--chart-1)"` — the tokens are declared in
 * `globals.css` for both themes and resolve per theme automatically.
 *
 * The *raw* token is used rather than the Tailwind-facing `--color-*` alias.
 * `@theme inline` exists precisely so utilities inline their values instead of
 * referencing a variable, which makes the alias an implementation detail of the
 * utility layer; the raw names are declared on `:root` and on
 * `[data-theme="light"]` directly, so they are the ones safe to name in SVG.
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

/** The same five, as CSS values, for anything drawn in SVG. */
export const seriesVar = (i: number) => `var(--chart-${(i % 5) + 1})`

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

function Nothing({ what = "Nothing yet." }: { what?: string }) {
  return <p className="px-5 py-10 text-center text-[13px] text-subtle">{what}</p>
}

/* ── Scales ────────────────────────────────────────────────────────────── */

/**
 * A rounded top for the axis, and the ticks to go with it.
 *
 * Charts that scale to the exact maximum put the tallest bar flush against the
 * top edge, which reads as clipped, and give you tick labels like 0 / 1,847 /
 * 3,694. Rounding up to 1, 2 or 5 times a power of ten gives round numbers and
 * a little headroom, which is what makes a scale legible at a glance.
 */
export function niceMax(value: number): number {
  if (value <= 0) return 1
  const mag = Math.pow(10, Math.floor(Math.log10(value)))
  const norm = value / mag
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10
  return step * mag
}

export function ticks(max: number, count = 4): number[] {
  return Array.from({ length: count + 1 }, (_, i) => (max / count) * i)
}

export const compact = (v: number) =>
  v >= 1_000_000 ? `${(v / 1_000_000).toFixed(v % 1_000_000 ? 1 : 0)}M`
  : v >= 1_000   ? `${(v / 1_000).toFixed(v % 1_000 ? 1 : 0)}k`
  : String(Math.round(v))

/* ── Column chart ──────────────────────────────────────────────────────── */

export function ColumnChart({
  points,
  label,
  format = v => String(v),
  height = 200,
  colour = 0,
}: {
  points: { day: string; value: number }[]
  label: string
  format?: (value: number) => string
  height?: number
  colour?: number
}) {
  if (!points.length) return <Nothing />

  const max = niceMax(Math.max(...points.map(p => p.value)))
  const PAD_L = 38
  const PAD_B = 22
  const W = 720
  const plotW = W - PAD_L - 8
  const plotH = height - PAD_B - 8

  const bw = plotW / points.length
  // A gap that shrinks as the bars do, so ninety days is still readable.
  const gap = Math.min(4, Math.max(1, bw * 0.18))

  const labelEvery = Math.max(1, Math.ceil(points.length / 8))

  return (
    <figure className="px-5 py-5" role="img" aria-label={label}>
      {/* No fixed CSS height and no `preserveAspectRatio="none"`. Both were
          tried: the first letterboxes the drawing inside the box, the second
          stretches the tick labels horizontally on a wide screen. Letting the
          viewBox set the aspect ratio scales the type with everything else,
          which is the only version that looks right at every width. */}
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" aria-hidden="true">
        {/* Gridlines and the scale. Drawn first so the bars sit over them. */}
        {ticks(max).map(t => {
          const y = 8 + plotH - (t / max) * plotH
          return (
            <g key={t}>
              <line
                x1={PAD_L} x2={W - 8} y1={y} y2={y}
                stroke="var(--line)" strokeWidth={1}
                // Zero is the baseline, not a gridline — it wants to look solid.
                strokeDasharray={t === 0 ? undefined : "3 4"}
              />
              <text
                x={PAD_L - 8} y={y + 3.5}
                textAnchor="end"
                fill="var(--subtle)"
                fontSize={10}
              >
                {compact(t)}
              </text>
            </g>
          )
        })}

        {points.map((p, i) => {
          const h = max > 0 ? (p.value / max) * plotH : 0
          const x = PAD_L + i * bw + gap / 2
          const w = Math.max(1, bw - gap)
          return (
            <g key={p.day}>
              {/* A zero day still needs a visible floor, or the axis looks
                  broken and a run of quiet days looks like missing data. */}
              <rect
                x={x}
                y={8 + plotH - Math.max(h, p.value > 0 ? 2 : 1)}
                width={w}
                height={Math.max(h, p.value > 0 ? 2 : 1)}
                rx={Math.min(2, w / 3)}
                fill={p.value > 0 ? seriesVar(colour) : "var(--chart-track)"}
              />
              {/* Full-height hit area, so hovering anywhere in the column
                  works rather than only the few pixels of a short bar. */}
              <rect x={x} y={8} width={w} height={plotH} fill="transparent">
                <title>{`${p.day}: ${format(p.value)}`}</title>
              </rect>
            </g>
          )
        })}
      </svg>

      <div className="mt-1.5 flex" style={{ paddingLeft: `${(PAD_L / W) * 100}%` }}>
        {points.map((p, i) => (
          <span key={p.day} className="flex-1 truncate text-center text-[10px] text-subtle">
            {i % labelEvery === 0 ? p.day.slice(5) : ""}
          </span>
        ))}
      </div>

      <DataTable
        caption={label}
        valueLabel="Value"
        rows={points.map(p => ({ label: p.day, value: format(p.value) }))}
      />
    </figure>
  )
}

/* ── Line and area ─────────────────────────────────────────────────────── */

/**
 * For anything where the *shape* is the point — a rate over time, a cost curve.
 *
 * Bars invite comparing individual days; a line invites reading a trend. Which
 * one is right depends on the question, so both exist rather than one being
 * declared the house chart.
 */
export function AreaChart({
  points,
  label,
  format = v => String(v),
  height = 200,
  colour = 0,
  /** Cap the axis at 100 for percentages, so 60% never looks like a peak. */
  maxOverride,
}: {
  points: { day: string; value: number }[]
  label: string
  format?: (value: number) => string
  height?: number
  colour?: number
  maxOverride?: number
}) {
  if (points.length < 2) return <Nothing what="Not enough days yet." />

  const max = maxOverride ?? niceMax(Math.max(...points.map(p => p.value)))
  const PAD_L = 38
  const PAD_B = 22
  const W = 720
  const plotW = W - PAD_L - 8
  const plotH = height - PAD_B - 8

  const x = (i: number) => PAD_L + (i / (points.length - 1)) * plotW
  const y = (v: number) => 8 + plotH - (max > 0 ? (v / max) * plotH : 0)

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ")
  const area = `${line} L${x(points.length - 1).toFixed(1)},${8 + plotH} L${x(0).toFixed(1)},${8 + plotH} Z`

  const labelEvery = Math.max(1, Math.ceil(points.length / 8))
  const id = `area-${label.replace(/\W+/g, "")}`

  return (
    <figure className="px-5 py-5" role="img" aria-label={label}>
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" aria-hidden="true">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={seriesVar(colour)} stopOpacity="0.28" />
            <stop offset="100%" stopColor={seriesVar(colour)} stopOpacity="0" />
          </linearGradient>
        </defs>

        {ticks(max).map(t => {
          const ty = y(t)
          return (
            <g key={t}>
              <line
                x1={PAD_L} x2={W - 8} y1={ty} y2={ty}
                stroke="var(--line)" strokeWidth={1}
                strokeDasharray={t === 0 ? undefined : "3 4"}
              />
              <text x={PAD_L - 8} y={ty + 3.5} textAnchor="end" fill="var(--subtle)" fontSize={10}>
                {compact(t)}
              </text>
            </g>
          )
        })}

        <path d={area} fill={`url(#${id})`} />
        <path
          d={line}
          fill="none"
          stroke={seriesVar(colour)}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {points.map((p, i) => (
          <g key={p.day}>
            <circle cx={x(i)} cy={y(p.value)} r={2.5} fill={seriesVar(colour)} opacity={points.length > 40 ? 0 : 1} />
            <rect
              x={x(i) - plotW / points.length / 2}
              y={8}
              width={plotW / points.length}
              height={plotH}
              fill="transparent"
            >
              <title>{`${p.day}: ${format(p.value)}`}</title>
            </rect>
          </g>
        ))}
      </svg>

      <div className="mt-1.5 flex" style={{ paddingLeft: `${(PAD_L / W) * 100}%` }}>
        {points.map((p, i) => (
          <span key={p.day} className="flex-1 truncate text-center text-[10px] text-subtle">
            {i % labelEvery === 0 ? p.day.slice(5) : ""}
          </span>
        ))}
      </div>

      <DataTable
        caption={label}
        valueLabel="Value"
        rows={points.map(p => ({ label: p.day, value: format(p.value) }))}
      />
    </figure>
  )
}

/* ── Sparkline ─────────────────────────────────────────────────────────── */

/**
 * The line that goes inside a stat card.
 *
 * No axis, no labels, no tooltip — deliberately. It answers "roughly what shape
 * did this take" and nothing more; the moment it tries to answer more than that
 * it competes with the number it sits under.
 *
 * ── TWO THINGS THAT LOOKED WRONG AND WERE ─────────────────────────────
 *
 * `preserveAspectRatio="none"` is right for the *line* — a sparkline is meant
 * to fill its box regardless of shape, and that is why the stroke carries
 * `non-scaling-stroke` to stay an even weight. It is wrong for anything with a
 * shape of its own: a `<circle>` in a viewBox stretched two and a half times
 * horizontally is not a circle, it is a lopsided blob, and the marker on the
 * last point rendered as exactly that.
 *
 * The line also ran flush to the top and bottom edges, so a final upstroke
 * looked like an arrow leaving the card rather than a value. A pixel of padding
 * at each end fixes it, and costs nothing — the vertical scale here is relative
 * anyway.
 */
export function Sparkline({
  values,
  colour = 0,
  height = 30,
  label,
}: {
  values: number[]
  colour?: number
  height?: number
  label?: string
}) {
  if (values.length < 2) return null

  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const span = max - min || 1
  const W = 120

  // Breathing room top and bottom, so a peak is a peak and not a clipped edge.
  const PAD = 3

  const x = (i: number) => (i / (values.length - 1)) * W
  const y = (v: number) => height - PAD - ((v - min) / span) * (height - PAD * 2)

  const line = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")

  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      className="w-full overflow-hidden"
      style={{ height }}
      preserveAspectRatio="none"
      role="img"
      aria-label={label ?? "Trend"}
    >
      <path
        d={`${line} L${W},${height} L0,${height} Z`}
        fill={seriesVar(colour)}
        opacity={0.14}
      />
      <path
        d={line}
        fill="none"
        stroke={seriesVar(colour)}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

/* ── Donut ─────────────────────────────────────────────────────────────── */

/**
 * Share of a whole, with the total in the middle.
 *
 * Only ever for parts of one thing — a donut of unrelated quantities is a
 * classic way to make a chart that looks informative and means nothing. Slices
 * under 2% are still drawn, because vanishing entirely reads as "we lost some
 * calls" rather than "that outcome is rare".
 */
export function Donut({
  rows,
  label,
  centreValue,
  centreLabel,
  size = 168,
}: {
  rows: { label: string; value: number }[]
  label: string
  centreValue?: string
  centreLabel?: string
  size?: number
}) {
  const total = rows.reduce((s, r) => s + r.value, 0)
  if (total === 0) return <Nothing />

  const R = size / 2
  const stroke = size * 0.16
  const r = R - stroke / 2
  const circumference = 2 * Math.PI * r

  let offset = 0

  return (
    <figure className="flex flex-wrap items-center gap-6 px-5 py-5" role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" aria-hidden="true">
        <g transform={`rotate(-90 ${R} ${R})`}>
          <circle cx={R} cy={R} r={r} fill="none" stroke="var(--chart-track)" strokeWidth={stroke} />
          {rows.map((row, i) => {
            const frac = row.value / total
            const dash = frac * circumference
            const el = (
              <circle
                key={row.label}
                cx={R} cy={R} r={r}
                fill="none"
                stroke={seriesVar(i)}
                strokeWidth={stroke}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
              >
                <title>{`${row.label}: ${row.value} (${Math.round(frac * 100)}%)`}</title>
              </circle>
            )
            offset += dash
            return el
          })}
        </g>
        {centreValue && (
          <>
            <text
              x={R} y={R - 2}
              textAnchor="middle"
              fill="var(--fg)"
              fontSize={size * 0.17}
              fontWeight={600}
            >
              {centreValue}
            </text>
            {centreLabel && (
              <text x={R} y={R + size * 0.11} textAnchor="middle" fill="var(--subtle)" fontSize={size * 0.075}>
                {centreLabel}
              </text>
            )}
          </>
        )}
      </svg>

      <ul className="min-w-0 flex-1 space-y-2">
        {rows.map((row, i) => (
          <li key={row.label} className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: seriesVar(i) }}
            />
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">{row.label}</span>
            <span className="shrink-0 text-[12.5px] tabular-nums text-fg">{row.value}</span>
            <span className="w-9 shrink-0 text-right text-[11.5px] tabular-nums text-subtle">
              {Math.round((row.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>

      <DataTable
        caption={label}
        valueLabel="Count"
        rows={rows.map(r => ({ label: r.label, value: String(r.value) }))}
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
  /** Colour each row from the series instead of using one colour throughout. */
  rainbow = false,
}: {
  rows: { label: string; value: number }[]
  label: string
  format?: (value: number) => string
  colour?: number
  rainbow?: boolean
}) {
  const max = Math.max(1, ...rows.map(r => r.value))

  if (rows.length === 0) return <Nothing />

  return (
    <figure className="space-y-3 px-5 py-5" role="img" aria-label={label}>
      {rows.map((r, i) => (
        <div key={r.label} className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-[13px]">{r.label}</span>
            <span className="shrink-0 text-[12.5px] tabular-nums text-muted">
              {format(r.value)}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-chart-track">
            <div
              className={cn("h-full rounded-full", seriesColour(rainbow ? i : colour))}
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

  if (total === 0) return <Nothing />

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

/* ── When the phone rings ──────────────────────────────────────────────── */

const DAY_NAME = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

/**
 * Hour of day by day of week.
 *
 * This is the chart that changes what somebody does. A tenant whose calls all
 * land between 8 and 10am does not need a better agent, they need a second
 * number; one whose Saturdays are dead can stop paying somebody to cover them.
 * Neither fact is visible in any total.
 *
 * `cells` is a 7×24 grid indexed `[weekday][hour]`, Monday first, in the
 * tenant's own timezone — bucketing in UTC would smear every business's morning
 * across two columns.
 */
export function HeatGrid({
  cells,
  label,
  format = v => `${v}`,
}: {
  cells: number[][]
  label: string
  format?: (v: number) => string
}) {
  const flat = cells.flat()
  const max = Math.max(1, ...flat)
  if (flat.every(v => v === 0)) return <Nothing />

  return (
    <figure className="px-5 py-5" role="img" aria-label={label}>
      <div className="overflow-x-auto">
        <div className="min-w-[520px]">
          <div className="flex">
            <span className="w-9 shrink-0" />
            <div className="flex flex-1">
              {Array.from({ length: 24 }, (_, h) => (
                <span key={h} className="flex-1 text-center text-[9px] text-subtle">
                  {h % 3 === 0 ? h : ""}
                </span>
              ))}
            </div>
          </div>

          {cells.map((row, d) => (
            <div key={d} className="mt-1 flex items-center">
              <span className="w-9 shrink-0 text-[10.5px] text-subtle">{DAY_NAME[d]}</span>
              <div className="flex flex-1 gap-[2px]">
                {row.map((v, h) => (
                  <div
                    key={h}
                    title={`${DAY_NAME[d]} ${String(h).padStart(2, "0")}:00 — ${format(v)}`}
                    className="h-4 flex-1 rounded-[2px]"
                    style={{
                      // A floor of 0.08 so an empty hour is still a cell rather
                      // than a hole in the grid.
                      background: v === 0
                        ? "var(--chart-track)"
                        : seriesVar(0),
                      opacity: v === 0 ? 1 : 0.25 + (v / max) * 0.75,
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <DataTable
        caption={label}
        valueLabel="Calls"
        rows={cells.flatMap((row, d) =>
          row
            .map((v, h) => ({ label: `${DAY_NAME[d]} ${String(h).padStart(2, "0")}:00`, value: String(v) }))
            .filter(r => r.value !== "0")
        )}
      />
    </figure>
  )
}

/* ── One number as a proportion ────────────────────────────────────────── */

/**
 * A rate, with its denominator visible.
 *
 * The denominator is not optional. "68% connected" out of 9 calls and out of
 * 900 calls are different facts, and a percentage on its own hides which one
 * you are looking at — which is how a tenant concludes their agent got worse
 * on a quiet Tuesday.
 */
export function Meter({
  value,
  of,
  label,
  suffix = "",
  colour = 0,
}: {
  value: number
  of: number
  label: string
  suffix?: string
  colour?: number
}) {
  const pct = of > 0 ? (value / of) * 100 : 0

  return (
    <div className="px-5 py-5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-muted">{label}</span>
        <span className="text-[15px] font-semibold tabular-nums">
          {of > 0 ? `${pct.toFixed(pct < 10 ? 1 : 0)}%` : "—"}
          {suffix}
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-chart-track">
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${Math.min(100, Math.max(pct, of > 0 ? 1.5 : 0))}%`, background: seriesVar(colour) }}
        />
      </div>
      <p className="mt-1.5 text-[11.5px] font-light text-subtle">
        {value.toLocaleString()} of {of.toLocaleString()}
      </p>
    </div>
  )
}

/* ── Funnel ────────────────────────────────────────────────────────────── */

/**
 * Stages that only ever shrink.
 *
 * Percentages are shown against the *previous* stage as well as the first,
 * because those answer different questions: "half our leads never connect" and
 * "of the ones we reach, four in five book" are both worth knowing and only one
 * of them is visible if you index everything to the top.
 */
export function Funnel({
  stages,
  label,
}: {
  stages: { label: string; value: number }[]
  label: string
}) {
  const top = stages[0]?.value ?? 0
  if (!stages.length || top === 0) return <Nothing />

  return (
    <figure className="space-y-2.5 px-5 py-5" role="img" aria-label={label}>
      {stages.map((s, i) => {
        const prev = i === 0 ? s.value : stages[i - 1]!.value
        const ofTop = (s.value / top) * 100
        const ofPrev = prev > 0 ? (s.value / prev) * 100 : 0
        return (
          <div key={s.label}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-[13px]">{s.label}</span>
              <span className="shrink-0 text-[12.5px] tabular-nums text-muted">
                {s.value.toLocaleString()}
                {i > 0 && (
                  <span className="ml-2 text-subtle">{ofPrev.toFixed(0)}% of previous</span>
                )}
              </span>
            </div>
            <div className="mt-1.5 h-6 overflow-hidden rounded-xs bg-chart-track">
              <div
                className="flex h-full items-center justify-end rounded-xs pr-2"
                style={{ width: `${Math.max(ofTop, 3)}%`, background: seriesVar(i) }}
              >
                <span className="text-[10.5px] font-medium text-on-brand">
                  {ofTop.toFixed(0)}%
                </span>
              </div>
            </div>
          </div>
        )
      })}

      <DataTable
        caption={label}
        valueLabel="Count"
        rows={stages.map(s => ({ label: s.label, value: String(s.value) }))}
      />
    </figure>
  )
}
