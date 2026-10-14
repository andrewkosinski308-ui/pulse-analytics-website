# Authorization remediation — production application test report

Date: 2026-10-12, with a client-session follow-up on 2026-10-13. Testing only. No deploy, policy change, or migration was performed. The only production change in the follow-up was a password reset for the existing client test account, requested so that account could sign in. No role, project, file, billing, or customer record was changed.

## 1. Target

| Item | Result |
| --- | --- |
| Supabase project | `gultqhsccxuqvibymwdg` |
| Database host | `db.gultqhsccxuqvibymwdg.supabase.co` |
| Database | `postgres` |
| Live site | `https://pulseanalyticsgroupllc.com` |
| Deployed portal script | `js/admin-portal.js?v=20260927d` |
| Application version | No separate release number is published. The live portal matches the committed site, not the uncommitted shared-shell edits. |

The database release from earlier on this date is unchanged by this test.

## 2. Local automated tests

Command: `node --test` on all 29 `*.test.mjs` files outside `node_modules`.

| Result | Count |
| --- | --- |
| Pass | 330 |
| Fail | 0 |
| Skip | 0 |
| Cancelled | 0 |
| Todo | 0 |

The suite was run again for this follow-up. The same counts came back: 330 passed, 0 failed, 0 skipped. It included the authorization remediation tests, project-creation tests, portal-guard tests, employee administration tests, profile authorization tests, onboarding rule tests, and the Worker onboarding gate tests. Billing tests logged `Stripe billing read failed` with subscription and invoice 404 responses and still passed. That log is existing test noise, not a failure. No test failed.

The staging SQL integration test was not repeated.

## 3. Live checks

The pending shared-shell edits are still uncommitted. The live files were compared with those edits and with the committed routing.

| Check | Status | Result |
| --- | --- | --- |
| Staff login page loads | PASS | `https://pulseanalyticsgroupllc.com/admin-login` shows the Admin / Staff sign-in form. |
| Client login page loads | PASS | `https://pulseanalyticsgroupllc.com/client-login` shows the client sign-in form, including forgot-password and account-creation links. |
| Unauthenticated admin portal | PASS | Opening `/admin-portal` in a browser ended on `/admin-login`. |
| Unauthenticated staff workspace | PASS | Opening `/staff-workspace` ended on `/admin-login`. |
| Unauthenticated client portal | PASS | Opening `/client-portal` ended on `/client-login`, not the staff login. |
| Password-reset route | PASS | `/admin-forgot-password` returned 200 and the login pages link to forgot password. A reset email was not submitted. |
| Password-update route | PASS | `/admin-update-password` returned 200. No password was changed. |
| Onboarding account creation | PASS | `/account/create` returned 200. |
| Onboarding later steps without a session | PASS | `/account/business` and `/account/discovery` returned 302 to `/account/create`. |
| Deployed employee route | PASS | Live `portal-guard.js` sends an active administrator to `admin-portal.html` and an active employee to `staff-workspace.html`. Live `admin-unauthorized.html` does the same. |
| Pending shared shell | PASS | The live portal gate says “Verifying administrator access.” It does not say “Verifying staff access,” and it does not contain `data-admin-only`. Live `admin-portal.js` does not hide administrator modules or rename the workspace link to Staff Portal. The live staff-workspace link is hidden unless the user is an administrator. |
| Billing without a session | PASS | `GET /api/billing/summary`, `POST /api/billing/portal`, and `POST /api/billing/service-change` returned 401 and `{"error":"Billing is not available right now."}`. No billing payload was returned. |
| Staff invitation without a session | PASS | `POST /api/staff/invite` returned 401, “Sign in again to invite an employee.” `GET` returned 405. |
| Checkout without a cart | PASS | `POST /api/checkout/session` with an empty body returned 400, “Your cart is empty.” No checkout session was created. |
| Checkout confirmation without a session id | PASS | `GET /api/checkout/session` returned 400, “We couldn't confirm this payment.” |
| Stripe webhook without a signature | PASS | `POST /api/stripe/webhook` returned 400, “Invalid signature.” |
| Public benchmarks route | PASS | `GET /api/benchmarks` returned 200 and public category names. |
| Authenticated administrator portal | PASS | An existing admin session was already signed in. Dashboard, Clients, Projects, Employees, and Account opened. No password was entered or recorded. |
| Client directory | PASS | Clients loaded one existing test account, Portal Test Co. Nothing was created or edited. |
| Project administration | PASS | Projects opened, the New Project control is visible, and the current filter shows no projects. No project was created. |
| Employee administration | PASS | Employees opened, Add Employee is visible, and the list says there are no employee accounts yet. No invitation or role change was made. |
| Creating a project or changing an employee role | NOT TESTED | Those actions would write production data. The controls are present; they were not submitted. |
| Authenticated employee permissions and assigned delivery | BLOCKED | No employee test account was available. |
| Authenticated client isolation | PASS | The existing account `hoibcftm@guerrillamailblock.com` is an active client, Portal Test Client for Portal Test Co. After a password reset, that session opened the client portal. The dashboard, projects, files, reports, and account pages loaded for that company only. Projects had no New Project control and no projects. Files showed an upload form, which was not submitted, and two delivered files, which were not downloaded. One published report was visible. No account field was saved. |
| Client denied on the admin portal | PASS | Opening `/admin-portal` ended on `/admin-unauthorized`. The page said the signed-in account does not have administrator access. The client session stayed signed in. |
| Client denied on the staff workspace | PASS | Opening `/staff-workspace` also ended on `/admin-unauthorized`. The client session stayed signed in, and returning opened the client dashboard again. |
| Staff session kept when opening the client login | BLOCKED | No employee test account was available. |
| Authenticated billing client scope | PASS | The billing summary loaded for Portal Test Co. No subscription is synced. The owner controls for Stripe billing and service changes were visible and were not used. |
| Deployed Worker employee onboarding destination | INCONCLUSIVE | Unsigned onboarding redirects match both the committed and pending Worker. The employee destination was not exercised. Committed source sends employees to `/staff-workspace.html`. The pending, undeployed source sends them to `/admin-portal.html`. |

