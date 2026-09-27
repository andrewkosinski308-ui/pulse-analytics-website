# Current State

What the repository and live Supabase project `gultqhsccxuqvibymwdg` actually contain for the client portal.  
Labels: **VERIFIED**, **INFERRED**, **RECOMMENDATION**, **REQUIRES APPROVAL**.

## 1. Repository Structure

**VERIFIED.** The site is a static front end plus a Cloudflare Worker.

Relevant portal and platform files:

- `client-login.html`, `client-forgot-password.html`, `client-update-password.html`, `client-portal.html`, `client-portal.css`
- `js/pulse-auth.js`, `js/supabase-env.js`, `js/supabase-env.example.js`
- `main.js` (marketing header link only)
- `admin-login.html`, `admin-forgot-password.html`, `admin-update-password.html`, `admin-unauthorized.html`, `admin-portal.html`
- `js/admin-portal.js`, `css/admin.css`
- `contact.html`, `cart/checkout.html`, `cart/checkout.js`, `pricing.html`
- `workers/router.js`, `workers/checkout/api.js`, `workers/checkout/catalog.js`, `wrangler.toml`
- `src/lib/supabase/client.ts`, `src/lib/supabase/database.types.ts`
- `supabase/config.toml`
- `supabase/migrations/20260320120001_extensions_and_enums.sql` through `20260320120013_grant_authenticated_privileges.sql`
- Later research and benchmark migrations (`20260924*` through `20260926053000_benchmark_metrics.sql`) do not alter portal tables

**VERIFIED.** There is no `client-portal.js`, no `supabase/functions` directory, and no `docs/client-portal` content other than this audit set.

**VERIFIED.** `package.json` depends on `@supabase/supabase-js`. It does not depend on the Stripe Node SDK. The Worker calls the Stripe REST API with `fetch`.

## 2. Client Portal

**VERIFIED.** Four pages, one stylesheet, shared auth module.

| Page | Role |
| --- | --- |
| `client-login.html` | Email and password sign-in. Loads `js/supabase-env.js` and `js/pulse-auth.js`. Does not load `main.js`. |
| `client-forgot-password.html` | Calls `resetPassword`. Success copy is generic, including on failure, to avoid account enumeration. |
| `client-update-password.html` | Waits for a recovery session, then `updatePassword`. Form stays hidden until a session exists. |
| `client-portal.html` | Account overview only. |

`client-portal.html` renders `#portal-loading` and `#portal-panel`. The panel shows a welcome title, subtitle, and meta rows: Name, Company, Email, Account role (hardcoded “Client Account”), Membership (capitalized `member_role`). Actions are Sign Out and Visit Website. The header “Support” link points at `contact.html`.

**VERIFIED.** The page does not render reports, projects, files, billing, tickets, appointments, or notifications. It does not contain “coming soon” module stubs. Those stubs exist on the admin portal, not here.

**VERIFIED.** `client-portal.css` styles the auth card, the overview panel, loading, and the marketing-header portal icon (`.header-portal`).

## 3. Authentication

**VERIFIED.** `js/pulse-auth.js` creates one Supabase browser client for both portals.

- `getConfig` requires `window.PULSE_SUPABASE.url` and a non-placeholder `anonKey`.
- `initAuth` uses `persistSession: true`, `autoRefreshToken: true`, `detectSessionInUrl: true`, and `localStorage`.
- `signIn(email, password, portal)` defaults `portal` to `'client'`.
- Client sign-in calls `establishSession` (`auth.signInWithPassword`) then `assertClientPortalAccess`.
- `resetPassword` defaults the redirect page to `client-update-password.html` and uses `auth.resetPasswordForEmail`.
- `updatePassword` calls `auth.updateUser({ password })`.
- `signOut` calls `auth.signOut()`.

**VERIFIED.** `isClientPortalEligible` is true only when all of the following hold:

- `authenticated`
- `profile.role === 'client'`
- `client.id` is present
- `profile.is_active !== false`

**VERIFIED.** `assertClientPortalAccess` signs the user out when `profile.role !== 'client'`. Admin accounts get an Admin Portal message. Employee accounts get a staff-only message. Other non-client roles get a generic denial. If `role === 'client'` but `loadClientContext` found no client row, it signs the user out and reports that no client organization is linked.

