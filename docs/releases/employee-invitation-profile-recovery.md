# Employee test account recovery — read-only verification

Date: 2026-10-13. Production project `gultqhsccxuqvibymwdg` (`db.gultqhsccxuqvibymwdg.supabase.co`, database `postgres`). This check did not write to the database, change a role, send an invitation, confirm an email, set a password, deploy, or change Auth settings.

Local Git changes were left as they were. Nothing was staged, committed, reset, or discarded.

## 1. Verified account state

One Auth user exists for `andrewkosinski11@gmail.com`. One profile exists, and its id matches that Auth user. There is no second user and no profile left behind without an Auth user.

| Item | Verified state |
| --- | --- |
| Auth user | present, not banned |
| Profile | present, email matches this account |
| Profile role | `client` |
| Active | yes |
| Display name | Andrew Kosinski |
| Signup intent on the Auth user | `staff_employee` |
| First name, last name, job title, department, phone | not stored on the profile |
| Started on / ended on | empty |
| Profile created and updated | 2026-10-13 04:34:52 UTC, unchanged since creation |
| Invited at | 2026-10-13 04:34:52 UTC |
| Email confirmed | yes, at 2026-10-13 04:35:46 UTC |
| Confirmation email timestamp | empty |
| Password-recovery email timestamp | empty |
| Sign-in timestamp | 2026-10-13 04:35:46 UTC, the same moment as confirmation |
| Stored password hash | present |
| Recipient completed a password form | not shown. The hash and sign-in timestamp come from invite verification. |

The email is confirmed. The earlier description of this account as unconfirmed is not the current state.

A later Add Employee submit for this same address was refused with “An account with this email already exists.” This read shows that refusal did not create another user and did not update the profile.

## 2. Memberships and dependencies

Counts are for this account only.

| Relationship | Count |
| --- | --- |
| Client memberships | 0 |
| Clients where this account is the account manager | 0 |
| Employee assignments, including inactive | 0 |
| Assignments created by this account | 0 |
| Owned projects | 0 |
| Project memberships | 0 |
| Uploaded files | 0 |
| Created reports | 0 |
| Assigned tasks | 0 |
| Support requests | 0 |
| Support messages | 0 |
| Notifications | 0 |
| Audit rows as actor | 0 |
| Audit rows as the subject | 0 |

No `ADMIN_CREATED_EMPLOYEE` row exists. No `ADMIN_CHANGED_EMPLOYEE_ROLE` row exists. Changing this profile from `client` to `employee` does not remove a company, a project, an assignment, or another person’s access.

## 3. Role correction is appropriate

Correction through the existing Admin Portal workflow is appropriate. Direct SQL is not required and must not be used.

`admin_set_staff_role(uuid, app_role)` is installed as security definer with `search_path=public`. Its body uses `existing_role` and `pulse.role_change`. It does not use `current_role`. Execute is granted to `authenticated` and `postgres`. The function accepts an existing client or employee, refuses `admin`, and refuses a self-change. The assignment guard applies only when an employee is changed to a client. It does not block this client-to-employee change.

The profile update trigger writes `ADMIN_CHANGED_EMPLOYEE_ROLE` when an administrator changes another person’s role through that approved path.

## 4. Proposed correction

Do not perform these steps until they are approved. Do not send an invitation as part of the correction.

Preconditions, rechecked immediately before the change:

- The signed-in session is the administrator, not a client session.
- This account is still the only Auth user and profile for `andrewkosinski11@gmail.com`.
- Role is still `client`, and the account is active.
- The relationship counts in section 2 are still zero.
- No audit row names this profile.

Administrator path:

1. Open `https://pulseanalyticsgroupllc.com/admin-portal`.
2. Open Employees.
3. Select the Clients directory filter. The Employees filter hides client profiles, including this one. Search `andrewkosinski11@gmail.com` so the matching row is the only one opened.
4. Open Andrew Kosinski.
5. Under Authorization, choose Employee. Submit Change role, then Confirm. The confirmation says the account is being changed to Employee and that existing records are kept.
6. Do not use Save employment unless a later task asks for it. Do not use Assign client. Do not use Add Employee.

The confirm action calls `admin_set_staff_role` with this profile and role `employee`.

## 5. How to verify the correction

After the confirm action, the detail page should say “Role updated.” Read the same profile again:

- Role is `employee`.
- Active is still yes.
- Relationship counts in section 2 are still zero.
- One new audit row exists for this profile: action `ADMIN_CHANGED_EMPLOYEE_ROLE`, from `client` to `employee`.
- No `ADMIN_CREATED_EMPLOYEE` row appears, because this step does not send an invitation.
- The directory’s Employees filter shows this account. The Clients filter does not.

