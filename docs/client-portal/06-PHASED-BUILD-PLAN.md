# Phased Build Plan

Planning only. No phase in this document is authorized to start until Gate 0 in `08-APPROVAL-CHECKPOINTS.md` is approved for implementation.

Order follows the audit: foundation and a notification primitive before modules that emit events; files security before file UI; billing and scheduling after their decisions. Report and project metadata can overlap once the shell exists. Report download cannot.

Labels: **VERIFIED** for what exists to reuse, **RECOMMENDATION** for proposed work, **REQUIRES APPROVAL** for decisions.

## Phase 1 — Foundation

**Objective.** Turn the account card into a workspace shell that resolves one client and fails closed, without fake module data.

**Existing components to reuse.** `client-portal.html`, `client-portal.css`, `js/pulse-auth.js`, `js/supabase-env.js`, `isClientPortalEligible`, `loadClientContext`, `signOut`.

**Files affected.** `client-portal.html`, `client-portal.css`, `js/pulse-auth.js`, new `js/client-portal.js`. No new framework.

**Database changes.** None required for the shell.

**RLS changes.** None required to keep current reads. Do not widen policies.

**Storage changes.** None.

**Backend / Worker changes.** None.

**Frontend changes.** Navigation landmarks, session loading, error and empty regions, sign-out, display of the current safe client fields. Inactive clients are signed out. Modules not built are absent, not populated with samples.

**Dependencies.** Gate 0. **REQUIRES APPROVAL** if implementation will support multiple memberships instead of the earliest row.

**Testing requirements.** Client success path, admin and employee rejected on client login, client without membership rejected, inactive client signed out, direct load of the portal URL while logged out, session refresh.

**Definition of done.** An eligible client sees the shell and only their own identity data. A user who tampers with a client id in later queries still receives no other client’s rows under existing RLS. No domain module pretends to have data.

**Risks.** Scope growth into admin CRM. Building queries with `select *`.

**Approval requirements.** Gate 1. Multi-membership decision if it changes `loadClientContext`.

## Phase 2 — Account

**Objective.** Let the signed-in client maintain their own profile and password using existing auth and `profiles` rules.

**Existing components to reuse.** `updatePassword`, `profiles_update_self`, `protect_profile_privileges`, forgot-password and update-password pages.

**Files affected.** `client-portal.html` or a section in the shell, `js/client-portal.js`. Auth pages stay.

**Database changes.** None for name, phone, and password.

**RLS changes.** None. Clients still cannot update `clients` or `role`.

**Storage changes.** None. **REQUIRES APPROVAL** before any avatar upload. No avatar bucket exists.

**Backend / Worker changes.** None unless email change is in scope.

**Frontend changes.** Form for `full_name` and `phone`. Password form calling `updatePassword`. Read-only company, website, industry, and client status. No role control.

**Dependencies.** Phase 1.

**Testing requirements.** Update own name, attempt to set `role` or `is_active` and confirm the trigger keeps the old values, password change then sign-in, cannot update another profile.

**Definition of done.** Account edits persist on the caller’s profile only. Company record is unchanged.

**Risks.** Profile email diverging from Auth email if a raw profile update is used for email.

**Approval requirements.** Gate 4 includes account. Email change and notification preferences wait on the email decision (**REQUIRES APPROVAL**).

## Phase 3 — Notification Primitive

**Objective.** One in-app inbox and one way for later modules to create notifications.

**Existing components to reuse.** `notifications`, unread index, `notifications_select`, `notifications_update`.

**Files affected.** `js/client-portal.js`, shell badge and inbox section.

**Database changes.** **RECOMMENDATION.** Extend `notification_type` when file, billing, or support events need names. **REQUIRES APPROVAL** of the values. The primitive can ship first using existing values `info`, `report`, `appointment`, `task`, and `system` for a smoke test.

**RLS changes.** **RECOMMENDATION.** Remove client self-insert before the inbox is treated as trustworthy. Staff insert should not be a general “notify anyone” footgun. Mechanism **REQUIRES APPROVAL** if a definer function is used.

**Storage changes.** None.

**Backend / Worker changes.** None for in-app only.

**Frontend changes.** List, unread count, mark read. Empty and error states.

**Dependencies.** Phase 1. Email provider is not a dependency for this phase.

