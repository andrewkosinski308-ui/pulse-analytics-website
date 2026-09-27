# Client Portal Audit

Pulse Analytics Group LLC  
Audit date: 2026-09-26  
Scope: documentation of the existing client portal, admin shell, Supabase schema and RLS, Storage, and Stripe checkout.  
This document does not approve implementation.

Labels used in this set:

- **VERIFIED** — confirmed from repository code, migrations, or the live Supabase project `gultqhsccxuqvibymwdg`.
- **INFERRED** — strongly indicated, not directly confirmed.
- **RECOMMENDATION** — a proposed technical choice, not a fact and not an automatic requirement.
- **REQUIRES APPROVAL** — a decision that must be made by a human before implementation.

## 1. Executive Summary

**VERIFIED.** The client portal is a working authentication shell, not a client workspace. Four pages plus shared CSS let a user with `profiles.role = client` and a linked `clients` row sign in, reset a password, and see name, company, email, a hardcoded account label, and membership role. Reports, projects, files, billing, support tickets, appointments, and notifications are not implemented in that UI.

**VERIFIED.** The database already models the agency relationship. The tenant is `clients`, not an `organizations` table. Membership is `client_members` (`owner` or `viewer`). Projects, tasks, reports, files, appointments, notifications, and audit logs exist, with row level security enabled. A private Storage bucket, `client-files`, exists with a 50 MiB limit and no MIME allowlist. The client UI does not query those domain tables or the bucket.

**VERIFIED.** The Admin Portal is a separate staff shell for `profiles.role = admin` only. Its CRM, files, reports, projects, and appointments navigation items are disabled placeholders. It does not provide the staff tools the client workspace will need.

**VERIFIED.** Stripe is public-site Embedded Checkout in a Cloudflare Worker. There is no webhook, no Customer Portal, no invoice API, and no stored link from a Stripe customer to `clients`.

**RECOMMENDATION.** Extend the existing static portal, `js/pulse-auth.js`, Supabase RLS, the private bucket, and the checkout Worker. Do not replace the tenant model, do not add a frontend framework, and do not build a second billing system or a full CRM.

Implementation does not start with this document. Gate 0 in `08-APPROVAL-CHECKPOINTS.md` is still required.

## 2. Current Implementation Status

| Area | Status | Evidence |
| --- | --- | --- |
| Authentication | Implemented for client sign-in, password reset, and password update | `client-login.html`, `client-forgot-password.html`, `client-update-password.html`, `js/pulse-auth.js` |
| Portal shell | Partial: one account overview card, no module navigation | `client-portal.html` |
| Overview | Partial: identity and membership only; no activity from other modules | `renderPortal` in `client-portal.html` |
| Reports | Not in the client UI. Table and published-only client SELECT exist | `reports`, policy `reports_select` |
| Projects | Not in the client UI. Tables and client SELECT exist | `projects`, `tasks`, policy `projects_select` |
| Files | Not in the client UI. Metadata table and private bucket exist. Client upload is denied | `files`, bucket `client-files` |
| Billing | Not in the portal. Checkout exists on the public site and is not tied to `clients` | `workers/checkout/api.js` |
| Support | Marketing contact form only. No ticket tables | `contact.html` |
| Appointments | Not in the client UI. Table exists. Clients can read; only staff can write | `appointments`, `appointments_staff_write` |
| Account | Partial: display plus separate password-reset pages. No in-portal profile editor | `client-portal.html`, `profiles_update_self` |
| Notifications | Not in the client UI. Per-user table and policies exist. No writers in application code | `notifications` |

## 3. Current Module Status

**VERIFIED** unless noted.

- **Authentication.** Email and password via Supabase Auth. Session persistence is in `localStorage`. Eligibility is application-side and then constrained by RLS on the three tables the portal reads.
- **Portal.** Single panel after sign-in. Header links go to the marketing site and to `contact.html`.
- **Overview.** Welcome text and meta rows. Missing values render as an em dash. No counts, no recent activity.
- **Reports.** Schema supports title, free-text `report_type`, period dates, `draft` or `published`, summary, optional project. Client SELECT requires `status = published` and `can_access_client`. No publish UI.
- **Projects.** Schema supports status, dates, summary, services, members, and tasks. No milestones table. No client UI. Task rows are readable by client members with no client-visibility flag.
- **Files.** Metadata can point at `client-files`. Staff can insert file rows. Storage insert requires `is_staff()`. No upload, download, signed URL, category, message, or delivery-state code.
- **Billing.** `clients.billing_email` is a text column. No Stripe customer id. Portal does not show invoices, subscriptions, or payment status.
- **Support.** Client header “Support” opens the public contact page. That form posts to a Google Apps Script. It is not an authenticated support module.
- **Appointments.** Types and statuses exist. Notes are on the same row clients can select. Clients cannot create, cancel, or reschedule through RLS. No external scheduler is integrated.
- **Account.** Password recovery is implemented. Profile self-update is allowed by RLS, with `role` and `is_active` protected by trigger. The portal does not expose an edit form. Clients cannot update the `clients` row.
- **Notifications.** Columns include title, body, type, link, `read_at`, and entity reference. Unread index exists. No in-app inbox and no portal email sender beyond Supabase Auth password reset.

