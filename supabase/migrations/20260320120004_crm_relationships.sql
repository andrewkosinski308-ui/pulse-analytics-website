-- Pulse Analytics: CRM relationship tables
CREATE TABLE public.client_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients (id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  member_role public.client_member_role NOT NULL DEFAULT 'viewer',
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT client_members_client_profile_unique UNIQUE (client_id, profile_id)
);

CREATE INDEX client_members_profile_id_idx ON public.client_members (profile_id);
CREATE INDEX client_members_client_id_idx ON public.client_members (client_id);

CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  email text NOT NULL,
  phone text,
  company_name text,
  source text,
  status public.lead_status NOT NULL DEFAULT 'new',
  assigned_to uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  converted_client_id uuid REFERENCES public.clients (id) ON DELETE SET NULL,
  message text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX leads_status_idx ON public.leads (status);
CREATE INDEX leads_assigned_to_idx ON public.leads (assigned_to);
CREATE INDEX leads_source_idx ON public.leads (source);
CREATE INDEX leads_created_at_idx ON public.leads (created_at DESC);
CREATE INDEX leads_email_idx ON public.leads (email);

CREATE TRIGGER leads_set_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients (id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads (id) ON DELETE CASCADE,
  first_name text NOT NULL,
  last_name text,
  email text,
  phone text,
  title text,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT contacts_has_owner CHECK (client_id IS NOT NULL OR lead_id IS NOT NULL)
);

CREATE INDEX contacts_client_id_idx ON public.contacts (client_id);
CREATE INDEX contacts_lead_id_idx ON public.contacts (lead_id);
CREATE INDEX contacts_email_idx ON public.contacts (email);

CREATE TRIGGER contacts_set_updated_at
  BEFORE UPDATE ON public.contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