## 3a. Installed database rules

A read-only catalog query was run against `gultqhsccxuqvibymwdg`. It read policy expressions, function attributes, grants, and trigger names. It did not read customer, profile, or billing rows, and it did not change anything.

These results confirm the installed rules. They do not show an employee or client session being denied by the live application.

| Installed rule | Status | What was read |
| --- | --- | --- |
| Client insert | PASS | `clients_insert` is `is_admin()`. |
| Project insert | PASS | `projects_insert` is `is_admin()`. `projects_guard_staff_grant` is present and its function is security definer. |
| Assigned project update | PASS | `projects_update` allows an administrator, a project member, or assigned staff to see the row, and allows an administrator or assigned staff to write it. |
| Service catalog write | PASS | `services_admin_write` is `is_admin()`. `services_staff_write` is absent. `services_select` remains active services or staff. |
| Role change | PASS | `admin_set_staff_role` is security definer, uses `existing_role` and `pulse.role_change`, and does not use `current_role`. Execute is granted to `authenticated` and `postgres`, not to `anon`. |
| Profile protection | PASS | `protect_profile_privileges` contains the assignment guard and refuses an existing administrator role. `profiles_guard_role_insert` is present. |
| Stripe provisioning | PASS | `create_project_from_stripe_checkout` is security invoker. Execute is granted to `service_role` and `postgres`, not to `anon` or `authenticated`. |
| Delivery and client read scope | PASS | `files_select`, `reports_select`, and `support_requests_select` still limit staff to `is_staff_for_client` and clients to their own membership. `clients_select` is `can_access_client(id)`. `projects_select` is client access or project membership. |

No installed rule contradicted the four migrations.

## 4. Regressions

No reproducible failure was observed. The local suite had no failures. The installed policies match the release. Unauthenticated live routes and API denials behaved as the deployed source describes.

The client session was observed on the live application. An employee session has not been observed. That employee gap is unverified behavior, not a failed check.

## 5. Shared-shell deploy state

The live application does not contain the pending shared admin/staff portal changes. Employees are still routed to the staff workspace. Administrator-only module hiding and the Staff Portal label are only in the uncommitted working tree.

## 6. Recommendation

**Partially verified.**

The local suite passes, the installed database rules match the four migrations, and the signed-in administrator can open the live client directory, project list, and employee list. The existing client account for Portal Test Co. can sign in, see that company’s portal, read its own billing summary, and is turned away from the admin portal and the staff workspace without losing the client session.

The password for that client account was reset during this follow-up. The new password is not recorded in this report. The test browser’s previous administrator session was replaced by this client session because the site uses one shared login. There is still no employee account in the employee list.

On 2026-10-13 the live administrator session, labeled Pulse Admin, submitted one Add Employee invitation for Andrew Kosinski at the controlled Gmail address. No password was entered. No client or project was assigned. The page did not confirm the invitation. It reported: “The invitation could not be sent. Please try again.” The invitation was not submitted again.

That submission created one profile named Andrew Kosinski. Its role is `client`, not `employee`. The email is not confirmed. No `ADMIN_CREATED_EMPLOYEE` audit row was written. Activation and employee testing were not started.

The smallest next action is to correct that profile to `employee` through the authorized application workflow before the account owner sets a password. This test does not approve the application deploy.

Backup and point-in-time recovery remain unverified. `supabase db push` remains unsafe for this project’s migration history.
