/**
 * The dialer's dials. Every number that bounds it lives here rather than being
 * scattered as literals, because most of them are trade-offs rather than facts
 * and the reasoning has to sit next to the value.
 *
 * Client-safe: constants only.
 */

/* ── Leases ─────────────────────────────────────────────────────────────
 *
 * A lease is how long we hold a lead before admitting we do not know what
 * happened to it. Crossing one never causes a dial — only a question to the
 * provider. See lib/dialer/reap.ts.
 */

/** Claim → the provider says it is ringing. Covers queueing and connect. */
export const CONNECT_LEASE_SECONDS = 90

/** Extra time on top of the agent's own maxDurationSeconds once it is live. */
export const TALK_LEASE_MARGIN_SECONDS = 120

/** While the reaper is asking about it. Stops two reapers fighting over a row. */
export const RECONCILE_LEASE_SECONDS = 120

/* ── Tick budget ────────────────────────────────────────────────────────
 *
 * The heartbeat exists to start campaigns that have nothing in flight to pump
 * them, to reap expired leases, and to recover dropped work. In steady state the
 * webhook does nearly all the dialling — every ended call starts the next — so
 * these bound a cold start and a repair, not throughput.
 */

/**
 * The cron route's function timeout. The tick stops well before it.
 *
 * Mirrored as a literal in `app/api/cron/dialer/route.ts` rather than imported
 * there: route segment config is read by statically analysing that file at
 * build time, before any module runs, so importing this one fails the build
 * with "Invalid segment configuration export detected". Change both together.
 */
export const TICK_MAX_DURATION_SECONDS = 60

/** Internal deadline, leaving room to finish tidily rather than be killed. */
export const TICK_DEADLINE_MS = 45_000

export const MAX_CAMPAIGNS_PER_TICK = 25
export const MAX_DIALS_PER_TICK = 60
export const MAX_REAPS_PER_TICK = 10

/**
 * Most one claim will take at once.
 *
 * Also the bound on how far the platform-wide cap can overshoot: that tier is
 * counted rather than locked, and the only concurrent claimers are
 * webhook-driven advances, so the worst case is (simultaneous call-ends × this).
 */
export const BATCH_CEILING = 8

/**
 * Concurrent provider calls inside one tick. Three, not five.
 *
 * The `pg` pool is capped at five connections per function instance and the Vapi
 * webhook may well land on the same warm instance. Each dial touches the
 * database twice, so at five the tick holds every connection and the webhook
 * waits — which makes Vapi retry, which makes more webhooks. One connection
 * stays free on purpose.
 */
export const DIAL_CONCURRENCY = 3

/** Per provider request inside the tick. The client's own default is longer. */
export const PROVIDER_TIMEOUT_MS = 10_000

/* ── Recovery ───────────────────────────────────────────────────────── */

/**
 * How long to keep trying to attribute a dial whose create response never
 * arrived, before giving up and marking the attempt LOST.
 *
 * The lead then goes back to the queue with the attempt *counted*, never
 * uncounted: we may well have called that person, and calling them twice is a
 * worse outcome than calling them once.
 */
export const ATTRIBUTION_GRACE_MS = 3 * 60_000