## 4. Major Findings

1. **VERIFIED.** Treat `client-portal.html` as existing infrastructure. The README still lists the client portal as planned. The README is stale.
2. **VERIFIED.** There is no `client-portal.js`. Portal page logic is inline in `client-portal.html`.
3. **VERIFIED.** Public client signup is absent from the client pages and from `js/pulse-auth.js`.
4. **VERIFIED.** `loadClientContext` keeps only the earliest `client_members` row.
5. **VERIFIED.** `owner` and `viewer` are stored and displayed. No RLS policy branches on `member_role`.
6. **VERIFIED.** Domain tables the portal will need are already deployed on project `gultqhsccxuqvibymwdg`. Live table list and live policy names match the March 2026 portal migrations.
7. **VERIFIED.** Admin business modules are not available to reuse. Shared value is authentication, not CRM screens.
8. **VERIFIED.** Research and benchmark tables exist and are unrelated to the client workspace.

## 5. Major Architectural Findings

1. **VERIFIED.** The site is static HTML, CSS, and browser JavaScript, served as Cloudflare Worker assets after `/api/*` handling in `workers/router.js`. Client and admin HTML are not server-rendered sessions.
2. **VERIFIED.** Authorization for data is Postgres RLS. The browser uses the publishable anon key (`js/supabase-env.js`, `src/lib/supabase/client.ts`). `pulse-auth.js` states that RLS remains the authorization authority.
3. **VERIFIED.** There is no `supabase/functions` directory. Server-side Stripe work lives in the Cloudflare Worker, not in Supabase Edge Functions.
4. **RECOMMENDATION.** Keep the static multi-page portal and add a workspace shell plus `js/client-portal.js`. Do not introduce a new frontend framework.
5. **RECOMMENDATION.** A minimal staff file-delivery surface is required for “Send to Client.” That is not a reason to rebuild the Admin Portal into a CRM.
6. **REQUIRES APPROVAL.** Whether one person can act in more than one client account. The current code does not offer a switcher.

## 6. Major Database Findings

1. **VERIFIED.** Tenant boundary is `public.clients`. `organizations` is absent. Do not add it to match earlier wording.
2. **VERIFIED.** `client_members` is unique on `(client_id, profile_id)`.
3. **VERIFIED.** `reports.report_type` is `text`, not a category enum. Period columns already exist.
4. **VERIFIED.** `files` stores bucket, path, name, MIME, size, uploader, and optional links to client, project, lead, and report. It does not store category, description, client message, direction, or delivery state.
5. **VERIFIED.** `milestones` is absent. `tasks` has no client-visibility column.
6. **VERIFIED.** Billing tables are absent. `notifications` has no email-delivery columns. Support tables are absent.
7. **VERIFIED.** `handle_new_user` inserts `profiles.role = client`. `protect_profile_privileges` stops non-admins from changing `role` or `is_active`.

## 7. Major Security Findings

These are documented for later gates. They are not fixed here.

1. **VERIFIED.** A client member of client A cannot read client B rows by knowing B’s UUID, for tables gated by `can_access_client` or equivalent membership checks.
2. **VERIFIED.** Several staff write policies use `is_staff()` without `is_staff_for_client`. Any active employee can write reports, appointments, and file metadata for any client. Storage insert is narrower.
3. **VERIFIED.** Row policies return whole rows. Client members who can read `clients` can read `notes`, `billing_email`, `legal_name`, and `account_manager_id`. The current portal select list avoids those columns. A later `select *` would not.
4. **VERIFIED.** `tasks_select` allows every task on a project whose client the user can access, including description, priority, and assignee.
5. **VERIFIED.** `appointments_select` includes `notes` for client members.
6. **VERIFIED.** `files_select` allows client members to read every file row with their `client_id`, including rows tied to draft reports. It does not check `reports.status`.
7. **VERIFIED.** `storage_client_files_select` allows read of every object whose first folder is a client UUID the user can access. There is no internal versus client-visible path.
8. **VERIFIED.** Client upload is denied: `files_insert` requires `is_staff()` and `uploaded_by = auth.uid()`. `storage_client_files_insert` requires `is_staff()`.
9. **VERIFIED.** `assertClientPortalAccess` does not check `is_active`. `isClientPortalEligible` does. An inactive client can pass the sign-in assert, fail eligibility, and remain signed in with an error on the login page.
10. **VERIFIED.** `notifications_insert` allows a user to insert a notification to themselves, or any staff user to insert a notification to anyone.
11. **VERIFIED.** `audit_logs` are append-only and staff-readable. Clients cannot read them. No trigger writes a file or report audit row.
12. **VERIFIED.** Employees are `is_staff()` in the database and are rejected by both portal UIs (`isAdminPortalEligible` is admin-only; client login signs them out).

