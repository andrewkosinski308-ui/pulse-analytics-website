-- Pulse Analytics: appointments
CREATE TABLE public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  appointment_type public.appointment_type NOT NULL DEFAULT 'consultation',
  status public.appointment_status NOT NULL DEFAULT 'scheduled',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  timezone text NOT NULL DEFAULT 'America/New_York',
  location_or_url text,
  host_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  client_id uuid REFERENCES public.clients (id) ON DELETE SET NULL,
  lead_id uuid REFERENCES public.leads (id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT appointments_time_valid CHECK (ends_at > starts_at)
);

CREATE INDEX appointments_host_id_idx ON public.appointments (host_id);
CREATE INDEX appointments_starts_at_idx ON public.appointments (starts_at);
CREATE INDEX appointments_client_id_idx ON public.appointments (client_id);
CREATE INDEX appointments_lead_id_idx ON public.appointments (lead_id);
CREATE INDEX appointments_status_idx ON public.appointments (status);

CREATE TRIGGER appointments_set_updated_at
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.appointment_attendees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES public.appointments (id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  attendance_role public.attendance_role NOT NULL DEFAULT 'guest',
  response_status public.attendance_response NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT appointment_attendees_unique UNIQUE (appointment_id, profile_id)
);

CREATE INDEX appointment_attendees_profile_id_idx ON public.appointment_attendees (profile_id);