**Testing requirements.** User A does not see user B’s rows. Mark read sets `read_at`. Client cannot forge a notification if the insert policy was tightened. Admin read behavior stays as designed.

**Definition of done.** The shell shows only the caller’s notifications. A later module has one function to call.

**Risks.** Building per-module notification tables anyway.

**Approval requirements.** Insert-policy change. Email is **REQUIRES APPROVAL** and is out of this phase.

## Phase 4 — Reports

**Objective.** Clients see published reports for their client: title, type, period, summary, published time.

**Existing components to reuse.** `reports`, `reports_select`, `validate_report_project_client`.

**Files affected.** Shell reports section, `js/client-portal.js`.

**Database changes.** None for metadata.

**RLS changes.** None for the list. Download is not part of done until Phase 6 closes `files_select` for draft and unsent files.

**Storage changes.** None in this phase.

**Backend / Worker changes.** None.

**Frontend changes.** List and detail. Empty state when nothing is published. No draft toggle.

**Dependencies.** Phase 1. Download depends on Phase 6. “New report” notification depends on Phase 3 plus a staff publish action.

**Testing requirements.** Published row for client A visible to A and not to B. Draft not visible. Report whose `project_id` belongs to another client cannot be saved by staff (trigger). Client cannot update `status`.

**Definition of done.** Metadata matches RLS. The UI does not offer a file download that could expose an unsent or draft-linked object.

**Risks.** Staff still have no publish screen, so the list may be empty. That is acceptable. **INFERRED.** Operators might insert rows in the Supabase dashboard.

**Approval requirements.** Gate 2 for the read UI. A staff publish tool is not required for this phase and is not a CRM project. If a minimal publish action is added, it needs the employee-scope decision (**REQUIRES APPROVAL**).

## Phase 5 — Projects

**Objective.** Clients see their projects: name, status, dates, summary, and linked service names.

**Existing components to reuse.** `projects`, `project_services`, `services`, `projects_select`, `project_services_select`.

**Files affected.** Shell projects section, `js/client-portal.js`.

**Database changes.** None if tasks are omitted. **REQUIRES APPROVAL** before adding `client_visible` on `tasks`.

**RLS changes.** None for project rows. Do not list tasks until `tasks_select` matches the visibility decision.

**Storage changes.** None. Project file links wait for Phase 6.

**Backend / Worker changes.** None.

**Frontend changes.** List and detail. No fake progress percentage.

**Dependencies.** Phase 1. Task display depends on the visibility decision. File attachments depend on Phase 6.

**Testing requirements.** Client A does not see client B projects. Service names resolve only for that project. Client cannot insert a project.

**Definition of done.** Project metadata is accurate and internal tasks are not shown.

**Risks.** Showing `project_members` profile ids without a safe name source, or widening `profiles_select` to fix it.

**Approval requirements.** Gate 2. Task flag is **REQUIRES APPROVAL**. Staff names on a project are **REQUIRES APPROVAL**.

## Phase 6 — Two-Way Files

**Objective.** Staff can upload without sending. Send to Client is a separate action. Clients can list, download, and upload only inside their membership. Internal objects are not readable.

**Existing components to reuse.** `files`, `validate_file_ownership`, bucket `client-files`, size limit 50 MiB, `can_access_client`, `is_staff_for_client`.

**Files affected.** `js/client-portal.js`, shell files section, a minimal staff delivery page (location **REQUIRES APPROVAL**), new migration files when implementation is approved. Not this audit.

**Database changes.** **REQUIRED** for this phase: delivery state, category, description, optional client message, and enough direction or actor information to tell staff uploads from client uploads. Exact columns **REQUIRES APPROVAL** at Gate 3.

**RLS changes.** **REQUIRED:** client select only for sent or client-uploaded rows in their client; client insert only for their `client_id` and their user id; staff can hold unsent rows. Close the draft-report file read. **REQUIRES APPROVAL** before narrowing all employee writes.

**Storage changes.** **REQUIRED:** select and insert rules that match delivery. Internal and client-visible objects must not share an unrestricted `{client_id}/` prefix. MIME allowlist **REQUIRES APPROVAL**. Keep the bucket private.

**Backend / Worker changes.** **RECOMMENDATION.** None if upload uses the user session and storage RLS. A Worker is required only if audit inserts for client uploads cannot be done with a definer function. **REQUIRES APPROVAL.**

