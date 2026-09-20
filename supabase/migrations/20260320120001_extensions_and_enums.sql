-- Pulse Analytics: extensions and enums
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE public.app_role AS ENUM ('admin', 'employee', 'client');
CREATE TYPE public.client_status AS ENUM ('lead', 'active', 'paused', 'churned');
CREATE TYPE public.lead_status AS ENUM ('new', 'contacted', 'qualified', 'won', 'lost');
CREATE TYPE public.project_status AS ENUM ('planned', 'active', 'on_hold', 'completed', 'cancelled');
CREATE TYPE public.report_status AS ENUM ('draft', 'published');
CREATE TYPE public.client_member_role AS ENUM ('owner', 'viewer');
CREATE TYPE public.task_status AS ENUM ('todo', 'in_progress', 'blocked', 'done', 'cancelled');
CREATE TYPE public.task_priority AS ENUM ('low', 'medium', 'high', 'urgent');
CREATE TYPE public.appointment_status AS ENUM ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show');
CREATE TYPE public.appointment_type AS ENUM ('consultation', 'audit', 'check_in', 'onboarding', 'other');
CREATE TYPE public.attendance_role AS ENUM ('host', 'staff', 'client', 'guest');
CREATE TYPE public.attendance_response AS ENUM ('pending', 'accepted', 'declined', 'tentative');
CREATE TYPE public.notification_type AS ENUM ('info', 'success', 'warning', 'task', 'appointment', 'report', 'system');
