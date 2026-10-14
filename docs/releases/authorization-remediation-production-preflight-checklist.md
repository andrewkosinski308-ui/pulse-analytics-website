# Authorization remediation — production preflight checklist

This checklist is the operator procedure for one read-only look at production. Completing it does not approve a migration, a dry run, or a deploy.

Use it with:

- `docs/releases/authorization-remediation-production-runbook.md`
- `docs/releases/authorization-remediation-production-preflight.sql`

Do not run `docs/releases/authorization-remediation-production-postcheck.sql` during this preflight. That file is for after the four migrations, which this checklist does not approve.

Do not run `supabase/tests/authorization_phase1.sql` on production.

The four migrations are one release. Apply none of them during this preflight, and do not later apply a subset. The first file leaves a temporary project-insert policy and a `current_role` function that fails at runtime. The release is complete only after `20261012071500`.

Staging project `nncqmztzdkklbwkubowq` already passed its test. That does not show what production contains. Recovery readiness is unverified until Step C is completed.

Never print or save a database password, connection URL, service-role key, access token, or other secret in this checklist, a repository file, or a terminal log.

## A. Preserve and verify the release

Work from `C:\Users\akosi\Documents\pulse-analytics-website` on `main`. Do not stage, commit, push, reset, stash, clean, or revert. Do not use `git add .`.

- [ ] Run `git status --short` and review the full diff, including untracked files.
- [ ] Confirm these four files are present and that `git hash-object` returns exactly:

  | File | Content hash |
  | --- | --- |
  | `supabase/migrations/20261012010000_authorization_remediation_phase1.sql` | `6322e8bd76e803bbd1463ea9607c6da4025567a6` |
  | `supabase/migrations/20261012020000_role_change_flag_guard.sql` | `55a8d079251f8c09f74f4de132d3b961bd5961b6` |
  | `supabase/migrations/20261012045059_admin_only_project_creation.sql` | `390c1cda78579e8369b7aae933bc920e149016dc` |
  | `supabase/migrations/20261012071500_fix_admin_set_staff_role_variable.sql` | `a12067053ee1ccae375eeff782be2554511669b8` |

- [ ] Confirm `js/staff-workspace.js` sets the shared-shell link to `Admin Portal` for an active administrator and `Staff Portal` for an employee, and that the link still points at `admin-portal.html`.
- [ ] Confirm the intended application set is only the files named in section A of the runbook: the shared-shell pages and scripts, `workers/onboarding/gate.js`, the tests listed there, and these release documents.
- [ ] Confirm `supabase/config.toml` and `wrangler.toml` are not modified and still name production project `gultqhsccxuqvibymwdg`.
- [ ] If any other modified or untracked file is present, stop and review it before continuing. Do not include `node_modules`, `js/supabase-env.js`, or `C:\Users\akosi\AppData\Local\Temp\pulse-staging-baseline`. That directory is linked to staging.

**Stop** if a migration hash differs or the working tree contains a change that is not in the reviewed release.

## B. Verify the production target

Verify the project in the Supabase dashboard, or in another project view that shows the project reference, before any connection. `supabase/config.toml` contains `project_id = "gultqhsccxuqvibymwdg"`, but that file does not prove which host a connection string will open.

All of these must match:

| Item | Required value |
| --- | --- |
| Project reference | `gultqhsccxuqvibymwdg` |
| Database host | `db.gultqhsccxuqvibymwdg.supabase.co` |
| Port | `5432` |
| Database | `postgres` |

- [ ] The dashboard project reference is `gultqhsccxuqvibymwdg`.
- [ ] The host that will be used is `db.gultqhsccxuqvibymwdg.supabase.co`.
- [ ] The port is `5432` and the database name is `postgres`.
- [ ] The host is not `db.nncqmztzdkklbwkubowq.supabase.co` and the project is not `nncqmztzdkklbwkubowq`.

**Stop** if any value differs. Do not connect.

The later SQL result `inet_server_addr()` is the server address. It does not prove the Supabase project.

## C. Verify backup and recovery readiness

Use the production project's own backup or recovery settings. Do not treat a general Supabase feature as evidence that this project has it.

Record, outside the repository and without secrets:

- [ ] A usable backup or point-in-time recovery option exists for `gultqhsccxuqvibymwdg`.
- [ ] The latest backup or recovery-point time.
- [ ] The retention window and any limit that would prevent restoring this change.
- [ ] The recovery method can restore this database if a migration must be recovered.
- [ ] The operator knows how to start that recovery, and which person is allowed to approve it.

