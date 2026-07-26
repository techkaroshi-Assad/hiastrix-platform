-- ═══════════════════════════════════════════════════════════════════════
--  Hi-Astrix — create an operations (admin) account
--
--  Run in: Supabase Dashboard → SQL Editor
--
--  There is deliberately no signup route for /admin. Operator accounts are
--  provisioned by hand, here, and nowhere else.
--
--  EDIT THE FOUR VALUES IN THE `DECLARE` BLOCK, THEN RUN.
--
--  Safe to re-run. An account that already exists has its password, name and
--  role refreshed rather than being duplicated.
--
--  Verified against this project's auth schema:
--    · auth.identities.email is a GENERATED column and must not be inserted
--    · pgcrypto lives in the `extensions` schema, not `public`
--    · the auth role claim is lowercase (super_admin); the admin_users enum
--      is uppercase (SUPER_ADMIN) — the block bridges the two
-- ═══════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  ---------------------------------------------------------------------
  -- EDIT THESE
  ---------------------------------------------------------------------
  v_email    text := 'assad@astrixdigitalmedia.com';  -- operator's email
  v_password text := 'REPLACE_WITH_YOUR_PASSWORD';    -- min 10 chars — change this
  v_name     text := 'Assad Baloch';                  -- display name
  v_role     text := 'super_admin';                   -- 'super_admin' or 'admin'
  ---------------------------------------------------------------------

  v_user_id uuid;
BEGIN
  IF length(v_password) < 10 THEN
    RAISE EXCEPTION 'Use a password of at least 10 characters for an operator account.';
  END IF;

  IF v_role NOT IN ('super_admin', 'admin') THEN
    RAISE EXCEPTION 'Role must be super_admin or admin, got %', v_role;
  END IF;

  SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = lower(v_email);

  IF v_user_id IS NULL THEN
    -- ── New identity ────────────────────────────────────────────────
    v_user_id := gen_random_uuid();

    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, is_sso_user, is_anonymous
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
      now(), now(), false, false
    );

    -- Password sign-in requires a matching identity row.
    -- Note: the `email` column here is generated — do not insert it.
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

    RAISE NOTICE 'Created identity for %', v_email;
  ELSE
    -- ── Existing identity: refresh password and role ────────────────
    UPDATE auth.users
       SET encrypted_password = extensions.crypt(v_password, extensions.gen_salt('bf')),
           email_confirmed_at = COALESCE(email_confirmed_at, now()),
           raw_app_meta_data  = COALESCE(raw_app_meta_data, '{}'::jsonb)
                                  || jsonb_build_object('role', v_role),
           raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb)
                                  || jsonb_build_object('name', v_name, 'role', v_role),
           updated_at         = now()
     WHERE id = v_user_id;

    RAISE NOTICE 'Refreshed existing identity for %', v_email;
  END IF;

  -- ── Authorisation record ──────────────────────────────────────────
  -- admin_users is what every /admin page re-checks. Without a row here the
  -- account can sign in but the console will bounce it straight back out.
  INSERT INTO public.admin_users (supabase_id, email, name, role, is_active)
  VALUES (v_user_id, lower(v_email), v_name, upper(v_role)::admin_role, true)
  ON CONFLICT (supabase_id) DO UPDATE
    SET email     = EXCLUDED.email,
        name      = EXCLUDED.name,
        role      = EXCLUDED.role,
        is_active = true;
END $$;


-- ── Confirm it worked ────────────────────────────────────────────────
-- password_verifies must be true, identities must be 1.

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
