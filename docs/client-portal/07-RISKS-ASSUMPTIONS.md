# Risks, Assumptions, and Unknowns

Labels mark each item. Recommendations are not facts. Approval items are not decided.

## 1. Technical Risks

1. **VERIFIED.** The client UI and the database are far apart. Building screens that `select *` will surface columns the overview currently avoids.
2. **VERIFIED.** There is no staff UI to publish reports, create projects, or send files. Client screens can ship empty.
3. **VERIFIED.** `database.types.ts` omits later research tables. Portal JavaScript does not use that file today. A future TypeScript client could be generated from a stale file and miss or mis-type columns.
4. **VERIFIED.** `authenticated` table grants are broad. Disabling RLS on a portal table would expose it. Migrations must not disable RLS.
5. **RECOMMENDATION.** Keep one data module and one notification writer so modules do not drift apart.

## 2. Authentication Risks

1. **VERIFIED.** `assertClientPortalAccess` does not check `is_active`, and the failed eligibility path on the login page does not sign the user out. An inactive client can hold a session that still satisfies RLS anywhere `is_active` is not part of the policy. Client data policies use membership, not `profiles.is_active`, except the helpers `is_admin` and `is_staff` which require `is_active` for staff. **VERIFIED.** A deactivated client with a surviving session can still pass `can_access_client` if the membership row remains.
2. **VERIFIED.** Client and admin share one Supabase session in `localStorage`. Role asserts sign the user out when they use the wrong login. A half-finished flow can be confusing. It is not, by itself, a cross-tenant read.
3. **VERIFIED.** No public signup. A mistaken self-serve signup later would create `role = client` profiles with no membership, which the login assert rejects. The risk is support burden and unused Auth users, not immediate data access.
4. **INFERRED.** Email on `profiles` can diverge from Auth if updated only in `profiles`. The trigger blocks changing another user’s email. It does not require Auth to confirm the new address.
5. **RECOMMENDATION.** Sign out inactive clients and keep membership removal as the real access revocation, not only `is_active`.

## 3. Authorization Risks

1. **VERIFIED.** `owner` and `viewer` are not enforced. A viewer can do anything a member can do, including a future client upload if the policy says “any member.”
2. **VERIFIED.** Employees are staff in SQL and have no UI. A stolen employee session is more powerful than the admin shell suggests, because write policies use `is_staff()` for reports, appointments, and file rows.
3. **VERIFIED.** `loadClientContext` uses one membership. The database does not stop a second membership from existing. Features that assume a single client can show the wrong tenant’s name while RLS still allows the other tenant if a query uses `user_client_ids()` without a filter. **RECOMMENDATION.** Client queries should constrain to the resolved client id and RLS should still allow only memberships. Both are needed. A switcher is **REQUIRES APPROVAL**.
4. **VERIFIED.** Adding a client user to `project_members` on another client grants `can_access_client` for that other client.

## 4. RLS Risks

1. **VERIFIED.** `files_select` and storage select are wider than “sent to client.”
2. **VERIFIED.** `tasks_select` includes every task for an accessible client.
3. **VERIFIED.** `appointments_select` includes `notes`.
4. **VERIFIED.** `clients_select` includes `notes` and `billing_email`.
5. **VERIFIED.** `notifications_insert` allows self-insert.
6. **VERIFIED.** Several staff writes ignore assignment.
7. **RECOMMENDATION.** Do not ship the matching UI until the policy matches the product rule. A JavaScript column list is not enough for files and tasks, because the user can call PostgREST directly with the anon key and their JWT.

## 5. Storage and File Risks

1. **VERIFIED.** The bucket is private, which is appropriate, and the select policy still opens the whole client prefix to members.
2. **VERIFIED.** `allowed_mime_types` is null. A future uploader could store HTML or executables up to 50 MiB unless an allowlist is added.
3. **VERIFIED.** Clients cannot upload today. Removing `is_staff()` from storage insert without a membership check would allow cross-tenant upload.
4. **VERIFIED.** No signed URL code exists. Introducing service-role signing in the browser would bypass RLS.
5. **INFERRED.** Existing objects, if any, have no delivery flag. A stricter policy needs a backfill. Object counts were not measured in this audit.
6. **RECOMMENDATION.** Treat upload and send as different states. Put internal objects on a prefix clients cannot select.
7. **REQUIRES APPROVAL.** MIME list, path, and 50 MiB cap.

## 6. Stripe Risks

1. **VERIFIED.** No webhook. A paid Checkout session is not recorded on `clients`. The portal cannot show “current services” from the database.
2. **VERIFIED.** Checkout does not send a client id. **INFERRED.** Past customers cannot be matched reliably.
3. **VERIFIED.** The secret key is a Worker secret and tests are expected not to return it. A future billing route could regress that. Gate 7 should re-check.
4. **VERIFIED.** Mixed carts become one subscription session. That behavior is checkout, not portal billing, and should not be reinterpreted as an org subscription model.
5. **RECOMMENDATION.** Do not build portal billing on the browser confirm response.
6. **REQUIRES APPROVAL.** Customer Portal versus invoices in the app, and the mapping process.

## 7. Data Integrity Risks

