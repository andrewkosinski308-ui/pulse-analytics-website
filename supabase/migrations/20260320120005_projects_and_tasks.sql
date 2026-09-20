-- Pulse Analytics: projects and delivery membership
CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients (id) ON DELETE CASCADE,
  name text NOT NULL,
  status public.project_status NOT NULL DEFAULT 'planned',
  owner_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  starts_on date,
  ends_on date,
  summary text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX projects_client_id_idx ON public.projects (client_id);
CREATE INDEX projects_status_idx ON public.projects (status);
CREATE INDEX projects_owner_id_idx ON public.projects (owner_id);
CREATE INDEX projects_created_at_idx ON public.projects (created_at DESC);

CREATE TRIGGER projects_set_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.project_services (
  project_id uuid NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services (id) ON DELETE RESTRICT,
  PRIMARY KEY (project_id, service_id)
);

CREATE TABLE public.project_members (
  project_id uuid NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (project_id, profile_id)
);

CREATE INDEX project_members_profile_id_idx ON public.project_members (profile_id);

CREATE TABLE public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  status public.task_status NOT NULL DEFAULT 'todo',
  priority public.task_priority NOT NULL DEFAULT 'medium',
  assignee_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX tasks_project_id_idx ON public.tasks (project_id);
CREATE INDEX tasks_assignee_id_idx ON public.tasks (assignee_id);
CREATE INDEX tasks_status_idx ON public.tasks (status);
CREATE INDEX tasks_due_at_idx ON public.tasks (due_at);

CREATE TRIGGER tasks_set_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