**Frontend changes.** Staff: upload, categorize, describe, optional message, Send, list of client uploads. Client: category, optional message, upload, history, download. Client has no client picker.

**Dependencies.** Phases 1 and 3. Gate 3 approvals for path, MIME, and staff audience (admin only or employees).

**Testing requirements.** See Gate 3: staff upload hidden from client; send reveals it; other client denied; client upload visible to assigned staff; MIME and size rejected; signed or authenticated download expires or stays authorized only for the caller; notification and audit rows created.

**Definition of done.** Upload and Send are different. Organization isolation holds for objects and rows. Validation runs before accept. No service-role key in the browser.

**Risks.** Policy change hides files that were already in the client folder if they are not backfilled. Bucket contents must be checked first.

**Approval requirements.** Gate 3. All file decisions in `04-DATABASE-RLS-REVIEW.md`.

## Phase 7 — Billing

**Objective.** Show billing state for the mapped client using the existing Stripe integration. Do not create a second billing system.

**Existing components to reuse.** `workers/checkout/api.js`, `workers/checkout/catalog.js`, `workers/router.js`, Worker secret handling, `clients` as the tenant.

**Files affected.** Worker billing routes, a migration for the customer link and synced status, shell billing section. Public checkout pages stay unless a gate explicitly changes them.

**Database changes.** **REQUIRED** once this phase is approved: Stripe customer id related to `clients`, and stored status for what the UI shows. Shape **REQUIRES APPROVAL**.

**RLS changes.** Clients read only their client’s billing status. They do not update Stripe ids.

**Storage changes.** None.

**Backend / Worker changes.** Signed webhook. Optional Customer Portal session if that option is approved. Secret key stays on the Worker.

**Frontend changes.** Status, current services if known from synced data, and a manage action only if Customer Portal is approved. No card entry in the portal unless a later gate says checkout should move here.

**Dependencies.** Phases 1 and 3 if events notify. Stripe decisions. This phase does not depend on files.

**Testing requirements.** Unsigned webhook rejected. Client A cannot read client B status. Secret never appears in browser responses. Portal session is created only for the mapped customer.

**Definition of done.** The screen matches synced Stripe state. Unmapped clients see an explicit empty state, not a guessed balance.

**Risks.** Historical anonymous customers with no id to match. **INFERRED** from the absence of stored metadata.

**Approval requirements.** Gate 4. Customer Portal versus in-app invoices. Mapping process for old customers.

## Phase 8 — Support

**Objective.** Authenticated requests and replies for one client. Not a helpdesk suite.

**Existing components to reuse.** Tenant and RLS patterns. Public `contact.html` remains public.

**Files affected.** New migration, shell support section, small staff reply UI.

**Database changes.** **REQUIRED** for this module: request and message rows with `client_id`. Status list **REQUIRES APPROVAL**.

**RLS changes.** Client insert and select only for their client. Staff select and reply only under the approved staff rule.

**Storage changes.** None unless attachments are in scope. **RECOMMENDATION.** Attachments reuse Phase 6 files rather than a new bucket. That reuse is optional and should not expand Phase 6.

**Backend / Worker changes.** None for in-app messages.

**Frontend changes.** Create request, history, thread, status. Empty and error states.

**Dependencies.** Phases 1 and 3. Staff reply surface.

**Testing requirements.** Client cannot set another `client_id`. Client cannot read another client’s thread. Staff reply notifies the client.

**Definition of done.** A request survives reload and is isolated by client.

**Risks.** Rebuilding the marketing form into the portal and breaking public intake.

**Approval requirements.** Gate 4. Status values.

## Phase 9 — Appointments

**Objective.** Show the client’s appointments. Scheduling changes only after the product decision.

**Existing components to reuse.** `appointments`, `appointment_attendees`, `appointments_select`.

**Files affected.** Shell appointments section, `js/client-portal.js`. Migrations only if notes are split or requests are a new table.

**Database changes.** None for a read-only list that omits `notes` in the query. A database guarantee that notes are unreadable is **REQUIRES APPROVAL** and implies a column or view change.

**RLS changes.** None for read-only. Client cancel or reschedule is not allowed by `appointments_staff_write` and must not be faked in the UI.

**Storage changes.** None.

**Backend / Worker changes.** None unless an external scheduler is approved. No vendor is chosen.

