-- Staging verification for authorization remediation and administrator-only project creation.
-- Apply these migrations to a staging database first. Do not run this against production.
--   supabase/migrations/20261012010000_authorization_remediation_phase1.sql
--   supabase/migrations/20261012020000_role_change_flag_guard.sql
--   supabase/migrations/20261012045059_admin_only_project_creation.sql
--
-- Target catalog: PostgreSQL 17 (supabase/config.toml db.major_version).
-- pg_policy.polqual and pg_policy.polwithcheck are both pg_node_tree, which is
-- the argument pg_get_expr accepts. Do not subscript polwithcheck; that type is
-- not an array on this version.
--
-- Supabase auth.role() and auth.uid() read request.jwt.claim.role and
-- request.jwt.claim.sub before the request.jwt.claims JSON. SET LOCAL ROLE
-- changes current_user only. Every scenario below sets both.
--
-- The runner must bypass row-level security for fixture setup, read pg_policy,
-- and SET ROLE to service_role and authenticated. A direct postgres session can.
-- The session user must not itself be authenticated or service_role.
--
-- auth.users is inserted with (id, email, aud, role) only. Hosted GoTrue can
-- reject that if a NOT NULL column has no default (confirmation_token and
-- instance_id are the usual ones). Confirm the staging auth schema before
-- running. This file does not guess extra columns.
--
-- handle_new_user creates a client profile. It creates a client organization
-- only when raw_user_meta_data signup_intent is portal_client. These fixtures
-- omit that metadata, then the bypassing session sets staff roles.
--
-- The script is one transaction and ends in ROLLBACK. A failed statement aborts
-- the transaction; disconnecting psql discards it. Do not commit.
--
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/authorization_phase1.sql

BEGIN;

DO $$
DECLARE
  clients_insert text;
  projects_insert text;
  projects_update text;
  services_write text;
  services_read text;
  files_read text;
  reports_read text;
  support_read text;
