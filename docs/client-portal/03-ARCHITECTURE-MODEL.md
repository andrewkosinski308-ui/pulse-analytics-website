# Architecture Model

Proposed shape for the client workspace, constrained by the repository that exists today.  
Items marked **RECOMMENDATION** are not implemented and are not automatic requirements.  
Items marked **REQUIRES APPROVAL** block the related work.

## 1. Architectural Principles

1. **VERIFIED constraint.** RLS is the authorization authority. Browser checks only choose which page to show.
2. **VERIFIED constraint.** The tenant is `clients`. Do not add `organizations`.
3. **VERIFIED constraint.** The front end is static HTML, CSS, and browser modules. Do not introduce a new frontend framework.
4. **VERIFIED constraint.** Stripe stays in the Cloudflare Worker. The browser must not receive `STRIPE_SECRET_KEY`.
5. **RECOMMENDATION.** One notification writer. Modules emit events through it instead of each inventing a table.
6. **RECOMMENDATION.** Explicit column lists on every client query. RLS does not hide `notes` or similar columns inside an allowed row.
7. **RECOMMENDATION.** Staff file delivery is a small screen, not an admin CRM rebuild.
8. **RECOMMENDATION.** Upload File and Send to Client are different actions. A stored object is not client-visible until it is sent.
9. Scope stays an agency client workspace. See out-of-scope list in `02-GAP-ANALYSIS.md`.

## 2. High-Level Architecture

```text
Marketing site (static HTML)
  contact.html  -> Google Apps Script (unchanged public intake)
  cart checkout -> workers/checkout/api.js -> Stripe Checkout

Client portal (static HTML + js/pulse-auth.js + future js/client-portal.js)
  anon key -> Supabase Auth
  anon key -> PostgREST under RLS
  anon key -> Storage under storage policies
  future billing routes -> existing Cloudflare Worker -> Stripe

Admin shell (admin-portal.html, admin role only)
  future minimal file delivery uses the same Supabase project and RLS
```

**VERIFIED.** `workers/router.js` already sends `/api/*` to Worker handlers and everything else to static assets. New portal pages can follow that pattern. New billing endpoints, if approved, belong next to checkout, not in page JavaScript.

There are no Supabase Edge Functions in the repo. **RECOMMENDATION.** Do not add them unless a gate decides the Worker cannot host a given server step.

## 3. Existing Static Application Architecture

**VERIFIED.** Client pages are multi-page documents. They load `js/supabase-env.js` and import `js/pulse-auth.js` as a module. Styling is `client-portal.css` plus site `styles.css` on the login page.

**RECOMMENDATION.** Keep that pattern:

- Auth pages stay as they are, with the inactive-client fix in `pulse-auth.js` during foundation.
- `client-portal.html` becomes the workspace shell, or the shell links to sibling pages (`client-reports.html` and so on) that share the same header and `js/client-portal.js`.
- Data access functions live in `js/client-portal.js` (or a small set of modules next to it), not copied into every HTML file.
- Do not move the portal into the research or benchmark front ends.

**REQUIRES APPROVAL** is not required for “no new framework.” That is a recommendation aligned with the current app. A framework change would itself be **REQUIRES APPROVAL** and is not proposed.

## 4. Authentication Architecture

**VERIFIED baseline.**

- Supabase Auth email and password.
- `signIn(..., 'client')` then `assertClientPortalAccess`.
- Eligibility: client role, linked client, active profile.
- Password reset and update already exist.
- New auth users receive `profiles.role = client` from `handle_new_user`.
- No public signup.

**RECOMMENDATION.**

- Keep provisioning as an operator action: create the Auth user, confirm the profile, insert `client_members`. The admin CRM is not required for that if operators use a controlled process. A self-serve signup form is not part of this architecture.
- Foundation signs out when the profile is inactive, so eligibility and the login assert match.
- Account password changes call the existing `updatePassword` while the session is already signed in.
- Email changes, if offered, must go through Supabase Auth and stay consistent with `profiles.email`. The privilege trigger blocks changing someone else’s email. It does not by itself prove Auth and `profiles.email` stay in sync. **INFERRED.** A profile email edit that does not call Auth can diverge. **RECOMMENDATION.** Change email only through Auth, then refresh the profile.

## 5. Client / Tenant Context

