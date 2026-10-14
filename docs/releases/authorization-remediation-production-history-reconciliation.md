# Authorization remediation — production history reconciliation

This report explains the migration-history mismatch found by the October 12, 2026 read-only production preflight. It does not approve a production change. No database was contacted while preparing it.

The preflight output used here is `C:\Users\akosi\AppData\Local\pulse-preflight\20261012-authorization-remediation-production-preflight.txt`.

## 1. Executive summary

Production’s schema objects match the pre-release checks the four authorization migrations expect. Production’s migration ledger does not match the repository filenames.

The ledger was recorded when changes were applied. Those version numbers are wall-clock timestamps. The repository later, or in a few cases earlier, stored the same work under different designed filenames. Git shows no renames. One repository file was edited after it was first added. Several production rows are splits of a single repository file.

No pair has been reconciled. The applied SQL text was not compared with the current files.

Do not run `supabase db push` against production. Do not replay the 39 baseline files. Do not insert the 38 missing filename versions to make the preflight pass.

The smallest safe release, after its own approval, is to apply the four reviewed SQL files in filename order, each in its own explicit transaction, and to record only those four filename versions. The existing postcheck history comparison would still fail after that and must not be used unchanged.

Backup and point-in-time recovery remain unverified.

## 2. Why the histories differ

This is the explanation supported by the timestamps, filenames, and git history. It is not a statement that the SQL text matches.

Production project `gultqhsccxuqvibymwdg` was created on 2026-09-20. Its first recorded migration is `20260920224255 extensions_and_enums`, which is 2026-09-20 22:42:55 UTC. The next foundation rows are seconds apart. The repository files for that work are named `20260320120001` through `20260320120012` and were committed at 2026-09-20 23:36:21 UTC, about 54 minutes after those production rows. The filenames are backdated to March 20. Git added them with those names. There is no rename history.

`supabase/migrations/20260320120013_grant_authenticated_privileges.sql` says that `apply_migration`-created tables did not receive default grants. Production recorded `20260920234712 grant_authenticated_table_privileges` at 23:47 UTC. The repository file was committed the next morning, at 2026-09-21 04:22:10 UTC, under a different name.

The same pattern repeats. Production versions carry irregular seconds. Repository versions are round designed stamps. For the research, search, analytics, and benchmark batches, the git commit is one to four minutes after the production timestamp. Commit `5195d13`, “Keep GitHub main aligned with the portal already running in production,” is 2026-09-27 07:11:16 UTC, after production’s `20260927063955 admin_client_detail`.

Two October 1 files were committed before production recorded them, and production still stored a later clock time rather than the filename:

| Repository commit | Commit time (UTC) | Production row |
| --- | --- | --- |
| `d53d5a0` `profile_authorization` | 2026-10-01 07:06:51 | `20261001081902 profile_authorization` |
| `455cc2c` `employee_management` | 2026-10-01 07:24:48 | `20261001081933 employee_management` |

`appointments` was recorded one second before `projects_and_tasks`. The repository filename order is the reverse. A filename-ordered `db push` did not produce that sequence.

`20260926190000 client_portal_workspace` is the only exact version-and-name match. Its version is a round filename stamp, not an irregular clock time. The recording method for that single row was not established. It is not proof that the current file body was what production applied.

What the evidence rules out:

- Git did not rename these files after production applied them.
- The four authorization versions are not present. Their absence is not the cause of the 38 missing baseline versions.
- No production name was identified that belongs to a feature absent from the repository. That does not prove each production row’s SQL is contained in the corresponding file.

What remains unproven:

- Byte-for-byte or effect-for-effect equality of any production row with the current repository file.
- Whether `schema_migrations.statements` contains the applied SQL. The preflight read `version` and `name` only.
- Whether any split row contains a statement that the current combined file does not.

`20261002040000_client_profile_services.sql` was added in `a9d339e` and edited in `7299865` at 2026-10-01 08:36:05 UTC. Production recorded `client_profile_services` at 08:20:15 UTC, before that commit. This file is the concrete case where the current repository text may differ from what production applied.

The October 12 schema checks still returned `expected` for all 28 authorization prerequisites. The different ledger has not, by those checks, left a different `clients_insert`, `projects_insert`, `services_staff_write`, or `admin_set_staff_role` starting state.

