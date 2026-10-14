-- Read-only production preflight for the authorization remediation release.
-- Do not run this file until the production read-only preflight is explicitly approved.
--
-- Connect only to db.gultqhsccxuqvibymwdg.supabase.co, database postgres, port 5432.
-- Abort before connecting if the host is anything else, including staging
-- db.nncqmztzdkklbwkubowq.supabase.co.
-- This file contains SELECT statements only. It does not start a transaction,
-- change roles, or modify data.
--
-- Abort the release if any result row has status = 'abort'.
-- The expected starting state is the repository baseline through
-- 20261002053000, with none of the four authorization versions applied.
-- Do not assume production matches staging.

-- This result identifies the session. It does not contain the Supabase project
-- reference. Confirm the host before connecting. inet_server_addr is the
-- server address, not proof of the project. Staging fails the baseline checks
-- below because the four release versions are already recorded there.
SELECT current_database() AS current_database,
       current_user,
       session_user,
       current_setting('server_version') AS server_version,
       inet_server_port() AS server_port,
       inet_server_addr()::text AS server_addr;

WITH remote AS (
  SELECT version, name
  FROM supabase_migrations.schema_migrations
),
expected_baseline AS (
  SELECT * FROM (VALUES
    ('20260320120001', 'extensions_and_enums'),
    ('20260320120002', 'profiles'),
    ('20260320120003', 'core_entities'),
    ('20260320120004', 'crm_relationships'),
    ('20260320120005', 'projects_and_tasks'),
    ('20260320120006', 'appointments'),
    ('20260320120007', 'reports_and_files'),
    ('20260320120008', 'notifications_and_audit'),
    ('20260320120009', 'helper_functions'),
    ('20260320120010', 'rls_policies'),
    ('20260320120011', 'storage'),
    ('20260320120012', 'security_hardening'),
    ('20260320120013', 'grant_authenticated_privileges'),
    ('20260924220000', 'research_catalog'),
    ('20260924221500', 'research_catalog_anon_select'),
    ('20260925034500', 'research_taxonomy_access'),
    ('20260925063000', 'search_seo_collection'),
    ('20260925071000', 'analytics_ai_ux_resources'),
    ('20260926053000', 'benchmark_metrics'),
    ('20260926190000', 'client_portal_workspace'),
    ('20260926223000', 'service_role_billing_sync_grants'),
    ('20260926225500', 'cast_file_notification_type'),
    ('20260926234000', 'cast_support_notification_type'),
    ('20260926235500', 'report_publication'),
    ('20260927021500', 'project_purchases'),
    ('20260927023000', 'fix_project_purchase_function'),
    ('20260927040000', 'restrict_client_project_fields'),
    ('20260927041000', 'staff_project_member_read'),
    ('20260927042000', 'project_member_write_check'),
    ('20260927050000', 'remove_leads_contacts_appointments'),
    ('20260927060000', 'client_onboarding_status'),
    ('20260927061000', 'client_onboarding'),
    ('20260927062000', 'fix_onboarding_save'),
    ('20260927070000', 'client_lifecycle'),
    ('20260927080000', 'admin_client_directory'),
    ('20261001030000', 'profile_authorization'),
    ('20261001180000', 'employee_management'),
    ('20261002040000', 'client_profile_services'),
    ('20261002053000', 'fix_service_interest_save')
  ) AS v(version, name)
),
release_versions AS (
  SELECT * FROM (VALUES
    ('20261012010000', 'authorization_remediation_phase1'),
    ('20261012020000', 'role_change_flag_guard'),
    ('20261012045059', 'admin_only_project_creation'),
    ('20261012071500', 'fix_admin_set_staff_role_variable')
  ) AS v(version, name)
)
SELECT finding, version, name
FROM (
  SELECT 'missing_baseline' AS finding, e.version, e.name
  FROM expected_baseline e
  LEFT JOIN remote r ON r.version = e.version
  WHERE r.version IS NULL
  UNION ALL
  SELECT 'baseline_name_mismatch', r.version, r.name || ' <> ' || e.name
  FROM remote r
  JOIN expected_baseline e ON e.version = r.version
  WHERE r.name IS DISTINCT FROM e.name
  UNION ALL
  SELECT 'unexpected_remote', r.version, r.name
  FROM remote r
  LEFT JOIN expected_baseline e ON e.version = r.version
  WHERE e.version IS NULL
  UNION ALL
  SELECT 'release_already_present', r.version, r.name
  FROM remote r
  JOIN release_versions rel ON rel.version = r.version
) findings
ORDER BY finding, version;