**VERIFIED.** After login, context is `auth.uid()` plus the earliest `client_members` row plus that `clients` row.

**RECOMMENDATION.** The workspace treats that resolved `client_id` as the only tenant for the session. Client uploads and support inserts set `client_id` from that membership on the server side of RLS (`user_client_ids()` or `can_access_client`), never from a form field the browser can switch to another client.

**REQUIRES APPROVAL.** If a person may belong to several clients, the earliest-row rule is not enough. A switcher would load a chosen membership and every module would have to follow it. Do not build a switcher until that decision is approved.

## 6. Membership / Permission Model

**VERIFIED.** `member_role` is `owner` or `viewer`. Policies ignore it. Both may read anything `can_access_client` allows.

**RECOMMENDATION, pending approval.** Until an owner-only list is approved, both roles keep the same read access, and both may use client upload if the files phase allows client upload at all. Do not invent owner-only billing or owner-only upload in code before Gate approval.

**VERIFIED staff model to preserve.**

- `admin` uses the admin shell and passes `is_admin()` and `is_staff()`.
- `employee` passes `is_staff()` and cannot open either shell today.
- `is_staff_for_client` is the assignment check. Several write policies do not use it.

**REQUIRES APPROVAL.** Tighten those write policies before staff delivery tools ship, or explicitly accept that any employee can publish any client’s reports and file rows.

## 7. Client Portal Shell

**RECOMMENDATION.** Extend `client-portal.html` rather than replacing it.

Shell contents:

- Existing session gate and sign-out.
- Navigation for Overview, Reports, Projects, Files, Billing, Support, Appointments, Account, Notifications.
- A single place that shows load errors, empty states, and the resolved client name.
- Modules that are not built yet are omitted or clearly unavailable. They are not fake data.

**VERIFIED.** Support in the current header is a link to `contact.html`. **RECOMMENDATION.** Keep a way to reach the public site, and point in-portal Support at the authenticated module only after that module exists.

## 8. Admin Portal Relationship

**VERIFIED.** Admin portal is an admin-only shell. Business nav is disabled.

**RECOMMENDATION.** Do not block client read-only reports or projects on a full CRM. Do block “Send to Client” on a real staff action. That action needs a minimal screen: staff-accessible client, file, category, description, optional message, Send. The same screen lists client uploads for clients that staff member can access.

**REQUIRES APPROVAL.** Place that screen in the admin shell or on a dedicated staff page. Employees may need access. Today they are rejected by `isAdminPortalEligible`. Giving employees this screen means a new eligibility rule (`is_staff()` plus assignment), which should be decided at the files gate, not copied from the admin-only rule.

## 9. Shared Services

**RECOMMENDATION.** Add these as plain modules beside `pulse-auth.js`. They do not exist today.

| Service | Responsibility |
| --- | --- |
| Session and client context | Existing `pulse-auth.js` |
| Portal API | Explicit selects for reports, projects, files, appointments, notifications |
| Notifications | Insert for a recipient in the same client, with type, link, and entity |
| Files | Validate type and size, write metadata, upload to the allowed path, separate send from upload |
| Billing | Worker routes only, after Stripe mapping is approved |

No shared service should use the service-role key in the browser.

## 10. Overview

**RECOMMENDATION.** Overview reads only live records.

- From context: person name, email, company name, client status, membership role.
- Counts or short lists: published reports, visible projects, client-visible files, unread notifications, upcoming appointments.
- Billing and support blocks appear only after those modules exist.
- Empty modules explain that nothing has been shared yet. They do not show sample numbers.

**VERIFIED.** `clients.status` can be `lead`, `active`, `paused`, or `churned`. The overview can show that value. It should not show `notes`.

## 11. Reports

**RECOMMENDATION.**

- Client list: `reports` where RLS already enforces published and client access. Display title, `report_type`, `period_start`, `period_end`, `published_at`, `summary`.
- Categories such as SEO, website, analytics, marketing, social, and campaigns are not an enum. **RECOMMENDATION.** Display the stored `report_type` text. Do not invent a second taxonomy unless a gate asks for one.
- Download uses a `files` row linked by `report_id` only when that file is client-visible under the files rules. A published report with no file still shows metadata.
- Staff publish remains `reports_staff_write`. The client UI never updates `status`.

**VERIFIED gap.** A file linked to a draft report is still selected by `files_select` when `client_id` is set. **RECOMMENDATION.** The files phase closes that gap before report download is offered.

