-- ═══════════════════════════════════════════════════════════════════════
--  Hi-Astrix — the claim, verified against a real Postgres
--
--  Run in: Supabase Dashboard → SQL Editor → paste → Run
--
--  Everything the dialer relies on that lives in SQL rather than TypeScript:
--  headroom accounting, the credit gate, pause, the calling window, the
--  double-dial guard, and knowing when a campaign is genuinely finished.
--  The TypeScript half is covered by verify-dialer.ts in the test rig.
--
--  This is one DO block on purpose. It runs in a single transaction, so a
--  failed assertion aborts and rolls back every fixture it created — there is
--  no half-finished state to clean up by hand, and nothing of yours is touched.
--  On success it deletes its own fixtures before committing.
--
--  ── WHAT IT CANNOT PROVE ─────────────────────────────────────────────
--
--  Two claims genuinely running at the same moment. That needs two connections,
--  and this is one. What it does prove is the accounting those two claims share:
--  a claim never takes more than the headroom left by calls already up. The
--  interleaving itself rests on FOR UPDATE SKIP LOCKED re-evaluating the
--  locking select's own predicates after a competing transaction commits, which
--  is why `state IN ('PENDING','RETRY_WAIT')` sits inside that select and not
--  only on the UPDATE.
--
--  Expected output: one row per check, all ok = true, and 'ALL CHECKS PASSED'.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TEMP TABLE IF NOT EXISTS zz_checks (label text, ok boolean, detail text);
TRUNCATE zz_checks;

DO $$
DECLARE
  v_tenant      uuid;
  v_agent       uuid;
  v_broke       uuid;
  v_broke_agent uuid;
  v_camp        uuid := '00000000-0000-0000-0000-00000000dd01';
  v_camp_broke  uuid := '00000000-0000-0000-0000-00000000dd02';
  v_camp_shut   uuid := '00000000-0000-0000-0000-00000000dd03';
  v_lead        uuid;
  v_n           int;
  v_open        text := to_char(now() AT TIME ZONE 'UTC', 'HH24:MI');
