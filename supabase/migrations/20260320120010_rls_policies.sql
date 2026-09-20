-- Pulse Analytics: Row Level Security policies
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_attendees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- PROFILES
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_staff());

CREATE POLICY profiles_update_self ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.is_admin())
  WITH CHECK (id = auth.uid() OR public.is_admin());

CREATE POLICY profiles_admin_insert ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() OR id = auth.uid());

-- CLIENTS
CREATE POLICY clients_select ON public.clients
  FOR SELECT TO authenticated
  USING (public.can_access_client(id));

CREATE POLICY clients_insert ON public.clients
  FOR INSERT TO authenticated
  WITH CHECK (public.is_staff());

CREATE POLICY clients_update ON public.clients
  FOR UPDATE TO authenticated
  USING (public.is_admin() OR public.is_staff_for_client(id))
  WITH CHECK (public.is_admin() OR public.is_staff_for_client(id));

CREATE POLICY clients_delete ON public.clients
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- CLIENT MEMBERS
CREATE POLICY client_members_select ON public.client_members
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR profile_id = auth.uid()
    OR public.is_staff_for_client(client_id)
  );

CREATE POLICY client_members_staff_write ON public.client_members
  FOR ALL TO authenticated
  USING (public.is_admin() OR public.is_staff_for_client(client_id))
  WITH CHECK (public.is_admin() OR public.is_staff_for_client(client_id));

-- LEADS (staff only)
CREATE POLICY leads_staff_select ON public.leads
  FOR SELECT TO authenticated
  USING (public.is_staff());

CREATE POLICY leads_staff_insert ON public.leads
  FOR INSERT TO authenticated
  WITH CHECK (public.is_staff());

CREATE POLICY leads_staff_update ON public.leads
  FOR UPDATE TO authenticated
  USING (public.is_admin() OR assigned_to = auth.uid() OR public.is_staff())
  WITH CHECK (public.is_staff());

CREATE POLICY leads_admin_delete ON public.leads
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- CONTACTS
CREATE POLICY contacts_select ON public.contacts
  FOR SELECT TO authenticated
  USING (
    public.is_staff()
    OR (client_id IS NOT NULL AND public.can_access_client(client_id))
  );

CREATE POLICY contacts_insert ON public.contacts
  FOR INSERT TO authenticated
  WITH CHECK (public.is_staff());

CREATE POLICY contacts_update ON public.contacts
  FOR UPDATE TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

CREATE POLICY contacts_delete ON public.contacts
  FOR DELETE TO authenticated
  USING (public.is_admin() OR public.is_staff());

-- SERVICES: staff manage; authenticated read active catalog
CREATE POLICY services_select ON public.services
  FOR SELECT TO authenticated
  USING (is_active = true OR public.is_staff());

CREATE POLICY services_staff_write ON public.services
  FOR ALL TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- PROJECTS
CREATE POLICY projects_select ON public.projects
  FOR SELECT TO authenticated
  USING (
    public.can_access_client(client_id)
    OR public.is_project_member(id)
  );

CREATE POLICY projects_insert ON public.projects
  FOR INSERT TO authenticated
  WITH CHECK (public.is_staff());

CREATE POLICY projects_update ON public.projects
  FOR UPDATE TO authenticated
  USING (public.is_admin() OR public.is_project_member(id) OR public.is_staff_for_client(client_id))
  WITH CHECK (public.is_admin() OR public.is_project_member(id) OR public.is_staff_for_client(client_id));

CREATE POLICY projects_delete ON public.projects
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- PROJECT SERVICES
CREATE POLICY project_services_select ON public.project_services
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects pr
      WHERE pr.id = project_id
        AND (public.can_access_client(pr.client_id) OR public.is_project_member(pr.id))
    )
  );

CREATE POLICY project_services_staff_write ON public.project_services
  FOR ALL TO authenticated
  USING (
    public.is_staff()
    AND EXISTS (
      SELECT 1 FROM public.projects pr
      WHERE pr.id = project_id
        AND (public.is_admin() OR public.is_project_member(pr.id) OR public.is_staff_for_client(pr.client_id))
    )
  )
  WITH CHECK (
    public.is_staff()
    AND EXISTS (
      SELECT 1 FROM public.projects pr
      WHERE pr.id = project_id
        AND (public.is_admin() OR public.is_project_member(pr.id) OR public.is_staff_for_client(pr.client_id))
    )
  );

-- PROJECT MEMBERS
CREATE POLICY project_members_select ON public.project_members
  FOR SELECT TO authenticated
  USING (
    profile_id = auth.uid()
    OR public.is_admin()
    OR public.is_project_member(project_id)
    OR EXISTS (
      SELECT 1 FROM public.projects pr
      WHERE pr.id = project_id AND public.can_access_client(pr.client_id)
    )
  );

CREATE POLICY project_members_staff_write ON public.project_members
  FOR ALL TO authenticated
  USING (
    public.is_staff()
    AND EXISTS (
      SELECT 1 FROM public.projects pr
      WHERE pr.id = project_id
        AND (public.is_admin() OR public.is_staff_for_client(pr.client_id) OR pr.owner_id = auth.uid())
    )
  )
  WITH CHECK (
    public.is_staff()
    AND EXISTS (
      SELECT 1 FROM public.projects pr
      WHERE pr.id = project_id
        AND (public.is_admin() OR public.is_staff_for_client(pr.client_id) OR pr.owner_id = auth.uid())
    )
  );

