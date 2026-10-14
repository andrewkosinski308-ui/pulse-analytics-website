# Employee invitation failure — investigation

Date: 2026-10-13. Diagnosis only. No invitation was retried. No email was sent. No password was set. No role was changed. No profile or auth user was deleted. No policy, trigger, function, grant, or deployment was changed.

Production project: `gultqhsccxuqvibymwdg`. Live site: `https://pulseanalyticsgroupllc.com`. Staging was not used.

## 1. What happened

One Add Employee invitation was submitted from the live administrator session for Andrew Kosinski at `andrewkosinski11@gmail.com`. The Admin Portal then showed: “The invitation could not be sent. Please try again.”

That message is the Worker’s generic failure text. It is returned for an Auth invite that is not an “already exists” response, and again when the following profile update fails. It does not identify which of those steps failed. The browser shows the same sentence when the request itself fails.

Production logs for 2026-10-13 04:34:52 UTC show the actual order:

| Time (UTC) | Result |
| --- | --- |
| 04:34:52.439 | `POST /auth/v1/invite` returned 200. |
| 04:34:52.700 | `PATCH /rest/v1/profiles` returned 403. |
| 04:34:52.733 | Postgres: `permission denied for table profiles`. |

The Auth invitation succeeded. The profile update did not. No `ADMIN_CREATED_EMPLOYEE` audit row was written, because the Worker returns before that insert when the profile update fails.

About one minute later, a mobile browser requested the invite verification URL twice. This investigation did not send that request and does not record the token. The account now has a confirmed email, a password, and a sign-in. Those facts were not true in the minute immediately after the Admin Portal error.

## 2. Root cause

`public.handle_new_user()` runs when Auth inserts the user. It always inserts `public.profiles.role` as `client`. It reads `signup_intent` only to create a client company for `portal_client`. The invitation sent `signup_intent` `staff_employee`, so no client company and no membership were created, but the profile role was still `client`.

The Worker then updates that profile to `employee` with the service-role key. On this database, `service_role` does not have `SELECT`, `INSERT`, `UPDATE`, or `DELETE` on `public.profiles`. It has only `REFERENCES`, `TRIGGER`, and `TRUNCATE`. The update is rejected before any column changes.

That matches the stored profile: role `client`, active, no first name, last name, job title, or department, and `updated_at` equal to `created_at`. The names in the invitation were stored on the Auth user metadata and copied into `full_name` by the signup trigger. They were not written by the failed update.

This is not an email-provider failure, a rate limit, or an Auth outage. The invite call returned 200. The email failure was assumed earlier and is not supported.

The role-protection trigger is not what blocked this update. For a non-`authenticated` role it returns before those checks. The request never got that far: the table privilege check failed first.

## 3. Current profile state

Checked with a read of this account only.

| Item | State |
| --- | --- |
| Name on the profile | Andrew Kosinski |
| Email | `andrewkosinski11@gmail.com` |
| Role | `client` |
| Active | yes |
| Signup intent | `staff_employee` |
| Email confirmed | yes, after the later verification request |
| Password chosen by the recipient | not shown. Auth has a stored password hash and a sign-in timestamp from the verification request. That does not mean the recipient completed a password form. |
| Signed in through the invite verification | yes |
| Client memberships | none |
| Employee assignments | none |
| Employee-creation audit | none |
| Created | 2026-10-13 04:34:52 UTC |

The account is a confirmed client with no company membership. It is not an employee.

## 4. Partial account and email

The Auth user and the client profile were created inside the successful invite call, before the profile update failed. The invite call is also what sends the invitation message. Delivery was not the failing step. The profile update failed afterward, and the Worker reported that later failure with the same text it uses when an invitation cannot be sent.

A second invitation must not be sent. Auth will treat the email as already registered, and another message is not required for recovery.

## 5. Smallest safe correction to the workflow

Do not apply this in this task.

1. Change `public.handle_new_user()` so `signup_intent` `staff_employee` inserts role `employee`, and copy `first_name` and `last_name` from the Auth metadata in that same insert. Leave every other signup as `client`. Do not allow this path to insert `admin`. The trigger runs as the function owner, so it does not depend on the missing `service_role` table grant.
2. Stop the Worker from reporting “The invitation could not be sent” after Auth has already returned 200. The follow-up profile write should use a security-definer function granted only to `service_role`, not a new blanket `UPDATE` grant on `profiles`. If that write fails, return a distinct error that says the account exists and the employee role was not applied.
3. Write `ADMIN_CREATED_EMPLOYEE` only after the role is actually `employee`.