## 12. Projects

**RECOMMENDATION.**

- Client list: name, status, summary, start and end dates, related `services` through `project_services`.
- Progress is status plus dates. Do not compute a percentage unless it is defined from real task counts the client is allowed to see.
- Related files are the client-visible files with that `project_id`.

**REQUIRES APPROVAL.** Tasks. Either add a client-visibility flag and select only those rows, or omit tasks. There is no milestones table. **RECOMMENDATION.** Do not add milestones. Internal description text stays off the client screen even for visible tasks if the flag is approved.

## 13. Two-Way Files

This is the target model. It is not implemented.

### Staff to client

1. Staff uploads into storage and inserts a `files` row in a not-sent state. The client cannot read that row or object.
2. Staff sets category, description, and optional client-facing message.
3. Send to Client changes delivery state. That is a different action from upload.
4. After send, the client can list and download.
5. Optional notification uses the shared writer.
6. An audit event records upload and send. Clients do not read `audit_logs`.

### Client to Pulse Analytics

1. The client does not pick a client account. RLS sets or checks `client_id` against membership.
2. The client chooses a category and an optional message and uploads.
3. The object is staff-readable for that client and visible in the client’s own history.
4. Staff are notified through the same writer.
5. The client sees confirmation from the insert they are allowed to read back.

### Storage

**VERIFIED today.** Private bucket, 50 MiB, no MIME list, first folder is the client UUID, any member who passes `can_access_client` can read every object in that folder, and clients cannot insert.

**RECOMMENDATION.**

- Keep one private bucket unless an approval chooses a second bucket.
- Do not leave internal and client-visible objects in one unrestricted `{client_id}/` prefix.
- Downloads use the signed-in user: authenticated download or a short-lived signed URL created with that user’s session after RLS allows the object. Do not mint URLs with the service role in the browser.
- Reject mismatched MIME, oversize files, and empty names before upload. The bucket size cap remains 50 MiB unless a gate changes it.
- **REQUIRES APPROVAL.** Exact path pattern and MIME allowlist.

**VERIFIED.** Lead files stay staff-only through the lead branch of `files_select`. The client workspace should not surface lead files.

## 14. Billing

**VERIFIED.** Checkout Worker and catalog are the Stripe implementation. They are not connected to `clients`.

**RECOMMENDATION.** Do not create a parallel invoice ledger as the source of truth.

Target, after approval:

- Store the Stripe customer id on the client record.
- Verify webhooks in the Worker and store the minimum status the portal must show (subscription status, latest invoice status, or both).
- Portal reads that stored state through RLS.
- Management opens a Stripe Customer Portal session created in the Worker for that mapped customer, if Customer Portal is the approved option.
- The existing checkout flow can stay the public purchase path. Linking a guest payment to a client is a back-office match, not an automatic browser assumption.

**REQUIRES APPROVAL.** Customer Portal versus in-portal invoice list, and how historical Checkout customers are attached.

Until approval, the architecture does not include billing screens or new Stripe endpoints.

## 15. Support

**VERIFIED.** No ticket schema. Public contact form stays a marketing form.

**RECOMMENDATION.** If support is in scope, add a small request table and a message table, both with `client_id`, status, and author. Clients insert requests only for their membership. Staff who can access that client read and reply. Statuses stay short (for example open, waiting on client, resolved). That list is **REQUIRES APPROVAL** before migration.

Not in the model: live chat, a knowledge base, or a third-party helpdesk.

## 16. Appointments

**VERIFIED.** Reads can use `appointments` and `appointment_attendees`. Writes are staff-only. `notes` is on the client-readable row. No external scheduler is integrated.

**RECOMMENDATION.** First client view, if the phase is approved: upcoming and past rows for the session client, showing title, type, status, time range, timezone, and `location_or_url`. Omit `notes` in the client select list even though RLS would return them if asked. Prefer a dedicated client-safe column or view if staff need private notes to remain on the row. That split is **REQUIRES APPROVAL** if private notes must be guaranteed against a modified query, because a column list in JavaScript is not a database guarantee.

**REQUIRES APPROVAL.** Request, cancel, and reschedule. Options are staff-managed only, an in-app request row, or an external scheduler. This architecture does not select a vendor.

## 17. Account

**RECOMMENDATION.**