**VERIFIED.** `assertClientPortalAccess` does not test `is_active`. An inactive client can pass that assert, then fail `isClientPortalEligible`. The login page then shows that the account cannot access the Client Portal. The session is not signed out on that path.

**VERIFIED.** `requireClientPortalOrRedirect` is exported and is not called by any HTML page. The portal page uses `subscribeAuth` and redirects ineligible users to `client-login.html`.

**VERIFIED.** `handle_new_user` in `supabase/migrations/20260320120002_profiles.sql` inserts a profile with `role = 'client'` after `auth.users` insert. There is no client registration form and no `signUp` call in `js/pulse-auth.js`.

**VERIFIED.** Admin “remember me” handling in `pulse-auth.js` does not sign out client sessions when it clears an admin tab session.

**VERIFIED.** `main.js` `injectClientPortalEntry` adds a header link on marketing pages. Eligible clients are sent to `client-portal.html`. Everyone else is sent to `client-login.html`. Failures leave the login link in place.

## 4. Authorization

**VERIFIED.** Two layers:

1. Browser gates in `pulse-auth.js` decide which HTML shell is shown.
2. Postgres RLS decides which rows PostgREST returns. The browser never receives a service-role key from `src/lib/supabase/client.ts` (that helper warns against passing the service role).

**VERIFIED.** Application roles are the enum `app_role`: `admin`, `employee`, `client`.

| Role | Client portal UI | Admin portal UI | Database `is_staff()` |
| --- | --- | --- | --- |
| `admin` | Signed out at client login | Allowed if `is_active` | True |
| `employee` | Signed out at client login | Denied (`isAdminPortalEligible` is admin-only) | True |
| `client` with membership | Allowed if active | Denied; unauthorized page can link back to the client portal | False |
| `client` without membership | Signed out at login | Denied | False |

**VERIFIED.** `isAdminPortalEligible` requires `profile.role === 'admin'` and `is_active !== false`. Employees have staff SQL rights and no staff UI.

## 5. Client / Tenant Model

**VERIFIED.** There is no `organizations` table. The tenant is `public.clients`.

Columns on `clients`: `id`, `name`, `legal_name`, `website`, `industry`, `status` (`client_status`: `lead`, `active`, `paused`, `churned`), `account_manager_id`, `billing_email`, `notes`, timestamps.

The portal select in `loadClientContext` is only `id, name, website, industry, status`. Company name on the overview is `clients.name`.

**VERIFIED.** `clients_select` uses `can_access_client(id)`, so a member can read the full row, including `notes` and `billing_email`, if a query asks for those columns.

**VERIFIED.** Inserts are `is_staff()`. Updates are admin or `is_staff_for_client`. Deletes are admin. Clients cannot edit their company row.

## 6. Membership Model

**VERIFIED.** `client_members` columns: `id`, `client_id`, `profile_id`, `member_role` (`owner` or `viewer`, default `viewer`), `created_at`. Unique `(client_id, profile_id)`.

**VERIFIED.** `loadClientContext` loads membership only when `profile.role === 'client'`:

```text
from client_members
select id, client_id, member_role, created_at
where profile_id = auth user
order created_at ascending
limit 1
```

Then it loads that `clients` row. Admins skip membership and clear `client`.

**VERIFIED.** `client_members_select` lets a user see their own membership rows, admins see all, and assigned staff see members of clients they are staff for. A client does not see other members of the same client through this policy.

**VERIFIED.** `can_access_client` is true for an admin, the account manager, any `client_members` row (owner or viewer), or a user who owns or is a `project_members` row on a project for that client. It does not test `member_role`.

**REQUIRES APPROVAL.** Multiple memberships. The database allows them. The portal uses one, the earliest.

## 7. Admin Portal

**VERIFIED.** `admin-portal.html` calls `requireAdminPortal`. `js/admin-portal.js` only renders identity, binds the password toggle, and binds sidebar chrome. “Coming soon” items call `preventDefault`.

Live section: Dashboard, with placeholder cards and copy that business metrics are not shown yet.

Disabled navigation: CRM group, Clients, Leads, Contacts, Projects, Tasks, Files, Reports, Appointments, Blog, Analytics, Settings.

**VERIFIED.** Absent from the admin UI: support, billing, notifications, and any file upload.

