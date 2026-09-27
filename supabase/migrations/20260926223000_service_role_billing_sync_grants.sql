-- The billing Worker uses the service role to match a Stripe customer and
-- write invoice, subscription, and notification rows. service_role bypasses
-- RLS, but these tables currently grant it no SELECT, INSERT, or UPDATE.
-- Without those privileges the webhook returns 200 and writes nothing.

GRANT SELECT ON public.clients TO service_role;
GRANT SELECT ON public.client_members TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.client_invoices TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.client_subscriptions TO service_role;
GRANT INSERT ON public.notifications TO service_role;
