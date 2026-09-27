# Gap Analysis

Comparison of the verified portal with the intended agency client workspace.  
Desired behavior is a target, not evidence that it exists.  
Labels: **VERIFIED**, **INFERRED**, **RECOMMENDATION**, **REQUIRES APPROVAL**.

## Feature Comparison

| Feature | Current State | Desired State | Reusable Infrastructure | Required Work | Dependencies | Security Considerations |
| --- | --- | --- | --- | --- | --- | --- |
| Overview | **VERIFIED.** One card: name, company, email, hardcoded “Client Account”, membership label. | Identity, membership, account status, and real counts or lists from reports, projects, files, billing, support, appointments, and notifications. No invented metrics. | `client-portal.html`, `loadClientContext`, `clients.status`, later module queries. | Shell navigation and queries that use only columns and rows the client should see. Fill sections as modules exist. | Foundation; each module before its overview block is real. | Do not select `clients.notes`. Do not count draft reports or internal files. |
| Reports | **VERIFIED.** No UI. Table and `reports_select` (published plus `can_access_client`) exist. `report_type` is free text. | List metadata, period, open or download when a client-visible file exists, distinguish current and historical by period and `published_at`. | `reports`, `files.report_id`, published-only RLS. | Client read UI. Staff still need a way to create and publish, which the admin shell does not provide. | Foundation; file visibility rules before download; notification primitive if publish should notify. | Drafts stay staff-only. File rows for draft reports are readable today if `client_id` is set. |
| Projects | **VERIFIED.** No UI. Projects, services, members, and tasks exist. No milestones. | Status, dates, summary, related services, client-appropriate tasks, related client-visible files. Hide internal staff notes and internal tasks. | `projects`, `project_services`, `services`, `projects_select`. | Client read UI. Visibility rule for tasks before any task list. | Foundation; task-visibility decision; files if attachments are shown. | `tasks_select` currently returns every task to client members. |
| Files | **VERIFIED.** No UI, no upload code, no signed URLs. Private bucket, staff-only insert. No delivery state. | Two-way exchange. Staff upload is not Send to Client. Clients upload only into their own membership. Isolation, validation, delivery state, notification, audit. | `files`, bucket `client-files`, `can_access_client`, 50 MiB cap. | Schema for delivery and message fields, RLS for client insert, storage rules that hide internal objects, minimal staff send screen, client list and upload. | Foundation; notification primitive; audit approach; path and MIME approvals. | Current select policies expose the whole client folder and every client-linked file row. |
| Billing | **VERIFIED.** No portal billing. Anonymous Embedded Checkout only. No customer mapping, webhook, portal, or invoice API. | Show the client’s services, subscription or payment status, and a safe management path using the existing Stripe integration. | Worker checkout, catalog, `clients.billing_email` as a contact field only. | Approved mapping and sync, then a read API and a small portal section. Not a second billing system. | Stripe decisions; Worker changes later; auth on those routes. | Do not put `STRIPE_SECRET_KEY` in the browser. Do not treat a guest Checkout session as proof of an org subscription. |
| Support | **VERIFIED.** Header link to public `contact.html` (Google Apps Script). No ticket tables. | Authenticated request, history, staff reply, status, notification. Not a helpdesk product. | Contact page can stay the public intake. Auth and `clients` tenancy. | New request and message tables and a small UI, if approved. | Notification primitive; staff reply surface. | Requests must be forced to the caller’s `client_id`. Do not expose other clients’ messages. |
| Appointments | **VERIFIED.** Table, types, statuses, attendee rows. Clients can read, including `notes`. Staff-only writes. No scheduler product. | Upcoming, past, and detail. Scheduling behavior is undecided. | `appointments`, `appointment_attendees`, `appointments_select`. | Read UI that omits internal notes. Write or request flow only after approval. | Appointments decision; notification primitive for changes. | `notes` is on the client-readable row. `appointments_staff_write` is any staff member. |
| Account | **VERIFIED.** Display plus forgot-password and update-password pages. RLS allows self profile update except `role` and `is_active`. | Profile, email, password, read-only company, notification preferences when email exists. | `profiles_update_self`, `protect_profile_privileges`, existing password functions. | In-portal profile form and password entry that reuse current auth. Company stays read-only. | Foundation. Email preferences depend on an email decision. | Clients must not update `clients` or their own `role`. |
| Notifications | **VERIFIED.** Table, unread index, policies. No UI, no writers, no portal email. Type enum has no file, billing, or support values. | One in-app channel for report, project, file, support, billing, appointment, and account events. | `notifications`, recipient RLS, `link_path`, `entity_type`, `entity_id`. | Shared writer, inbox, unread count. Enum extension or mapped types. Email only if approved. | Foundation before modules emit events. | Clients can insert rows to themselves today. Staff can insert to any recipient. |

## Authentication Gaps

**VERIFIED.**

- No public signup. Provisioning a client user is an Auth user plus a profile plus a `client_members` row. The admin UI does not do that provisioning.
- Inactive clients are not signed out inside `assertClientPortalAccess`.
- `requireClientPortalOrRedirect` is unused. The portal page implements its own redirect.
- Password change from inside the signed-in overview does not exist. Recovery pages do.
- Client and admin share one browser Supabase session. Signing in as the other role signs the mismatched role out only on that portal’s assert path.

