# Database and RLS Review

Live project: `gultqhsccxuqvibymwdg`.  
Schema source: `supabase/migrations/20260320120001_extensions_and_enums.sql` through `20260320120013_grant_authenticated_privileges.sql`, confirmed against live tables, columns, helpers, policies, and the `client-files` bucket on 2026-09-26.  
Labels: **VERIFIED**, **INFERRED**, **RECOMMENDATION**, **REQUIRES APPROVAL**.

Nothing in this document is a migration. Required and recommended changes are separate.

## 1. Existing Relevant Tables

### `profiles`

- **Purpose.** Application user, one-to-one with `auth.users`.
- **Primary key.** `id` (uuid, references `auth.users` on delete cascade).
- **Columns.** `email` unique, `full_name`, `role` `app_role` default `client`, `phone`, `avatar_url`, `is_active`, timestamps.
- **Tenant.** None directly.
- **Consumers.** `loadClientContext` selects `id, email, full_name, role, phone, avatar_url, is_active`. Admin and client shells both load this through `pulse-auth.js`.
- **RLS.** Enabled. `profiles_select`, `profiles_update_self`, `profiles_admin_insert`.
- **Status.** Sufficient for account display and self-update. Trigger `protect_profile_privileges` restores `role` and `is_active` for non-admins.

### `clients`

- **Purpose.** Tenant account.
- **Primary key.** `id` uuid.
- **Columns.** `name`, `legal_name`, `website`, `industry`, `status` `client_status`, `account_manager_id`, `billing_email`, `notes`, timestamps.
- **Tenant.** This is the tenant.
- **Consumers.** Portal loads `id, name, website, industry, status` after membership. No other app module queries it.
- **RLS.** `clients_select` (`can_access_client`), `clients_insert` (`is_staff`), `clients_update` (admin or `is_staff_for_client`), `clients_delete` (admin).
- **Status.** Sufficient as the tenant. Missing Stripe customer id. `notes` is staff-oriented and readable if selected.

### `client_members`

- **Purpose.** Links a profile to a client with `member_role` `owner` or `viewer`.
- **Primary key.** `id`. Unique `(client_id, profile_id)`.
- **Foreign keys.** `client_id` to `clients`, `profile_id` to `profiles`.
- **Consumers.** `loadClientContext` takes the earliest row for the user.
- **RLS.** `client_members_select` (admin, self, or `is_staff_for_client`). `client_members_staff_write` (admin or `is_staff_for_client`).
- **Status.** Sufficient for membership. Role is not enforced in policies.

### `services`

- **Purpose.** Global catalog. Seeded in `20260320120003_core_entities.sql`.
- **Primary key.** `id`. Unique `slug`.
- **Tenant.** None. Linked through `project_services`.
- **RLS.** `services_select` (active or staff). `services_staff_write` (staff).
- **Status.** Reusable for project service labels. Not a Stripe price list. Checkout prices live in `workers/checkout/catalog.js`.

### `projects`

- **Purpose.** Work for one client.
- **Primary key.** `id`. **Foreign key.** `client_id` not null. `owner_id` to `profiles`.
- **Columns.** `name`, `status` `project_status`, `starts_on`, `ends_on`, `summary`, timestamps.
- **RLS.** `projects_select`, `projects_insert` (staff), `projects_update` (admin, project member, or `is_staff_for_client`), `projects_delete` (admin).
- **Status.** Readable by client members. No client UI. No internal-only summary flag.

### `project_services`

- **Primary key.** `(project_id, service_id)`.
- **RLS.** `project_services_select` via project access. `project_services_staff_write` for staff who can administer that project.
- **Status.** Safe enough to show service names on a client project once the project itself is visible.

### `project_members`

- **Primary key.** `(project_id, profile_id)`.
- **RLS.** `project_members_select` includes users who `can_access_client` on the project’s client, so a client member can see who is on the project. Writes are staff.
- **Status.** **RECOMMENDATION.** Client UI should not dump staff email addresses. `profiles_select` allows a client to read only their own profile, not other profiles, unless the reader is staff. A client select of `project_members` therefore returns profile ids, not coworker names, unless a policy or view is added. **VERIFIED.** Showing staff names to clients would need a deliberate, limited profile read. That is **REQUIRES APPROVAL**, not a silent policy widening.

### `tasks`