A grant of table-wide `UPDATE` to `service_role` would also make today’s patch succeed, and it would leave the client default in place whenever that patch fails for any other reason. The trigger change is the change that prevents the wrong role.

## 6. Proposed recovery for this profile

Do not perform this until it is approved. Do not send another invitation, set a password, or edit the row in SQL.

1. Sign in as the existing administrator.
2. Open Admin Portal → Employees, switch the directory to Clients, and open Andrew Kosinski.
3. Use the existing Change role control, which calls `admin_set_staff_role`, and set the role to `employee`.
4. Add no client or project assignment.
5. Read back the role. It should be `employee`, active, with no assignments.

That function is the supported role change. It accepts an existing client or employee and refuses `admin`. This profile has no assignments, so the assignment guard does not apply. After the role change, the account should use the staff sign-in. It should not be used as a client login.

Cleanup, including deletion, stays a separate decision after employee testing.

## 7. Why acceptance opens the admin login

The invitation email is not stored in this repository. There is no invite template under `supabase/`. The Worker asks Auth to send the recipient to `https://pulseanalyticsgroupllc.com/admin-update-password.html` after verification. `workers/staff/invite.test.mjs` does not assert that address.

The production verification request for this invitation did not use that page. Its `redirect_to` was `https://pulseanalyticsgroupllc.com` with no path. Auth does that when the requested redirect is not on the project allow list: it substitutes the Site URL. `supabase/config.toml` has no redirect allow list. The documented allow list in `.env.example` names the client password page and `client-login.html`. It does not name `admin-update-password.html`.

`admin-update-password.html` is the only staff password page. It can show a new-password form when a recovery or invite session is present. If no session is present, it stays on that page and shows “Recovery session not found.” It does not send the browser to `admin-login.html` by itself. The login page is only a link on that screen.

The homepage does load Auth and can store a session from a URL hash. It does not look for an invite, and it does not open a password form. Its Admin Portal link is always `admin-login.html`. Opening that link after the hash has been left behind shows the staff sign-in form, which requires a password. An invited person who never reached the password page has no password to enter.

The route guard is not treating the invited person as an administrator. An unsigned visit to `admin-login.html` is the sign-in form. A signed-in client who reaches that page is sent to `admin-unauthorized.html`, not left on the login form. This account’s role is still `client`, so a preserved invite session would be denied there rather than offered a password form.

`/account/create` is the client onboarding route. `signUpClient` sets `signup_intent` to `portal_client`, and `handle_new_user()` then creates a client company and an owner membership. That flow also asks the person to choose a password before the account exists. It is the wrong route for an invitation that already created an Auth user.

There is no employee-only setup route. The committed `admin-update-password.html` sends an employee to `staff-workspace.html` only after a password is saved, and only if the profile role is already `employee`. The working tree sends that same employee to `admin-portal.html`. Neither version is what this invitation opened.

Intended acceptance, once a change is approved:

1. The email button opens the Auth verification URL for this invitation.
2. Auth validates the token and redirects only to a dedicated employee setup page that is on the allow list.
3. That page keeps the invite session and asks the recipient to set a password. It does not show the admin sign-in form.
4. The role is already `employee` from the signup trigger in section 5. The setup page does not offer a role choice and does not call client onboarding.
5. After the password is saved, an employee session opens `staff-workspace.html` on the current live site.
6. An expired, invalid, or already-used link stays on the setup page with an error. It does not create a second account. The invite itself remains the only step that creates the Auth user, so a bad link must not call sign-up.

The corresponding change, not applied here, is a dedicated employee setup page, an allow-list entry for that exact URL, and a Worker `redirect_to` that uses it. The homepage and `admin-login.html` stay out of that redirect. `/account/create` stays client-only.

## 8. Tests that would have caught this

The current invitation tests mock a successful profile update. They do not cover a 403 from that update, and they do not assert that `staff_employee` creates an employee rather than a client. They also do not assert `redirect_to`.

Add these before any workflow change is deployed:

