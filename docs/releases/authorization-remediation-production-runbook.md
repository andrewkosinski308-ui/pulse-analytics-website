# Authorization remediation — production runbook

This document prepares a controlled production release. It does not authorize that release.

Production project: `gultqhsccxuqvibymwdg`
Production database host: `db.gultqhsccxuqvibymwdg.supabase.co`
Staging project, already used for verification: `nncqmztzdkklbwkubowq`

Staging success does not approve any production action. Each gate below needs its own explicit approval.

## A. Release scope

The reviewed working tree on `main` is uncommitted. A GitHub-triggered deploy of `origin/main` would not include these files. A later release has to use this reviewed tree, or a commit that is reviewed again before it is pushed.

### Database migrations

Apply these four files, in this order, and no others:

1. `supabase/migrations/20261012010000_authorization_remediation_phase1.sql`
2. `supabase/migrations/20261012020000_role_change_flag_guard.sql`
3. `supabase/migrations/20261012045059_admin_only_project_creation.sql`
4. `supabase/migrations/20261012071500_fix_admin_set_staff_role_variable.sql`

### Application and Worker

- `admin-portal.html`
- `admin-unauthorized.html`
- `admin-update-password.html`
- `client-login.html`
- `staff-workspace.html`
- `js/account-onboarding.js`
- `js/admin-portal.js`
- `js/portal-guard.js`
- `js/pulse-auth.js`
- `js/staff-workspace.js`
- `workers/onboarding/gate.js`

`workers/billing/purchase-project.js` is unchanged. Stripe payment and price checks stay in that Worker. The SQL function `create_project_from_stripe_checkout` is unchanged: it remains `SECURITY INVOKER`, checks the checkout-session id, services, prices, and billing mode, and is granted to `service_role`.

### Tests

- `js/admin-employees.test.mjs`
- `js/authorization-remediation.test.mjs`
- `js/portal-guard.test.mjs`
- `js/profile-authorization.test.mjs`
- `js/project-creation-admin.test.mjs`
- `workers/onboarding/gate.test.mjs`
- `supabase/tests/authorization_phase1.sql`

### Documentation and operational scripts

- `docs/releases/authorization-remediation-production-runbook.md`
- `docs/releases/authorization-remediation-production-preflight.sql`
- `docs/releases/authorization-remediation-production-postcheck.sql`

Both SQL files are `SELECT`-only. They are not migrations.

### Files outside this release

No modified or untracked file in the current working tree was identified as unrelated. If the tree changes before release, review the new diff before continuing. Do not include `node_modules`, generated `js/supabase-env.js`, or the staging CLI directory `C:\Users\akosi\AppData\Local\Temp\pulse-staging-baseline`. That directory is linked to staging.

`supabase/config.toml` and `wrangler.toml` stay pointed at production. Do not edit them for this release.

## B. Pre-deployment checklist

Stop until every item is true:

- The working-tree diff has been reviewed and still matches this scope.
- All four migration files are present in the tree that will be applied.
- The Node regression suite has been run on that tree. This preparation run passed 330, failed 0, and skipped 0. Repeat the suite if the tree changes before release.
- `supabase/tests/authorization_phase1.sql` passed on staging in one session and ended with `ROLLBACK`. Fixture counts were zero. Do not rerun it against production.
- The read-only production preflight in section 3 has been run under gate 1, and every check returned `expected` or an empty mismatch list.
- The migration dry run, also under gate 1, lists exactly the four files in filename order and no others.
- The operator has confirmed a current backup or point-in-time recovery option for project `gultqhsccxuqvibymwdg`. If that option is missing or unclear, stop.
- Gate 2, the approval to apply migrations, is explicit and separate from the staging work and from gate 1.
- A deployment window is agreed before gate 2 and gate 3. Apply the database changes before the Worker and website deploy, so the database rules are in place before employees are sent to the shared shell.

## C. Migration sequence

Do not run a command that applies every pending repository migration. Production history was not read during preparation. If production is behind `20261002053000`, or has versions this repository does not contain, a normal `db push` would include those differences. That is an abort, not an invitation to continue.

Use the repository as the CLI work directory only after the preflight. Do not use the staging work directory. Pass the production project reference explicitly even though `supabase/config.toml` already names it. Use `npx.cmd`, because PowerShell script execution blocks `npx.ps1`. Use CLI 2.120.0, the version used for the staging apply.

After gate 1, and only as a non-writing connection:

```text
npx.cmd supabase@2.120.0 db push --workdir "C:\Users\akosi\Documents\pulse-analytics-website" --linked --project-ref gultqhsccxuqvibymwdg --skip-vault --dry-run
```

The dry run must propose only:

1. `20261012010000_authorization_remediation_phase1.sql`
2. `20261012020000_role_change_flag_guard.sql`
3. `20261012045059_admin_only_project_creation.sql`
4. `20261012071500_fix_admin_set_staff_role_variable.sql`