**VERIFIED.** `admin-portal.js` does not call `.from`, `.rpc`, or storage. Admin pages still run `loadClientContext` through `pulse-auth.js`, which reads `profiles` and, for clients only, membership.

**VERIFIED.** `workers/router.js` does not special-case admin or client HTML. After API routes, it serves static assets. Access control is the browser gate plus RLS.

## 8. Supabase

**VERIFIED.**

- Project id in `supabase/config.toml`: `gultqhsccxuqvibymwdg`.
- Browser config: `js/supabase-env.js` sets `window.PULSE_SUPABASE`.
- Typed helper: `createPulseSupabaseClient` in `src/lib/supabase/client.ts`.
- Migrations `20260320120001` through `20260320120013` define the portal schema, helpers, RLS, storage, hardening, and grants.
- `20260320120012_security_hardening.sql` states that it mirrors the live project. Live policy names queried on 2026-09-26 match that migration set for portal tables.
- `authenticated` has table privileges from `20260320120013_grant_authenticated_privileges.sql`. RLS still filters rows. `anon` table access was revoked in that migration. Later research migrations add anon read policies on research tables only.
- No Supabase Edge Functions are in the repository.

**INFERRED.** `src/lib/supabase/database.types.ts` was generated when the portal schema matched production and was not regenerated after research and benchmark migrations. Portal table shapes in that file still match the live columns checked for this audit. Research tables are missing from the types file. That drift does not change portal behavior.

## 9. Database

**VERIFIED** live public base tables include the portal set below. Research and benchmark tables also exist and are out of portal scope.

| Table | Purpose |
| --- | --- |
| `profiles` | One row per auth user. PK `id` references `auth.users`. |
| `clients` | Tenant account. |
| `client_members` | Portal user membership and `member_role`. |
| `services` | Global service catalog, seeded from site offerings. |
| `projects` | Delivery work. `client_id` required. |
| `project_services` | Project to service. |
| `project_members` | Staff (or other profiles) on a project. |
| `tasks` | Work items on a project. No milestone table. |
| `appointments` | Scheduled events. Optional `client_id` and `lead_id`. |
| `appointment_attendees` | Profile attendance. |
| `reports` | Client reports. `client_id` required. `status` draft or published. |
| `files` | Metadata for objects, default bucket `client-files`. |
| `notifications` | Per-recipient in-app rows. |
| `audit_logs` | Append-only staff audit. |
| `leads`, `contacts` | CRM. Leads are staff-only. Contacts are readable by client members when `client_id` is set. |

Enums are defined in `20260320120001_extensions_and_enums.sql` and exist in live types used by these tables: `app_role`, `client_status`, `lead_status`, `project_status`, `report_status`, `client_member_role`, `task_status`, `task_priority`, `appointment_status`, `appointment_type`, `attendance_role`, `attendance_response`, `notification_type`.

**VERIFIED.** Absent: `organizations`, `milestones`, Stripe customer or invoice tables, support or ticket tables, notification preference tables.

## 10. RLS

**VERIFIED.** RLS is enabled on every portal table listed in `20260320120010_rls_policies.sql`. Live `pg_policy` names match those policies. Hardening recreated `files_select`, `appointments_select`, and `storage_client_files_select` with the same rules.

Helpers in `20260320120009_helper_functions.sql`, confirmed present in live Postgres:

- `is_admin()` — active profile with `role = admin`
- `is_staff()` — active `admin` or `employee`
- `user_client_ids()` — client ids from `client_members` for `auth.uid()`
- `is_project_member(project_id)` — admin, project owner, or `project_members`
- `can_access_client(client_id)` — admin, account manager, any membership, or project owner or member for that client
- `is_staff_for_client(client_id)` — admin, or staff who are the account manager or a project owner or member for that client. Pure client membership does not qualify.

Execute on the helpers is granted to `authenticated` and revoked from `anon` and `PUBLIC`. Trigger functions `handle_new_user` and `protect_profile_privileges` are not executable by `authenticated`.

Policy inventory and isolation analysis are in `04-DATABASE-RLS-REVIEW.md`.

## 11. Storage

**VERIFIED** from migration `20260320120011_storage.sql` and a live `storage.buckets` read:

| Setting | Value |
| --- | --- |
| Bucket id | `client-files` |
| Public | `false` |
| File size limit | `52428800` (50 MiB) |
| Allowed MIME types | `null` (no allowlist) |
| Other buckets | none returned |