- A Worker test where Auth invite returns 200 and the profile update returns 403 with `permission denied for table profiles`. The response must not be success, and it must not use the generic “could not be sent” text.
- A Worker test that the invite call happens before the profile update, so a failed update is treated as a partial account.
- A Worker test that `redirect_to` is the employee setup page on the site origin, with no password field in the invite body.
- A database test that inserting an Auth user with `signup_intent` `staff_employee` creates role `employee`, and that `portal_client` and a missing intent remain `client`.
- A grant check that the role-completion function is executable by `service_role` and that the Worker does not require `service_role` to `UPDATE` `public.profiles` directly.
- Successful acceptance: a valid invite session on the setup page saves a password, leaves the role `employee`, and routes to `staff-workspace.html`.
- Invalid or expired link: the setup page shows an error, does not show the admin sign-in form, and does not create a profile.
- Duplicate acceptance: a second use of the same link does not create another user and does not change the role.
- Email-delivery failure: if Auth does not accept the invite, no profile is left behind, and the Admin Portal does not say the invitation was sent.
- Role preservation: acceptance cannot submit `admin` or `client`, and it does not call `signUpClient` or `/account/create`.

## 9. What this document does not approve

This file is the diagnosis. The profile correction in section 6 was later approved and completed through the Admin Portal. That outcome is in `docs/releases/employee-invitation-profile-recovery.md`. This file still does not approve a deploy or employee sign-in testing.

## 10. Implemented locally

Not deployed. This implementation did not change Auth settings or send an invitation. The later role correction is recorded separately and was not made by this Worker.

The Worker now redirects an invitation to `https://<request-host>/employee-setup.html`. After Auth creates the user, the administrator session calls `admin_set_staff_role` and the Worker reads the role back. Success is returned only when that role is `employee`. The service-role profile update is no longer used. That update was the call production rejected with `permission denied for table profiles`.

The Auth invite and the role change are not one database transaction. Auth sends the email when the user is created, before the role call. If the role is not `employee`, the Worker deletes only that new Auth user and reports the removal. If that delete fails, it reports that the email was sent and the account is not an employee, and it does not send a second invitation. A duplicate email returns “already exists” and does not create another user.

`employee-setup.html` accepts the Supabase invite session through the existing Auth client. It allows a password only when the loaded profile role is `employee` and the account is active. It does not offer a role, and it does not open admin login or client signup. After the password is saved, an employee goes to `staff-workspace.html`.

Files for this fix: `employee-setup.html`, `js/employee-setup-rules.js`, `js/employee-setup-rules.test.mjs`, `workers/staff/invite.js`, `workers/staff/invite.test.mjs`, `.env.example`, and `docs/releases/employee-invitation-acceptance-release-checklist.md`.

Local `node --test` on 2026-10-13: 340 passed, 0 failed, 0 skipped. The same command was run again during release preparation and the result was again 340 passed, 0 failed, 0 skipped. The four authorization migration files were not edited.

The operator has since shown `https://pulseanalyticsgroupllc.com/employee-setup.html` on the production Auth redirect allow list. This repository did not change that setting. The invite email template must keep using the Auth confirmation link. The website and Worker are still not deployed, so a new invitation has not been observed landing on the setup page.

## 11. Release preparation

Reviewed on 2026-10-13. No production record, Auth setting, invitation, or deployment was changed.

The local Worker asks Auth to redirect a new invitation to `https://<request-host>/employee-setup.html`. The setup page loads the session with the existing Supabase client (`detectSessionInUrl: true`) and allows a password only for an active employee. The recipient cannot choose a role. Client signup still uses `signup_intent` `portal_client` and `/account/create`. The setup page does not link to admin login.

An email that Auth refuses does not create a user. An address that already exists returns “already exists” and does not delete or change that user. If a new user is created but the employee role is not applied, the Worker deletes only that new user.

`andrewkosinski11@gmail.com` is already an active employee. Add Employee will not send that address another invitation. A local recovery form on `employee-setup.html` can request a password email for an existing employee and returns that person to the same page. It is not deployed, and no recovery email has been sent. Administrator and client forgot-password pages still use their own password pages. Deployment and password setup remain pending. The deployment plan is `docs/releases/employee-invitation-acceptance-release-checklist.md`.