- **Primary key.** `id`. **Foreign key.** `project_id`.
- **Columns.** `title`, `description`, `status`, `priority`, `assignee_id`, `due_at`, `completed_at`, timestamps.
- **Tenant.** Through `projects.client_id`.
- **RLS.** `tasks_select` includes client access via the project. Insert is staff. Update is admin, assignee, or project member. Delete is admin or project member.
- **Status.** No `client_visible` column. Not safe to list in the portal as-is.

### `appointments`

- **Primary key.** `id`. Optional `client_id`, `host_id`, `lead_id`.
- **Columns.** `title`, `appointment_type`, `status`, `starts_at`, `ends_at`, `timezone`, `location_or_url`, `notes`, timestamps.
- **RLS.** `appointments_select` (recreated in `20260320120012_security_hardening.sql`). `appointments_staff_write` is any staff for all commands.
- **Status.** Client read works. Client write does not. `notes` is not separated.

### `appointment_attendees`

- **Primary key.** `id`. Unique `(appointment_id, profile_id)`.
- **RLS.** `appointment_attendees_select`, `appointment_attendees_staff_write`.
- **Status.** Usable to show “you are an attendee.” Same profile-name limitation as project members.

### `reports`

- **Primary key.** `id`. **Foreign key.** `client_id` not null. Optional `project_id`, `created_by`.
- **Columns.** `title`, `report_type` text, `period_start`, `period_end`, `status` `report_status`, `published_at`, `summary`, `created_at`.
- **Trigger.** `reports_validate_project_client`.
- **RLS.** `reports_select` (staff, or client access and `published`). `reports_staff_write` (any staff, all commands).
- **Status.** Best current read model for a client module. No file blob on the report row. Attachments are `files.report_id`.

### `files`

- **Primary key.** `id`. Unique `storage_path`.
- **Columns.** `bucket` default `client-files`, `storage_path`, `file_name`, `mime_type`, `size_bytes`, `uploaded_by`, optional `client_id`, `project_id`, `lead_id`, `report_id`, `created_at`.
- **Constraints.** At least one of client, project, lead, report. Trigger `files_validate_ownership`.
- **RLS.** `files_select` (hardening recreation), `files_insert` (staff and `uploaded_by = auth.uid()`), `files_update` (any staff), `files_delete` (admin or uploader).
- **Status.** Not sufficient for two-way delivery. Missing direction, category, description, client message, and delivery state. Client insert is denied.

### `notifications`

- **Primary key.** `id`. **Foreign key.** `recipient_id` to `profiles`.
- **Columns.** `title`, `body`, `type` `notification_type`, `link_path`, `read_at`, `entity_type`, `entity_id`, `created_at`.
- **Tenant.** None. Per user.
- **RLS.** `notifications_select`, `notifications_update`, `notifications_insert`, `notifications_delete`.
- **Status.** Usable as the in-app inbox. Insert policy is broader than a system writer. Enum lacks file, billing, and support.

### `audit_logs`

- **Primary key.** `id`. Optional `actor_id`.
- **Columns.** `action`, `entity_type`, `entity_id`, `ip_address`, `user_agent`, `metadata`, `created_at`.
- **RLS.** `audit_logs_staff_select`, `audit_logs_staff_insert`. No update or delete policy. Triggers block mutation.
- **Status.** Usable for staff audit if a writer is added. Not client-visible. Not automatically populated.

### CRM tables (not portal modules)

- `leads`: staff policies `leads_staff_select`, `leads_staff_insert`, `leads_staff_update`, `leads_admin_delete`. Clients have no lead access.
- `contacts`: `contacts_select` allows staff or `can_access_client`. Writes are staff. **RECOMMENDATION.** Do not build a client contact directory unless a later requirement says so. Out of the current portal scope.

## 2. Table Relationships

```text
auth.users
  -> profiles
       -> client_members -> clients
       -> notifications.recipient_id
       -> audit_logs.actor_id

clients
  -> projects -> tasks
              -> project_services -> services
              -> project_members -> profiles
  -> reports -> files
  -> files
  -> appointments -> appointment_attendees -> profiles
  -> contacts
```

**VERIFIED.** `files.client_id` is also set from the project or report by `validate_file_ownership` when those links exist. A file can additionally point at `lead_id`. Lead-only files are staff-only in `files_select`.

## 3. Client / Tenant Isolation

**VERIFIED.** Isolation key is `clients.id`, carried on child rows as `client_id` or through `projects.client_id`.

