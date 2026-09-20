-- Pulse Analytics: clients and services (root entities)
CREATE TABLE public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  legal_name text,
  website text,
  industry text,
  status public.client_status NOT NULL DEFAULT 'lead',
  account_manager_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  billing_email text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX clients_status_idx ON public.clients (status);
CREATE INDEX clients_account_manager_id_idx ON public.clients (account_manager_id);
CREATE INDEX clients_lower_name_idx ON public.clients (lower(name));

CREATE TRIGGER clients_set_updated_at
  BEFORE UPDATE ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  category text,
  base_price numeric(12, 2),
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT services_slug_unique UNIQUE (slug)
);

CREATE INDEX services_slug_idx ON public.services (slug);
CREATE INDEX services_is_active_idx ON public.services (is_active);

CREATE TRIGGER services_set_updated_at
  BEFORE UPDATE ON public.services
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Seed catalog from website service offerings
INSERT INTO public.services (name, slug, description, category, sort_order) VALUES
  ('Search Engine Optimization', 'seo', 'Technical SEO, content strategy, and organic growth.', 'SEO', 10),
  ('Local SEO', 'local-seo', 'Local visibility, Google Business Profile, and maps presence.', 'SEO', 20),
  ('Google Ads Management', 'google-ads', 'Paid search and Performance Max campaign management.', 'Advertising', 30),
  ('Website Design & Development', 'web-design', 'Responsive, accessible, SEO-ready websites.', 'Web', 40),
  ('Analytics & Reporting', 'analytics-reporting', 'GA4, dashboards, KPI reporting, and insights.', 'Analytics', 50),
  ('Social Media Marketing', 'social-media', 'Content strategy, engagement, and campaign management.', 'Marketing', 60),
  ('AI Marketing Solutions', 'ai-marketing', 'Automation, chatbots, and AI-assisted workflows.', 'AI', 70),
  ('Brand Strategy', 'branding', 'Positioning, messaging, and brand identity strategy.', 'Branding', 80);