WITH policy AS (
  SELECT tablename, policyname, cmd, COALESCE(qual, '') AS qual, COALESCE(with_check, '') AS with_check
  FROM pg_policies
  WHERE schemaname = 'public'
),
fn AS (
  SELECT p.proname,
         pg_get_function_identity_arguments(p.oid) AS args,
         p.prosecdef,
         COALESCE(p.proconfig::text, '') AS config,
         p.prosrc
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
),
checks AS (
  SELECT 'clients_table' AS check_name,
         CASE WHEN to_regclass('public.clients') IS NULL THEN 'abort' ELSE 'expected' END AS status,
         COALESCE(to_regclass('public.clients')::text, 'missing') AS detail
  UNION ALL
  SELECT 'projects_table',
         CASE WHEN to_regclass('public.projects') IS NULL THEN 'abort' ELSE 'expected' END,
         COALESCE(to_regclass('public.projects')::text, 'missing')
  UNION ALL
  SELECT 'profiles_table',
         CASE WHEN to_regclass('public.profiles') IS NULL THEN 'abort' ELSE 'expected' END,
         COALESCE(to_regclass('public.profiles')::text, 'missing')
  UNION ALL
  SELECT 'services_table',
         CASE WHEN to_regclass('public.services') IS NULL THEN 'abort' ELSE 'expected' END,
         COALESCE(to_regclass('public.services')::text, 'missing')
  UNION ALL
  SELECT 'assignment_table',
         CASE WHEN to_regclass('public.employee_client_assignments') IS NULL THEN 'abort' ELSE 'expected' END,
         COALESCE(to_regclass('public.employee_client_assignments')::text, 'missing')
  UNION ALL
  SELECT 'project_members_table',
         CASE WHEN to_regclass('public.project_members') IS NULL THEN 'abort' ELSE 'expected' END,
         COALESCE(to_regclass('public.project_members')::text, 'missing')
  UNION ALL
  SELECT 'audit_logs_table',
         CASE WHEN to_regclass('public.audit_logs') IS NULL THEN 'abort' ELSE 'expected' END,
         COALESCE(to_regclass('public.audit_logs')::text, 'missing')
  UNION ALL
  SELECT 'private_schema',
         CASE WHEN EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'private') THEN 'expected' ELSE 'abort' END,
         'private'
  UNION ALL
  SELECT 'app_role_values',
         CASE
           WHEN (
             SELECT string_agg(e.enumlabel::text, ',' ORDER BY e.enumsortorder)
             FROM pg_enum e
             JOIN pg_type t ON t.oid = e.enumtypid
             JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE n.nspname = 'public' AND t.typname = 'app_role'
           ) = 'admin,employee,client'
           THEN 'expected' ELSE 'abort'
         END,
         COALESCE((
           SELECT string_agg(e.enumlabel::text, ',' ORDER BY e.enumsortorder)
           FROM pg_enum e
           JOIN pg_type t ON t.oid = e.enumtypid
           JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE n.nspname = 'public' AND t.typname = 'app_role'
         ), 'missing')
  UNION ALL
  SELECT 'profiles_role_column',
         CASE
           WHEN EXISTS (
             SELECT 1
             FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'role'
               AND udt_name = 'app_role'
           ) THEN 'expected' ELSE 'abort'
         END,
         'profiles.role'
  UNION ALL
  SELECT 'profile_privilege_columns',
         CASE
           WHEN (
             SELECT count(*)
             FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'profiles'
               AND column_name IN ('is_active', 'job_title', 'department', 'started_on', 'ended_on', 'email')
           ) = 6 THEN 'expected' ELSE 'abort'
         END,
         'is_active, job_title, department, started_on, ended_on, email'
  UNION ALL
  SELECT 'clients_account_manager',
         CASE
           WHEN EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'clients' AND column_name = 'account_manager_id'
           ) THEN 'expected' ELSE 'abort'
         END,
         'clients.account_manager_id'
  UNION ALL
  SELECT 'projects_owner_and_client',
         CASE
           WHEN (
             SELECT count(*) FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'projects'
               AND column_name IN ('client_id', 'owner_id')
           ) = 2 THEN 'expected' ELSE 'abort'
         END,
         'projects.client_id, projects.owner_id'
  UNION ALL
  SELECT 'rls_enabled',
         CASE
           WHEN (
             SELECT count(*)
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public'
               AND c.relname IN ('clients', 'projects', 'profiles', 'services')
               AND c.relrowsecurity
           ) = 4 THEN 'expected' ELSE 'abort'
         END,
         (
           SELECT string_agg(c.relname || ':' || c.relrowsecurity::text, ', ' ORDER BY c.relname)
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public'
             AND c.relname IN ('clients', 'projects', 'profiles', 'services')
         )
  UNION ALL
  SELECT 'helper_functions',
         CASE
           WHEN to_regprocedure('public.is_admin()') IS NOT NULL
            AND to_regprocedure('public.is_staff()') IS NOT NULL
            AND to_regprocedure('public.is_staff_for_client(uuid)') IS NOT NULL
            AND to_regprocedure('public.is_project_member(uuid)') IS NOT NULL
            AND to_regprocedure('public.can_access_client(uuid)') IS NOT NULL
            AND (
              SELECT count(*)
              FROM pg_proc p
              JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public'
                AND p.proname IN ('is_admin', 'is_staff', 'is_staff_for_client', 'is_project_member', 'can_access_client')
                AND p.prosecdef
            ) = 5
           THEN 'expected' ELSE 'abort'
         END,
         'security definer helpers: is_admin, is_staff, is_staff_for_client, is_project_member, can_access_client'
  UNION ALL
  SELECT 'clients_insert_starting_policy',
         CASE
           WHEN NOT EXISTS (SELECT 1 FROM policy WHERE tablename = 'clients' AND policyname = 'clients_insert') THEN 'abort'
           WHEN (SELECT with_check FROM policy WHERE tablename = 'clients' AND policyname = 'clients_insert') ILIKE '%is_staff()%'
            AND (SELECT with_check FROM policy WHERE tablename = 'clients' AND policyname = 'clients_insert') NOT ILIKE '%is_admin()%'
           THEN 'expected'
           ELSE 'abort'
         END,
         COALESCE((SELECT with_check FROM policy WHERE tablename = 'clients' AND policyname = 'clients_insert'), 'missing')
  UNION ALL
  SELECT 'projects_insert_starting_policy',
         CASE
           WHEN NOT EXISTS (SELECT 1 FROM policy WHERE tablename = 'projects' AND policyname = 'projects_insert') THEN 'abort'
           WHEN (SELECT with_check FROM policy WHERE tablename = 'projects' AND policyname = 'projects_insert') ILIKE '%is_staff()%'
            AND (SELECT with_check FROM policy WHERE tablename = 'projects' AND policyname = 'projects_insert') NOT ILIKE '%is_admin()%'
            AND (SELECT with_check FROM policy WHERE tablename = 'projects' AND policyname = 'projects_insert') NOT ILIKE '%is_staff_for_client%'
           THEN 'expected'
           ELSE 'abort'
         END,
         COALESCE((SELECT with_check FROM policy WHERE tablename = 'projects' AND policyname = 'projects_insert'), 'missing')
  UNION ALL
  SELECT 'projects_update_starting_policy',
         CASE
           WHEN NOT EXISTS (SELECT 1 FROM policy WHERE tablename = 'projects' AND policyname = 'projects_update') THEN 'abort'
           WHEN (SELECT with_check FROM policy WHERE tablename = 'projects' AND policyname = 'projects_update') ILIKE '%is_project_member%'
           THEN 'expected'
           ELSE 'abort'
         END,
         COALESCE((SELECT with_check FROM policy WHERE tablename = 'projects' AND policyname = 'projects_update'), 'missing')
  UNION ALL
  SELECT 'services_staff_write_present',
         CASE
           WHEN EXISTS (SELECT 1 FROM policy WHERE tablename = 'services' AND policyname = 'services_staff_write') THEN 'expected'
           ELSE 'abort'
         END,
         COALESCE((SELECT with_check FROM policy WHERE tablename = 'services' AND policyname = 'services_staff_write'), 'missing')
  UNION ALL
  SELECT 'services_admin_write_absent',
         CASE
           WHEN EXISTS (SELECT 1 FROM policy WHERE tablename = 'services' AND policyname = 'services_admin_write') THEN 'abort'
           ELSE 'expected'
         END,
         'services_admin_write'
  UNION ALL
  SELECT 'services_select_unchanged',
         CASE
           WHEN EXISTS (
             SELECT 1 FROM policy
             WHERE tablename = 'services' AND policyname = 'services_select'
               AND qual ILIKE '%is_staff()%'
           ) THEN 'expected' ELSE 'abort'
         END,
         COALESCE((SELECT qual FROM policy WHERE tablename = 'services' AND policyname = 'services_select'), 'missing')
  UNION ALL
  SELECT 'admin_set_staff_role_starting_body',
         CASE
           WHEN NOT EXISTS (SELECT 1 FROM fn WHERE proname = 'admin_set_staff_role' AND args = 'p_profile_id uuid, p_role app_role') THEN 'abort'
           WHEN (SELECT prosrc FROM fn WHERE proname = 'admin_set_staff_role' AND args = 'p_profile_id uuid, p_role app_role') ILIKE '%current_role%'
            AND (SELECT prosrc FROM fn WHERE proname = 'admin_set_staff_role' AND args = 'p_profile_id uuid, p_role app_role') NOT ILIKE '%existing_role%'
            AND (SELECT prosrc FROM fn WHERE proname = 'admin_set_staff_role' AND args = 'p_profile_id uuid, p_role app_role') NOT ILIKE '%pulse.role_change%'
            AND (SELECT prosecdef FROM fn WHERE proname = 'admin_set_staff_role' AND args = 'p_profile_id uuid, p_role app_role')
            AND (SELECT config FROM fn WHERE proname = 'admin_set_staff_role' AND args = 'p_profile_id uuid, p_role app_role') ILIKE '%search_path=public%'
           THEN 'expected' ELSE 'abort'
         END,
         'signature, security definer, search_path, current_role collision still present'
  UNION ALL
  SELECT 'protect_profile_privileges_starting_body',
         CASE
           WHEN to_regprocedure('public.protect_profile_privileges()') IS NULL THEN 'abort'
           WHEN (SELECT prosrc FROM fn WHERE proname = 'protect_profile_privileges') NOT ILIKE '%pulse.role_change%'
            AND (SELECT prosrc FROM fn WHERE proname = 'protect_profile_privileges') NOT ILIKE '%staff_still_assigned%'
           THEN 'expected' ELSE 'abort'
         END,
         'no role-change flag yet'
  UNION ALL
  SELECT 'profile_privilege_trigger',
         CASE
           WHEN EXISTS (
             SELECT 1 FROM pg_trigger t
             JOIN pg_class c ON c.oid = t.tgrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relname = 'profiles'
               AND t.tgname = 'profiles_protect_privileges' AND NOT t.tgisinternal
           ) THEN 'expected' ELSE 'abort'
         END,
         'profiles_protect_privileges'
  UNION ALL
  SELECT 'new_triggers_absent',
         CASE
           WHEN EXISTS (
             SELECT 1 FROM pg_trigger t
             JOIN pg_class c ON c.oid = t.tgrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND NOT t.tgisinternal
               AND t.tgname IN ('projects_guard_staff_grant', 'profiles_guard_role_insert')
           ) THEN 'abort' ELSE 'expected'
         END,
         'projects_guard_staff_grant, profiles_guard_role_insert'
  UNION ALL
  SELECT 'stripe_function_service_role_only',
         CASE
           WHEN to_regprocedure('public.create_project_from_stripe_checkout(uuid, text, uuid[], text[], text, text, text)') IS NULL THEN 'abort'
           WHEN EXISTS (
             SELECT 1 FROM fn
             WHERE proname = 'create_project_from_stripe_checkout'
               AND prosecdef
           ) THEN 'abort'
           WHEN EXISTS (
             SELECT 1
             FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
             CROSS JOIN LATERAL aclexplode(p.proacl) a
             LEFT JOIN pg_roles r ON r.oid = a.grantee
             WHERE n.nspname = 'public'
               AND p.proname = 'create_project_from_stripe_checkout'
               AND a.privilege_type = 'EXECUTE'
               AND (a.grantee = 0 OR r.rolname IN ('anon', 'authenticated', 'PUBLIC'))
           ) THEN 'abort'
           WHEN NOT EXISTS (
             SELECT 1
             FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
             CROSS JOIN LATERAL aclexplode(p.proacl) a
             JOIN pg_roles r ON r.oid = a.grantee
             WHERE n.nspname = 'public'
               AND p.proname = 'create_project_from_stripe_checkout'
               AND a.privilege_type = 'EXECUTE'
               AND r.rolname = 'service_role'
           ) THEN 'abort'
           ELSE 'expected'
         END,
         'security invoker; execute for service_role; no anon, authenticated, or public execute'
  UNION ALL
  SELECT 'admin_set_staff_role_grants',
         CASE
           WHEN NOT EXISTS (
             SELECT 1
             FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
             CROSS JOIN LATERAL aclexplode(p.proacl) a
             JOIN pg_roles r ON r.oid = a.grantee
             WHERE n.nspname = 'public'
               AND p.proname = 'admin_set_staff_role'
               AND pg_get_function_identity_arguments(p.oid) = 'p_profile_id uuid, p_role app_role'
               AND a.privilege_type = 'EXECUTE'
               AND r.rolname = 'authenticated'
           ) THEN 'abort'
           WHEN EXISTS (
             SELECT 1
             FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
             CROSS JOIN LATERAL aclexplode(p.proacl) a
             LEFT JOIN pg_roles r ON r.oid = a.grantee
             WHERE n.nspname = 'public'
               AND p.proname = 'admin_set_staff_role'
               AND pg_get_function_identity_arguments(p.oid) = 'p_profile_id uuid, p_role app_role'
               AND a.privilege_type = 'EXECUTE'
               AND (a.grantee = 0 OR r.rolname IN ('anon', 'PUBLIC'))
           ) THEN 'abort'
           ELSE 'expected'
         END,
         'authenticated execute; no public or anon execute'
  UNION ALL
  SELECT 'assignment_and_audit_columns',
         CASE
           WHEN (
             SELECT count(*)
             FROM information_schema.columns
             WHERE (table_schema, table_name, column_name) IN (
               ('public', 'employee_client_assignments', 'employee_id'),
               ('public', 'employee_client_assignments', 'client_id'),
               ('public', 'employee_client_assignments', 'active'),
               ('public', 'project_members', 'project_id'),
               ('public', 'project_members', 'profile_id'),
               ('public', 'audit_logs', 'actor_id'),
               ('public', 'audit_logs', 'action'),
               ('public', 'audit_logs', 'entity_type'),
               ('public', 'audit_logs', 'entity_id'),
               ('public', 'audit_logs', 'metadata')
             )
           ) = 10 THEN 'expected' ELSE 'abort'
         END,
         'assignment, membership, and audit columns used by the release'
)
SELECT check_name, status, detail
FROM checks
ORDER BY status DESC, check_name;