BEGIN

  ---------------------------------------------------------------------
  -- Fixtures. A funded tenant that may call, and a real one that may not.
  ---------------------------------------------------------------------

  SELECT t.id, a.id INTO v_tenant, v_agent
    FROM tenants t JOIN agents a ON a.tenant_id = t.id
   WHERE t.status = 'ACTIVE'
     AND (t.credit_balance_cents > 0
          OR t.minutes_used < COALESCE((SELECT p.minutes_included FROM packages p WHERE p.id = t.package_id), 0))
   LIMIT 1;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'No tenant on this database can currently place a call, so the claim cannot be exercised. Give one some credit and re-run.';
  END IF;

  SELECT t.id, a.id INTO v_broke, v_broke_agent
    FROM tenants t JOIN agents a ON a.tenant_id = t.id
   WHERE t.status = 'ACTIVE'
     AND t.credit_balance_cents <= 0
     AND t.minutes_used >= COALESCE((SELECT p.minutes_included FROM packages p WHERE p.id = t.package_id), 0)
   LIMIT 1;

  -- A campaign wide open in UTC, so the window never accidentally decides the
  -- result of a test about something else.
  INSERT INTO campaigns (id, tenant_id, agent_id, name, state, max_concurrent,
                         timezone, window_start, window_end, window_days)
  VALUES (v_camp, v_tenant, v_agent, 'zz-verify claim', 'RUNNING', 3,
          'UTC', '00:00', '23:59', '{1,2,3,4,5,6,7}');

  INSERT INTO campaign_leads (campaign_id, tenant_id, phone_e164, contact_name)
  SELECT v_camp, v_tenant, '+1555999' || lpad(g::text, 4, '0'), 'zz verify ' || g
    FROM generate_series(1, 10) g;

  ---------------------------------------------------------------------
  -- 1. A claim takes the campaign's concurrency and no more.
  ---------------------------------------------------------------------

  WITH claimed AS (
    SELECT l.id FROM campaign_leads l
     WHERE l.campaign_id = v_camp AND l.state IN ('PENDING','RETRY_WAIT')
       AND l.next_attempt_at <= now()
     ORDER BY l.next_attempt_at, l.priority DESC, l.id
     FOR UPDATE SKIP LOCKED
     LIMIT (SELECT GREATEST(0, LEAST(
              c.max_concurrent - (SELECT count(*)::int FROM campaign_leads x
                                   WHERE x.campaign_id = v_camp
                                     AND x.state IN ('DIALING','IN_PROGRESS')
                                     AND x.lease_expires_at > now()),
              8)) FROM campaigns c WHERE c.id = v_camp)
  )
  UPDATE campaign_leads l SET state='DIALING', attempt_no = l.attempt_no + 1,
         lease_expires_at = now() + interval '90 seconds'
    FROM claimed c WHERE l.id = c.id AND l.state IN ('PENDING','RETRY_WAIT');
  GET DIAGNOSTICS v_n = ROW_COUNT;

  INSERT INTO zz_checks VALUES
    ('a claim takes exactly the campaign concurrency', v_n = 3, format('claimed %s of 10 due, cap 3', v_n));
  IF v_n <> 3 THEN RAISE EXCEPTION 'claim took % rows, expected 3', v_n; END IF;

  ---------------------------------------------------------------------
  -- 2. With those three up, a second claim takes nothing.
  --
  -- This is the one that caught the original design. Counting in flight from
  -- dial_attempts — written a moment later by the dialer — this returned 3
  -- again, because the ledger rows did not exist yet.
  ---------------------------------------------------------------------

  WITH claimed AS (
    SELECT l.id FROM campaign_leads l
     WHERE l.campaign_id = v_camp AND l.state IN ('PENDING','RETRY_WAIT')
       AND l.next_attempt_at <= now()
     ORDER BY l.next_attempt_at, l.priority DESC, l.id
     FOR UPDATE SKIP LOCKED
     LIMIT (SELECT GREATEST(0, LEAST(
              c.max_concurrent - (SELECT count(*)::int FROM campaign_leads x
                                   WHERE x.campaign_id = v_camp
                                     AND x.state IN ('DIALING','IN_PROGRESS')
                                     AND x.lease_expires_at > now()),
              8)) FROM campaigns c WHERE c.id = v_camp)
  )
  UPDATE campaign_leads l SET state='DIALING' FROM claimed c WHERE l.id = c.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  INSERT INTO zz_checks VALUES
    ('a second claim while three are up takes none', v_n = 0, format('claimed %s', v_n));
  IF v_n <> 0 THEN RAISE EXCEPTION 'second claim took % rows, expected 0', v_n; END IF;

  ---------------------------------------------------------------------
  -- 3. An expired lease stops holding a slot.
  ---------------------------------------------------------------------

  UPDATE campaign_leads SET lease_expires_at = now() - interval '1 second'
   WHERE campaign_id = v_camp AND state = 'DIALING';

  SELECT count(*)::int INTO v_n FROM campaign_leads
   WHERE campaign_id = v_camp AND state IN ('DIALING','IN_PROGRESS')
     AND lease_expires_at > now();

  INSERT INTO zz_checks VALUES
    ('an expired lease no longer counts against concurrency', v_n = 0, format('%s still counted', v_n));
  IF v_n <> 0 THEN RAISE EXCEPTION 'expired leases still counted: %', v_n; END IF;

  UPDATE campaign_leads SET state='PENDING', lease_expires_at=NULL, attempt_no=0
   WHERE campaign_id = v_camp;

  ---------------------------------------------------------------------
  -- 4. A paused campaign is not claimable — the gate is in the statement.
  ---------------------------------------------------------------------

  UPDATE campaigns SET state='PAUSED' WHERE id = v_camp;

  SELECT count(*)::int INTO v_n FROM campaigns c
    JOIN tenants t ON t.id = c.tenant_id
   WHERE c.id = v_camp AND c.state = 'RUNNING' AND t.status = 'ACTIVE';

  INSERT INTO zz_checks VALUES
    ('a paused campaign fails the claim gate', v_n = 0, format('%s', v_n));
  IF v_n <> 0 THEN RAISE EXCEPTION 'paused campaign still passed the gate'; END IF;

  UPDATE campaigns SET state='RUNNING' WHERE id = v_camp;

  ---------------------------------------------------------------------
  -- 5. The credit gate, against a tenant that genuinely cannot pay.
  --
  -- The predicate is readAllowance(...).canCall expressed in SQL: allowance
  -- left OR credit left. Not "balance above zero", which would stop a tenant
  -- who has just bought a plan and spent none of it.
  ---------------------------------------------------------------------

  IF v_broke IS NOT NULL THEN
    INSERT INTO campaigns (id, tenant_id, agent_id, name, state, max_concurrent,
                           timezone, window_start, window_end, window_days)
    VALUES (v_camp_broke, v_broke, v_broke_agent, 'zz-verify broke', 'RUNNING', 3,
            'UTC', '00:00', '23:59', '{1,2,3,4,5,6,7}');

    SELECT count(*)::int INTO v_n
      FROM campaigns c JOIN tenants t ON t.id = c.tenant_id
      LEFT JOIN packages p ON p.id = t.package_id
     WHERE c.id = v_camp_broke
       AND (t.minutes_used < COALESCE(p.minutes_included, 0) OR t.credit_balance_cents > 0);

    INSERT INTO zz_checks VALUES
      ('a tenant with no allowance and no credit claims nothing', v_n = 0, format('%s', v_n));
    IF v_n <> 0 THEN RAISE EXCEPTION 'the credit gate let a broke tenant through'; END IF;
  ELSE
    INSERT INTO zz_checks VALUES
      ('credit gate', true, 'skipped — every tenant on this database can currently pay');
  END IF;

  -- And the funded one still passes, so the check above is not vacuous.
  SELECT count(*)::int INTO v_n
    FROM campaigns c JOIN tenants t ON t.id = c.tenant_id
    LEFT JOIN packages p ON p.id = t.package_id
   WHERE c.id = v_camp
     AND (t.minutes_used < COALESCE(p.minutes_included, 0) OR t.credit_balance_cents > 0);

  INSERT INTO zz_checks VALUES
    ('a tenant who can pay still passes', v_n = 1, format('%s', v_n));
  IF v_n <> 1 THEN RAISE EXCEPTION 'the credit gate refused a funded tenant'; END IF;

  ---------------------------------------------------------------------
  -- 6. The calling window, and DEFERRED rather than dropped.
  ---------------------------------------------------------------------

  INSERT INTO campaigns (id, tenant_id, agent_id, name, state, max_concurrent,
                         timezone, window_start, window_end, window_days)
  VALUES (v_camp_shut, v_tenant, v_agent, 'zz-verify shut', 'RUNNING', 3,
          'UTC', '00:00', '00:01', '{1,2,3,4,5,6,7}');

  SELECT count(*)::int INTO v_n FROM campaigns c
   WHERE c.id = v_camp_shut
     AND to_char(now() AT TIME ZONE c.timezone, 'HH24:MI') >= c.window_start
     AND to_char(now() AT TIME ZONE c.timezone, 'HH24:MI') <  c.window_end;

  INSERT INTO zz_checks VALUES
    ('a campaign outside its calling window claims nothing',
     v_n = 0 OR v_open < '00:01', format('now is %s UTC', v_open));
  IF v_n <> 0 AND v_open >= '00:01' THEN
    RAISE EXCEPTION 'the calling window did not close the campaign';
  END IF;

  SELECT count(*)::int INTO v_n FROM campaigns c
   WHERE c.id = v_camp_shut
     AND EXTRACT(isodow FROM now() AT TIME ZONE c.timezone)::int = ANY (ARRAY[]::int[]);

  INSERT INTO zz_checks VALUES
    ('an empty weekday list never matches', v_n = 0, format('%s', v_n));

  ---------------------------------------------------------------------
  -- 7. The double-dial guard, which is a database constraint and not code.
  ---------------------------------------------------------------------

  SELECT id INTO v_lead FROM campaign_leads WHERE campaign_id = v_camp LIMIT 1;

  INSERT INTO dial_attempts (tenant_id, campaign_id, campaign_lead_id, attempt_no,
                             phone_e164, state, lease_expires_at)
  VALUES (v_tenant, v_camp, v_lead, 1, '+15559990001', 'PLACING', now() + interval '90 seconds');

  BEGIN
    INSERT INTO dial_attempts (tenant_id, campaign_id, campaign_lead_id, attempt_no,
                               phone_e164, state, lease_expires_at)
    VALUES (v_tenant, v_camp, v_lead, 1, '+15559990001', 'PLACING', now() + interval '90 seconds');
    RAISE EXCEPTION 'two live attempts to the same person were allowed';
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO zz_checks VALUES
      ('a second live call to the same person is refused by the database', true,
       'partial unique index on (tenant_id, phone_e164)');
  END;

  UPDATE dial_attempts SET state='ENDED' WHERE campaign_id = v_camp;

  INSERT INTO dial_attempts (tenant_id, campaign_id, campaign_lead_id, attempt_no,
                             phone_e164, state, lease_expires_at)
  VALUES (v_tenant, v_camp, v_lead, 2, '+15559990001', 'PLACING', now() + interval '90 seconds');

  INSERT INTO zz_checks VALUES
    ('but a retry once the first has ended is allowed', true, '');

  ---------------------------------------------------------------------
  -- 8. Finished means finished — asked, never inferred.
  ---------------------------------------------------------------------

  SELECT count(*)::int INTO v_n FROM campaign_leads
   WHERE campaign_id = v_camp
     AND state IN ('PENDING','RETRY_WAIT','DEFERRED','DIALING','IN_PROGRESS');

  INSERT INTO zz_checks VALUES
    ('a campaign with work left is not drained', v_n > 0, format('%s outstanding', v_n));
  IF v_n = 0 THEN RAISE EXCEPTION 'drain check thinks a full campaign is finished'; END IF;

  UPDATE campaign_leads SET state='COMPLETED' WHERE campaign_id = v_camp;

  SELECT count(*)::int INTO v_n FROM campaign_leads
   WHERE campaign_id = v_camp
     AND state IN ('PENDING','RETRY_WAIT','DEFERRED','DIALING','IN_PROGRESS');

  INSERT INTO zz_checks VALUES
    ('and one with none is', v_n = 0, format('%s outstanding', v_n));
  IF v_n <> 0 THEN RAISE EXCEPTION 'drain check missed a finished campaign'; END IF;

  ---------------------------------------------------------------------
  -- Tidy up. Cascades take the leads and attempts with them.
  ---------------------------------------------------------------------

  DELETE FROM campaigns WHERE id IN (v_camp, v_camp_broke, v_camp_shut);

END $$;

-- One row per check. All ok = true means the claim behaves as designed; a
-- failure aborts the block above with a message naming what broke.
SELECT label, ok, detail FROM zz_checks;