-- TASKS
CREATE POLICY tasks_select ON public.tasks
  FOR SELECT TO authenticated
  USING (
    assignee_id = auth.uid()
    OR public.is_project_member(project_id)
    OR EXISTS (
      SELECT 1 FROM public.projects pr
      WHERE pr.id = project_id AND public.can_access_client(pr.client_id)
    )
  );

CREATE POLICY tasks_insert ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_staff()
    AND (public.is_admin() OR public.is_project_member(project_id))
  );

CREATE POLICY tasks_update ON public.tasks
  FOR UPDATE TO authenticated
  USING (
    public.is_admin()
    OR assignee_id = auth.uid()
    OR public.is_project_member(project_id)
  )
  WITH CHECK (
    public.is_admin()
    OR assignee_id = auth.uid()
    OR public.is_project_member(project_id)
  );

CREATE POLICY tasks_delete ON public.tasks
  FOR DELETE TO authenticated
  USING (public.is_admin() OR public.is_project_member(project_id));

-- APPOINTMENTS
CREATE POLICY appointments_select ON public.appointments
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR host_id = auth.uid()
    OR (client_id IS NOT NULL AND public.is_staff_for_client(client_id))
    OR (client_id IS NOT NULL AND public.can_access_client(client_id))
    OR (
      lead_id IS NOT NULL AND public.is_staff()
      AND EXISTS (
        SELECT 1 FROM public.leads l
        WHERE l.id = lead_id AND (l.assigned_to = auth.uid() OR public.is_admin())
      )
    )
    OR EXISTS (
      SELECT 1 FROM public.appointment_attendees aa
      WHERE aa.appointment_id = id AND aa.profile_id = auth.uid()
    )
  );

CREATE POLICY appointments_staff_write ON public.appointments
  FOR ALL TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- APPOINTMENT ATTENDEES
CREATE POLICY appointment_attendees_select ON public.appointment_attendees
  FOR SELECT TO authenticated
  USING (
    profile_id = auth.uid()
    OR public.is_staff()
    OR EXISTS (
      SELECT 1 FROM public.appointments a
      WHERE a.id = appointment_id
        AND (
          a.host_id = auth.uid()
          OR (a.client_id IS NOT NULL AND public.can_access_client(a.client_id))
        )
    )
  );

CREATE POLICY appointment_attendees_staff_write ON public.appointment_attendees
  FOR ALL TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- REPORTS (clients: published only for their org)
CREATE POLICY reports_select ON public.reports
  FOR SELECT TO authenticated
  USING (
    public.is_staff()
    OR (
      public.can_access_client(client_id)
      AND status = 'published'
    )
  );

CREATE POLICY reports_staff_write ON public.reports
  FOR ALL TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- FILES
CREATE POLICY files_select ON public.files
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR (client_id IS NOT NULL AND public.is_staff_for_client(client_id))
    OR (client_id IS NOT NULL AND public.can_access_client(client_id))
    OR (
      project_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.projects pr
        WHERE pr.id = project_id
          AND (
            public.is_project_member(pr.id)
            OR public.is_staff_for_client(pr.client_id)
            OR public.can_access_client(pr.client_id)
          )
      )
    )
    OR (
      lead_id IS NOT NULL AND public.is_staff()
      AND EXISTS (
        SELECT 1 FROM public.leads l
        WHERE l.id = lead_id
          AND (public.is_admin() OR l.assigned_to = auth.uid())
      )
    )
  );

CREATE POLICY files_insert ON public.files
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_staff()
    AND uploaded_by = auth.uid()
  );

CREATE POLICY files_update ON public.files
  FOR UPDATE TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

CREATE POLICY files_delete ON public.files
  FOR DELETE TO authenticated
  USING (public.is_admin() OR uploaded_by = auth.uid());

-- NOTIFICATIONS
CREATE POLICY notifications_select ON public.notifications
  FOR SELECT TO authenticated
  USING (recipient_id = auth.uid() OR public.is_admin());

CREATE POLICY notifications_update ON public.notifications
  FOR UPDATE TO authenticated
  USING (recipient_id = auth.uid())
  WITH CHECK (recipient_id = auth.uid());

CREATE POLICY notifications_insert ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (public.is_staff() OR recipient_id = auth.uid());

CREATE POLICY notifications_delete ON public.notifications
  FOR DELETE TO authenticated
  USING (recipient_id = auth.uid() OR public.is_admin());

-- AUDIT LOGS: staff read; insert via service role / definer only (no general insert policy for clients)
CREATE POLICY audit_logs_staff_select ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.is_staff());

-- Allow staff to insert audit rows (app/API); still no update/delete via triggers
CREATE POLICY audit_logs_staff_insert ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (public.is_staff() AND (actor_id IS NULL OR actor_id = auth.uid() OR public.is_admin()));