BEGIN
  SELECT pg_get_expr(pol.polwithcheck, pol.polrelid)
  INTO clients_insert
  FROM pg_policy pol
  JOIN pg_class rel ON rel.oid = pol.polrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public' AND rel.relname = 'clients' AND pol.polname = 'clients_insert';

  IF clients_insert IS NULL OR clients_insert NOT LIKE '%is_admin%' OR clients_insert LIKE '%is_staff(%' THEN
    RAISE EXCEPTION 'clients_insert must be administrator-only, found: %', clients_insert;
  END IF;

  SELECT pg_get_expr(pol.polwithcheck, pol.polrelid)
  INTO projects_insert
  FROM pg_policy pol
  JOIN pg_class rel ON rel.oid = pol.polrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public' AND rel.relname = 'projects' AND pol.polname = 'projects_insert';

  IF projects_insert IS NULL
     OR projects_insert NOT LIKE '%is_admin%'
     OR projects_insert LIKE '%is_staff_for_client%'
     OR projects_insert LIKE '%is_staff(%' THEN
    RAISE EXCEPTION 'projects_insert must be administrator-only, found: %', projects_insert;
  END IF;

  SELECT pg_get_expr(pol.polwithcheck, pol.polrelid)
  INTO projects_update
  FROM pg_policy pol
  JOIN pg_class rel ON rel.oid = pol.polrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public' AND rel.relname = 'projects' AND pol.polname = 'projects_update';

  IF projects_update IS NULL OR projects_update NOT LIKE '%is_staff_for_client%' OR projects_update LIKE '%is_project_member%' THEN
    RAISE EXCEPTION 'projects_update check must not treat the moved project as access, found: %', projects_update;
  END IF;

  SELECT pg_get_expr(pol.polwithcheck, pol.polrelid)
  INTO services_write
  FROM pg_policy pol
  JOIN pg_class rel ON rel.oid = pol.polrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public' AND rel.relname = 'services' AND pol.polname = 'services_admin_write';

  IF services_write IS NULL OR services_write NOT LIKE '%is_admin%' THEN
    RAISE EXCEPTION 'services_admin_write is missing, found: %', services_write;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policy pol
    JOIN pg_class rel ON rel.oid = pol.polrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public' AND rel.relname = 'services' AND pol.polname = 'services_staff_write'
  ) THEN
    RAISE EXCEPTION 'services_staff_write is still present';
  END IF;

  SELECT pg_get_expr(pol.polqual, pol.polrelid)
  INTO services_read
  FROM pg_policy pol
  JOIN pg_class rel ON rel.oid = pol.polrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public' AND rel.relname = 'services' AND pol.polname = 'services_select';

  IF services_read IS NULL OR services_read NOT LIKE '%is_active%' THEN
    RAISE EXCEPTION 'services_select read behavior changed, found: %', services_read;
  END IF;

  SELECT pg_get_expr(pol.polqual, pol.polrelid)
  INTO files_read
  FROM pg_policy pol
  JOIN pg_class rel ON rel.oid = pol.polrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public' AND rel.relname = 'files' AND pol.polname = 'files_select';

  IF files_read IS NULL OR files_read NOT LIKE '%is_staff_for_client%' THEN
    RAISE EXCEPTION 'files_select no longer allows assigned staff, found: %', files_read;
  END IF;

  SELECT pg_get_expr(pol.polqual, pol.polrelid)
  INTO reports_read
  FROM pg_policy pol
  JOIN pg_class rel ON rel.oid = pol.polrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public' AND rel.relname = 'reports' AND pol.polname = 'reports_select';

  IF reports_read IS NULL OR reports_read NOT LIKE '%is_staff_for_client%' THEN
    RAISE EXCEPTION 'reports_select no longer allows assigned staff, found: %', reports_read;
  END IF;

  SELECT pg_get_expr(pol.polqual, pol.polrelid)
  INTO support_read
  FROM pg_policy pol
  JOIN pg_class rel ON rel.oid = pol.polrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public' AND rel.relname = 'support_requests' AND pol.polname = 'support_requests_select';

  IF support_read IS NULL OR support_read NOT LIKE '%is_staff_for_client%' THEN
    RAISE EXCEPTION 'support_requests_select no longer allows assigned staff, found: %', support_read;
  END IF;

  IF has_function_privilege(
    'authenticated',
    'public.create_project_from_stripe_checkout(uuid,text,uuid[],text[],text,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated can execute Stripe project provisioning';
  END IF;
  IF NOT has_function_privilege(
    'service_role',
    'public.create_project_from_stripe_checkout(uuid,text,uuid[],text[],text,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role cannot execute Stripe project provisioning';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_proc fn
    JOIN pg_namespace ns ON ns.oid = fn.pronamespace
    WHERE ns.nspname = 'public'
      AND fn.proname = 'create_project_from_stripe_checkout'
      AND fn.prosecdef
  ) THEN
    RAISE EXCEPTION 'Stripe project provisioning must stay security invoker';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_proc fn
    JOIN pg_namespace ns ON ns.oid = fn.pronamespace
    WHERE ns.nspname = 'public'
      AND fn.prokind = 'f'
      AND pg_get_functiondef(fn.oid) ILIKE '%INSERT INTO public.projects%'
      AND has_function_privilege('authenticated', fn.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'an authenticated function can insert projects';
  END IF;
END $$;

-- Behavioral checks. Fixture ids are local to this transaction.
DO $$
DECLARE
  admin_id uuid := '00000000-0000-4000-8000-0000000000a1';
  employee_id uuid := '00000000-0000-4000-8000-0000000000e1';
  client_user_id uuid := '00000000-0000-4000-8000-0000000000c1';
  spare_id uuid := '00000000-0000-4000-8000-0000000000e2';
  client_id uuid := '00000000-0000-4000-8000-0000000000c2';
  assigned_client_id uuid := '00000000-0000-4000-8000-0000000000c3';
  service_id uuid := '00000000-0000-4000-8000-0000000000b1';
  project_id uuid;
  stripe_project_id uuid;
  denied boolean;
  err_state text;
  err_message text;
  seen_role public.app_role;
BEGIN
  -- Drop any request identity inherited from the connection before fixtures.
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('pulse.role_change', '', true);
  IF coalesce(auth.role(), '') <> '' OR auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'fixture setup inherited a request identity (role %, uid %)', auth.role(), auth.uid();
  END IF;
  IF current_user IN ('authenticated', 'service_role', 'anon') THEN
    RAISE EXCEPTION 'run this script as a bypassing owner, not %', current_user;
  END IF;

  -- No signup_intent, so handle_new_user creates profiles only.
  INSERT INTO auth.users (id, email, aud, role)
  VALUES
    (admin_id, 'phase1-admin@example.com', 'authenticated', 'authenticated'),
    (employee_id, 'phase1-employee@example.com', 'authenticated', 'authenticated'),
    (client_user_id, 'phase1-client@example.com', 'authenticated', 'authenticated'),
    (spare_id, 'phase1-spare@example.com', 'authenticated', 'authenticated');

  UPDATE public.profiles
  SET full_name = 'Phase Admin', role = 'admin', is_active = true
  WHERE id = admin_id;
  UPDATE public.profiles
  SET full_name = 'Phase Employee', role = 'employee', is_active = true
  WHERE id = employee_id;
  UPDATE public.profiles
  SET full_name = 'Phase Client', role = 'client', is_active = true
  WHERE id = client_user_id;
  UPDATE public.profiles
  SET full_name = 'Phase Spare', role = 'employee', is_active = true
  WHERE id = spare_id;

  IF (SELECT role FROM public.profiles WHERE id = admin_id) IS DISTINCT FROM 'admin'
     OR (SELECT role FROM public.profiles WHERE id = employee_id) IS DISTINCT FROM 'employee'
     OR (SELECT role FROM public.profiles WHERE id = client_user_id) IS DISTINCT FROM 'client'
     OR (SELECT role FROM public.profiles WHERE id = spare_id) IS DISTINCT FROM 'employee'
     OR EXISTS (SELECT 1 FROM public.client_members WHERE profile_id IN (admin_id, employee_id, client_user_id, spare_id))
  THEN
    RAISE EXCEPTION 'fixtures did not produce the intended roles without client membership';
  END IF;

  INSERT INTO public.clients (id, name, status)
  VALUES
    (client_id, 'Unassigned phase client', 'active'),
    (assigned_client_id, 'Assigned phase client', 'active');

  INSERT INTO public.employee_client_assignments (employee_id, client_id, assigned_by, active)
  VALUES (employee_id, assigned_client_id, admin_id, true);

  INSERT INTO public.services (id, name, slug)
  VALUES (service_id, 'Phase checkout service', 'phase-checkout-service');

  -- Service-role provisioning. Clear this identity before any later case.
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  EXECUTE 'SET LOCAL ROLE service_role';
  IF auth.role() IS DISTINCT FROM 'service_role' OR auth.uid() IS NOT NULL OR current_user IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Stripe identity was not service_role (role %, uid %, db %)', auth.role(), auth.uid(), current_user;
  END IF;
  stripe_project_id := public.create_project_from_stripe_checkout(
    assigned_client_id,
    'cs_phase2checkout',
    ARRAY[service_id],
    ARRAY['price_phase2'],
    'Stripe provisioned project',
    'Paid checkout.',
    'one_time'
  );
  IF stripe_project_id IS NULL THEN
    RAISE EXCEPTION 'Stripe project provisioning did not return an id';
  END IF;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('pulse.role_change', '', true);
  IF coalesce(auth.role(), '') <> '' OR auth.uid() IS NOT NULL OR current_user IN ('service_role', 'authenticated') THEN
    RAISE EXCEPTION 'service-role claim leaked (role %, uid %, db %)', auth.role(), auth.uid(), current_user;
  END IF;

  -- Employee. Database role and both Supabase claim settings are set together.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', employee_id, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', employee_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS DISTINCT FROM employee_id OR current_user IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'employee identity was not established (role %, uid %, db %)', auth.role(), auth.uid(), current_user;
  END IF;
  IF public.is_admin() OR NOT public.is_staff() THEN
    RAISE EXCEPTION 'employee fixture has the wrong staff privilege';
  END IF;

  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS DISTINCT FROM employee_id THEN
    RAISE EXCEPTION 'employee identity lost before client insert';
  END IF;
  denied := false;
  err_state := NULL;
  err_message := NULL;
  BEGIN
    INSERT INTO public.clients (name, status, account_manager_id)
    VALUES ('Employee created client', 'lead', employee_id);
  EXCEPTION
    WHEN insufficient_privilege THEN
      GET STACKED DIAGNOSTICS err_state = RETURNED_SQLSTATE, err_message = MESSAGE_TEXT;
      denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'employee client insert was allowed';
  END IF;
  IF err_state IS DISTINCT FROM '42501' OR err_message NOT LIKE '%row-level security policy for table "clients"%' THEN
    RAISE EXCEPTION 'employee client insert denied for the wrong reason (%): %', err_state, err_message;
  END IF;

  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS DISTINCT FROM employee_id THEN
    RAISE EXCEPTION 'employee identity lost before project insert';
  END IF;
  denied := false;
  err_state := NULL;
  err_message := NULL;
  BEGIN
    INSERT INTO public.projects (client_id, name, owner_id)
    VALUES (client_id, 'Self-assigned project', employee_id);
  EXCEPTION
    WHEN insufficient_privilege THEN
      GET STACKED DIAGNOSTICS err_state = RETURNED_SQLSTATE, err_message = MESSAGE_TEXT;
      denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'employee project self-assignment was allowed';
  END IF;
  IF err_state IS DISTINCT FROM '42501' OR err_message NOT LIKE '%Administrator access is required.%' THEN
    RAISE EXCEPTION 'employee project insert denied for the wrong reason (%): %', err_state, err_message;
  END IF;

  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS DISTINCT FROM employee_id THEN
    RAISE EXCEPTION 'employee identity lost before assigned project insert';
  END IF;
  denied := false;
  err_state := NULL;
  err_message := NULL;
  BEGIN
    INSERT INTO public.projects (client_id, name, owner_id)
    VALUES (assigned_client_id, 'Assigned client project', admin_id);
  EXCEPTION
    WHEN insufficient_privilege THEN
      GET STACKED DIAGNOSTICS err_state = RETURNED_SQLSTATE, err_message = MESSAGE_TEXT;
      denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'employee project creation for an assigned client was allowed';
  END IF;
  IF err_state IS DISTINCT FROM '42501' OR err_message NOT LIKE '%Administrator access is required.%' THEN
    RAISE EXCEPTION 'assigned-client project insert denied for the wrong reason (%): %', err_state, err_message;
  END IF;

  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS DISTINCT FROM employee_id THEN
    RAISE EXCEPTION 'employee identity lost before Stripe function call';
  END IF;
  denied := false;
  err_state := NULL;
  err_message := NULL;
  BEGIN
    PERFORM public.create_project_from_stripe_checkout(
      assigned_client_id,
      'cs_employeeattempt',
      ARRAY[service_id],
      ARRAY['price_employee'],
      'Employee checkout project',
      'Should not be created.',
      'one_time'
    );
  EXCEPTION
    WHEN insufficient_privilege THEN
      GET STACKED DIAGNOSTICS err_state = RETURNED_SQLSTATE, err_message = MESSAGE_TEXT;
      denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'employee executed Stripe project provisioning';
  END IF;
  IF err_state IS DISTINCT FROM '42501' OR err_message NOT LIKE '%permission denied for function create_project_from_stripe_checkout%' THEN
    RAISE EXCEPTION 'Stripe function denial was the wrong reason (%): %', err_state, err_message;
  END IF;

  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS DISTINCT FROM employee_id THEN
    RAISE EXCEPTION 'employee identity lost before self-promotion';
  END IF;
  PERFORM set_config('pulse.role_change', '', true);
  denied := false;
  err_state := NULL;
  err_message := NULL;
  BEGIN
    UPDATE public.profiles SET role = 'admin' WHERE id = employee_id;
  EXCEPTION
    WHEN insufficient_privilege THEN
      GET STACKED DIAGNOSTICS err_state = RETURNED_SQLSTATE, err_message = MESSAGE_TEXT;
      denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'employee self-promotion was allowed';
  END IF;
  IF err_state IS DISTINCT FROM '42501' OR err_message NOT LIKE '%Those account fields cannot be changed here%' THEN
    RAISE EXCEPTION 'employee self-promotion denied for the wrong reason (%): %', err_state, err_message;
  END IF;
  SELECT role INTO seen_role FROM public.profiles WHERE id = employee_id;
  IF seen_role IS DISTINCT FROM 'employee' THEN
    RAISE EXCEPTION 'employee self-promotion changed the stored role to %', seen_role;
  END IF;

  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS DISTINCT FROM employee_id THEN
    RAISE EXCEPTION 'employee identity lost before role-change flag attempt';
  END IF;
  PERFORM set_config('pulse.role_change', 'approved', true);
  denied := false;
  err_state := NULL;
  err_message := NULL;
  BEGIN
    UPDATE public.profiles SET role = 'admin' WHERE id = employee_id;
  EXCEPTION
    WHEN insufficient_privilege THEN
      GET STACKED DIAGNOSTICS err_state = RETURNED_SQLSTATE, err_message = MESSAGE_TEXT;
      denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'employee role-change flag bypass to admin was allowed';
  END IF;
  IF err_state IS DISTINCT FROM '42501'
     OR err_message NOT LIKE '%Those account fields cannot be changed here%'
     OR err_message LIKE '%Remove this employee from client assignments%'
  THEN
    RAISE EXCEPTION 'employee flag bypass denied for the wrong reason (%): %', err_state, err_message;
  END IF;
  SELECT role INTO seen_role FROM public.profiles WHERE id = employee_id;
  IF seen_role IS DISTINCT FROM 'employee' THEN
    RAISE EXCEPTION 'employee flag bypass changed the stored role to %', seen_role;
  END IF;

  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS DISTINCT FROM employee_id THEN
    RAISE EXCEPTION 'employee identity lost before client-role flag attempt';
  END IF;
  PERFORM set_config('pulse.role_change', 'approved', true);
  denied := false;
  err_state := NULL;
  err_message := NULL;
  BEGIN
    UPDATE public.profiles SET role = 'client' WHERE id = employee_id;
  EXCEPTION
    WHEN insufficient_privilege THEN
      GET STACKED DIAGNOSTICS err_state = RETURNED_SQLSTATE, err_message = MESSAGE_TEXT;
      denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'employee role-change flag bypass was allowed';
  END IF;
  IF err_state IS DISTINCT FROM '42501' OR err_message NOT LIKE '%Those account fields cannot be changed here%' THEN
    RAISE EXCEPTION 'employee client-role flag bypass denied for the wrong reason (%): %', err_state, err_message;
  END IF;
  SELECT role INTO seen_role FROM public.profiles WHERE id = employee_id;
  IF seen_role IS DISTINCT FROM 'employee' THEN
    RAISE EXCEPTION 'employee client-role flag bypass changed the stored role to %', seen_role;
  END IF;

  -- Client identity, independent of the employee claims above.
  PERFORM set_config('pulse.role_change', '', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', client_user_id, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', client_user_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS DISTINCT FROM client_user_id OR current_user IS DISTINCT FROM 'authenticated' OR public.is_staff() THEN
    RAISE EXCEPTION 'client identity was not established (role %, uid %, db %)', auth.role(), auth.uid(), current_user;
  END IF;
  denied := false;
  err_state := NULL;
  err_message := NULL;
  BEGIN
    UPDATE public.profiles SET role = 'admin' WHERE id = client_user_id;
  EXCEPTION
    WHEN insufficient_privilege THEN
      GET STACKED DIAGNOSTICS err_state = RETURNED_SQLSTATE, err_message = MESSAGE_TEXT;
      denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'client role change was allowed';
  END IF;
  IF err_state IS DISTINCT FROM '42501' OR err_message NOT LIKE '%Those account fields cannot be changed here%' THEN
    RAISE EXCEPTION 'client role change denied for the wrong reason (%): %', err_state, err_message;
  END IF;

  -- Administrator identity.
  PERFORM set_config('pulse.role_change', '', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', admin_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS DISTINCT FROM admin_id OR current_user IS DISTINCT FROM 'authenticated' OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'administrator identity was not established (role %, uid %, db %)', auth.role(), auth.uid(), current_user;
  END IF;

  INSERT INTO public.clients (name, status, account_manager_id)
  VALUES ('Admin created client', 'lead', employee_id);

  INSERT INTO public.projects (client_id, name, owner_id)
  VALUES (assigned_client_id, 'Admin created project', employee_id)
  RETURNING id INTO project_id;
  IF project_id IS NULL THEN
    RAISE EXCEPTION 'administrator project creation did not return an id';
  END IF;

  PERFORM public.admin_set_staff_role(employee_id, 'employee');
  PERFORM public.admin_set_staff_role(spare_id, 'client');
  IF (SELECT role FROM public.profiles WHERE id = spare_id) IS DISTINCT FROM 'client'
     OR (SELECT role FROM public.profiles WHERE id = employee_id) IS DISTINCT FROM 'employee'
  THEN
    RAISE EXCEPTION 'legitimate administrator role change did not apply';
  END IF;

  PERFORM set_config('pulse.role_change', '', true);
  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS DISTINCT FROM admin_id OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'administrator identity lost before direct promotion';
  END IF;
  denied := false;
  err_state := NULL;
  err_message := NULL;
  BEGIN
    UPDATE public.profiles SET role = 'admin' WHERE id = employee_id;
  EXCEPTION
    WHEN insufficient_privilege THEN
      GET STACKED DIAGNOSTICS err_state = RETURNED_SQLSTATE, err_message = MESSAGE_TEXT;
      denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'direct administrator promotion was allowed';
  END IF;
  IF err_state IS DISTINCT FROM '42501' OR err_message NOT LIKE '%Those account fields cannot be changed here%' THEN
    RAISE EXCEPTION 'direct promotion denied for the wrong reason (%): %', err_state, err_message;
  END IF;
  IF (SELECT role FROM public.profiles WHERE id = employee_id) IS DISTINCT FROM 'employee' THEN
    RAISE EXCEPTION 'direct promotion changed the employee role';
  END IF;

  PERFORM set_config('pulse.role_change', 'approved', true);
  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS DISTINCT FROM admin_id THEN
    RAISE EXCEPTION 'administrator identity lost before flagged admin promotion';
  END IF;
  denied := false;
  err_state := NULL;
  err_message := NULL;
  BEGIN
    UPDATE public.profiles SET role = 'admin' WHERE id = spare_id;
  EXCEPTION
    WHEN insufficient_privilege THEN
      GET STACKED DIAGNOSTICS err_state = RETURNED_SQLSTATE, err_message = MESSAGE_TEXT;
      denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'administrator flag still cannot create an administrator';
  END IF;
  IF err_state IS DISTINCT FROM '42501' OR err_message NOT LIKE '%Those account fields cannot be changed here%' THEN
    RAISE EXCEPTION 'flagged admin promotion denied for the wrong reason (%): %', err_state, err_message;
  END IF;
  IF (SELECT role FROM public.profiles WHERE id = spare_id) IS DISTINCT FROM 'client' THEN
    RAISE EXCEPTION 'flagged admin promotion changed the spare role';
  END IF;

  PERFORM set_config('pulse.role_change', 'approved', true);
  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS DISTINCT FROM admin_id THEN
    RAISE EXCEPTION 'administrator identity lost before assignment check';
  END IF;
  denied := false;
  err_state := NULL;
  err_message := NULL;
  BEGIN
    UPDATE public.profiles SET role = 'client' WHERE id = employee_id;
  EXCEPTION
    WHEN insufficient_privilege THEN
      GET STACKED DIAGNOSTICS err_state = RETURNED_SQLSTATE, err_message = MESSAGE_TEXT;
      denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'role-change flag skipped the assignment removal check';
  END IF;
  IF err_state IS DISTINCT FROM '42501' OR err_message NOT LIKE '%Remove this employee from client assignments%' THEN
    RAISE EXCEPTION 'assignment check denied for the wrong reason (%): %', err_state, err_message;
  END IF;
  IF (SELECT role FROM public.profiles WHERE id = employee_id) IS DISTINCT FROM 'employee' THEN
    RAISE EXCEPTION 'assignment check changed the employee role';
  END IF;

  -- Employee again, after the administrator cases.
  PERFORM set_config('pulse.role_change', '', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', employee_id, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', employee_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS DISTINCT FROM employee_id OR public.is_admin() OR NOT public.is_staff() THEN
    RAISE EXCEPTION 'employee identity was not restored (role %, uid %)', auth.role(), auth.uid();
  END IF;

  IF NOT public.is_staff_for_client(assigned_client_id) THEN
    RAISE EXCEPTION 'assigned employee lost legitimate client access';
  END IF;
  IF public.is_staff_for_client(client_id) THEN
    RAISE EXCEPTION 'employee gained access to an unassigned client';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = project_id) THEN
    RAISE EXCEPTION 'assigned employee cannot read the administrator-created project';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = stripe_project_id) THEN
    RAISE EXCEPTION 'assigned employee cannot read the Stripe-provisioned project';
  END IF;

  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS DISTINCT FROM employee_id THEN
    RAISE EXCEPTION 'employee identity lost before catalog write';
  END IF;
  denied := false;
  err_state := NULL;
  err_message := NULL;
  BEGIN
    INSERT INTO public.services (name, slug, is_active)
    VALUES ('Employee catalog write', 'employee-catalog-write', true);
  EXCEPTION
    WHEN insufficient_privilege THEN
      GET STACKED DIAGNOSTICS err_state = RETURNED_SQLSTATE, err_message = MESSAGE_TEXT;
      denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'employee service catalog write was allowed';
  END IF;
  IF err_state IS DISTINCT FROM '42501' OR err_message NOT LIKE '%row-level security policy for table "services"%' THEN
    RAISE EXCEPTION 'catalog write denied for the wrong reason (%): %', err_state, err_message;
  END IF;
END $$;

ROLLBACK;