Staging is not evidence for this ledger. Staging was built from the repository filenames. Production was not.

## 3. Mapping

Equivalence is `probable` only when one production row and one current repository file share the same migration name, and the file was not edited after it was added. `unknown` means the names differ, one file corresponds to several rows, the file was edited later, or only the version number matches. None are `proven`. No row is marked production-specific; unique SQL inside a split remains possible.

| Production version and name | Closest repository file | Evidence | Equivalence | Production-specific |
| --- | --- | --- | --- | --- |
| `20260920224255 extensions_and_enums` | `20260320120001_extensions_and_enums.sql` | Same name. Applied before the file was committed. | probable | not indicated |
| `20260920224310 profiles` | `20260320120002_profiles.sql` | Same name. Same apply burst. | probable | not indicated |
| `20260920224335 core_entities` | `20260320120003_core_entities.sql` | Same name. Same apply burst. | probable | not indicated |
| `20260920224358 crm_relationships` | `20260320120004_crm_relationships.sql` | Same name. Same apply burst. | probable | not indicated |
| `20260920224411 appointments` | `20260320120006_appointments.sql` | Same name. Applied before `projects_and_tasks`, opposite the filename order. | probable | not indicated |
| `20260920224412 projects_and_tasks` | `20260320120005_projects_and_tasks.sql` | Same name. Order differs from the filename. | probable | not indicated |
| `20260920224436 reports_and_files` | `20260320120007_reports_and_files.sql` | Same name. | probable | not indicated |
| `20260920224452 notifications_audit_logs` | `20260320120008_notifications_and_audit.sql` | Name differs. No SQL comparison. | unknown | not indicated |
| `20260920224521 helper_functions` | `20260320120009_helper_functions.sql` | Same name. | probable | not indicated |
| `20260920224547 rls_policies` | `20260320120010_rls_policies.sql` | Same name. | probable | not indicated |
| `20260920224554 storage_client_files` | `20260320120011_storage.sql` | Name differs. The repository file creates policies named `storage_client_files_*`. | unknown | not indicated |
| `20260920224647 security_hardening_grants` | `20260320120012_security_hardening.sql` | Name differs. | unknown | not indicated |
| `20260920234712 grant_authenticated_table_privileges` | `20260320120013_grant_authenticated_privileges.sql` | Name differs. The file itself says it repairs privileges after `apply_migration`. | unknown | not indicated |
| `20260925020426 research_catalog` | `20260924220000_research_catalog.sql` | Same name, different version. | probable | not indicated |
| `20260925020821 research_catalog_anon_select` | `20260924221500_research_catalog_anon_select.sql` | Same name, different version. | probable | not indicated |
| `20260925035004 research_taxonomy_access` | `20260925034500_research_taxonomy_access.sql` | One repository file contains schema changes, seed inserts, RLS, and function revokes. Five production names were recorded from 03:50:04 through 03:52:30 UTC. The file was committed at 03:53:10 UTC. | unknown | not indicated |
| `20260925035041 research_taxonomy_access_schema` | `20260925034500_research_taxonomy_access.sql` | Split of the same file. | unknown | not indicated |
| `20260925035107 research_taxonomy_access_seed` | `20260925034500_research_taxonomy_access.sql` | Split of the same file. The file contains taxonomy inserts. | unknown | not indicated |
| `20260925035138 research_taxonomy_access_rls` | `20260925034500_research_taxonomy_access.sql` | Split of the same file. The file contains RLS changes. | unknown | not indicated |
| `20260925035230 research_taxonomy_function_execute_revoke` | `20260925034500_research_taxonomy_access.sql` | Split of the same file. The file revokes function execute. | unknown | not indicated |
| `20260925045127 search_seo_collection` | `20260925063000_search_seo_collection.sql` | Same name, plus a second production row. Applied at 04:51 UTC. File committed at 04:53 UTC. | unknown | not indicated |
| `20260925045150 search_seo_collection_schema` | `20260925063000_search_seo_collection.sql` | Second row for one repository file. | unknown | not indicated |
| `20260925050740 analytics_ai_ux_resources` | `20260925071000_analytics_ai_ux_resources.sql` | Same name. Applied 05:07:40 UTC. Committed 05:08:17 UTC. | probable | not indicated |
| `20260926043124 benchmark_metrics` | `20260926053000_benchmark_metrics.sql` | Same name. Applied 04:31 UTC. Committed 04:35 UTC. | probable | not indicated |
| `20260926190000 client_portal_workspace` | `20260926190000_client_portal_workspace.sql` | Exact version and name. SQL text was not compared. | unknown | not indicated |
| `20260926222738 service_role_billing_sync_grants` | `20260926223000_service_role_billing_sync_grants.sql` | Same name, clock version. Part of the batch committed by `5195d13` after production was already running. | probable | not indicated |
| `20260926225905 cast_file_notification_type` | `20260926225500_cast_file_notification_type.sql` | Same name, clock version. | probable | not indicated |
| `20260926233204 cast_support_notification_type` | `20260926234000_cast_support_notification_type.sql` | Same name, clock version. | probable | not indicated |
| `20260926235543 report_publication` | `20260926235500_report_publication.sql` | Same name, clock version. | probable | not indicated |
| `20260927013856 project_purchases` | `20260927021500_project_purchases.sql` | Same name, clock version. | probable | not indicated |
| `20260927013940 fix_project_purchase_function` | `20260927023000_fix_project_purchase_function.sql` | Same name, clock version. | probable | not indicated |
| `20260927034648 restrict_client_project_fields` | `20260927040000_restrict_client_project_fields.sql` | Same name, clock version. | probable | not indicated |
| `20260927034937 staff_project_member_read` | `20260927041000_staff_project_member_read.sql` | Same name, clock version. | probable | not indicated |
| `20260927035029 project_member_write_check` | `20260927042000_project_member_write_check.sql` | Same name, clock version. | probable | not indicated |
| `20260927042214 remove_leads_contacts_appointments` | `20260927050000_remove_leads_contacts_appointments.sql` | Same name, clock version. | probable | not indicated |
| `20260927051635 client_onboarding_status` | `20260927060000_client_onboarding_status.sql` | Same name, clock version. | probable | not indicated |
| `20260927051740 client_onboarding` | `20260927061000_client_onboarding.sql` | Same name, clock version. | probable | not indicated |
| `20260927052923 fix_onboarding_save` | `20260927062000_fix_onboarding_save.sql` | Same name, clock version. | probable | not indicated |
| `20260927060905 client_lifecycle` | `20260927070000_client_lifecycle.sql` | One file, three production names. | unknown | not indicated |
| `20260927060958 client_lifecycle_schema` | `20260927070000_client_lifecycle.sql` | Split candidate. | unknown | not indicated |
| `20260927061038 client_lifecycle_onboarding` | `20260927070000_client_lifecycle.sql` | Split candidate. | unknown | not indicated |
| `20260927063926 admin_client_list` | `20260927080000_admin_client_directory.sql` | The file defines `admin_client_list` and `admin_client_detail`. Production has no `admin_client_directory` row. | unknown | not indicated |
| `20260927063955 admin_client_detail` | `20260927080000_admin_client_directory.sql` | Second function in the same file. | unknown | not indicated |
| `20261001081902 profile_authorization` | `20261001030000_profile_authorization.sql` | Same name. File committed 07:06 UTC and not edited later. Production recorded 08:19 UTC. | probable | not indicated |
| `20261001081933 employee_management` | `20261001180000_employee_management.sql` | Same name. File committed 07:24 UTC and not edited later. | probable | not indicated |
| `20261001082015 client_profile_services` | `20261002040000_client_profile_services.sql` | Same name. Production row is 08:20 UTC. The file was edited at 08:36 UTC. | unknown | not indicated |
| `20261001083324 fix_service_interest_save` | `20261002053000_fix_service_interest_save.sql` | Same name. Applied 08:33 UTC, three minutes before commit `7299865`. | unknown | not indicated |