After a separate gate 2 approval, repeat that command without `--dry-run`. Do not add `--include-all`. Do not repair migration history. Do not insert rows into `supabase_migrations.schema_migrations`.

### Why the order is required

1. `20261012010000` makes client inserts administrator-only, tightens project updates, makes catalog writes administrator-only, installs the role-change flag on profile updates, and blocks authenticated profile inserts with role `admin`. It also creates `projects_guard_staff_grant` and `profiles_guard_role_insert`. Its project-insert policy still allows an assigned employee to create a project when that employee is not the owner. That policy is temporary. Its `admin_set_staff_role` function still uses the variable name `current_role`, which collides with the SQL keyword and fails at runtime with `42883`. That function body is also temporary.
2. `20261012020000` depends on the flag introduced by the first file. It repeats the assignment-removal check inside `protect_profile_privileges`, so a direct profile update cannot skip the rule enforced by `admin_set_staff_role`.
3. `20261012045059` depends on the trigger created by the first file. It replaces `projects_insert` with `is_admin()` only and makes the insert branch of `guard_project_staff_grant` reject every authenticated non-administrator. This is the final project-creation policy.
4. `20261012071500` depends on the function installed by the first file. It renames `current_role` to `existing_role` and leaves every authorization check in place. This is the final function body. The release is incomplete until this file has succeeded.

The final combined state is:

- Authenticated client and project creation require an administrator.
- An employee cannot set themselves as account manager through client creation, or as project owner through project creation.
- Employees cannot write the service catalog. Catalog reads stay available.
- A direct profile update cannot change a role unless the caller is an active administrator, the target is someone else, the current role is not `admin`, the new role is `employee` or `client`, and the transaction-local setting `pulse.role_change` is `approved`.
- An assigned employee still cannot be changed to `client` until the assignment, account-manager seat, and project seat are removed.
- `admin_set_staff_role(uuid, app_role)` is `SECURITY DEFINER`, uses `search_path=public`, and compares `existing_role` with `profiles.role`.
- Stripe provisioning is unchanged and remains callable by `service_role` only.
- Assigned employees keep project update and delivery access for clients they already serve. Files, reports, and support policies are not replaced.
- Client lifecycle, pricing, and billing behavior are not changed by these four files.

Each file is transaction-safe under the CLI used on staging: `db push` commits a file only after that file succeeds, and a failed file rolls back its own transaction and is not recorded. These files have no top-level `COMMIT`, no `CREATE INDEX CONCURRENTLY`, and no `VACUUM`. They do replace policies and function bodies. They do not drop tables or delete rows.

## D. Abort and stop conditions

Stop, and do not start the next step, if:

- The connected host is not `db.gultqhsccxuqvibymwdg.supabase.co`, the database is not `postgres`, or the port is not 5432.
- The host or project reference is staging `nncqmztzdkklbwkubowq`.
- The preflight history query returns any row.
- Any of the four release versions is already recorded.
- A required table, column, enum value, function, trigger, policy, or grant differs from the preflight's `expected` rows.
- The dry run lists any migration other than the four named above, or lists them out of order.
- A migration command fails.
- History, policies, triggers, or function grants after a migration do not match the post-check.
- An application smoke test shows an authorization regression.
- Backup or recovery is unavailable or unclear.

Do not retry a failed migration. Do not continue to a later file after a failure. Do not rewrite a migration during the release.

## E. Recovery

Confirm history and the live policy or function before choosing a response. A failed CLI migration and a committed migration are different situations.

### Failed file, transaction rolled back

`db push` does not record a file whose transaction rolls back. Confirm the failed version is absent from `supabase_migrations.schema_migrations`. Confirm the object that file would have replaced still matches the preflight. Leave the database there. Report the sanitized error. Do not rerun the file until the error is understood and a new approval is given.

### A file may have changed state

If history contains a version but the matching object is missing or different, treat that as a partial or drifted apply. Do not drop tables, do not recreate policies from the old staff-write rules, and do not delete migration history. Those actions would weaken authorization or hide what production has done. Stop and inspect the recorded version, the function body, and the policy expressions. The next change, if one is required, is a new reviewed forward migration.

### A file succeeded and a later file failed

Earlier files in this sequence stay applied. In particular:

- After only the first file, employees can still create a project for a client they already serve, and `admin_set_staff_role` still has the `current_role` defect.
- After the third file, project creation is administrator-only, but role changes through `admin_set_staff_role` still fail until the fourth file.
- Do not restore the pre-release `clients_insert`, `projects_insert`, or `services_staff_write` policies to "undo" a later failure. That would reopen the employee write paths this release closes.

The recovery for a successful first, second, or third file followed by a failed fourth file is a reviewed forward migration with the same function body as `20261012071500`, not a reversal of the earlier files.

### Application regression after the database release

Leave the new policies in place if they match the intended final state. Reversing them to restore a screen would reopen employee client, project, or catalog writes. Fix the application forward, or add a reviewed forward database migration if the installed object itself is wrong.