**RECOMMENDATION.** Foundation should sign out inactive clients and keep using the existing recovery pages rather than a new auth provider.

## Authorization Gaps

**VERIFIED.**

- `owner` and `viewer` are display-only.
- Earliest membership wins in the UI even if more rows exist.
- Employees are staff in SQL and have no portal.
- HTML hiding is not sufficient. Every new query must rely on RLS, and selects must name safe columns because RLS is row-level, not column-level.

**REQUIRES APPROVAL.** Owner-only actions, if any.

## RLS Gaps

**VERIFIED.**

- Client isolation for current portal queries holds through `can_access_client` and membership policies.
- Staff write on `reports_staff_write`, `appointments_staff_write`, `files_insert`, and `files_update` is any `is_staff()`, not assignment.
- `files_select` does not require a linked report to be published.
- `tasks_select` and `appointments_select` expose internal text fields to client members.
- `notifications_insert` allows self-insert by any authenticated user.
- `audit_logs` has no client scope and no automatic portal events.

**RECOMMENDATION.** Fix file visibility and draft-report file reads before a files or report-download UI. Do not treat those policy changes as optional once those screens exist.

**REQUIRES APPROVAL.** Narrowing employee writes to `is_staff_for_client` changes current staff capability, even though no UI uses it.

## Storage Gaps

**VERIFIED.**

- One private bucket, 50 MiB, MIME allowlist empty.
- No application upload, download, or signed URL.
- Client insert denied.
- Select allows every object under `{client_id}/` for anyone who can access that client.
- Update and delete are staff-wide, not folder-scoped, on the storage policies (`storage_client_files_update` checks `is_staff()` only; delete is admin or staff).

**RECOMMENDATION.** Client-visible objects need a path or policy that staff-only objects do not share. Upload File and Send to Client are different steps.

## Database Gaps

**VERIFIED absent structures:** organizations (intentionally absent), milestones, file delivery fields, support tables, Stripe ids, notification preferences, client visibility on tasks.

**VERIFIED present and sufficient to start read-only work, with the security caveats above:** `clients`, `client_members`, `profiles`, `reports`, `projects`, `project_services`, `services`, `appointments`, `notifications`.

Details of required versus recommended changes are in `04-DATABASE-RLS-REVIEW.md`. Recommendations there are not requirements until a gate accepts them.

## Stripe Gaps

**VERIFIED.**

- No `clients` to Stripe customer link.
- No webhook, so payment, invoice, and subscription state never lands in Postgres.
- No Customer Portal session endpoint.
- No portal billing screen.
- Checkout can create Stripe customers that the app cannot later find.

**REQUIRES APPROVAL.** Mapping and whether management is the Stripe Customer Portal or an in-app invoice list. Until that decision, billing UI should not be built.

## Notification Gaps

**VERIFIED.**

- No producer, no inbox, no unread badge.
- Type enum does not name file, billing, or support events.
- No email transport for those events.
- Insert policy lets a client fabricate their own notification rows.

**RECOMMENDATION.** One writer used by every module. In-app first.

**REQUIRES APPROVAL.** Email.

## Staff / Admin Gaps

**VERIFIED.** The admin shell cannot:

- link a user to a client
- publish a report
- create a project
- upload or send a file
- reply to support
- schedule an appointment
- show billing
- send a notification

**RECOMMENDATION.** For files, add a minimal staff delivery screen: choose the client from staff-accessible clients, upload, categorize, describe, optionally message, then Send to Client. Do not build the rest of the CRM nav as part of this portal project.

**REQUIRES APPROVAL.** Whether that screen lives in `admin-portal.html` or a separate staff page.

**INFERRED.** Until some staff write path exists, client reports, projects, and files will stay empty even if the client UI is finished. Data could also be inserted with the Supabase dashboard; that is not a product workflow.

## Technical Debt Relevant to the Portal

**VERIFIED or INFERRED as marked.**

- **VERIFIED.** README still says the client portal is planned.
- **VERIFIED.** `requireClientPortalOrRedirect` is dead code.
- **VERIFIED.** Inactive-client sign-in leaves a session.
- **INFERRED.** `database.types.ts` is stale relative to research tables. Portal columns checked live still match. Regenerating types is useful if TypeScript portal code is added. The current portal is plain browser JavaScript and does not import that file.
- **VERIFIED.** `files_insert` and storage insert disagree: a staff user who is not assigned can insert a `files` row for any client but cannot upload the object into that client’s folder unless they also pass `can_access_client` or `is_staff_for_client`.
- **VERIFIED.** Grants give `authenticated` broad table privileges. Safety depends entirely on RLS remaining enabled.

Out of scope debt: marketing pages, research catalog, benchmark tools, cart add-ons that are not in `STRIPE_CATALOG`.

## Explicitly Out of Scope

Unless a later approved requirement changes this:

- Full CRM (leads pipeline, contact management, blog, site analytics, settings)
- Enterprise project-management platform and a milestones product
- Accounting system or a second invoice database that duplicates Stripe
- GA4 or other analytics product inside the portal
- Zendesk-style helpdesk and live chat
- Knowledge base
- Enterprise document management (version trees, legal holds, external sharing links as a product)
- Rebuilding the marketing site or rewriting checkout catalog items
- Adding an `organizations` table to rename `clients`