## 8. Major Integration Findings

1. **VERIFIED.** Checkout: `POST /api/checkout/session` and `GET /api/checkout/session?session_id=`. Implementation is `workers/checkout/api.js` calling Stripe REST (`Stripe-Version: 2025-03-31.basil`). Catalog and price IDs are `workers/checkout/catalog.js`. Secrets are Worker secrets `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY`. The secret is not returned to the browser.
2. **VERIFIED.** Checkout does not set `client_reference_id`, Supabase user id, or `clients.id` metadata. One-time payments set `customer_creation=always`. Subscriptions rely on Stripe’s default customer creation. The flow is anonymous cart checkout.
3. **VERIFIED.** Absent: webhook endpoint, `STRIPE_WEBHOOK_SECRET`, Customer Portal session, invoice list, subscription sync, and `stripe_customer_id`.
4. **VERIFIED.** Password reset email is Supabase Auth (`resetPasswordForEmail`). No other transactional email integration is present for portal events.
5. **VERIFIED.** Contact form action is a Google Apps Script URL in `contact.html`. It is not Supabase and not authenticated.

## 9. Major Risks

1. **VERIFIED risk.** Shipping a files UI on current policies would show every object in the client folder and would still block client upload.
2. **VERIFIED risk.** Shipping a tasks UI on current policies would show internal task text.
3. **VERIFIED risk.** Billing UI cannot be honest until Stripe customers are mapped and payment state is synced. Guessing from Checkout success in the browser is not a ledger.
4. **INFERRED risk.** Historical Checkout customers cannot be matched to `clients` automatically, because no identifier was stored.
5. **VERIFIED risk.** `README.md` Planned Features will mislead future work if treated as the source of truth.
6. **RECOMMENDATION.** Do not widen employee write access further. Review whether unassigned employees should keep global report and file-row writes before a staff delivery screen exists.

## 10. Recommended Build Direction

**RECOMMENDATION.** Build on the current portal.

- Keep Supabase Auth, `js/pulse-auth.js`, and RLS as the authority.
- Keep `clients` as the tenant.
- Add a client workspace shell and one shared data module. Query explicit columns, not whole sensitive rows.
- Add a notification writer once, then have reports, files, support, billing, and appointments call it.
- Add file delivery state and a storage rule that separates internal objects from client-visible objects before any client file UI.
- Extend the existing Worker for billing only after customer mapping and sync are approved.
- Add a small staff file-delivery screen for upload and Send to Client. Leave leads, blog, analytics, and settings out of this effort.
- Leave the marketing contact form in place. Portal support, if approved, is a separate authenticated request log.

**RECOMMENDATION.** Phase order: foundation, account, notification primitive, reports, projects, two-way files, billing, support, appointments, overview completion, testing, security review, production readiness. Details are in `06-PHASED-BUILD-PLAN.md`.

Out of scope unless requirements change: full CRM, enterprise project management, an accounting system, a GA4 replacement, a Zendesk replacement, live chat, an enterprise document platform, and unrelated marketing-site refactors.

## 11. Decisions Requiring Approval

1. **REQUIRES APPROVAL.** Multiple client memberships and whether the portal needs a client switcher. Today only the earliest membership is loaded.
2. **REQUIRES APPROVAL.** Which actions are owner-only. RLS treats owner and viewer the same.
3. **REQUIRES APPROVAL.** Whether unassigned employees should lose broad write rights on reports, appointments, and file rows.
4. **REQUIRES APPROVAL.** Tasks: add a client-visibility flag, or do not show tasks. Do not add a milestones product unless separately approved.
5. **REQUIRES APPROVAL.** File path and delivery-state design so internal objects are not readable from the client folder policy. Upload and Send to Client must stay different actions.
6. **REQUIRES APPROVAL.** MIME allowlist. The bucket currently allows any type up to 50 MiB.
7. **REQUIRES APPROVAL.** Stripe Customer Portal versus in-portal invoice display, and how existing anonymous Checkout customers attach to `clients`.
8. **REQUIRES APPROVAL.** Appointments: read-only plus staff scheduling, in-app request and reschedule, or an external scheduler. No vendor is selected in this audit.
9. **REQUIRES APPROVAL.** Transactional email beyond Supabase Auth password reset.
10. **REQUIRES APPROVAL.** Whether the minimal staff file screen ships inside the current admin shell.

No implementation is authorized by this audit.
