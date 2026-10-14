# Employee invitation acceptance — release checklist

Reviewed 2026-10-13. This is the deployment plan. Nothing in this checklist was deployed, and no production record or Auth setting was changed.

## Status

| Item | State |
| --- | --- |
| Local invitation fix | Present in the working tree. Not deployed. |
| Automated tests | 345 passed, 0 failed, 0 skipped. The previous baseline was 340. Command below. |
| Production role correction | Done. Andrew Kosinski is an active employee. Recorded in `docs/releases/employee-invitation-profile-recovery.md`. |
| Auth redirect allow list | The operator confirmed this exact URL is listed: `https://pulseanalyticsgroupllc.com/employee-setup.html`. This review did not open or change Auth settings. |
| Production Supabase project | `gultqhsccxuqvibymwdg`. `wrangler.toml` sets `SUPABASE_URL` to `https://gultqhsccxuqvibymwdg.supabase.co`. |
| Website and Worker deploy | Not done. |
| Password setup and employee sign-in | Not done. |

The four authorization migrations stay as they are. Do not run them again and do not use `supabase db push`.

## What the local fix does

- `workers/staff/invite.js` sends `redirect_to` to `https://<request-host>/employee-setup.html`. It does not accept a password or a role other than employee.
- After Auth creates a new user, the administrator session calls `admin_set_staff_role`. Success is returned only when the profile role reads back as `employee`.
- If the invitation email is refused, no user is left behind and the response says the email could not be sent.
- If the email already exists, the response is “An account with this email already exists.” That path does not delete the user or change the role.
- If a new user is created but the role is not `employee`, the Worker deletes only that new user.
- `employee-setup.html` loads the session with the existing Supabase client (`detectSessionInUrl: true`). A password form is shown only for an authenticated, active employee. The page does not link to admin login or `/account/create`. After the password is saved, the employee goes to `staff-workspace.html`.
- Client signup still uses `signup_intent` `portal_client`.

No service-role key, access token, or password is stored in these files.

## Tests

From the repository root, collect every `*.test.mjs` file outside `node_modules` and run:

```powershell
$files = Get-ChildItem -Recurse -Filter *.test.mjs | Where-Object { $_.FullName -notmatch '\\node_modules\\' } | ForEach-Object { $_.FullName }
node --test @files
```

Result on 2026-10-13 after the employee recovery checks, and again after the isolated worktree was prepared: 345 passed, 0 failed, 0 skipped. The prior baseline was 340.

Those tests include invitation authorization, the setup-page redirect, a fixed employee role, password rules, email failure, partial provisioning, duplicate accounts, portal routing, client onboarding, and the Worker gates. No test was weakened and no application code was changed in this review.

## Isolated recovery release

Prepared 2026-10-13. Not deployed.

The recovery page does not need a change to `js/pulse-auth.js`. The live file at `https://pulseanalyticsgroupllc.com/js/pulse-auth.js` was downloaded read-only and is byte-for-byte the same as commit `291f21016429137601457873ef92714a73ea711f`. It already sets `detectSessionInUrl: true`, exports `getSupabase`, `initAuth`, and `updatePassword`, and loads `profiles.role` and `profiles.is_active` for the Auth user. The uncommitted shared-shell edits are absent from that live file. `@supabase/auth-js` 2.116.0 defaults to the implicit flow. On the callback it reads the redirect, rejects an error in the URL, and checks the access token with Auth before saving a session. The setup page then loads the profile and allows `updateUser({ password })` only for an active employee. A failed callback hides the password form even when another session is stored.

`employee-setup.html`, `js/employee-setup-rules.js`, and `js/employee-recovery.js` are not on the live site. Each returned HTTP 404. `js/supabase-env.js` returned HTTP 200.

The normal command `npm run build && npx wrangler deploy` uploads the Worker built from `workers/router.js` and every file under the asset directory `.` that `.assetsignore` does not exclude. It does not upload only the files you name. Run from the current working tree, it would publish the shared-shell edits, release notes, tests, and authorization SQL.

The isolated tree is a detached worktree of `291f210` plus only the three recovery files:

`C:\Users\akosi\Documents\pulse-analytics-recovery-release`

Its `git status --short` shows only:

- `employee-setup.html`
- `js/employee-recovery.js`
- `js/employee-setup-rules.js`

`git diff` there is empty. `js/pulse-auth.js` in that tree does not contain `clientLoginStaffDestination`. `workers/staff/invite.js` in that tree does not contain `employee-setup.html`. The uncommitted invitation Worker stays in the original working tree and is not part of this release. New invitations keep the currently deployed redirect until that Worker is released separately.

Those three files match the working copies and do not contain a service-role key. The page’s CSS, `js/auth-scene.js`, `js/pulse-auth.js`, and image files are already in commit `291f210`. `js/supabase-env.js` is gitignored and is created only by `npm run build`. This shell did not have `SUPABASE_URL` or `SUPABASE_ANON_KEY`, so the generated file is not in the worktree yet. A deploy without that build would omit the live config file.

The newest listed production deployment is version `3b6a0d53-5913-477a-8740-55bc061459e4`, created 2026-10-01 09:57 UTC, one minute after commit `291f210`. The whole asset set was not byte-compared. The auth script match and that timing are the evidence that production is that commit.

Before a future approved deploy, from the worktree, confirm `git status --short` is still only those three files. Then, with the publishable `SUPABASE_URL` and `SUPABASE_ANON_KEY` in the environment and no service-role key present:

```powershell
Set-Location C:\Users\akosi\Documents\pulse-analytics-recovery-release
npm run build
npx wrangler deploy
```

Do not run those commands in `C:\Users\akosi\Documents\pulse-analytics-website`. Do not send the recovery email as part of the deploy.

After deploy, open `https://pulseanalyticsgroupllc.com/employee-setup.html` with no session. It should stay on that page, say the link is invalid or expired, and show the email form. It should not open admin login. Do not submit the form until activation is approved. Confirm `/js/employee-recovery.js` and `/js/employee-setup-rules.js` return the new files, and `/js/pulse-auth.js` still does not contain `clientLoginStaffDestination`.

Rollback does not need a database change. `npx wrangler rollback 3b6a0d53-5913-477a-8740-55bc061459e4` returns the previous Worker version. Accounts that are already employees stay employees.

## Do not deploy this working tree as-is

The deployment command publishes the Worker bundle and the repository as static assets:

```powershell
npm run build && npx wrangler deploy
```

`wrangler.toml` names the Worker `pulse-analytics-website`, sets `main` to `workers/router.js`, and sets the asset directory to `.`. `npm run build` only generates `js/supabase-env.js`. There is no separate staging Worker.

That command would publish every current file that `.assetsignore` does not exclude. The invitation fix is not isolated from the other uncommitted work. A deploy from this tree would also publish the shared-shell edits:

- `admin-portal.html`
- `admin-unauthorized.html`
- `admin-update-password.html`
- `client-login.html`
- `js/account-onboarding.js`
- `js/admin-portal.js`
- `js/portal-guard.js`
- `js/pulse-auth.js`
- `js/staff-workspace.js`
- `workers/onboarding/gate.js`

Those edits send active employees into the shared Admin Portal shell and change client sign-in, the administrator password page, and the onboarding gate. They are not required for `employee-setup.html`. `workers/router.js` imports `workers/onboarding/gate.js`, so the Worker bundle includes that onboarding change even though the invitation route itself is only `/api/staff/invite`.

The same asset upload would also publish untracked release notes, tests, and the authorization SQL files because `.assetsignore` does not exclude `docs/` or `supabase/`. Do not run the command until the deploy tree contains the invitation files without those unrelated edits. Do not discard the unrelated work to make the tree clean.

## Files the invitation release needs

- `employee-setup.html` at `/employee-setup.html`
- `js/employee-setup-rules.js`
- `js/employee-recovery.js`
- `workers/staff/invite.js`, through the existing route in `workers/router.js`
- The existing CSS and `js/auth-scene.js` already used by the setup page
- Generated `js/supabase-env.js` from `npm run build`

