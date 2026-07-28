-- ═══════════════════════════════════════════════════════════════════════
--  Hi-Astrix — the dialer heartbeat, scheduled from Postgres
--
--  Run in: Supabase Dashboard → SQL Editor → paste → Run
--
--  ── WHY THIS IS NOT A VERCEL CRON ─────────────────────────────────────
--
--  It was, briefly. Vercel's Hobby plan allows cron jobs but only once a day,
--  and an every-minute schedule in vercel.json is rejected during configuration
--  validation — which does not fail the build, it stops the deployment from
--  being created at all. A push that looks like it simply never arrived.
--
--  Scheduling it here instead is better than paying to lift that limit:
--
--    · It runs in the same region as the database it is about to query.
--    · It costs nothing, and it is infrastructure that is already ours.
--    · It survives a Vercel plan change, a project rename, or a redeploy.
--
--  What it does not survive is the database being paused, which on a free
--  Supabase project happens after a week of inactivity. Worth knowing; not a
--  problem for a database that a dialer is writing to every few seconds.
--
--  ── WHAT IT ACTUALLY DOES ─────────────────────────────────────────────
--
--  Every minute it makes one HTTP GET to /api/cron/dialer carrying the shared
--  secret. That endpoint is the repair crew, not the engine: the call-ended
--  webhook starts the next call itself, so in normal running this finds full
--  pipelines and returns in a few milliseconds. It exists to start campaigns
--  that have nothing in flight to be pumped by, to resolve expired leases, to
--  release leads deferred outside calling hours, and to pick up anything the
--  webhook dropped.
--
--  ── BEFORE YOU RUN IT ─────────────────────────────────────────────────
--
--  Set the two values in the EDIT THESE block. The secret must be the same
--  string as CRON_SECRET in Vercel's Production environment variables — if they
--  differ, the endpoint answers 401 and the dialer silently never starts.
--
--  Safe to re-run. It replaces the job rather than adding a second one.
-- ═══════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
DECLARE
  ---------------------------------------------------------------------
  --  EDIT THESE
  ---------------------------------------------------------------------
  v_url    text := 'https://app.hiastrix.com/api/cron/dialer';
  v_secret text := 'REPLACE_WITH_THE_SAME_VALUE_AS_CRON_SECRET';
  ---------------------------------------------------------------------

  v_existing uuid;
BEGIN
  IF v_secret = 'REPLACE_WITH_THE_SAME_VALUE_AS_CRON_SECRET' THEN
    RAISE EXCEPTION 'Set v_secret to the same value as CRON_SECRET in Vercel first.';
  END IF;

  -- The secret goes in Vault, not inline in the job command. cron.job is
  -- readable by anyone who can read the schema, and a bearer token sitting in
  -- a query string there is a bearer token in your database in plain text.
  SELECT id INTO v_existing FROM vault.secrets WHERE name = 'dialer_cron_secret';

  IF v_existing IS NULL THEN
    PERFORM vault.create_secret(v_secret, 'dialer_cron_secret',
                                'Bearer token for /api/cron/dialer');
  ELSE
    PERFORM vault.update_secret(v_existing, v_secret, 'dialer_cron_secret',
                                'Bearer token for /api/cron/dialer');
  END IF;
END $$;

-- The job body, so the schedule stays readable and the secret is fetched at
-- fire time rather than baked into the schedule.
CREATE OR REPLACE FUNCTION public.run_dialer_heartbeat()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net, extensions
AS $$
DECLARE
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
   WHERE name = 'dialer_cron_secret';

  IF v_secret IS NULL THEN
    RAISE WARNING 'dialer_cron_secret is not in the vault — heartbeat skipped';
    RETURN;
  END IF;

  -- Asynchronous by design. pg_net queues the request and returns immediately,
  -- so a slow or unreachable app never holds a database worker open, and a
  -- minute-by-minute job can never pile up on itself.
  PERFORM net.http_get(
    url     := 'https://app.hiastrix.com/api/cron/dialer',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 55000
  );
END $$;

REVOKE ALL ON FUNCTION public.run_dialer_heartbeat() FROM PUBLIC, anon, authenticated;

-- Replace rather than accumulate: re-running this must not leave two jobs
-- dialling in parallel.
SELECT cron.unschedule('dialer-heartbeat')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dialer-heartbeat');

SELECT cron.schedule('dialer-heartbeat', '* * * * *',
                     'SELECT public.run_dialer_heartbeat()');

-- ── Confirm it worked ────────────────────────────────────────────────
-- Expect one row, active = true. Then wait a minute and run the second query:
-- status_code 200 means the endpoint accepted the secret, 401 means it does not
-- match CRON_SECRET in Vercel.

SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'dialer-heartbeat';

-- SELECT status_code, content::text, created
--   FROM net._http_response
--  ORDER BY created DESC
--  LIMIT 5;
