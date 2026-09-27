# Approval Checkpoints

These gates govern future implementation. Creating this file does not approve Gate 0 for coding.

No gate authorizes a migration, RLS edit, storage change, Stripe change, or portal feature by itself. A human accepts the gate, then implementation of that gate’s scope may start.

Labels: **VERIFIED** where the gate checks something already observed, **REQUIRES APPROVAL** where the gate must decide.

## Gate 0 — Audit Approval

**Purpose.** Accept the current-state findings before any build.

**Entry criteria.**

- Documents `00` through `08` in `docs/client-portal/` exist and agree.
- No application or database change has been made as part of the audit.

**Review items.**

- Current state: auth shell, admin shell, `clients` tenancy, live RLS, private `client-files` bucket, Embedded Checkout only.
- Gap analysis, architecture, database review, dependency map, phased plan, and risks.
- Out-of-scope list: full CRM, enterprise project management, accounting system, GA4 replacement, Zendesk, live chat, enterprise document system, unrelated refactors.

**Required tests.** None. This gate is a document review. It is not a penetration test.

**Exit criteria.**

- Reviewers accept the findings as the baseline.
- Reviewers list which **REQUIRES APPROVAL** items in Gate 1 through Gate 4 they will decide before those phases.
- Implementation is still stopped until that acceptance is explicit.

**Decisions requiring approval.**

- **REQUIRES APPROVAL.** Accept this audit as the baseline.
- **REQUIRES APPROVAL.** Confirm `clients` remains the tenant and `organizations` will not be added.
- **REQUIRES APPROVAL.** Confirm the phase order in `06-PHASED-BUILD-PLAN.md`.

## Gate 1 — Foundation

**Purpose.** Auth, client context, membership, permissions, and the portal shell.

**Entry criteria.**

- Gate 0 accepted for implementation.
- No domain module UI beyond the shell.

**Review items.**

- `isClientPortalEligible` and inactive-client sign-out.
- Earliest-membership behavior versus a switcher.
- Owner and viewer still equal unless this gate changes that.
- Shell navigation, loading, error, and empty regions.
- Employee and admin still unable to use the client shell.
- RLS unchanged except any membership decision this gate explicitly accepts.

**Required tests.**

- Eligible client reaches the shell.
- Logged-out user is sent to `client-login.html`.
- Admin and employee client-login attempts are rejected and signed out.
- Client with no `client_members` row cannot stay in the portal.
- Inactive client cannot remain signed in.
- A second test client cannot read the first client’s `clients` row by id.

**Exit criteria.**

- Shell shows only safe identity fields.
- No sample metrics.
- Password reset still works.

**Decisions requiring approval.**

- **REQUIRES APPROVAL.** One membership versus a switcher.
- **REQUIRES APPROVAL.** Any owner-only rule. Default recommendation is to leave owner and viewer equal until a later gate names an action.

## Gate 2 — Core Portal

**Purpose.** Overview (initial), reports metadata, and projects metadata.

**Entry criteria.**

- Gate 1 exited.
- Report download and task lists are not included unless their security decisions are already accepted. Default is metadata only.

**Review items.**

- Published reports only.
- Project status, dates, summary, services.
- Tasks hidden or limited by an accepted visibility rule.
- Overview uses only those real queries.
- No admin CRM rebuild.

**Required tests.**

- Draft report invisible to the client and visible to staff under current staff policy.
- Client B cannot read client A reports or projects by UUID.
- Client cannot update `reports.status` or insert `projects`.
- Empty states when tables have no rows.

**Exit criteria.**

- Lists match RLS.
- No download button that opens `client-files` until Gate 3.

**Decisions requiring approval.**

- **REQUIRES APPROVAL.** Task visibility column versus no tasks.
- **REQUIRES APPROVAL.** Whether staff names appear. Widening `profiles_select` is not allowed without this decision.
- **REQUIRES APPROVAL.** Whether a minimal report-publish control is in scope. It is not required for the client read list.

## Gate 3 — Two-Way Files

**Purpose.** Secure exchange. Upload is not Send to Client.

**Entry criteria.**