`can_access_client(p_client_id)` is true only if one of these is true:

- caller is an active admin
- caller is `clients.account_manager_id`
- a `client_members` row exists for the caller and that client
- the caller owns a project for that client or is in `project_members` for such a project

A client user who is only a member of client A does not satisfy those checks for client B. UUID guessing does not add a membership row.

**VERIFIED.** `client_members_select` does not list other members to a client user. `profiles_select` does not list other profiles to a client user.

**INFERRED.** A client who is also added as `project_members` on another client’s project would gain `can_access_client` for that other client, including projects, published reports, tasks, files, and appointments. That follows the helper definition. It is a real widening path if staff add portal users onto other clients’ projects.

## 4. Existing RLS Policies

Live policy names match the migrations. Commands: `r` select, `a` insert, `w` update, `d` delete, `*` all.

| Table | Policies |
| --- | --- |
| `profiles` | `profiles_select`, `profiles_update_self`, `profiles_admin_insert` |
| `clients` | `clients_select`, `clients_insert`, `clients_update`, `clients_delete` |
| `client_members` | `client_members_select`, `client_members_staff_write` |
| `leads` | `leads_staff_select`, `leads_staff_insert`, `leads_staff_update`, `leads_admin_delete` |
| `contacts` | `contacts_select`, `contacts_insert`, `contacts_update`, `contacts_delete` |
| `services` | `services_select`, `services_staff_write` |
| `projects` | `projects_select`, `projects_insert`, `projects_update`, `projects_delete` |
| `project_services` | `project_services_select`, `project_services_staff_write` |
| `project_members` | `project_members_select`, `project_members_staff_write` |
| `tasks` | `tasks_select`, `tasks_insert`, `tasks_update`, `tasks_delete` |
| `appointments` | `appointments_select`, `appointments_staff_write` |
| `appointment_attendees` | `appointment_attendees_select`, `appointment_attendees_staff_write` |
| `reports` | `reports_select`, `reports_staff_write` |
| `files` | `files_select`, `files_insert`, `files_update`, `files_delete` |
| `notifications` | `notifications_select`, `notifications_update`, `notifications_insert`, `notifications_delete` |
| `audit_logs` | `audit_logs_staff_select`, `audit_logs_staff_insert` |
| `storage.objects` | `storage_client_files_select`, `storage_client_files_insert`, `storage_client_files_update`, `storage_client_files_delete` |

`20260320120012_security_hardening.sql` dropped and recreated `storage_client_files_select`, `files_select`, and `appointments_select`.

## 5. Existing Authorization Helpers

| Function | Effect |
| --- | --- |
| `is_admin()` | Active admin profile |
| `is_staff()` | Active admin or employee |
| `user_client_ids()` | Set of `client_id` from the caller’s memberships |
| `is_project_member(uuid)` | Admin, project `owner_id`, or `project_members` |
| `can_access_client(uuid)` | Admin, account manager, any member, or project participation |
| `is_staff_for_client(uuid)` | Admin, or staff with account-manager or project participation. Not mere client membership |

All six are `SECURITY DEFINER`, `STABLE`, `search_path = public`. **VERIFIED** present in live `pg_proc`.

There is no `is_org_member`. There is no helper that checks `member_role = owner`.

## 6. Client Permissions

**VERIFIED** for `profiles.role = client` with a membership, assuming they are not also staff:

| Data | Read | Write |
| --- | --- | --- |
| Own profile | Yes | Yes, except `role` and `is_active` forced back |
| Own membership row | Yes | No |
| Own client row | Yes, all columns if selected | No |
| Other clients | No | No |
| Published reports for that client | Yes | No |
| Draft reports | No | No |
| Projects, project services, tasks for that client | Yes | No |
| Appointments for that client, including notes | Yes | No |
| File rows with that `client_id` | Yes | No |
| Storage objects under that client folder | Yes | No |
| Own notifications | Yes | Insert to self, update own, delete own |
| Audit logs | No | No |
| Leads | No | No |

## 7. Staff Permissions

**VERIFIED.**

- Active admins pass every `is_admin()` and `is_staff()` check.
- Active employees pass `is_staff()` and fail `is_admin()`.
- Assignment-sensitive checks use `is_staff_for_client` or `is_project_member`.
- These policies do **not** require assignment: `reports_staff_write`, `appointments_staff_write`, `appointment_attendees_staff_write`, `files_insert`, `files_update`, `services_staff_write`, `leads_staff_select`, `contacts_update`, `storage_client_files_update`, `storage_client_files_delete` (delete is any staff or admin).
- Storage insert does require admin, `is_staff_for_client`, or `can_access_client` in addition to `is_staff()`.

