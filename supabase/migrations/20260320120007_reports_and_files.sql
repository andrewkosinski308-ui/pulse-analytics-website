-- Pulse Analytics: reports then files (files.report_id FK)
CREATE TABLE public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients (id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects (id) ON DELETE SET NULL,
  title text NOT NULL,
  report_type text NOT NULL,
  period_start date,
  period_end date,
  status public.report_status NOT NULL DEFAULT 'draft',
  published_at timestamptz,
  summary text,
  created_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX reports_client_id_idx ON public.reports (client_id);
CREATE INDEX reports_project_id_idx ON public.reports (project_id);
CREATE INDEX reports_period_start_idx ON public.reports (period_start);
CREATE INDEX reports_published_at_idx ON public.reports (published_at);

-- Ensure project belongs to same client when set
CREATE OR REPLACE FUNCTION public.validate_report_project_client()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.project_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = NEW.project_id AND p.client_id = NEW.client_id
    ) THEN
      RAISE EXCEPTION 'reports.project_id must belong to reports.client_id';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reports_validate_project_client
  BEFORE INSERT OR UPDATE ON public.reports
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_report_project_client();

CREATE TABLE public.files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket text NOT NULL DEFAULT 'client-files',
  storage_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  client_id uuid REFERENCES public.clients (id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects (id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads (id) ON DELETE CASCADE,
  report_id uuid REFERENCES public.reports (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT files_storage_path_unique UNIQUE (storage_path),
  CONSTRAINT files_has_owner CHECK (
    num_nonnulls(client_id, project_id, lead_id, report_id) >= 1
  )
);

CREATE INDEX files_client_id_idx ON public.files (client_id);
CREATE INDEX files_project_id_idx ON public.files (project_id);
CREATE INDEX files_lead_id_idx ON public.files (lead_id);
CREATE INDEX files_uploaded_by_idx ON public.files (uploaded_by);
CREATE INDEX files_report_id_idx ON public.files (report_id);

-- Keep file client_id aligned with project/report when those are set
CREATE OR REPLACE FUNCTION public.validate_file_ownership()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  project_client uuid;
  report_client uuid;
BEGIN
  IF NEW.project_id IS NOT NULL THEN
    SELECT client_id INTO project_client FROM public.projects WHERE id = NEW.project_id;
    IF project_client IS NULL THEN
      RAISE EXCEPTION 'Invalid project_id for file';
    END IF;
    IF NEW.client_id IS NULL THEN
      NEW.client_id := project_client;
    ELSIF NEW.client_id <> project_client THEN
      RAISE EXCEPTION 'files.client_id must match project client';
    END IF;
  END IF;

  IF NEW.report_id IS NOT NULL THEN
    SELECT client_id INTO report_client FROM public.reports WHERE id = NEW.report_id;
    IF report_client IS NULL THEN
      RAISE EXCEPTION 'Invalid report_id for file';
    END IF;
    IF NEW.client_id IS NULL THEN
      NEW.client_id := report_client;
    ELSIF NEW.client_id <> report_client THEN
      RAISE EXCEPTION 'files.client_id must match report client';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER files_validate_ownership
  BEFORE INSERT OR UPDATE ON public.files
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_file_ownership();