1. **VERIFIED.** `files_insert` can create metadata the storage policy will not let that employee upload, because insert does not require assignment and storage insert does.
2. **VERIFIED.** `validate_file_ownership` and `validate_report_project_client` already stop cross-client project and report links. New file columns must not bypass those triggers.
3. **VERIFIED.** `handle_new_user` uses `ON CONFLICT DO NOTHING`. A partial profile row is not repaired by a second auth insert.
4. **RECOMMENDATION.** Client-supplied `client_id` on upload must be checked against `user_client_ids()`, and the trigger should continue to align project and report clients.
5. **REQUIRES APPROVAL.** Audit insert path for client actions, so client uploads are not the only writes without a trail.

## 8. Migration Risks

1. **VERIFIED.** The live database already has the portal tables, policies, and bucket. Recreating them would destroy data.
2. **INFERRED.** File policy tightening without backfill could hide legitimate objects or, if the backfill marks everything sent, could publish internal objects.
3. **VERIFIED.** Enum changes are easier to add than to remove.
4. **VERIFIED.** Research and benchmark objects share this database. A broad `DROP POLICY` or `REVOKE` can break them.
5. **RECOMMENDATION.** One migration per decision, applied only after the gate that owns that decision. Snapshot or backup before the file-policy migration.

## 9. Production Risks

1. **VERIFIED.** Portal auth is client-side gating plus RLS. A broken anon key or a disabled RLS policy fails open or closed in different ways. Open is worse. Production checks should confirm RLS is still enabled.
2. **VERIFIED.** Cloudflare asset hosting will serve new HTML as soon as it is deployed. Database policy and UI must deploy in an order that does not offer download before the select policy is safe.
3. **INFERRED.** Supabase Auth redirect URLs must include the password-update page on the production origin. `authPageUrl` uses `siteUrl` or `window.location.origin`. A missing redirect allow-list would break reset. The live Auth redirect allow-list was not read in this audit.
4. **RECOMMENDATION.** Deploy file UI only after file policies. Deploy billing UI only after the webhook is verified. Keep checkout tests green.

## 10. Assumptions

These are assumptions, not verified facts.

1. **Assumption.** Pulse Analytics will provision client users and memberships manually until a staff provisioning screen exists. The repository does not show that manual process.
2. **Assumption.** One membership per user is enough for the first release unless Gate 1 says otherwise. The code behaves that way. The business rule was not confirmed outside the code.
3. **Assumption.** Agency clients need published report files and project status more than a task board. That matches the instruction to avoid a project-management platform. It is still a product assumption.
4. **Assumption.** In-app notifications are enough until an email provider is approved.
5. **Assumption.** The public contact form should keep working even after portal support exists.
6. **Assumption.** Stripe Customer Portal is the smaller management surface, but it is not selected. It remains **REQUIRES APPROVAL**.

## 11. Unknowns

1. **Unknown.** How many `client-files` objects exist, and whether any client users already depend on folder-wide read. Not counted in this audit.
2. **Unknown.** Whether production Auth redirect URLs include `client-update-password.html`.
3. **Unknown.** Whether any employee accounts are active in production. The role exists. Counts were not queried, to avoid pulling user lists into the audit notes.
4. **Unknown.** Which historical Stripe customers should belong to which `clients`.
5. **Unknown.** Whether appointment `notes` in real rows contain internal text. The column allows it. Content was not read.
6. **Unknown.** The external scheduling product, if any, that the business wants. None is integrated.
7. **Unknown.** Whether a profile is expected to belong to more than one client in real operations.

## 12. Scope-Creep Risks

1. Turning the admin “Coming soon” CRM into this project.
2. Adding milestones, time tracking, or a full task manager because `tasks` exists.
3. Replacing Stripe with an invoice builder.
4. Replacing `contact.html` with live chat.
5. Building a document platform with versions, public links, and external guests.
6. Adding `organizations` beside `clients`.
7. Rewriting the site in a new frontend framework.
8. Regenerating unrelated research features while editing portal RLS.
9. Treating README Planned Features (blog, knowledge base, AI audit, live chat) as portal requirements.

**RECOMMENDATION.** If a task is not required for overview, reports, projects, files, billing, support, appointments, account, or notifications, it stays out.

## 13. Mitigation Strategies

| Risk | Mitigation |
| --- | --- |
| Cross-tenant reads | Keep RLS. Test with two clients. Never authorize only in the page. |
| Over-sharing columns | Name columns. For files and tasks, change policies before UI. |
| Unsent files visible | Delivery state and a storage prefix clients cannot read. |
| Client upload to the wrong tenant | `client_id` from membership only, enforced in RLS. |
| Service-role leak | Signing and Stripe stay on the Worker. Browser uses the anon key. |
| Billing fiction | No billing UI until webhook-backed status exists. |
| Empty portal | Accept empty states. Add a minimal staff file screen, not a CRM. |
| Migration damage | Additive migrations, backups, backfill plan, no drops of research policies. |
| Inactive users | Sign out in the client assert and treat membership removal as revocation. |
| Scope creep | Gates in `08-APPROVAL-CHECKPOINTS.md`. |

**VERIFIED** facts in the tables above are the ones also stated in earlier sections. The mitigations are **RECOMMENDATION** until a gate adopts them.
