-- Adds the portal onboarding lifecycle value.
-- Existing clients stay on their current status. New accounts opt into this value explicitly.
ALTER TYPE public.client_status ADD VALUE IF NOT EXISTS 'onboarding';