**VERIFIED.** Employees have these SQL rights and cannot open the admin UI.

## 8. Organization / Client Isolation Analysis

Question: can a client in organization A read organization B by changing a URL, id, or browser request?

**VERIFIED answer.** Not for the current portal queries, and not for child tables gated by `can_access_client`, as long as the caller has no membership, account-manager assignment, or project membership on B.

Direct PostgREST calls with another client’s UUID still pass through the same policies. The HTML app is not the enforcement point.

Exceptions and weaknesses, all **VERIFIED**:

1. Whole-row select exposes sensitive columns on rows the user is allowed to know exist.
2. Any file object in B is unreadable; any file object in A is readable even when the business intent was “not sent.”
3. Project membership on another client widens `can_access_client`.
4. Staff policies that use only `is_staff()` let any employee read and write across clients for those tables. That is cross-tenant for staff, by policy, not a client bypass.
5. `notifications` and `audit_logs` are not tenant tables. A client cannot read another user’s notifications. An admin can read all notifications (`notifications_select` includes `is_admin()`). Staff who are not admins cannot read another user’s notifications.

UI-only restrictions are not the control for these tables. The risk is policies that are broader than the product intent, not missing RLS.

## 9. Client-Visible Data Analysis

| Source | Safe to show as designed | Needs care |
| --- | --- | --- |
| `profiles` self | Name, email, phone | Do not expose a role editor |
| `clients` | `name`, `status`, `website`, `industry` | `notes`, `billing_email`, `legal_name`, `account_manager_id` |
| `client_members` self | Own `member_role` | Other members’ rows are already hidden |
| `reports` published | Title, type, period, summary, published time | Drafts hidden by RLS |
| `projects` | Name, status, dates, summary | Summary has no internal flag |
| `tasks` | Nothing until a visibility rule exists | Description, priority, assignee |
| `appointments` | Title, type, status, times, location | `notes` |
| `files` | Nothing until delivery state exists | All client-linked rows, including draft-report files |
| `notifications` | Own rows | Clients can insert their own |

**RECOMMENDATION.** Client queries name columns. Where a modified client could still request a sensitive column, the durable fix is a view with column privileges or a split column. Views are **RECOMMENDATION** except where a gate marks a specific leak as in scope to close. The files and tasks cases are the ones that should be closed before those UIs ship. That is a phase gate, not a schema change executed now.

## 10. Storage Security

**VERIFIED.**

- Bucket `client-files`, `public = false`, `file_size_limit = 52428800`, `allowed_mime_types` null.
- Select and insert policies cast the first folder to uuid and call the client helpers.
- Insert also requires `is_staff()`.
- Update requires `is_staff()` and does not re-check the folder on the `USING` clause beyond the bucket id.
- Delete requires admin or staff, same limitation.
- No signed URL helper exists in application code.

**RECOMMENDATION.** Client-visible and internal objects must not share one readable prefix. A later client select policy should allow only the sent prefix (or a second bucket). Staff retain the internal prefix.

## 11. File Security

**VERIFIED gaps relative to two-way exchange.**

- No delivery state, so upload cannot differ from send.
- No client insert on `files` or storage.
- `files_insert` does not require the staff user to be assigned to `client_id`.
- `files_select` ignores report draft status.
- Folder-wide storage select matches that breadth.
- MIME and file name are not checked by the database. Size is checked by the bucket limit only after an upload reaches Storage. There is no app check because there is no upload code.
- No audit trigger on `files`.

**RECOMMENDATION.** See required versus recommended below. Do not open client downloads until internal objects are excluded.

## 12. Notification Security

**VERIFIED.**

- Recipients read and update only their rows. Admins can read all. Non-admin staff cannot read a client’s notifications.
- Any authenticated user can insert a row with `recipient_id = auth.uid()`.
- Any staff user can insert a row for any recipient.
- No email side effect exists in the database.

**RECOMMENDATION.** Replace client self-insert with no client insert, and insert from a `SECURITY DEFINER` function or from staff-only policies that check the recipient belongs to a client the caller can access. Exact mechanism is **REQUIRES APPROVAL** if it requires definer rights.