- Gate 1 exited. Notification primitive is available if this gate wants alerts at launch. Alerts can be a fast-follow only if the gate says so.
- Path and MIME decisions are written down before migration.

**Review items.**

- Staff upload stays hidden from the client.
- Send to Client is a second action and then allows client list and download.
- Client upload has no organization picker.
- Assigned staff can see that upload.
- Another client cannot.
- Internal prefix or bucket is not world-readable to the member.
- Validation of type, size, and name.
- Notification on send and on client upload, if the primitive exists.
- Audit trail for upload, send, and client upload.
- Draft-report files are not client-visible unless sent.
- Browser has no service-role key.

**Required tests.**

- Two clients, one staff admin, and one employee if employees are allowed.
- Unsent object download fails for the client through the API, not only through hidden buttons.
- Sent object download succeeds for the member and fails for the other client.
- Client insert with a forged `client_id` fails.
- Oversize and disallowed MIME fail.
- Staff who are not assigned behave according to the employee-scope decision.
- Audit row exists for each required action and is not readable by the client.

**Exit criteria.**

- The tests above pass.
- Existing objects were classified before the policy change, or the bucket was confirmed empty.
- Public checkout and admin login still work.

**Decisions requiring approval.**

- **REQUIRES APPROVAL.** Delivery columns and storage path or second bucket.
- **REQUIRES APPROVAL.** MIME allowlist and retention of the 50 MiB cap.
- **REQUIRES APPROVAL.** Admin-only staff screen versus employee access.
- **REQUIRES APPROVAL.** Narrowing global `is_staff()` file writes.
- **REQUIRES APPROVAL.** Audit writer for client uploads: definer function versus Worker.
- **REQUIRES APPROVAL.** Where the staff screen lives.

## Gate 4 — Operational Features

**Purpose.** Billing, support, appointments, and account, each only if its decisions are made.

**Entry criteria.**

- Gate 1 exited.
- Account may exit earlier with Phase 2. This gate still reviews it with the other operational items.
- Billing does not start without the Stripe decision.
- Appointment scheduling does not start without the scheduler decision.

**Review items.**

- Billing reads synced state only. Existing Worker and secrets stay the Stripe path.
- Support is a small request log. `contact.html` still posts to its current endpoint.
- Appointments show time and place. Notes handling matches the decision. No fake cancel button.
- Account cannot change `role`, `is_active`, or the `clients` row.

**Required tests.**

- Webhook signature failure is rejected, when billing is in scope.
- Client cannot read another client’s billing status or support thread.
- Client cannot update an appointment.
- Profile privilege trigger still blocks `role` changes.
- Checkout session creation still succeeds in the existing test suite.

**Exit criteria.**

- Each included feature matches its decision record.
- Features whose decisions were deferred are not in the UI.

**Decisions requiring approval.**

- **REQUIRES APPROVAL.** Stripe customer mapping, webhook scope, Customer Portal versus in-app invoices.
- **REQUIRES APPROVAL.** How to attach historical Checkout customers, or an explicit choice to leave them unmapped.
- **REQUIRES APPROVAL.** Support statuses.
- **REQUIRES APPROVAL.** Appointment notes guarantee, and request, cancel, or reschedule, including any external product.
- **REQUIRES APPROVAL.** Email channel and preferences.

## Gate 5 — Integration

**Purpose.** Modules work together.

**Entry criteria.**

- The phases intended for the first release have exited their gates.
- Overview completion is in review.

**Review items.**

- Report download uses only client-visible files.
- Project pages list only those files.
- Notification links land on the right section.
- Unread counts match the inbox.
- Overview numbers match each list.
- Staff send and client upload both notify the other side.
- Billing, support, and appointments appear on the overview only if those gates included them.

**Required tests.**

- End-to-end send file, notify, client download.
- End-to-end client upload, staff visibility, notify.
- Publish or insert a report and confirm the client list and overview count.
- Cross-links do not require the user to type another client’s id.

**Exit criteria.**

- No module shows another module’s internal rows.
- Empty overview sections match empty lists.

**Decisions requiring approval.**

- **REQUIRES APPROVAL.** Any shortcut that skips a module gate to make the overview look complete.

## Gate 6 — QA

