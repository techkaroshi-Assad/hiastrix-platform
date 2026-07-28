-- ═══════════════════════════════════════════════════════════════════════
--  Hi-Astrix — outbound campaigns (power dialer)
--
--  Applied to the live US database on 2026-07-28. Kept here so the schema has
--  a written history: Prisma holds no migrations for this project, and every
--  structural change so far was hand-written SQL applied the same way.
--
--  Idempotent throughout — safe to re-run.
--
--  ── WHY THE TABLES ARE SHAPED THIS WAY ────────────────────────────────
--
--  `campaign_leads` is the queue. One row per person per campaign, reused
--  across retries.
--
--  `dial_attempts` is the ledger. One row per dial, written BEFORE the call is
--  placed and never reused, so a row with no provider call id means "we may
--  have dialled this person and we do not know" — which is recoverable. The
--  reverse ordering is not.
--
--  ── WHERE CONCURRENCY IS COUNTED FROM ─────────────────────────────────
--
--  From `campaign_leads`, not from `calls` and not from `dial_attempts`.
--
--  Not `calls`, because call rows are created lazily by the webhook: a call
--  placed two seconds ago does not exist there yet, so pacing off it undercounts
--  by exactly the ramp — worst at the moment a campaign starts.
--
--  Not `dial_attempts` either, which was the first design and was wrong. The
--  ledger row is written by the dialer a moment after the claim, so a second
--  claim landing in that gap saw nothing in flight and claimed a whole batch
--  again. Measured against the live database: with max_concurrent 3, two
--  back-to-back claims returned 3 rows each.
--
--  The lead row is what the claim statement transitions, atomically, under the
--  tenant advisory lock. Counting from it makes the count and the claim the same
--  statement, so there is no window between finding headroom and consuming it.
--  The same two claims now return 3 and then 0.
--
--  RLS is enabled with no policies, matching `tenant_invitations` and
--  `crm_connection`: these tables are reached only by the server through
--  Prisma, so anything holding an anon or authenticated key sees nothing.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Enums ─────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE campaign_state AS ENUM ('DRAFT','RUNNING','PAUSED','COMPLETED','ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE lead_state AS ENUM (
    'PENDING',      -- never attempted, or due now
    'RETRY_WAIT',   -- attempted; next_attempt_at is in the future
    'DEFERRED',     -- due, but outside the campaign's calling window
    'DIALING',      -- claimed, lease held, being placed or ringing
    'IN_PROGRESS',  -- connected
    'COMPLETED',    -- spoken to, or voicemail left under the leave-message policy
    'EXHAUSTED',    -- attempts spent without ever connecting
    'FAILED',       -- permanently undialable
    'SUPPRESSED',   -- do-not-call, opt-out, or over a contact cap
    'CANCELLED'     -- campaign archived, or removed while queued
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE attempt_state AS ENUM (
    'PLACING',      -- ledger row written, provider not yet called
    'DIALING',      -- provider accepted it, ringing
    'IN_PROGRESS',  -- connected
    'RECONCILING',  -- lease expired, asking the provider what happened
    'ENDED',        -- resolved
    'LOST'          -- placed, but never attributable to a provider call
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE voicemail_policy AS ENUM ('LEAVE_MESSAGE','HANG_UP_RETRY','HANG_UP_DONE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE lead_source AS ENUM ('CSV','CRM_TAG','MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE suppression_source AS ENUM ('UPLOAD','MANUAL','CALLER_REQUEST');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Campaigns ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.campaigns (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  agent_id          UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,

  -- Null means rotate round-robin across every number attached to the agent,
  -- which is what protects a single caller ID from being spam-labelled. Set it
  -- only when a campaign must present one specific number.
  phone_number_id   UUID REFERENCES public.phone_numbers(id) ON DELETE SET NULL,

  name              TEXT NOT NULL,
  state             campaign_state NOT NULL DEFAULT 'DRAFT',
  source            lead_source NOT NULL DEFAULT 'CSV',
  -- For CRM_TAG campaigns: the tag the list was pulled from. Kept for the
  -- record, not re-read — the lead set is snapshotted at creation.
  source_ref        TEXT,

  max_concurrent    INTEGER NOT NULL DEFAULT 3  CHECK (max_concurrent BETWEEN 1 AND 100),
  max_attempts      INTEGER NOT NULL DEFAULT 3  CHECK (max_attempts BETWEEN 1 AND 10),

  -- Calling window. Stored as 'HH24:MI' text compared against the same
  -- rendering of now() in `timezone`, which keeps the whole check inside the
  -- claim statement and free of date arithmetic.
  timezone          TEXT NOT NULL DEFAULT 'America/New_York',
  window_start      TEXT NOT NULL DEFAULT '09:00' CHECK (window_start ~ '^[0-2][0-9]:[0-5][0-9]$'),
  window_end        TEXT NOT NULL DEFAULT '19:00' CHECK (window_end   ~ '^[0-2][0-9]:[0-5][0-9]$'),
  window_days       INTEGER[] NOT NULL DEFAULT '{1,2,3,4,5}',   -- ISO day of week, Mon = 1

  voicemail_policy  voicemail_policy NOT NULL DEFAULT 'HANG_UP_RETRY',
  -- Spoken when the policy is LEAVE_MESSAGE. Null under the other two.
  voicemail_message TEXT,

  -- Set on a provider 429. The claim refuses while it is in the future, so a
  -- throttled campaign stops without any in-memory state.
  throttled_until   TIMESTAMPTZ,
  -- Round-robin fairness across campaigns within one heartbeat tick.
  last_ticked_at    TIMESTAMPTZ,

  paused_reason     TEXT,
  created_by        TEXT,
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── The queue ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.campaign_leads (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  -- Denormalised so the claim's concurrency count and the contact-frequency cap
  -- never need a join.
  tenant_id         UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  phone_e164        TEXT NOT NULL,
  contact_name      TEXT,
  crm_contact_id    TEXT,
  -- Merge values for the agent's opening line. Server-side only.
  fields            JSONB NOT NULL DEFAULT '{}'::jsonb,

  priority          SMALLINT NOT NULL DEFAULT 0,
  state             lead_state NOT NULL DEFAULT 'PENDING',

  -- Two budgets, deliberately separate. Provider faults spend `fault_no` so an
  -- outage cannot silently burn a whole list's real attempts.
  attempt_no        INTEGER NOT NULL DEFAULT 0,
  fault_no          INTEGER NOT NULL DEFAULT 0,

  next_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_expires_at  TIMESTAMPTZ,
  last_outcome      TEXT,
  -- Why a lead ended where it did, in words a tenant can read.
  note              TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Re-importing the same CSV adds nobody twice.
  UNIQUE (campaign_id, phone_e164)
);

-- ── The ledger ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.dial_attempts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  campaign_id       UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  campaign_lead_id  UUID NOT NULL REFERENCES public.campaign_leads(id) ON DELETE CASCADE,

  attempt_no        INTEGER NOT NULL,
  phone_e164        TEXT NOT NULL,
  -- Which of the agent's numbers presented as caller ID, for the per-number
  -- daily volume cap.
  phone_number_id   UUID REFERENCES public.phone_numbers(id) ON DELETE SET NULL,

  -- Null only in PLACING and LOST. Unique when set, so a replayed webhook
  -- cannot create a second attribution.
  provider_call_id  TEXT,
  state             attempt_state NOT NULL DEFAULT 'PLACING',
  lease_expires_at  TIMESTAMPTZ NOT NULL,

  ended_reason      TEXT,
  duration_seconds  INTEGER NOT NULL DEFAULT 0,
  -- Server-side only. Never rendered to a tenant; sanitiseError owns that.
  error             TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Do not call ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.suppressions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  phone_e164   TEXT NOT NULL,
  source       suppression_source NOT NULL DEFAULT 'MANUAL',
  note         TEXT,
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (tenant_id, phone_e164)
);

-- ── Indexes ───────────────────────────────────────────────────────────
-- The partial predicates are the point. Each index covers only rows that are
-- live, so it stays small however many millions of leads accumulate.

-- Drives the claim. Column order matches its ORDER BY exactly.
CREATE INDEX IF NOT EXISTS campaign_leads_due_idx
  ON public.campaign_leads (campaign_id, next_attempt_at, priority DESC, id)
  WHERE state IN ('PENDING','RETRY_WAIT');

-- Progress counts for the campaign page.
CREATE INDEX IF NOT EXISTS campaign_leads_state_idx
  ON public.campaign_leads (campaign_id, state);

-- All three concurrency tiers are counted from this one index: per-campaign by
-- adding the campaign predicate, per-tenant by the leading column, platform-wide
-- by scanning the whole (small) partial index. It stays small because the
-- predicate admits only calls that are actually live.
CREATE INDEX IF NOT EXISTS campaign_leads_live_idx
  ON public.campaign_leads (tenant_id, campaign_id, lease_expires_at)
  WHERE state IN ('DIALING','IN_PROGRESS');

-- Releasing deferred leads when a calling window reopens.
CREATE INDEX IF NOT EXISTS campaign_leads_deferred_idx
  ON public.campaign_leads (campaign_id, next_attempt_at)
  WHERE state = 'DEFERRED';

-- Not the concurrency count — see the note at the top. This one serves the
-- reaper's "what is still live" sweep and the admin overview.
CREATE INDEX IF NOT EXISTS dial_attempts_inflight_idx
  ON public.dial_attempts (tenant_id, campaign_id, lease_expires_at)
  WHERE state IN ('PLACING','DIALING','IN_PROGRESS','RECONCILING');

-- The cross-campaign double-dial guard.
--
-- Because the ledger row is inserted before the provider call, a second
-- campaign dialling the same person while a call is live gets a 23505 and never
-- reaches the provider. The constraint IS the coordination — no lock, no
-- application logic, no race.
CREATE UNIQUE INDEX IF NOT EXISTS dial_attempts_one_live_per_number_idx
  ON public.dial_attempts (tenant_id, phone_e164)
  WHERE state IN ('PLACING','DIALING','IN_PROGRESS','RECONCILING');

-- Webhook attribution.
CREATE UNIQUE INDEX IF NOT EXISTS dial_attempts_provider_call_idx
  ON public.dial_attempts (provider_call_id)
  WHERE provider_call_id IS NOT NULL;

-- The reaper.
CREATE INDEX IF NOT EXISTS dial_attempts_lease_idx
  ON public.dial_attempts (lease_expires_at)
  WHERE state IN ('PLACING','DIALING','IN_PROGRESS','RECONCILING');

-- Contact frequency cap, and the per-number daily volume cap.
CREATE INDEX IF NOT EXISTS dial_attempts_freq_idx
  ON public.dial_attempts (tenant_id, phone_e164, created_at DESC);
CREATE INDEX IF NOT EXISTS dial_attempts_number_day_idx
  ON public.dial_attempts (phone_number_id, created_at DESC);

CREATE INDEX IF NOT EXISTS campaigns_tenant_state_idx
  ON public.campaigns (tenant_id, state);
-- The heartbeat's campaign selection.
CREATE INDEX IF NOT EXISTS campaigns_running_idx
  ON public.campaigns (last_ticked_at NULLS FIRST)
  WHERE state = 'RUNNING';

-- ── updated_at ────────────────────────────────────────────────────────
-- Reusing the existing set_updated_at(). These tables are written by raw SQL as
-- well as by Prisma, so @updatedAt in the schema is not enough on its own.

DROP TRIGGER IF EXISTS campaigns_updated_at      ON public.campaigns;
DROP TRIGGER IF EXISTS campaign_leads_updated_at ON public.campaign_leads;
DROP TRIGGER IF EXISTS dial_attempts_updated_at  ON public.dial_attempts;

CREATE TRIGGER campaigns_updated_at      BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER campaign_leads_updated_at BEFORE UPDATE ON public.campaign_leads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER dial_attempts_updated_at  BEFORE UPDATE ON public.dial_attempts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Platform and tenant controls ──────────────────────────────────────

ALTER TABLE public.platform_settings
  -- The 2am switch. One flag that stops every claim on the platform.
  ADD COLUMN IF NOT EXISTS dialer_enabled            BOOLEAN NOT NULL DEFAULT TRUE,
  -- Set to roughly 85% of the provider's own concurrency limit; the platform
  -- tier is bounded best-effort rather than exact, and this absorbs the slack.
  ADD COLUMN IF NOT EXISTS max_concurrent_calls      INTEGER NOT NULL DEFAULT 40,
  ADD COLUMN IF NOT EXISTS tenant_max_concurrent     INTEGER NOT NULL DEFAULT 10,
  -- Carriers spam-label a number that makes hundreds of calls a day.
  ADD COLUMN IF NOT EXISTS number_daily_call_cap     INTEGER NOT NULL DEFAULT 200,
  -- The same person, across every campaign a tenant runs, in 24 hours.
  ADD COLUMN IF NOT EXISTS contact_daily_cap         INTEGER NOT NULL DEFAULT 2,
  -- Appended to the system prompt of any agent running a campaign, through the
  -- same mechanism as the CRM rules, so it cannot be edited out.
  ADD COLUMN IF NOT EXISTS consent_line              TEXT NOT NULL
    DEFAULT 'Let the person know this call may be recorded, in your first sentence, before anything else.';

ALTER TABLE public.tenants
  -- Null means fall back to platform_settings.tenant_max_concurrent.
  ADD COLUMN IF NOT EXISTS max_concurrent_calls      INTEGER,
  -- Default country for normalising bare numbers in an uploaded CSV.
  ADD COLUMN IF NOT EXISTS default_country_code      TEXT NOT NULL DEFAULT '1';

-- ── Row level security ────────────────────────────────────────────────
-- Enabled with no policies, as with tenant_invitations and crm_connection.
-- Everything here is reached by the server through Prisma; nothing holding an
-- anon or authenticated key has any business reading it.

ALTER TABLE public.campaigns      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dial_attempts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppressions   ENABLE ROW LEVEL SECURITY;

-- ── Confirm it worked ─────────────────────────────────────────────────

SELECT c.relname AS table_name,
       c.relrowsecurity AS rls,
       (SELECT count(*) FROM pg_index i WHERE i.indrelid = c.oid) AS indexes
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relname IN ('campaigns','campaign_leads','dial_attempts','suppressions')
 ORDER BY c.relname;