**Frontend changes.** Upcoming, past, detail without notes. No cancel button until a write path exists.

**Dependencies.** Phase 1. Notifications if changes should alert. The scheduler decision before any request UI.

**Testing requirements.** Client A does not see client B. Lead-only appointments stay off the client list. Notes are not in the client payload. Client update is rejected by RLS.

**Definition of done.** Read-only schedule is accurate. Unapproved scheduling actions are absent.

**Risks.** Choosing a calendar vendor inside implementation.

**Approval requirements.** Gate 4. Notes handling. Request, cancel, reschedule, and any external product (**REQUIRES APPROVAL**).

## Phase 10 — Overview Completion and Cross-Module UX

**Objective.** Overview shows real summaries from the modules that shipped, with shared empty, error, and loading behavior.

**Existing components to reuse.** Shell from Phase 1 and the section queries.

**Files affected.** Overview section, shared CSS states, nav unread badge.

**Database changes.** None beyond earlier phases.

**RLS changes.** None.

**Storage changes.** None.

**Backend / Worker changes.** None.

**Frontend changes.** Counts and recent items from reports, projects, files, notifications, and whichever of billing, support, and appointments exist. Quick actions only for real destinations.

**Dependencies.** Phases 1 through 6 at minimum. Later blocks as those phases finish.

**Testing requirements.** Counts match lists. Drafts and unsent files are not counted. Navigation works with the keyboard. Narrow viewport layout.

**Definition of done.** Overview cannot show a number that the module list does not support.

**Risks.** Hard-coded activity.

**Approval requirements.** Gate 5.

## Phase 11 — Testing

**Objective.** Cover the portal paths and the regressions around auth, checkout, and admin login.

**Existing components to reuse.** `workers/checkout/checkout.test.mjs` and router tests for checkout. There is no portal test suite today. **VERIFIED.**

**Files affected.** New tests when implementation exists. Not part of this documentation task.

**Database changes.** None.

**RLS changes.** None. Tests should run against policies, not only the happy UI.

**Storage changes.** None.

**Backend / Worker changes.** None except tests.

**Frontend changes.** None except test hooks if required.

**Dependencies.** Phases that claim to be done.

**Testing requirements.** Auth matrix, cross-client ids, file send versus upload, billing webhook signature, admin shell still admin-only, public checkout still creates a session in test doubles.

**Definition of done.** The Gate 6 test list is executed and failures are fixed or explicitly deferred by approval.

**Risks.** UI-only tests that never call PostgREST as a second client.

**Approval requirements.** Gate 6.

## Phase 12 — Security Review

**Objective.** Review auth, RLS, storage, tenant isolation, downloads, validation, Stripe secrets, and data exposure before production.

**Existing components to reuse.** This audit’s findings as the checklist, plus the implementation diff.

**Files affected.** None by default. Fixes are separate approved changes.

**Database changes.** Only if the review finds an open leak and a gate accepts a fix.

**Dependencies.** Phase 11 results.

**Testing requirements.** Two-client isolation, employee scope as approved, unsent file denied, secret scan of client responses, inactive user denied.

**Definition of done.** Gate 7 exit criteria met.

**Risks.** Treating this document as a completed penetration test. It is not. **VERIFIED** limitation: this audit read policies and code; it did not run a live exploit suite.

**Approval requirements.** Gate 7.

## Phase 13 — Production Readiness

**Objective.** Ship with a known migration, rollback, and configuration story.

**Existing components to reuse.** Supabase migrations, `wrangler.toml` secret names, current production project id.

**Files affected.** Migrations that gates already approved, README correction for the portal description, operator notes.

**Database changes.** Apply only the approved migrations. Confirm bucket objects before file-policy changes.

**RLS changes.** Apply only with those migrations.

**Storage changes.** Apply only with Gate 3.

**Backend / Worker changes.** Deploy webhook and billing routes only after Gate 4 and Gate 7.

**Frontend changes.** Production asset deploy of the portal pages.

**Dependencies.** Gates 6 and 7.

**Testing requirements.** Smoke test on production-like config with test clients in two tenants. Rollback rehearsal for the file policy migration.

**Definition of done.** Gate 8 exit criteria met. No service-role key in the site. Checkout and admin login still work.

**Risks.** Migrating file visibility without backfill. Deploying billing without a webhook secret.

**Approval requirements.** Gate 8.
