-- Read-only checks for the authorization remediation after all four migrations
-- have succeeded. Do not run this file before that, and do not run it as a
-- substitute for the preflight.
--
-- SELECT only. Abort further release steps if any row has status = 'abort'.
-- Expected final version: 20261012071500, with the 39 baseline versions still
-- present and no other versions.

WITH remote AS (
  SELECT version, name FROM supabase_migrations.schema_migrations
),
expected AS (
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
    ('20261002053000', 'fix_service_interest_save'),
    ('20261012010000', 'authorization_remediation_phase1'),
    ('20261012020000', 'role_change_flag_guard'),
    ('20261012045059', 'admin_only_project_creation'),
    ('20261012071500', 'fix_admin_set_staff_role_variable')
  ) AS v(version, name)
)
SELECT finding, version, name
FROM (
  SELECT 'missing_expected' AS finding, e.version, e.name
  FROM expected e
  LEFT JOIN remote r ON r.version = e.version
  WHERE r.version IS NULL
  UNION ALL
  SELECT 'unexpected_remote', r.version, r.name
  FROM remote r
  LEFT JOIN expected e ON e.version = r.version
  WHERE e.version IS NULL
  UNION ALL
  SELECT 'name_mismatch', r.version, r.name || ' <> ' || e.name
  FROM remote r
  JOIN expected e ON e.version = r.version
  WHERE r.name IS DISTINCT FROM e.name
  UNION ALL
  SELECT 'release_order', 'last_four', COALESCE((
    SELECT string_agg(version, ',' ORDER BY version)
    FROM (
      SELECT version
      FROM remote
      ORDER BY version DESC
      LIMIT 4
    ) AS last_four
  ), 'none')
  WHERE (
    SELECT string_agg(version, ',' ORDER BY version)
    FROM (
      SELECT version
      FROM remote
      ORDER BY version DESC
      LIMIT 4
    ) AS last_four
  ) IS DISTINCT FROM '20261012010000,20261012020000,20261012045059,20261012071500'
) findings
ORDER BY finding, version;