**STOP — do not authorize migration execution** if any item above cannot be confirmed.

This stop does not forbid a later request for the read-only preflight. It does forbid treating migration execution as approved.

## D. Obtain separate authorization for the read-only preflight

Reviewing this checklist or the SQL file is not authorization to run it.

- [ ] A named person has explicitly approved connecting to production and running only the read-only preflight.
- [ ] That approval does not mention migration execution, a dry run, or a Worker deploy. If it does, treat those as unapproved until they are stated separately.

After that approval, and only then:

1. Reconfirm the project reference, host, port, and database from Step B.
2. Connect with the least-privileged account that can read `supabase_migrations.schema_migrations`, `pg_policies`, and `pg_proc`. If the only usable account is broader, record the role name and why. Do not put the password or URL in the command line, a repo file, or the handoff report.
3. Run the identity `SELECT` at the top of `docs/releases/authorization-remediation-production-preflight.sql` before the rest of the file. Continue only when `current_database()` is `postgres` and `inet_server_port()` is `5432`. Record `current_user` and `server_version`. Record `inet_server_addr()` only as the server address, not as the project identity.
4. Execute the remainder of that same file and no other SQL.
5. Save the full output outside the repository. Remove any accidental secret before saving.
6. Record every history finding and every row whose status is `abort`.

**Stop** if the identity is uncertain, the session cannot read those catalogs, or the output is missing either result set.

Do not run the migration dry run in the runbook as part of this step. That command contacts production and is not authorized by this checklist.

## E. Interpret the preflight results

The expected starting point is an assumption until this output confirms it: the 39 repository baseline versions from `20260320120001` through `20261002053000`, and none of the four release versions.

Pass only when all of these are true:

- [ ] The history query returns no rows.
- [ ] Every schema check has status `expected`.
- [ ] No check is missing.
- [ ] `clients_insert` and `projects_insert` still show the pre-release `is_staff()` form.
- [ ] `services_staff_write` is still present and `services_admin_write` is absent.
- [ ] `admin_set_staff_role` still contains `current_role` and does not contain `existing_role`.

**Stop** if any of these is true:

- An unexpected migration version is present.
- Any of `20261012010000`, `20261012020000`, `20261012045059`, or `20261012071500` is present.
- A baseline version is missing, a version name differs, or the history is otherwise inconsistent.
- A required table, column, enum value, function, trigger, policy, RLS setting, or grant differs from the preflight's `expected` rows.
- The connection identity or project target is uncertain.
- Any row has status `abort`, or the SQL returns an error.
- The output is incomplete or ambiguous.

Do not edit the production schema. Do not rewrite a migration to make the result pass. Do not insert or repair migration history. Leave the database unchanged and report the discrepancy.

## F. Approval gates

These are separate. Checking one box does not check the next.

| Gate | What it allows | What it does not allow |
| --- | --- | --- |
| 1 | Run this read-only preflight against `gultqhsccxuqvibymwdg`. | Applying migrations, running the dry run, deploying, or starting recovery. |
| 2 | Apply the four reviewed migrations, in filename order, after the runbook dry run has shown only those four files. | Deploying the site or Worker, or applying any other migration. |
| 3 | Deploy the reviewed application and Worker changes. | A database change. |
| 4 | Perform a recovery operation that has its own written scope. | An improvised schema reversal. |

- [ ] Gate 1 is recorded as approved or refused.
- [ ] Gates 2, 3, and 4 are recorded as not approved by this preflight.

**STOP — do not authorize migration execution** from this checklist alone. Gate 2 also requires the confirmed recovery point from Step C and a dry run that lists only the four files. Both remain future approvals.

## G. Handoff report

Fill this in without passwords, connection URLs, or other secrets. Store the SQL output outside the repository and cite its location.

```text
Date:
Operator:
Project reference confirmed:
Database host confirmed:
Database name and port:
Session role and PostgreSQL version:
Server address recorded (not a project reference):

Backup or PITR available:
Latest recovery point:
Retention and limitations:
Who may initiate recovery:

History findings (empty means no rows):
Preflight status: pass / fail / abort
Abort or discrepancy rows:

Output location:
Outstanding questions:
Gate 1:
Gate 2 ready for a separate decision: yes / no
Gates 3 and 4: not approved
```

Gate 2 is ready for consideration only when the history list is empty, every schema check is `expected`, the target was confirmed before connecting, and Step C was confirmed. Ready for consideration is not approval to migrate.