`employee-setup.html` imports `js/pulse-auth.js` for `initAuth`, `updatePassword`, and `getAuthState`. The committed `pulse-auth.js` already provides those functions. The uncommitted `pulse-auth.js` changes are the shared-shell work and should stay out of this release.

The isolated recovery deploy described above does not publish the uncommitted `workers/staff/invite.js`. That file is a separate invitation release.

No migration is part of this release. Billing, checkout, and client onboarding routes stay on their current handlers.

## Preconditions

1. The allow-listed URL remains exactly `https://pulseanalyticsgroupllc.com/employee-setup.html`. Leave the Site URL as `https://pulseanalyticsgroupllc.com`.
2. The invite template still uses the Auth confirmation link (`{{ .ConfirmationURL }}`).
3. The deploy tree does not include the unrelated files listed above.
4. `wrangler.toml` still points `SUPABASE_URL` at `https://gultqhsccxuqvibymwdg.supabase.co`.
5. Do not invite `andrewkosinski11@gmail.com` during the deploy.

## Smoke tests after an approved deploy

Do not use `andrewkosinski11@gmail.com` for these checks.

1. Open `https://pulseanalyticsgroupllc.com/employee-setup.html` with no session. The page stays there, says the invitation link is invalid or expired, and shows the employee email form. It does not open admin login. Do not submit that form until the existing-employee activation is separately approved.
2. Confirm `/api/staff/invite` still rejects a request with no session.
3. Send one invitation to a new mailbox that you control. The Admin Portal should say the invitation was sent.
4. In the Auth logs, confirm that verification request’s `redirect_to` is `https://pulseanalyticsgroupllc.com/employee-setup.html`. Do not copy the token or the full URL into a report.
5. Set a password on that page. The browser should open `staff-workspace.html`, and the profile role should be `employee`.
6. Add no client or project assignment.
7. Repeat the same link. It should say the link is invalid or expired and should not create a second account.
8. Open `/account/create` and confirm it is still client signup.

## Existing employee password recovery

Implemented locally. No recovery email has been sent.

`employee-setup.html` shows an “Email setup link” form when there is no usable employee session. That form calls `resetPasswordForEmail` through `js/employee-recovery.js`. The redirect is exactly `https://pulseanalyticsgroupllc.com/employee-setup.html`. The page shows the same message whether the address exists, is unknown, or the send fails. It does not use Add Employee, `/account/create`, or `admin-update-password.html`.

The installed `@supabase/auth-js` 2.116.0 defaults to the implicit flow, and this project does not override `flowType`. `initAuth()` sets `detectSessionInUrl: true`. On the callback, that library reads the redirect, rejects an error in the URL, and checks the access token with Auth before saving a session. The page then loads `profiles` for that Auth user. Password setup stays hidden unless the profile role is `employee` and the account is active. A URL that names a role, email, or user id does not grant access. An expired, reused, or otherwise failed callback keeps the password form hidden even if another session is already stored. Client, administrator, inactive employee, missing profile, and profile lookup failure stay on this page.

`updatePassword` calls `updateUser({ password })` only after those checks. A second save is ignored while the first is in progress. The invitation Worker is unchanged: an existing email still returns “already exists” and is not deleted.

After this page is deployed, the existing employee opens `employee-setup.html`, enters the employee email, and uses the message link to set a password. Do not send that email until deployment is approved. The node tests do not open a browser session or call Auth, so the first live callback still needs the smoke check below.

## Existing employee account

`andrewkosinski11@gmail.com` is already one confirmed Auth user and one active employee profile. Do not delete it and do not send Add Employee for it. Do not send the recovery email during deployment preparation.

## Rollback

If the new setup page is removed without reverting `workers/staff/invite.js` and `js/employee-recovery.js`, new invitation and recovery links will miss the page. Revert those files together. Accounts already set to `employee` stay employees. There is no migration to roll back.

The allow-list entry can remain. It does not grant access by itself.

If a new invitation creates a user and the role call fails, the Worker deletes only that new user. That cleanup does not apply to Andrew Kosinski, because a duplicate invitation never creates a second user.