## 13. Audit Log Security

**VERIFIED.**

- Clients cannot select or insert.
- Staff can insert with actor constraints.
- Updates and deletes raise `audit_logs are append-only`.
- Rows are not tied to `client_id` except by whatever the writer puts in `metadata`.
- No current writer for portal file or report events.

**RECOMMENDATION.** Metadata should include `client_id` when the event is about a client record. A client-upload audit cannot use `audit_logs_staff_insert`. See the approval item in the architecture document.

## 14. Stripe Data Relationships

**VERIFIED.** No Stripe table and no Stripe column on `clients`. `billing_email` is not a customer id. Checkout does not write Postgres.

There is no foreign key from a payment to a client. **INFERRED.** Existing Stripe customers cannot be joined to `clients` from data in this database.

## 15. Required Database Changes

These are required only for the stated portal capabilities. They are not authorization to migrate during this audit. Exact column names and types still need a design review at the relevant gate.

### REQUIRED

1. **Files delivery distinction, before any client file UI.** A persisted state that separates staff holding a file from sending it to the client, plus RLS and storage conditions so client roles cannot read unsent objects or unsent rows. Without this, the current policies contradict the files requirement.
2. **Client upload path, before client upload ships.** `files` insert and storage insert exceptions that allow a client member to write only their own `client_id`, with `uploaded_by = auth.uid()`, and that ignore a browser-supplied client id that they do not belong to.
3. **Draft-report file leak, before report download ships.** Client file reads must not return files that exist only to support a draft report, unless those files were separately sent.
4. **Support storage, if the support module is approved.** No table exists. A request table and a message table scoped by `client_id` are required for that module. They are not required for reports or files.
5. **Stripe customer mapping, if billing is approved.** A durable id on `clients` (or a dedicated table) plus somewhere to store synced status. No billing UI can be correct without a link. The shape is **REQUIRES APPROVAL**.

### Not required

- An `organizations` table.
- A milestones table.
- A second invoice system.
- Replacing `reports`, `projects`, `notifications`, or `audit_logs`.

## 16. Recommended Database Changes

### RECOMMENDED

1. `client_visible` (or equivalent) on `tasks` if the task decision is to show some tasks. If the decision is to hide tasks, no column is needed.
2. Split or redact `appointments.notes` if staff notes must stay hidden even from a hand-written API query.
3. A client-safe view for `clients` that omits `notes`.
4. Extend `notification_type` with values for file, billing, and support when those events exist. Mapping onto `info` or `system` is possible and less clear.
5. Tighten `notifications_insert` so clients cannot forge rows.
6. Tighten staff write policies to `is_admin()` or `is_staff_for_client` where the product intent is assignment. This changes employee power and is **REQUIRES APPROVAL**.
7. MIME allowlist on the bucket after the allowlist is chosen.
8. Optional `notification_preferences` only if email is approved.
9. Audit helper that inserts file and report events, including a path for client uploads.

These recommendations are not requirements.

## 17. Migration Risks

**VERIFIED.** Portal tables are already in production (live project). New migrations must alter, not recreate, them.

- Tightening `files_select` or storage select can hide objects staff already consider delivered, if existing rows have no delivery flag. **RECOMMENDATION.** Backfill existing client-folder objects explicitly to sent or internal before changing the policy. There is no inventory of objects in this audit. **INFERRED.** The bucket may be empty or nearly empty because no app uploads. That must be checked at migration time, not assumed.
- Tightening staff writes can break a future operator habit of using the SQL editor as any employee. There is no admin file UI to regress.
- Enum additions are additive. Removing or renaming enum values is not.
- `handle_new_user` and privilege triggers must keep working. New profile columns should have defaults.
- Research policies and portal policies share one database. Portal migrations must not drop research policies.

## 18. Database Decisions Requiring Approval

1. File delivery columns and object path (or second bucket).
2. MIME allowlist and whether 50 MiB stays the cap.
3. Owner versus viewer enforcement in RLS.
4. Multi-client membership behavior.
5. Task visibility column versus no tasks.
6. Appointment notes column split.
7. Narrowing `is_staff()` write policies.
8. Notification enum values and who may insert.
9. Audit writer for client uploads (definer versus Worker).
10. Stripe id location and webhook payload storage.
11. Support status values and whether message bodies are a separate table (recommended) or a single request row (too limited for replies).

Gate 0 must accept this review before any of the above is migrated.