Path comment in the migration: `client-files/{client_id}/...`. Policies require the first folder segment to be a UUID.

| Policy | Rule |
| --- | --- |
| `storage_client_files_select` | Admin, `is_staff_for_client`, or `can_access_client` on that folder UUID |
| `storage_client_files_insert` | `is_staff()` and the same client checks |
| `storage_client_files_update` | `is_staff()` |
| `storage_client_files_delete` | `is_admin()` or `is_staff()` |

**VERIFIED.** No application source under the repo (excluding `node_modules`) calls `storage.from` or `createSignedUrl` for `client-files`.

## 12. Stripe

**VERIFIED.** Public checkout only.

- UI: `cart/checkout.js` loads Stripe.js, posts the cart to `/api/checkout/session`, mounts Embedded Checkout, and confirms `session_id` on return.
- Router: `workers/router.js` sends `/api/checkout/*` to `workers/checkout/api.js`.
- Catalog: `workers/checkout/catalog.js` `STRIPE_CATALOG` maps cart ids to Stripe product and price ids and to `monthly` or `one_time`. Browser prices are display-only. Unknown ids are rejected.
- Keys: `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` are Worker secrets named in `wrangler.toml`. The secret must be `sk_` or `rk_`. The publishable key must be `pk_`. The create response returns `clientSecret` and `publishableKey` only.
- Modes: any monthly item forces `mode=subscription`. All one-time items use `mode=payment`.
- One-time sessions set `customer_creation=always`. The code does not pass an existing customer id or a Supabase id.

**VERIFIED absent:** webhook route, webhook signing secret, Customer Portal, invoice or subscription list APIs, local subscription or invoice tables, and any column named `stripe_customer_id`.

Checkout is not authenticated and is not the client portal.

## 13. Reports

**VERIFIED.** Table `reports` from `20260320120007_reports_and_files.sql`: `client_id` required, optional `project_id`, `title`, `report_type` text, `period_start`, `period_end`, `status` default `draft`, `published_at`, `summary`, `created_by`, `created_at`. Trigger `validate_report_project_client` rejects a project that belongs to another client.

**VERIFIED.** `reports_select`: staff see all; others see a row only when `can_access_client(client_id)` and `status = published`. `reports_staff_write` is `is_staff()` for all commands, not limited to assigned clients.

**VERIFIED.** No client or admin UI reads or writes `reports`.

## 14. Projects

**VERIFIED.** `projects`: `client_id`, `name`, `status`, `owner_id`, `starts_on`, `ends_on`, `summary`, timestamps. Status enum: `planned`, `active`, `on_hold`, `completed`, `cancelled`.

`project_services` joins the seeded `services` catalog (SEO, local SEO, Google Ads, web design, analytics reporting, social, AI marketing, branding).

`tasks`: title, description, status, priority, assignee, due and completed timestamps. No `client_visible` column. No milestones table.

**VERIFIED.** `projects_select` allows `can_access_client` or project membership. `tasks_select` allows the assignee, a project member, or anyone who `can_access_client` on the project’s client. Client members can therefore read every task on their projects. They cannot insert tasks (`tasks_insert` requires staff and admin or project membership).

**VERIFIED.** No client or admin UI reads projects or tasks.

## 15. Files

**VERIFIED.** `files` columns: `id`, `bucket` default `client-files`, `storage_path` unique, `file_name`, `mime_type`, `size_bytes`, `uploaded_by`, optional `client_id`, `project_id`, `lead_id`, `report_id`, `created_at`. Check constraint requires at least one owner link. Trigger `validate_file_ownership` aligns `client_id` with the project or report client.

**VERIFIED.** There is no category, description, message, direction, or delivery-status column. Upload and “send to client” cannot be distinguished in the current schema.

**VERIFIED.** `files_insert` requires staff and `uploaded_by = auth.uid()`, and does not require `is_staff_for_client`. `files_update` is any staff. `files_delete` is admin or the uploader. `files_select` grants client members access through `client_id` or through the project’s client, without checking report publish status.

**VERIFIED.** No upload or download workflow exists in application code.

## 16. Support

**VERIFIED.** No support, ticket, or message tables.

