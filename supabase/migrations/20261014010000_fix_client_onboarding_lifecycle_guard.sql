-- Preserve owner-controlled fields while allowing the validated onboarding RPC
-- to update only lifecycle fields under its transaction-local write flag.
CREATE OR REPLACE FUNCTION private.guard_client_owner_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(auth.role(), '') IS DISTINCT FROM 'authenticated'
     OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  -- These fields are never written by the client onboarding RPC.
  NEW.account_manager_id := OLD.account_manager_id;
  NEW.stripe_customer_id := OLD.stripe_customer_id;
  NEW.billing_email := OLD.billing_email;
  NEW.notes := OLD.notes;

  -- Only the validated server-side lifecycle write may update these fields.
  IF current_setting('pulse.lifecycle_write', true) IS DISTINCT FROM 'allowed' THEN
    NEW.status := OLD.status;
    NEW.onboarding_step := OLD.onboarding_step;
    NEW.onboarding_completed_at := OLD.onboarding_completed_at;
  END IF;

  RETURN NEW;
END;
$function$;