The four release files have no production row:

1. `20261012010000_authorization_remediation_phase1.sql`
2. `20261012020000_role_change_flag_guard.sql`
3. `20261012045059_admin_only_project_creation.sql`
4. `20261012071500_fix_admin_set_staff_role_variable.sql`

## 4. Release approaches

### A. Normal `supabase db push`

Reject. CLI 2.120.0 `db push` pushes migrations that are not in the remote history table. Thirty-eight repository baseline versions are absent from production, so they are pending. `--include-all` widens the set of local migrations included. The command can also update vault secrets unless `--skip-vault` is set. The October 12 preflight already shows that a push from this repository would not be limited to the four release files. Do not run it, including `--dry-run`, unless a later approval asks only for that listing and accepts a production connection.

### B. Replaying the 39 baseline files

Reject. The 28 schema checks say the objects those files create are already present in the expected pre-release form. Replaying `CREATE TABLE`, policy, and grant statements against that schema can fail midway or replace objects that production already customized under a different recorded name. The edited `client_profile_services` file and the split rows make a replay able to change SQL that was not proven identical.

### C. Apply only the four reviewed files

This is the recommended approach. It is specified in section 5 and is not authorized by this report. It does not replay the baseline, does not delete or rewrite the 47 existing history rows, and records only the four filename versions that this release actually applies.

