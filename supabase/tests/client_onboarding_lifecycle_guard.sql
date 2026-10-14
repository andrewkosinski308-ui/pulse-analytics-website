-- Regression coverage for the client owner-field guard and trusted lifecycle flag.
-- Does not require pgTAP. Run only in a disposable/staging database.
BEGIN;

CREATE TEMP TABLE client_onboarding_guard_fixture (
  id integer PRIMARY KEY,
  name text,
  status text,
  account_manager_id uuid,
  stripe_customer_id text,
  onboarding_step smallint,
  onboarding_completed_at timestamptz,
  billing_email text,
  notes text
) ON COMMIT DROP;

CREATE TRIGGER client_onboarding_guard_fixture_trigger
BEFORE UPDATE ON pg_temp.client_onboarding_guard_fixture
FOR EACH ROW
EXECUTE FUNCTION private.guard_client_owner_fields();

SELECT set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001"}',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
SELECT set_config('pulse.lifecycle_write', '', true);

DO $test$
BEGIN
  IF auth.role()::text IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'FAIL: fixture request is not recognized as authenticated';
  END IF;
  RAISE NOTICE 'PASS: fixture request is recognized as authenticated';

  IF COALESCE(public.is_admin(), false) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FAIL: fixture identity unexpectedly has administrator privileges';
  END IF;
  RAISE NOTICE 'PASS: fixture identity is not an administrator';
END;
$test$;

INSERT INTO pg_temp.client_onboarding_guard_fixture (
  id, name, status, account_manager_id, stripe_customer_id,
  onboarding_step, onboarding_completed_at, billing_email, notes
) VALUES (
  1, 'Before', 'onboarding',
  '11111111-1111-1111-1111-111111111111', 'cus_before',
  2, NULL, 'before@example.com', 'protected note'
);

-- Normal authenticated client updates cannot alter protected lifecycle/owner fields.
UPDATE pg_temp.client_onboarding_guard_fixture
SET name = 'Changed ordinary field',
    status = 'lead',
    account_manager_id = '22222222-2222-2222-2222-222222222222',
    stripe_customer_id = 'cus_after',
    onboarding_step = 3,
    onboarding_completed_at = timezone('utc', now()),
    billing_email = 'after@example.com',
    notes = 'changed protected note'
WHERE id = 1;

DO $test$
DECLARE r pg_temp.client_onboarding_guard_fixture%ROWTYPE;
BEGIN
  SELECT * INTO r FROM pg_temp.client_onboarding_guard_fixture WHERE id = 1;
  IF r.onboarding_step IS DISTINCT FROM 2::smallint THEN RAISE EXCEPTION 'FAIL: normal client update changed onboarding_step'; END IF;
  RAISE NOTICE 'PASS: normal client update cannot advance onboarding_step';
  IF r.status IS DISTINCT FROM 'onboarding'::text THEN RAISE EXCEPTION 'FAIL: normal client update changed status'; END IF;
  RAISE NOTICE 'PASS: normal client update cannot change status';
  IF r.account_manager_id IS DISTINCT FROM '11111111-1111-1111-1111-111111111111'::uuid THEN RAISE EXCEPTION 'FAIL: normal client update changed account manager'; END IF;
  RAISE NOTICE 'PASS: normal client update cannot change account manager';
  IF r.stripe_customer_id IS DISTINCT FROM 'cus_before'::text THEN RAISE EXCEPTION 'FAIL: normal client update changed Stripe customer'; END IF;
  RAISE NOTICE 'PASS: normal client update cannot change Stripe customer';
  IF r.billing_email IS DISTINCT FROM 'before@example.com'::text THEN RAISE EXCEPTION 'FAIL: normal client update changed billing email'; END IF;
  RAISE NOTICE 'PASS: normal client update cannot change billing email';
  IF r.notes IS DISTINCT FROM 'protected note'::text THEN RAISE EXCEPTION 'FAIL: normal client update changed protected notes'; END IF;
  RAISE NOTICE 'PASS: normal client update cannot change protected notes';
  IF r.name IS DISTINCT FROM 'Changed ordinary field'::text THEN RAISE EXCEPTION 'FAIL: ordinary business field was not editable'; END IF;
  RAISE NOTICE 'PASS: ordinary business fields remain editable';
END;
$test$;

-- The onboarding RPC sets this transaction-local flag for its validated lifecycle update.
SELECT set_config('pulse.lifecycle_write', 'allowed', true);

UPDATE pg_temp.client_onboarding_guard_fixture
SET status = 'lead',
    onboarding_step = 3,
    onboarding_completed_at = timezone('utc', now()),
    account_manager_id = '33333333-3333-3333-3333-333333333333',
    stripe_customer_id = 'cus_trusted_write',
    billing_email = 'trusted-write@example.com',
    notes = 'trusted write changed note'
WHERE id = 1;

DO $test$
DECLARE r pg_temp.client_onboarding_guard_fixture%ROWTYPE;
BEGIN
  SELECT * INTO r FROM pg_temp.client_onboarding_guard_fixture WHERE id = 1;
  IF r.onboarding_step IS DISTINCT FROM 3::smallint THEN RAISE EXCEPTION 'FAIL: trusted lifecycle write could not advance onboarding_step'; END IF;
  RAISE NOTICE 'PASS: trusted lifecycle write can advance onboarding_step';
  IF r.status IS DISTINCT FROM 'lead'::text THEN RAISE EXCEPTION 'FAIL: trusted lifecycle write could not update status'; END IF;
  RAISE NOTICE 'PASS: trusted lifecycle write can update status';
  IF r.onboarding_completed_at IS NULL THEN RAISE EXCEPTION 'FAIL: trusted lifecycle write could not set completion timestamp'; END IF;
  RAISE NOTICE 'PASS: trusted lifecycle write can set onboarding completion timestamp';
  IF r.account_manager_id IS DISTINCT FROM '11111111-1111-1111-1111-111111111111'::uuid THEN RAISE EXCEPTION 'FAIL: lifecycle flag changed account manager'; END IF;
  RAISE NOTICE 'PASS: lifecycle flag cannot change account manager';
  IF r.stripe_customer_id IS DISTINCT FROM 'cus_before'::text THEN RAISE EXCEPTION 'FAIL: lifecycle flag changed Stripe customer'; END IF;
  RAISE NOTICE 'PASS: lifecycle flag cannot change Stripe customer';
  IF r.billing_email IS DISTINCT FROM 'before@example.com'::text THEN RAISE EXCEPTION 'FAIL: lifecycle flag changed billing email'; END IF;
  RAISE NOTICE 'PASS: lifecycle flag cannot change billing email';
  IF r.notes IS DISTINCT FROM 'protected note'::text THEN RAISE EXCEPTION 'FAIL: lifecycle flag changed protected notes'; END IF;
  RAISE NOTICE 'PASS: lifecycle flag cannot change protected notes';
END;
$test$;

ROLLBACK;