**VERIFIED.** `client-portal.html` links Support to `contact.html`. That page is a public marketing form. The form `action` is a Google Apps Script endpoint, with hidden `form_type=contact`. It does not use the signed-in Supabase session.

**VERIFIED.** The admin portal has no support section.

## 17. Appointments

**VERIFIED.** `appointments`: title, type, status, start, end, timezone default `America/New_York`, `location_or_url`, `host_id`, optional `client_id`, optional `lead_id`, `notes`. End must be after start.

Attendee roles: `host`, `staff`, `client`, `guest`. Responses: `pending`, `accepted`, `declined`, `tentative`.

**VERIFIED.** `appointments_select` includes client members via `can_access_client`, hosts, assigned staff, and attendees. The selected row includes `notes`. `appointments_staff_write` is any `is_staff()` for all commands. Clients cannot insert, update, or delete appointments.

**VERIFIED.** No scheduling UI and no third-party scheduling integration in application code.

**REQUIRES APPROVAL.** How clients request, cancel, or reschedule. The repository does not decide that.

## 18. Notifications

**VERIFIED.** `notifications`: `recipient_id`, `title`, `body`, `type`, `link_path`, `read_at`, `entity_type`, `entity_id`, `created_at`. Indexes support recipient plus created time, and unread rows (`read_at is null`).

`notification_type`: `info`, `success`, `warning`, `task`, `appointment`, `report`, `system`. There is no `file`, `billing`, or `support` value.

**VERIFIED.** Policies: select for recipient or admin; update only the recipient; insert if staff or `recipient_id = auth.uid()`; delete for recipient or admin.

**VERIFIED.** No application code inserts notifications. No database trigger creates them when reports, files, or appointments change. No portal email sender exists beyond Auth password reset.

## 19. Audit Logging

**VERIFIED.** `audit_logs`: `actor_id`, `action`, `entity_type`, `entity_id`, `ip_address`, `user_agent`, `metadata` jsonb, `created_at`. Triggers `audit_logs_no_update` and `audit_logs_no_delete` call `prevent_audit_mutation`.

**VERIFIED.** `audit_logs_staff_select` is `is_staff()`. `audit_logs_staff_insert` is staff, and `actor_id` must be null, self, or the caller must be admin. Clients cannot read or insert audit rows through these policies. Nothing in the portal migrations writes an audit row when a file or report changes.

Audit rows are not scoped by `client_id`.

## 20. Shared Components

**VERIFIED.**

| Piece | Used by |
| --- | --- |
| `js/pulse-auth.js` | Client and admin auth pages and both shells |
| `js/supabase-env.js` | Both portals |
| `client-portal.css` | Client pages and admin auth pages |
| `css/admin.css` | Admin shell and admin auth chrome |
| `js/admin-portal.js` `bindPasswordToggle` | Admin auth pages only |
| `workers/checkout/*` | Public cart, not the portal |

There is no shared portal data-access module, no shared notification helper, and no shared file helper.

## 21. Existing Documentation

**VERIFIED.** `README.md` Current Features describe the marketing site. Planned Features still include Client Portal, Client Dashboard, Online Appointment Scheduling, and Live Chat.

`SECURITY.md` is referenced by the README for vulnerability reports. It was not used as a schema source for this audit.

`src/lib/supabase/database.types.ts` is a generated types artifact, not a product spec. It is behind the research migrations.

## 22. Documentation vs Actual Implementation

| Document or comment | Actual implementation |
| --- | --- |
| README lists Client Portal as planned | **VERIFIED** implemented as an auth and account shell |
| README lists Client Dashboard as planned | **VERIFIED** not built beyond the overview card |
| README lists Online Appointment Scheduling as planned | **VERIFIED** table exists; no scheduling product and no vendor integration |
| README lists Live Chat as planned | **VERIFIED** not present. Out of scope for this portal |
| Admin nav labels for Clients, Files, Reports, Projects, Appointments | **VERIFIED** disabled placeholders |
| Storage migration path comment `{client_id}/...` | **VERIFIED** as the policy’s first-folder rule, not as application code |
| `pulse-auth.js` comment that RLS is the authority | **VERIFIED** for data access. HTML gates are additional |

**RECOMMENDATION.** When implementation starts, correct the README portal lines so they match the shell that exists. That README edit is outside this documentation set.