### D. Reconcile history by marking the baseline applied

Reject as part of this release. Inserting the 38 filename versions without running their SQL would tell a later `db push` that those files are already applied. That is false for any file whose text differs from production, and `client_profile_services` was edited after the production timestamp. Deleting or renaming the 46 clock-time rows would conceal the only record of how production was actually migrated, including the split rows whose SQL is still unknown.

A future reconciliation can be reviewed on its own. It would need a read-only comparison of stored migration statements, or of the live objects, against the current files. Until that comparison exists, the production ledger stays as it is. After the four-file release, `db push` from this repository remains unsafe because the 38 baseline filenames are still absent from production.

The schema evidence required before any history repair is a comparison that is still missing: the applied SQL, or a catalog diff that covers more than the 28 authorization checks. The passing checks are enough to apply the four files. They are not enough to mark the other 38 files applied.

## 5. Recommended procedure

Do not execute this section under the current approval.

The four files have no top-level `COMMIT`, `VACUUM`, `CREATE INDEX CONCURRENTLY`, `DELETE`, `DROP TABLE`, or `TRUNCATE`. The `BEGIN` keywords in those files are inside PL/pgSQL function bodies. The statements in one file become one transaction only when the client wraps them. The four files are not one transaction as a group. On staging, CLI `db push` supplied that per-file transaction. This procedure has to supply it explicitly.

Do not use `apply_migration`. It records a new clock-time version and would leave the filename version still pending.

Use one direct session to `db.gultqhsccxuqvibymwdg.supabase.co`, database `postgres`, port `5432`. Do not put the password or URL in the command line, a repository file, or the shell history. Send each file as one script. Do not split it on semicolons.

Before the first file, read column names and nullability for `supabase_migrations.schema_migrations`. The preflight proved `version` and `name` exist. It did not prove whether `statements` exists or is required. Use an `INSERT` that satisfies the live table. Include `statements` only when the table requires it, using the exact file text.

For each file, in this order:

1. `20261012010000` / `authorization_remediation_phase1`
2. `20261012020000` / `role_change_flag_guard`
3. `20261012045059` / `admin_only_project_creation`
4. `20261012071500` / `fix_admin_set_staff_role_variable`

Run:

```sql
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM supabase_migrations.schema_migrations
    WHERE version = '<filename version>'
  ) THEN
    RAISE EXCEPTION 'version already recorded';
  END IF;
END $$;

-- file contents, unchanged, as one script

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('<filename version>', '<filename name>');

COMMIT;
```

Adjust the `INSERT` column list only to match the live table. Do not insert any other version.

If any statement fails, the transaction rolls back. Confirm that version is absent and that the object which the file would have replaced still matches the preflight. Do not start the next file. Do not retry until the error is understood and a new approval is given.

If the transaction commits, read that version back before opening the next transaction. A committed earlier file stays applied if a later file fails. After only the first file, employees can still create a project for a client they already serve, and `admin_set_staff_role` still has the `current_role` defect. After the third file, project creation is administrator-only, but role changes through that function still fail until the fourth file. Do not restore the old staff-write policies. The repair for a committed prefix is a new forward migration, the same rule already in the runbook.

A second run of a committed file is prevented by the version check and by the primary key. The SQL itself is not a safe second run: it creates policies and replaces functions.

After the fourth commit, verify objects with the policy, function, trigger, and grant checks in `authorization-remediation-production-postcheck.sql`. Do not require the 39 baseline filename versions to be present. Separately confirm all four release versions exist with the names above, that they are the newest four versions, and that the 47 rows recorded on October 12 are still present and unchanged.

## 6. Preconditions and stop conditions