If the page reports an error, stop. Do not update the role in SQL, disable a trigger, or change a policy. Leave the profile as `client` and report the error text.

## 6. Do not send another invitation before deployment

The Auth user already exists, so Add Employee returns “An account with this email already exists” and does not send a new message. Do not submit Add Employee again while this user exists.

The local Worker and `employee-setup.html` are not deployed. The live invitation path is still the old Worker. A new message, if one could be sent, would not open the new setup page.

## 7. Password after deployment

The role is already `employee`. The original invitation was already verified, and its redirect was the site origin. Opening that old message does not start a new invitation.

Add Employee is not an activation path for this email. The Worker returns “already exists” and does not delete the user, change the role, or send another message. Do not delete or recreate this Auth user.

The local setup page can email a password link for an existing employee. The redirect is `https://pulseanalyticsgroupllc.com/employee-setup.html`. The password form is shown only after Auth establishes a session and the loaded profile is an active employee. That page is not deployed, and no recovery email has been sent. Do not send it until the deployment in `docs/releases/employee-invitation-acceptance-release-checklist.md` is approved. Do not use client signup or the administrator password page for this account.

## 8. If the role change or a later invitation fails

Role change denied: stop. The profile stays `client`. Do not retry with SQL.

Invitation after a future deploy fails before Auth creates a user: no new profile is created. The existing corrected employee, if the role change already succeeded, stays an employee.

Invitation after a future deploy creates a user but does not apply the employee role: the new Worker removes only that new user and asks for one new invitation. That compensation does not apply to this existing account. If the removal fails, the message says the email was sent and the account is not an employee. Do not invite that address again until that leftover user is removed or corrected.

Do not add a client assignment or a project in order to continue testing.

## 9. Redirect allow-list evidence

The operator supplied a screenshot of the production Auth redirect allow list that includes this exact URL:

`https://pulseanalyticsgroupllc.com/employee-setup.html`

This investigation did not change the allow list and did not read the dashboard itself. The screenshot is the evidence that the URL is listed. A live invitation has not been observed redirecting to that page. The setup page is not deployed, so the allow-list entry alone does not make the invitation flow work.

## 10. Unresolved blockers

- The role correction in section 4 was later approved and completed. See section 12.
- `employee-setup.html` and the updated Worker are not deployed.
- End-to-end invitation acceptance is not verified.
- This email cannot receive another invitation until the existing Auth user is removed under a separate approval.
- A stored password hash does not show that the recipient chose a password.
- No backup or point-in-time recovery was verified in this check.

## 11. Local files left untouched

Branch `main`. Modified and untracked files were not staged. They include the invitation fix (`employee-setup.html`, `js/employee-setup-rules.js`, `workers/staff/invite.js`, and their tests), the earlier uncommitted portal files, and `docs/releases/`.

## 12. Role correction outcome

Authorized on 2026-10-13. One change was made through the live Admin Portal while signed in as Pulse Admin. No SQL update was used. No invitation was sent. No client or project was assigned. The Auth user was not deleted.

Immediately before the change, a read of this account still showed role `client`, one Auth user, one profile, and no memberships, assignments, projects, files, or audit rows.

The page showed Andrew Kosinski, `andrewkosinski11@gmail.com`, role Client, active, staff portal access disabled, no assigned clients, and no administrative history. The role control was set to Employee. The confirmation text was: “Change this account to Employee. Existing records are kept.” Confirm was clicked once.

The page then showed “Role updated.” and “Role: Employee. Account status: Active. Staff portal access: Enabled.” It also showed “No clients are assigned.” and “Role changed · 2026-10-13”. The assign-client control was not used.

A later read of the same account verified:

| Item | Result |
| --- | --- |
| Auth users | 1 |
| Matching profiles | 1 |
| Role | `employee` |
| Active | yes |
| Profile updated | 2026-10-13 05:03:10 UTC |
| Client memberships | 0 |
| Account-manager links | 0 |
| Employee assignments | 0 |
| Assignments created by this account | 0 |
| Owned projects | 0 |
| Project memberships | 0 |
| Uploaded files | 0 |
| Created reports | 0 |
| Assigned tasks | 0 |
| Support requests and messages | 0 |
| Notifications | 0 |
| Audit rows for this profile | 1 |

That audit row is `ADMIN_CHANGED_EMPLOYEE_ROLE` on `profiles`, from `client` to `employee`, written at 2026-10-13 05:03:10 UTC by a different account than the subject. No other audit row exists for this profile.

No billing table is linked to this profile. This change did not create a project, file, membership, or assignment. Password setup and a new invitation remain blocked until deployment and a separate decision about this existing Auth user.