**Purpose.** Functional, regression, responsive, and accessibility checks.

**Entry criteria.**

- Gate 5 exited for the release scope.

**Review items.**

- Functional paths for every shipped module.
- Regression: client login, admin login, password reset, public checkout route, marketing header portal link.
- Responsive layout of nav, reports, and files.
- Accessibility: labels, alerts, keyboard nav, focus, non-color status.
- Error states: failed query, denied action, expired session.
- Empty states: new client with no rows.

**Required tests.**

- The matrices from Gates 1 through 5 for the shipped scope.
- Keyboard-only pass of the shell.
- Viewport pass for a narrow and a desktop width.
- `workers/checkout` tests still pass if Worker files changed. If they did not change, record that they were not required to change.

**Exit criteria.**

- Failures are fixed or listed as deferred with a named approver.
- No deferred item is a cross-tenant read or an unsent file leak.

**Decisions requiring approval.**

- **REQUIRES APPROVAL.** Any deferral of a failed isolation or file-visibility test.

## Gate 7 — Security

**Purpose.** Review the implementation against the audit findings.

**Entry criteria.**

- Gate 6 exited.
- Diff and migrations are available to review.

**Review items.**

- Authentication, including inactive users and role separation.
- Authorization and RLS, including owner and viewer as decided.
- Storage privacy, prefix separation, signed or authenticated downloads.
- Client isolation with forged ids.
- File validation and the 50 MiB cap.
- Stripe secret handling and webhook verification, if billing shipped.
- No service-role key, no `STRIPE_SECRET_KEY` in client assets.
- Data exposure: `notes`, draft reports, unsent files, task descriptions.
- Audit coverage for file actions.
- `notifications_insert` matches the approved writer model.

**Required tests.**

- Repeat the two-client API checks outside the UI (direct table and storage requests with the user JWT).
- Confirm storage bucket `public` is still false.
- Confirm client responses do not contain the Stripe secret.
- Confirm a client JWT cannot select `audit_logs`.

**Exit criteria.**

- No open cross-tenant read or unsent-file read for client roles.
- Accepted residuals are written down with **REQUIRES APPROVAL** still visible if they remain.

**Decisions requiring approval.**

- **REQUIRES APPROVAL.** Any residual risk that stays in production, including employee-wide write access if it was not narrowed.

## Gate 8 — Production

**Purpose.** Release configuration, data safety, and acceptance.

**Entry criteria.**

- Gate 7 exited for this release.
- Migrations reviewed.
- Backup or snapshot plan stated.

**Review items.**

- Production Supabase project and Cloudflare Worker config.
- Migration list and order.
- Backfill result for existing `client-files` objects, or confirmation the bucket had none.
- Auth redirect URLs for password update. This was an unknown in the audit and must be checked here.
- Webhook endpoint and signing secret if billing is included.
- Monitoring for Worker 5xx on checkout and billing routes.
- Rollback: how to restore the previous file select policy and the previous static assets.
- Operator notes: how a client user and membership are created.
- README no longer describes the whole portal as unbuilt, once the shell that shipped is accurate.
- Final acceptance against the modules actually included, not against the full wishlist.

**Required tests.**

- Smoke test with two production-like clients.
- Password reset on the production origin.
- Checkout smoke test if checkout code shipped.
- Admin login smoke test.

**Exit criteria.**

- Smoke tests passed.
- Rollback steps are written.
- Accepted scope is listed.
- Deferred modules are listed and are not linked as if they work.

**Decisions requiring approval.**

- **REQUIRES APPROVAL.** Production deploy window and who applies migrations.
- **REQUIRES APPROVAL.** Go-live with any Gate 7 residual.
- **REQUIRES APPROVAL.** Final module list for this release if it is smaller than all nine areas.

## Gate order

Gate 0, then Gate 1. Gate 2 can proceed for metadata while Gate 3 is designed, and Gate 2 must not ship downloads first. Gate 4 items can be split: account early, billing and appointments only after their decisions. Gate 5 through Gate 8 are sequential for a given release.

This audit’s documentation task stops here. It does not enter Gate 0 implementation approval and does not start Phase 1.