WITH policy AS (
  SELECT tablename, policyname, COALESCE(qual, '') AS qual, COALESCE(with_check, '') AS with_check
  FROM pg_policies
  WHERE schemaname = 'public'
),
fn AS (
  SELECT p.proname, p.prosrc, p.prosecdef, COALESCE(p.proconfig::text, '') AS config,
         pg_get_function_identity_arguments(p.oid) AS args
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
),
checks AS (
  SELECT 'clients_insert_admin_only' AS check_name,
         CASE
           WHEN (SELECT with_check FROM policy WHERE tablename = 'clients' AND policyname = 'clients_insert')
                = 'is_admin()'
             OR (SELECT with_check FROM policy WHERE tablename = 'clients' AND policyname = 'clients_insert')
                ILIKE '%is_admin()%'
            AND (SELECT with_check FROM policy WHERE tablename = 'clients' AND policyname = 'clients_insert')
                NOT ILIKE '%is_staff()%'
           THEN 'expected' ELSE 'abort'
         END AS status,
         COALESCE((SELECT with_check FROM policy WHERE tablename = 'clients' AND policyname = 'clients_insert'), 'missing') AS detail
  UNION ALL
  SELECT 'projects_insert_admin_only',
         CASE
           WHEN (SELECT with_check FROM policy WHERE tablename = 'projects' AND policyname = 'projects_insert') ILIKE '%is_admin()%'
            AND (SELECT with_check FROM policy WHERE tablename = 'projects' AND policyname = 'projects_insert') NOT ILIKE '%is_staff%'
           THEN 'expected' ELSE 'abort'
         END,
         COALESCE((SELECT with_check FROM policy WHERE tablename = 'projects' AND policyname = 'projects_insert'), 'missing')
  UNION ALL
  SELECT 'projects_update_keeps_assigned_staff',
         CASE
           WHEN (SELECT with_check FROM policy WHERE tablename = 'projects' AND policyname = 'projects_update') ILIKE '%is_staff_for_client%'
            AND (SELECT with_check FROM policy WHERE tablename = 'projects' AND policyname = 'projects_update') NOT ILIKE '%is_project_member%'
            AND (SELECT qual FROM policy WHERE tablename = 'projects' AND policyname = 'projects_update') ILIKE '%is_project_member%'
           THEN 'expected' ELSE 'abort'
         END,
         COALESCE((SELECT with_check FROM policy WHERE tablename = 'projects' AND policyname = 'projects_update'), 'missing')
  UNION ALL
  SELECT 'services_admin_write',
         CASE
           WHEN EXISTS (
             SELECT 1 FROM policy
             WHERE tablename = 'services' AND policyname = 'services_admin_write'
               AND qual ILIKE '%is_admin()%' AND with_check ILIKE '%is_admin()%'
           )
           AND NOT EXISTS (SELECT 1 FROM policy WHERE tablename = 'services' AND policyname = 'services_staff_write')
           THEN 'expected' ELSE 'abort'
         END,
         'services_admin_write present and services_staff_write absent'
  UNION ALL
  SELECT 'services_select_remains',
         CASE
           WHEN EXISTS (
             SELECT 1 FROM policy
             WHERE tablename = 'services' AND policyname = 'services_select' AND qual ILIKE '%is_staff()%'
           ) THEN 'expected' ELSE 'abort'
         END,
         COALESCE((SELECT qual FROM policy WHERE tablename = 'services' AND policyname = 'services_select'), 'missing')
  UNION ALL
  SELECT 'delivery_policies_remain',
         CASE
           WHEN (
             SELECT count(*)
             FROM pg_policies
             WHERE schemaname = 'public'
               AND policyname IN ('files_select', 'reports_select', 'support_requests_select')
               AND COALESCE(qual, '') ILIKE '%is_staff_for_client%'
           ) = 3 THEN 'expected' ELSE 'abort'
         END,
         'files_select, reports_select, support_requests_select'
  UNION ALL
  SELECT 'admin_set_staff_role_corrected',
         CASE
           WHEN (SELECT args FROM fn WHERE proname = 'admin_set_staff_role' AND args = 'p_profile_id uuid, p_role app_role') = 'p_profile_id uuid, p_role app_role'
            AND (SELECT prosecdef FROM fn WHERE proname = 'admin_set_staff_role' AND args = 'p_profile_id uuid, p_role app_role')
            AND (SELECT config FROM fn WHERE proname = 'admin_set_staff_role' AND args = 'p_profile_id uuid, p_role app_role') ILIKE '%search_path=public%'
            AND (SELECT prosrc FROM fn WHERE proname = 'admin_set_staff_role' AND args = 'p_profile_id uuid, p_role app_role') ILIKE '%existing_role%'
            AND (SELECT prosrc FROM fn WHERE proname = 'admin_set_staff_role' AND args = 'p_profile_id uuid, p_role app_role') NOT ILIKE '%current_role%'
            AND (SELECT prosrc FROM fn WHERE proname = 'admin_set_staff_role' AND args = 'p_profile_id uuid, p_role app_role') ILIKE '%pulse.role_change%'
            AND (SELECT prosrc FROM fn WHERE proname = 'admin_set_staff_role' AND args = 'p_profile_id uuid, p_role app_role') ILIKE '%Remove this employee from client assignments%'
            AND (SELECT prosrc FROM fn WHERE proname = 'admin_set_staff_role' AND args = 'p_profile_id uuid, p_role app_role') NOT ILIKE '%''admin''%'
           THEN 'expected' ELSE 'abort'
         END,
         'existing_role, security definer, search_path, assignment guard, no admin destination'
  UNION ALL
  SELECT 'role_change_trigger_guard',
         CASE
           WHEN (SELECT prosrc FROM fn WHERE proname = 'protect_profile_privileges' AND args = '') ILIKE '%staff_still_assigned%'
            AND (SELECT prosrc FROM fn WHERE proname = 'protect_profile_privileges' AND args = '') ILIKE '%pulse.role_change%'
            AND (SELECT prosrc FROM fn WHERE proname = 'protect_profile_privileges' AND args = '') ILIKE '%OLD.role = ''admin''%'
           THEN 'expected' ELSE 'abort'
         END,
         'protect_profile_privileges'
  UNION ALL
  SELECT 'project_insert_trigger_guard',
         CASE
           WHEN EXISTS (
             SELECT 1
             FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'private'
               AND p.proname = 'guard_project_staff_grant'
               AND p.prosrc ILIKE '%Administrator access is required.%'
               AND p.prosrc ILIKE '%IS DISTINCT FROM ''authenticated''%'
           )
            AND EXISTS (
              SELECT 1 FROM pg_trigger t
              JOIN pg_class c ON c.oid = t.tgrelid
              WHERE c.relname = 'projects' AND t.tgname = 'projects_guard_staff_grant' AND NOT t.tgisinternal
            )
            AND EXISTS (
              SELECT 1 FROM pg_trigger t
              JOIN pg_class c ON c.oid = t.tgrelid
              WHERE c.relname = 'profiles' AND t.tgname = 'profiles_guard_role_insert' AND NOT t.tgisinternal
            )
           THEN 'expected' ELSE 'abort'
         END,
         'private.guard_project_staff_grant and both new triggers'
  UNION ALL
  SELECT 'stripe_function_unchanged',
         CASE
           WHEN (
             SELECT count(*) FROM fn WHERE proname = 'create_project_from_stripe_checkout'
           ) = 1
            AND EXISTS (
             SELECT 1 FROM fn
             WHERE proname = 'create_project_from_stripe_checkout'
               AND args = 'p_client_id uuid, p_session_id text, p_service_ids uuid[], p_price_ids text[], p_project_name text, p_summary text, p_billing text'
               AND NOT prosecdef
           )
           AND EXISTS (
             SELECT 1
             FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
             CROSS JOIN LATERAL aclexplode(p.proacl) a
             JOIN pg_roles r ON r.oid = a.grantee
             WHERE n.nspname = 'public' AND p.proname = 'create_project_from_stripe_checkout'
               AND a.privilege_type = 'EXECUTE' AND r.rolname = 'service_role'
           )
           AND NOT EXISTS (
             SELECT 1
             FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
             CROSS JOIN LATERAL aclexplode(p.proacl) a
             LEFT JOIN pg_roles r ON r.oid = a.grantee
             WHERE n.nspname = 'public' AND p.proname = 'create_project_from_stripe_checkout'
               AND a.privilege_type = 'EXECUTE'
               AND (a.grantee = 0 OR r.rolname IN ('anon', 'authenticated'))
           )
           THEN 'expected' ELSE 'abort'
         END,
         'security invoker and service_role execute only'
  UNION ALL
  SELECT 'admin_set_staff_role_attributes',
         CASE
           WHEN EXISTS (
             SELECT 1
             FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public'
               AND p.proname = 'admin_set_staff_role'
               AND pg_get_function_identity_arguments(p.oid) = 'p_profile_id uuid, p_role app_role'
               AND pg_get_function_result(p.oid) = 'void'
               AND p.provolatile = 'v'
               AND p.prosecdef
               AND COALESCE(p.proconfig::text, '') ILIKE '%search_path=public%'
               AND pg_get_userbyid(p.proowner) = 'postgres'
           )
           AND EXISTS (
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
           )
           AND NOT EXISTS (
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
           )
           THEN 'expected' ELSE 'abort'
         END,
         'owner postgres, void, volatile, security definer, search_path, authenticated execute, no public or anon execute'
  UNION ALL
  SELECT 'rls_still_enabled',
         CASE
           WHEN (
             SELECT count(*)
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public'
               AND c.relname IN ('clients', 'projects', 'profiles', 'services', 'files', 'reports', 'support_requests')
               AND c.relrowsecurity
           ) = 7 THEN 'expected' ELSE 'abort'
         END,
         (
           SELECT string_agg(c.relname || ':' || c.relrowsecurity::text, ', ' ORDER BY c.relname)
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public'
             AND c.relname IN ('clients', 'projects', 'profiles', 'services', 'files', 'reports', 'support_requests')
         )
  UNION ALL
  SELECT 'untouched_policies_remain',
         CASE
           WHEN (
             SELECT count(*)
             FROM policy
             WHERE (tablename, policyname) IN (
               ('clients', 'clients_select'),
               ('clients', 'clients_update'),
               ('projects', 'projects_select'),
               ('projects', 'projects_delete'),
               ('profiles', 'profiles_select')
             )
           ) = 5 THEN 'expected' ELSE 'abort'
         END,
         'clients_select, clients_update, projects_select, projects_delete, profiles_select'
)
SELECT check_name, status, detail
FROM checks
ORDER BY status DESC, check_name;