- Editable: `full_name`, `phone`, password via existing auth helpers. Avatar only if a storage path for avatars is approved. There is no avatar bucket today (`avatar_url` is a text column).
- Read-only: email display until an Auth email-change flow is approved; company name, website, industry, and client status.
- Not editable by the client: `profiles.role`, `is_active`, `clients` row, membership role.
- Notification preferences: omit until email is approved. In-app notifications can be always on for security and delivery events without a preference table.

## 18. Notifications

**VERIFIED base.** `notifications` is per `recipient_id`, with `read_at` and an unread index.

**RECOMMENDATION.**

- Inbox and unread count in the shell.
- Mark read by setting `read_at` (already allowed for the recipient).
- Producers: report published, file sent, client file received, support reply, billing status change, appointment change, account or security events that the app can actually observe.
- Map new events onto existing enum values only as a temporary measure if a migration is deferred. **RECOMMENDATION** is to extend `notification_type` when those events ship, so the inbox can filter honestly.
- Do not let the client UI insert arbitrary notifications. **RECOMMENDATION.** Tighten `notifications_insert` so clients cannot write the table directly, and so staff inserts are tied to a real event path. That policy change is part of the notification phase, not a silent extra.

**REQUIRES APPROVAL.** Email delivery and any provider.

## 19. Audit Logging

**VERIFIED.** Append-only `audit_logs`, staff read, no automatic file or report triggers.

**RECOMMENDATION.** File upload, send, and client upload write audit rows with `entity_type = 'files'`, the file id, and the client id inside `metadata` (there is no `client_id` column). Report publish can do the same. Clients still cannot select `audit_logs`. Staff review stays a staff tool, not a client screen.

**REQUIRES APPROVAL.** Whether the browser may insert those rows under `audit_logs_staff_insert`, or only a Worker using a server credential. Browser insert is possible for staff today. Client uploads cannot insert audit rows under the current policy. A client-upload audit either needs a definer function or a Worker. That choice matters and is an approval item.

## 20. Error Handling

**VERIFIED patterns to keep.** Login and password pages use an alert region. The portal uses the loading element for init failure and then redirects. Forgot-password always shows the generic success message.

**RECOMMENDATION.** Workspace modules show a visible error when a query fails, without dumping Postgres internals. Authorization failures look like empty or not-found, not like another client’s data. Sign-out failure stays visible, as it does today.

## 21. Loading States

**VERIFIED.** `#portal-loading` shows “Verifying your session…” while `authState.loading` is true.

**RECOMMENDATION.** Each module has its own loading state after the session resolves, so a slow report query does not blank the whole shell.

## 22. Empty States

**RECOMMENDATION.** Empty means no rows, not a placeholder metric. Copy should say that Pulse Analytics has not shared a report, project, or file yet, or that the client has not uploaded one. Billing empty state waits on the Stripe decision so it does not imply an unpaid balance that was never synced.

## 23. Responsive Design

**VERIFIED.** `client-portal.css` and `styles.css` already target a small auth card and the marketing header. The admin shell has its own sidebar.

**RECOMMENDATION.** The workspace nav must work on a narrow viewport (stacked nav or the same sidebar pattern as admin, without copying admin-only CRM). Tables of reports and files become stacked rows on small screens. Touch targets follow the existing button styles.

## 24. Accessibility

**VERIFIED.** Current portal uses headings, a loading message, form labels on auth pages, and `aria-label` on the marketing portal icon in `main.js`.

**RECOMMENDATION.** New nav is a real navigation landmark. Icon-only controls have names. Errors use an alert region. Status is not color-only. Focus moves in a sensible order. Do not remove the existing auth labels.

## 25. Architectural Decisions Requiring Approval

1. Multiple client memberships and a switcher.
2. Owner versus viewer action split.
3. Whether to narrow unassigned employee writes.
4. Employee access to the staff file screen.
5. Task visibility flag versus hiding tasks. No milestones unless separately requested.
6. File path scheme and MIME allowlist.
7. Stripe mapping, webhook scope, and Customer Portal versus in-app invoices.
8. Appointment request and reschedule, including any external product.
9. Transactional email provider.
10. Who writes audit rows for client uploads (definer function versus Worker).
11. Private appointment notes as a guaranteed hidden column, versus omitting the column only in the client query.

No framework migration is proposed.