Start only when all of these are true:

- The four file hashes are still `6322e8bd76e803bbd1463ea9607c6da4025567a6`, `55a8d079251f8c09f74f4de132d3b961bd5961b6`, `390c1cda78579e8369b7aae933bc920e149016dc`, and `a12067053ee1ccae375eeff782be2554511669b8`.
- The project record is still `gultqhsccxuqvibymwdg`, host `db.gultqhsccxuqvibymwdg.supabase.co`, database `postgres`, port `5432`.
- A new read-only identity check returns database `postgres` and port `5432`.
- The 28 schema checks still return `expected`.
- The four release versions are still absent.
- The 47 production versions listed in section 3 are unchanged.
- The operator has explicitly accepted the unverified-recovery risk in section 7.
- Approval names this four-file procedure and does not name `db push`, baseline replay, or history repair.

Stop, and leave the database at the last committed file, if:

- The host, project, database, or port differs.
- Any schema check returns `abort`.
- Any of the four versions is already present at the start.
- The October 12 production version list has gained, lost, or renamed a row.
- `schema_migrations` cannot store `version` and `name` with a known column list.
- A file’s transaction fails.
- The post-file version read does not show exactly the version just committed.
- The final object checks do not match the intended administrator-only state.

## 7. Recovery

No backup was shown to exist for this project. Point-in-time recovery was not enabled. `walg_enabled` is not a restorable backup. No logical export has been taken, and none has been restored, so a logical dump is not a verified recovery path. Docker and the PostgreSQL client tools required by the supported free export were not installed. This report does not install them or buy a plan.

The minimum free procedure, still unverified, remains a later logical export with Supabase CLI `db dump` after Docker is available: separate roles, schema, and data files, stored outside the repository, then restored into a disposable local database. Storage file bytes, auth provider settings, and project secrets are outside that export. Until a restore test succeeds, that procedure is a plan, not a recovery capability.

These four files replace policies and functions. They do not drop tables or delete rows. An uncommitted file rolls back with its history insert. A committed file has no tested database restore behind it. Recovery from a committed mistake is a forward migration, not a reversal of earlier files and not a platform point-in-time restore.

That residual risk remains even if every schema check passes. This report does not waive the runbook’s backup stop. Execution needs a separate written acceptance of that risk.

## 8. Approvals

These are separate. This document grants none of them.

| Approval | What it allows | What it does not allow |
| --- | --- | --- |
| 1 | Nothing further. The read-only preflight already ran. | Migration, dry run, deploy, backup, or history repair. |
| 2 | Apply section 5, the four files only, after the operator accepts unverified recovery. | `db push`, baseline replay, editing the 47 existing history rows, or deploy. |
| 3 | Run the object checks from the postcheck, plus the four-version history check in section 5. | Treating the current postcheck history comparison as the pass rule. |
| 4 | Deploy the reviewed application and Worker after the fourth migration has been verified. | A database change. |
| 5 | A later, separately designed history reconciliation. | Doing that reconciliation inside approval 2. |
| 6 | A backup or a recovery operation with its own scope. | An improvised schema reversal. |

## 9. Unknowns

- The SQL stored for each production history row, if it was stored at all.
- Whether any split row differs from the current combined repository file.
- Whether the current `client_profile_services` file matches the body applied at 08:20 UTC.
- Why `client_portal_workspace` alone uses the filename version.
- The exact pending list `db push --dry-run` would print. It was not run. The version comparison is sufficient to reject the command.
- A tested restore path.

## Proposed runbook corrections

Do not apply these edits until they are reviewed. They belong in `authorization-remediation-production-runbook.md` and the postcheck comments:

- Delete the production `db push` command, with and without `--dry-run`, as the way to apply this release. Point section C at section 5 of this report.
- Remove the precondition that a dry run must list only the four files. This production history cannot satisfy that precondition.
- Change the postcheck comment and history query so production is not required to contain the 39 filename baseline versions. Keep the object, grant, trigger, and function checks. Add a check that the four release versions exist and that the 47 pre-release production rows are unchanged.
- Leave the preflight history check as it is. It correctly failed. Do not rewrite it so this ledger looks like the repository.
- Leave the instruction not to repair `schema_migrations` in order to pass the preflight.

The application and Worker deploy remains a later approval. The shared shell still must not be deployed before the fourth migration is verified.