## F. Post-migration verification

Run `docs/releases/authorization-remediation-production-postcheck.sql` after all four files succeed. Abort the application deploy if it returns any row in the history section or any `abort` status.

Also confirm, from that output or a catalog read:

- History contains the 39 baseline versions plus the four release versions, in timestamp order, and no others. The latest version is `20261012071500`.
- `admin_set_staff_role(uuid, app_role)` is `SECURITY DEFINER`, `search_path=public`, uses `existing_role`, and still sets `pulse.role_change` to `approved` only after the administrator, self-change, destination-role, and assignment checks.
- `EXECUTE` on that function is granted to `authenticated`. `PUBLIC` and `anon` do not have `EXECUTE`. `service_role` remains as it was in the preflight, because these statements do not revoke it.
- `clients_insert` and `projects_insert` allow an administrator only.
- `services_admin_write` is administrator-only and `services_staff_write` is gone. `services_select` remains.
- `projects_update` still lets an assigned staff member update a project they can already reach.
- `files_select`, `reports_select`, and `support_requests_select` still allow assigned staff.
- `create_project_from_stripe_checkout` is still `SECURITY INVOKER`, still granted to `service_role`, and still not granted to `anon` or `authenticated`.
- No authorization-test fixture rows are created by the post-check. Do not run `authorization_phase1.sql` on production.

## G. Application smoke tests

Run these only after gate 3, the application deploy approval, and only with existing staff and client test accounts. Do not create a customer, do not change a customer subscription, and do not run a live card payment.

- Administrator signs in at `admin-login.html` and reaches `admin-portal.html`. Clients, Projects, and Employees are available. Create a project only for a non-customer test client if one already exists.
- Employee signs in at `admin-login.html` and reaches `admin-portal.html`. Clients, Projects, and Employees stay hidden, and those modules are not mounted. From `staff-workspace.html`, the shared-shell link reads "Staff Portal" and still opens `admin-portal.html`. Assigned files, reports, and support still open.
- An employee request to insert a client, a project, or a service is denied by the database.
- An employee profile update cannot set `role` to `admin`.
- Client signs in at `client-login.html` and reaches the client portal. A client opening `admin-portal.html` is sent to `admin-unauthorized.html` without ending a separate client session that the client login itself did not end.
- An active staff account that signs in through `client-login.html` keeps the session and is sent to `admin-portal.html`.
- Stripe sandbox only: an unpaid checkout does not call project provisioning. Do not complete a live payment. The Worker still refuses `payment_status` other than `paid` before it calls the service-role function.

## H. Approval gates

These are separate. Completing one does not approve the next.

1. Approval to run the read-only production preflight and the non-writing migration dry run against `gultqhsccxuqvibymwdg`.
2. Approval to apply the four reviewed migrations to production.
3. Approval to deploy the Worker and website from the reviewed working tree.
4. Approval to perform any recovery change, including any new forward migration.

The documented website deploy command is `npm run build && npx wrangler deploy`. It publishes the `pulse-analytics-website` Worker and the repository as static assets, and it generates gitignored `js/supabase-env.js`. Do not run it under this preparation task.

## Production preflight

Gate 1 uses `docs/releases/authorization-remediation-production-preflight.sql`.

Before connecting, confirm the host is exactly `db.gultqhsccxuqvibymwdg.supabase.co`, the database name is `postgres`, and the port is 5432. The preflight SQL cannot see the Supabase project reference. `inet_server_addr()` is only the server address. A matching database name and port is not proof of production. Abort before connecting if the host is staging `db.nncqmztzdkklbwkubowq.supabase.co`. Staging also fails these baseline checks because the four release versions are already recorded there. Never print the connection URL, password, access token, or service-role key. Abort if the session cannot read `supabase_migrations.schema_migrations`, `pg_policies`, and `pg_proc`.

Keep the preflight output and the later post-check output. Any policy, function, grant, or trigger difference outside the objects changed by the four migrations is an abort.

This repository does not document a backup or point-in-time recovery procedure for `gultqhsccxuqvibymwdg`. Do not infer that a backup exists from Supabase's general product. During gate 1, confirm from that project's own recovery settings that a restorable backup or point-in-time window exists, and record the latest recovery point without copying credentials. If that confirmation is missing, stop.

Abort when any of these is true:

- Any history finding is returned.
- Any schema check has status `abort`.
- The server is not the production host verified before the session started.
- PostgreSQL is not version 17. The repository expects major version 17. A different major version is a prerequisite mismatch.
- `current_user` cannot see the policy and function catalogs.

The expected starting point, which production has not yet been shown to match, is baseline version `20261002053000` and the pre-release policies: `clients_insert` and `projects_insert` still use `is_staff()`, `services_staff_write` still exists, and `admin_set_staff_role` still contains the `current_role` collision. Any earlier or later state is an abort.
