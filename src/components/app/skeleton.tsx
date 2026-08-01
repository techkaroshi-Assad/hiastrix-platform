/**
 * Skeletons.
 *
 * ── WHY THESE EXIST ───────────────────────────────────────────────────
 *
 * There were none, anywhere, and no `loading.tsx` either. Every dashboard page
 * is an async server component that awaits a handful of Prisma queries, so
 * clicking a nav item did this: nothing happened, for as long as the database
 * took, while you continued to look at the page you had just left. Then the
 * whole screen replaced itself at once.
 *
 * That reads as "the app is slow" whether the wait is eighty milliseconds or
 * eight hundred, because there is no other signal to read it as. The fix is not
 * a faster query. It is telling the truth immediately: you clicked, we heard
 * you, here is the shape of what is coming.
 *
 * ── WHY THEY MIRROR THE PAGE ──────────────────────────────────────────
 *
 * A centred spinner would be less work and worse. It says "wait" and nothing
 * else, and when the content lands it lands somewhere the spinner never
 * suggested, so the page jumps. A skeleton in the shape of the real thing means
 * the layout is already correct before the data arrives, and the swap is a
 * fill-in rather than a redraw.
 *
 * Which is why these are per-route rather than generic. `calls/loading.tsx`
 * draws a table with eight columns because the calls page has eight columns.
 *
 * ── ON THE ANIMATION ──────────────────────────────────────────────────
 *
 * A pulse, not a spinner, and one shared `animate-pulse` rather than a sheen
 * per bar: forty independently animating gradients on one screen is a lot of
 * compositing for something nobody is meant to look at. The whole thing is
 * `aria-hidden` and announced once by its container, so a screen reader hears
 * "loading" rather than sixty empty boxes.
 */

import { cn } from "@/lib/utils"

/* ── The bar everything is made of ─────────────────────────────────────── */

export function Bar({
  className,
  w,
  h = 12,
}: {
  className?: string
  /** Width, as a Tailwind arbitrary value or a fraction class. */
  w?: string
  h?: number
}) {
  return (
    <div
      className={cn("rounded-xs bg-field-hover", w, className)}
      style={{ height: h }}
    />
  )
}

/** Wraps a whole skeleton so assistive tech hears one message, not sixty. */
export function Skeleton({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" aria-label="Loading" aria-live="polite" className="animate-pulse">
      <div aria-hidden="true">{children}</div>
    </div>
  )
}

/* ── Compositions ──────────────────────────────────────────────────────── */

/** The four-up figure row that opens Overview, Analytics and Billing. */
export function StatRowSkeleton({ n = 4 }: { n?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: n }, (_, i) => (
        <div
          key={i}
          className="rounded-2xl border border-line bg-linear-to-b from-field to-field-soft p-5"
        >
          <Bar w="w-24" h={9} />
          <Bar className="mt-4" w="w-20" h={24} />
          <Bar className="mt-2.5" w="w-28" h={9} />
        </div>
      ))}
    </div>
  )
}

/**
 * A card with a table in it.
 *
 * `cols` is not decoration — the column count is what stops the real table
 * from shifting sideways when it arrives.
 */
export function TableSkeleton({
  rows = 8,
  cols = 6,
  title = true,
}: {
  rows?: number
  cols?: number
  title?: boolean
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-field-soft">
      {title && (
        <div className="border-b border-line px-6 py-4">
          <Bar w="w-32" h={13} />
        </div>
      )}

      <div className="border-b border-line px-6 py-3">
        <div className="flex gap-6">
          {Array.from({ length: cols }, (_, i) => (
            <Bar key={i} className="flex-1" h={9} />
          ))}
        </div>
      </div>

      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="border-b border-line/60 px-6 py-4 last:border-0">
          <div className="flex gap-6">
            {Array.from({ length: cols }, (_, c) => (
              <Bar
                key={c}
                className="flex-1"
                h={11}
                // Slight width variation, so it reads as data rather than as a
                // grid. Deterministic from the indices — a random width would
                // differ between the server render and the client one.
                w={c === 0 ? undefined : (r + c) % 3 === 0 ? "max-w-[60%]" : "max-w-[85%]"}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/** A bordered panel with a heading and some lines. Most detail pages. */
export function PanelSkeleton({
  lines = 4,
  className,
}: {
  lines?: number
  className?: string
}) {
  return (
    <div className={cn("rounded-2xl border border-line bg-field-soft", className)}>
      <div className="border-b border-line px-6 py-4">
        <Bar w="w-40" h={13} />
      </div>
      <div className="space-y-3 px-6 py-5">
        {Array.from({ length: lines }, (_, i) => (
          <Bar key={i} h={11} w={i === lines - 1 ? "w-2/3" : "w-full"} />
        ))}
      </div>
    </div>
  )
}

/** The chart block on Analytics. Height matters more than anything inside it. */
export function ChartSkeleton({ h = 240 }: { h?: number }) {
  return (
    <div className="rounded-2xl border border-line bg-field-soft">
      <div className="border-b border-line px-6 py-4">
        <Bar w="w-36" h={13} />
      </div>
      <div className="px-6 py-6">
        <div className="flex items-end gap-2" style={{ height: h }}>
          {Array.from({ length: 24 }, (_, i) => (
            <div
              key={i}
              className="flex-1 rounded-t-xs bg-field-hover"
              // A fixed pseudo-random profile. Same on the server and the
              // client, so React never complains about a mismatch.
              style={{ height: `${28 + ((i * 37) % 62)}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

/** The card grid on Agents and Campaigns. */
export function CardGridSkeleton({ n = 6 }: { n?: number }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="rounded-2xl border border-line bg-field-soft p-5">
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 shrink-0 rounded-lg bg-field-hover" />
            <div className="min-w-0 flex-1">
              <Bar w="w-28" h={13} />
              <Bar className="mt-2" w="w-20" h={9} />
            </div>
          </div>
          <Bar className="mt-4" h={10} />
          <Bar className="mt-2" w="w-3/4" h={10} />
          <div className="mt-5 flex gap-2">
            <Bar w="w-16" h={26} />
            <Bar w="w-16" h={26} />
          </div>
        </div>
      ))}
    </div>
  )
}

/** The long form on the agent and campaign editors. */
export function FormSkeleton({ fields = 6 }: { fields?: number }) {
  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Bar key={i} w="w-24" h={32} />
        ))}
      </div>
      <div className="rounded-2xl border border-line bg-field-soft px-6 py-6">
        <div className="space-y-6">
          {Array.from({ length: fields }, (_, i) => (
            <div key={i}>
              <Bar w="w-28" h={10} />
              <Bar className="mt-2.5" h={38} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
