-- ═══════════════════════════════════════════════════════════════════════
--  Hi-Astrix — promote an existing Supabase user to an operator
--
--  Run in: Supabase Dashboard → SQL Editor
--
--  Use this AFTER creating the person through the Supabase UI
--  (Authentication → Users → Add user, with "Auto Confirm User" ticked).
--
--  Creating the account through the UI is the safer of the two routes: the
--  auth service writes the identity row and the token columns itself, so none
--  of the hand-rolled insert's failure modes apply. All that is left is the
--  part the UI knows nothing about — the role claim and the console's own
--  authorisation table.
--
--  EDIT THE THREE VALUES BELOW, THEN RUN. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  ---------------------------------------------------------------------
  -- EDIT THESE
  ---------------------------------------------------------------------
  v_email text := 'newperson@astrixdigitalmedia.com';  -- the user you just created
  v_name  text := 'Their Name';                        -- shown in the console
  v_role  text := 'super_admin';                       -- 'super_admin' or 'admin'
  ---------------------------------------------------------------------

  v_user_id uuid;
BEGIN
  IF v_role NOT IN ('super_admin', 'admin') THEN
    RAISE EXCEPTION 'Role must be super_admin or admin, got %', v_role;
  END IF;

  SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = lower(v_email);

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION
      'No account exists for %. Create it first under Authentication → Users → Add user.',
      v_email;
  END IF;

  -- ── The role claim ────────────────────────────────────────────────
  -- Read at the edge to decide whether a request may reach /admin at all. The
  -- UI has no field for this, which is why creating a user there is only half
  -- the job.
  UPDATE auth.users
     SET raw_app_meta_data  = COALESCE(raw_app_meta_data, '{}'::jsonb)
                                || jsonb_build_object('role', v_role),
         raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb)
                                || jsonb_build_object('name', v_name, 'role', v_role),
         email_confirmed_at = COALESCE(email_confirmed_at, now()),
         updated_at         = now()
   WHERE id = v_user_id;

  -- ── The authorisation record ──────────────────────────────────────
  -- Every /admin page re-checks this table rather than trusting the claim.
  -- Without a row here the account signs in and is bounced straight back out.
  INSERT INTO public.admin_users (supabase_id, email, name, role, is_active)
  VALUES (v_user_id, lower(v_email), v_name, upper(v_role)::admin_role, true)
  ON CONFLICT (supabase_id) DO UPDATE
    SET email     = EXCLUDED.email,
        name      = EXCLUDED.name,
        role      = EXCLUDED.role,
        is_active = true;

  RAISE NOTICE 'Promoted % to %', v_email, v_role;
END $$;


-- ── Confirm it worked ────────────────────────────────────────────────
-- Expect: confirmed true · auth_role matching · identities 1 · is_active true.
-- identities of 0 means password sign-in will fail — use create-super-admin.sql
-- instead, which writes that row.

SELECT
  u.email,
  u.email_confirmed_at IS NOT NULL                                AS confirmed,
  u.raw_app_meta_data ->> 'role'                                  AS auth_role,
  (SELECT count(*) FROM auth.identities i WHERE i.user_id = u.id) AS identities,
  a.role::text                                                    AS console_role,
  a.is_active
FROM auth.users u
JOIN public.admin_users a ON a.supabase_id = u.id
ORDER BY a.created_at DESC;
