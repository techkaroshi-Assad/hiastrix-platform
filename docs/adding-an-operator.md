# Adding an operator (admin / super admin)

There is deliberately no sign-up route for `/admin`. Operator accounts are
provisioned by hand, and this is the only way to do it.

## What an operator account actually is

Three separate things have to line up. Knowing this makes every failure below
obvious rather than mysterious.

**An auth account** — a row in `auth.users`, plus a matching row in
`auth.identities`. Without the identity row the password is never checked and
sign-in fails, even though the account visibly exists.

**A role claim** — `raw_app_meta_data.role`, either `super_admin` or `admin`.
The edge proxy reads this to decide whether a request may reach `/admin` at all.
It is a routing guard, not the authorisation boundary.

**An authorisation record** — a row in `public.admin_users`. Every admin page
re-checks this table on the server rather than trusting the claim. Without it,
the account signs in successfully and is bounced straight back out — which looks
like a broken login but isn't.

Note the two casings: the claim is lowercase (`super_admin`), the database enum
is uppercase (`SUPER_ADMIN`). Both scripts bridge that; if you write SQL by hand,
don't forget it.

---

## Route A — Supabase UI, then one script

The safer of the two, and the one to prefer. The auth service writes the identity
row and the token columns itself, so none of the hand-rolled insert's failure
modes apply.

**1.** Supabase Dashboard → **Authentication → Users → Add user → Create new
user**.

**2.** Enter their email and a password, and tick **Auto Confirm User**. Without
that they receive a verification email — which points at the Supabase domain, and
we don't expose that to anyone.

**3.** Open **SQL Editor**, paste `promote-to-operator.sql`, edit the three values
at the top, and run it.

**4.** Check the verification query at the bottom. You want `confirmed` true,
`auth_role` matching what you set, `identities` = 1, `is_active` true.

**5.** Have them sign in at `app.hiastrix.com/login`. They land on `/admin`.

---

## Route B — SQL only

One script, no dashboard clicking. Use this when you want the whole thing in one
place, or when you're re-provisioning after a database move.

**1.** SQL Editor → paste `create-super-admin.sql`.

**2.** Edit the four values in the `DECLARE` block — email, password, name, role.
The script refuses a password under ten characters.

**3.** Run it, then check the verification query.

It is safe to re-run. An account that already exists has its password, name and
role refreshed rather than being duplicated, which also makes this the way to
**reset an operator's password**.

---

## Roles

`super_admin` can do everything, including editing platform settings and
connecting the CRM. `admin` can run tenants day to day — provisioning, credit,
numbers — but the settings page is read-only for them and the CRM Connect button
does not appear.

Give people `admin` unless they specifically need the settings page.

---

## When sign-in fails

**"Something went wrong" immediately, no delay.** Almost always the token columns
being NULL. A row inserted by hand leaves `confirmation_token`, `recovery_token`,
`email_change` and their siblings unset, and the auth service reads them into
non-nullable string fields — so it errors before it ever checks the password. The
current `create-super-admin.sql` writes empty strings and repairs existing rows,
so re-running it on the affected email fixes this.

To check directly:

```sql
select email,
       confirmation_token is null as bad_confirmation,
       recovery_token     is null as bad_recovery,
       email_change       is null as bad_email_change
from auth.users
where lower(email) = lower('them@astrixdigitalmedia.com');
```

**Signs in, then bounces back to the login page.** No `admin_users` row, or
`is_active` is false. The auth half worked and the authorisation half didn't —
run `promote-to-operator.sql`.

**"Invalid login credentials" with a correct password.** `identities` is 0. The
Supabase UI creates that row; a partial hand-insert may not have. Run
`create-super-admin.sql`, which writes it.

---

## Removing someone

Prefer deactivating over deleting — the audit trail on credit grants and CRM
connections references operators by email, and a deleted account makes past
entries harder to read.

```sql
update public.admin_users
   set is_active = false
 where lower(email) = lower('them@astrixdigitalmedia.com');
```

They can still authenticate but every admin page will turn them away. To also
stop them signing in at all, delete the user under Authentication → Users.

To demote a super admin to admin, re-run `promote-to-operator.sql` with
`v_role := 'admin'`. Both the claim and the table are updated together, which is
what you want — changing only one leaves an account that routes to `/admin` and
is then refused, or vice versa.
