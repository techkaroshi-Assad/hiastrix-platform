-- ═══════════════════════════════════════════════════════════════════════
--  Hi-Astrix — create a super admin (admin panel account)
--
--  Run in: Supabase Dashboard → SQL Editor → paste → Run
--
--  This is the ONLY way to create an admin panel account. There is no sign-up
--  page for /admin, by design.
--
--  ── HOW TO USE ────────────────────────────────────────────────────────
--
--    1. Change the four values in the EDIT THESE block below.
--    2. Press Run.
--    3. Check the table it prints at the end (see WHAT GOOD LOOKS LIKE).
--    4. They sign in at app.hiastrix.com/login and land on /admin.
--
--  Reuse this same script every time. It handles all three cases on its own:
--
--    · The email is new                  → creates the whole account.
--    · The email already exists          → updates the password, name, role.
--    · You created them in the Supabase  → fills in the parts the dashboard
--      dashboard first                     cannot set.
--
--  So it is also how you RESET A PASSWORD — run it again with a new one.
--
--  ── WHAT GOOD LOOKS LIKE ──────────────────────────────────────────────
--
--    confirmed        true
--    auth_role        super_admin
--    identities       1            ← 0 means sign-in will fail
--    console_role     SUPER_ADMIN
--    is_active        true
--
--  ── WHY IT DOES WHAT IT DOES ──────────────────────────────────────────
--
--  Three things have to line up, and each one fails differently:
--
--    auth.users + auth.identities   the account and its password.
--                                   No identity row → "Invalid login
--                                   credentials" even with the right password.
--
--    raw_app_meta_data.role         read at the edge to route them to /admin.
--                                   The Supabase dashboard has no field for it.
--
--    public.admin_users             re-checked by every admin page. Missing →
--                                   they sign in and are bounced straight back
--                                   to the login screen.
--
--  Two details this script exists to get right:
--
--    · The token columns must be '' and never NULL. The auth service reads
--      them into non-nullable string fields, so a NULL makes sign-in fail
--      before the password is even checked — with an error that says nothing
--      about the cause.
--    · The role claim is lowercase (super_admin), the database enum is
--      uppercase (SUPER_ADMIN). This script bridges the two.
-- ═══════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  ---------------------------------------------------------------------
  --  EDIT THESE
  ---------------------------------------------------------------------
  v_email    text := 'someone@astrixdigitalmedia.com';  -- their email
  v_password text := 'REPLACE_WITH_A_REAL_PASSWORD';    -- min 10 characters
  v_name     text := 'Their Name';                      -- shown in the console
  v_role     text := 'super_admin';                     -- 'super_admin' or 'admin'
  ---------------------------------------------------------------------

  v_user_id uuid;
BEGIN
  IF length(v_password) < 10 THEN
    RAISE EXCEPTION 'Use a password of at least 10 characters.';
  END IF;

  IF v_role NOT IN ('super_admin', 'admin') THEN
    RAISE EXCEPTION 'Role must be super_admin or admin, got %', v_role;
  END IF;

  SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = lower(v_email);

  IF v_user_id IS NULL THEN
    -- ── Brand new account ───────────────────────────────────────────
    v_user_id := gen_random_uuid();

    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, is_sso_user, is_anonymous,
      -- Empty strings, never NULL. See the note at the top.
      confirmation_token, recovery_token, email_change,
      email_change_token_new, email_change_token_current,
      phone_change, phone_change_token, reauthentication_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_user_id,
      'authenticated',
      'authenticated',
      lower(v_email),
      extensions.crypt(v_password, extensions.gen_salt('bf')),
      now(),                                  -- pre-confirmed: no verification email
      jsonb_build_object('provider', 'email', 'providers', ARRAY['email'], 'role', v_role),
      jsonb_build_object('name', v_name, 'role', v_role),
      now(), now(), false, false,
      '', '', '', '', '', '', '', ''
    );

    RAISE NOTICE 'Created account for %', v_email;
  ELSE
    -- ── Existing account: refresh password, name and role ───────────
    -- COALESCE every token column, in case this account was created by hand or
    -- by an older version of this script and is still carrying NULLs.
    UPDATE auth.users
       SET encrypted_password = extensions.crypt(v_password, extensions.gen_salt('bf')),
           email_confirmed_at = COALESCE(email_confirmed_at, now()),
           raw_app_meta_data  = COALESCE(raw_app_meta_data, '{}'::jsonb)
                                  || jsonb_build_object('role', v_role),
           raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb)
                                  || jsonb_build_object('name', v_name, 'role', v_role),
           confirmation_token         = COALESCE(confirmation_token, ''),
           recovery_token             = COALESCE(recovery_token, ''),
           email_change               = COALESCE(email_change, ''),
           email_change_token_new     = COALESCE(email_change_token_new, ''),
           email_change_token_current = COALESCE(email_change_token_current, ''),
           phone_change               = COALESCE(phone_change, ''),
           phone_change_token         = COALESCE(phone_change_token, ''),
           reauthentication_token     = COALESCE(reauthentication_token, ''),
           updated_at         = now()
     WHERE id = v_user_id;

    RAISE NOTICE 'Updated existing account for %', v_email;
  END IF;

  -- ── The identity row ──────────────────────────────────────────────
  -- Password sign-in checks this, not auth.users alone. Written only when it is
  -- missing, so an account created in the Supabase dashboard keeps the row it
  -- already has.
  --
  -- Note: auth.identities.email is a GENERATED column — do not insert it.
  IF NOT EXISTS (
    SELECT 1 FROM auth.identities
     WHERE user_id = v_user_id AND provider = 'email'
  ) THEN
    INSERT INTO auth.identities (
      provider_id, user_id, identity_data, provider, created_at, updated_at
    ) VALUES (
      v_user_id::text,
      v_user_id,
      jsonb_build_object(
        'sub', v_user_id::text,
        'email', lower(v_email),
        'email_verified', true,
        'phone_verified', false
      ),
      'email', now(), now()
    );

    RAISE NOTICE 'Added the missing identity row for %', v_email;
  END IF;

  -- ── The admin panel record ────────────────────────────────────────
  -- What every /admin page re-checks. Without this the account signs in and is
  -- immediately turned away.
  INSERT INTO public.admin_users (supabase_id, email, name, role, is_active)
  VALUES (v_user_id, lower(v_email), v_name, upper(v_role)::admin_role, true)
  ON CONFLICT (supabase_id) DO UPDATE
    SET email     = EXCLUDED.email,
        name      = EXCLUDED.name,
        role      = EXCLUDED.role,
        is_active = true;
END $$;


-- ── Confirm it worked ────────────────────────────────────────────────
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
