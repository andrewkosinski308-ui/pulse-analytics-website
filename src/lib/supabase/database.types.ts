/**
 * Generated from live Pulse Analytics Supabase schema (gultqhsccxuqvibymwdg).
 * Regenerate with: npx supabase gen types typescript --project-id gultqhsccxuqvibymwdg
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string
          full_name: string | null
          role: Database['public']['Enums']['app_role']
          phone: string | null
          avatar_url: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          full_name?: string | null
          role?: Database['public']['Enums']['app_role']
          phone?: string | null
          avatar_url?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          full_name?: string | null
          role?: Database['public']['Enums']['app_role']
          phone?: string | null
          avatar_url?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      clients: {
        Row: {
          id: string
          name: string
          legal_name: string | null
          website: string | null
          industry: string | null
          status: Database['public']['Enums']['client_status']
          account_manager_id: string | null
          billing_email: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          legal_name?: string | null
          website?: string | null
          industry?: string | null
          status?: Database['public']['Enums']['client_status']
          account_manager_id?: string | null
          billing_email?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          legal_name?: string | null
          website?: string | null
          industry?: string | null
          status?: Database['public']['Enums']['client_status']
          account_manager_id?: string | null
          billing_email?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'clients_account_manager_id_fkey'
            columns: ['account_manager_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      client_members: {
        Row: {
          id: string
          client_id: string
          profile_id: string
          member_role: Database['public']['Enums']['client_member_role']
          created_at: string
        }
        Insert: {
          id?: string
          client_id: string
          profile_id: string
          member_role?: Database['public']['Enums']['client_member_role']
          created_at?: string
        }
        Update: {
          id?: string
          client_id?: string
          profile_id?: string
          member_role?: Database['public']['Enums']['client_member_role']
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'client_members_client_id_fkey'
            columns: ['client_id']
            isOneToOne: false
            referencedRelation: 'clients'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'client_members_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      leads: {
        Row: {
          id: string
          full_name: string
          email: string
          phone: string | null
          company_name: string | null
          source: string | null
          status: Database['public']['Enums']['lead_status']
          assigned_to: string | null
          converted_client_id: string | null
          message: string | null
          utm_source: string | null
          utm_medium: string | null
          utm_campaign: string | null
          utm_term: string | null
          utm_content: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          full_name: string
          email: string
          phone?: string | null
          company_name?: string | null
          source?: string | null
          status?: Database['public']['Enums']['lead_status']
          assigned_to?: string | null
          converted_client_id?: string | null
          message?: string | null
          utm_source?: string | null
          utm_medium?: string | null
          utm_campaign?: string | null
          utm_term?: string | null
          utm_content?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          full_name?: string
          email?: string
          phone?: string | null
          company_name?: string | null
          source?: string | null
          status?: Database['public']['Enums']['lead_status']
          assigned_to?: string | null
          converted_client_id?: string | null
          message?: string | null
          utm_source?: string | null
          utm_medium?: string | null
          utm_campaign?: string | null
          utm_term?: string | null
          utm_content?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'leads_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'leads_converted_client_id_fkey'
            columns: ['converted_client_id']
            isOneToOne: false
            referencedRelation: 'clients'
            referencedColumns: ['id']
          },
        ]
      }
      contacts: {
        Row: {
          id: string
          client_id: string | null
          lead_id: string | null
          first_name: string
          last_name: string | null
          email: string | null
          phone: string | null
          title: string | null
          is_primary: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          client_id?: string | null
          lead_id?: string | null
          first_name: string
          last_name?: string | null
          email?: string | null
          phone?: string | null
          title?: string | null
          is_primary?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          client_id?: string | null
          lead_id?: string | null
          first_name?: string
          last_name?: string | null
          email?: string | null
          phone?: string | null
          title?: string | null
          is_primary?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'contacts_client_id_fkey'
            columns: ['client_id']
            isOneToOne: false
            referencedRelation: 'clients'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'contacts_lead_id_fkey'
            columns: ['lead_id']
            isOneToOne: false
            referencedRelation: 'leads'
            referencedColumns: ['id']
          },
        ]
      }
      services: {
        Row: {
          id: string
          name: string
          slug: string
          description: string | null
          category: string | null
          base_price: number | null
          is_active: boolean
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
          description?: string | null
          category?: string | null
          base_price?: number | null
          is_active?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          slug?: string
          description?: string | null
          category?: string | null
          base_price?: number | null
          is_active?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          id: string
          client_id: string
          name: string
          status: Database['public']['Enums']['project_status']
          owner_id: string | null
          starts_on: string | null
          ends_on: string | null
          summary: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          client_id: string
          name: string
          status?: Database['public']['Enums']['project_status']
          owner_id?: string | null
          starts_on?: string | null
          ends_on?: string | null
          summary?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          client_id?: string
          name?: string
          status?: Database['public']['Enums']['project_status']
          owner_id?: string | null
          starts_on?: string | null
          ends_on?: string | null
          summary?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'projects_client_id_fkey'
            columns: ['client_id']
            isOneToOne: false
            referencedRelation: 'clients'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'projects_owner_id_fkey'
            columns: ['owner_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      project_services: {
        Row: {
          project_id: string
          service_id: string
        }
        Insert: {
          project_id: string
          service_id: string
        }
        Update: {
          project_id?: string
          service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'project_services_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'project_services_service_id_fkey'
            columns: ['service_id']
            isOneToOne: false
            referencedRelation: 'services'
            referencedColumns: ['id']
          },
        ]
      }
      project_members: {
        Row: {
          project_id: string
          profile_id: string
          created_at: string
        }
        Insert: {
          project_id: string
          profile_id: string
          created_at?: string
        }
        Update: {
          project_id?: string
          profile_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'project_members_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'project_members_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      tasks: {
        Row: {
          id: string
          project_id: string
          title: string
          description: string | null
          status: Database['public']['Enums']['task_status']
          priority: Database['public']['Enums']['task_priority']
          assignee_id: string | null
          due_at: string | null
          completed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          project_id: string
          title: string
          description?: string | null
          status?: Database['public']['Enums']['task_status']
          priority?: Database['public']['Enums']['task_priority']
          assignee_id?: string | null
          due_at?: string | null
          completed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          title?: string
          description?: string | null
          status?: Database['public']['Enums']['task_status']
          priority?: Database['public']['Enums']['task_priority']
          assignee_id?: string | null
          due_at?: string | null
          completed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'tasks_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tasks_assignee_id_fkey'
            columns: ['assignee_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      appointments: {
        Row: {
          id: string
          title: string
          appointment_type: Database['public']['Enums']['appointment_type']
          status: Database['public']['Enums']['appointment_status']
          starts_at: string
          ends_at: string
          timezone: string
          location_or_url: string | null
          host_id: string | null
          client_id: string | null
          lead_id: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          title: string
          appointment_type?: Database['public']['Enums']['appointment_type']
          status?: Database['public']['Enums']['appointment_status']
          starts_at: string
          ends_at: string
          timezone?: string
          location_or_url?: string | null
          host_id?: string | null
          client_id?: string | null
          lead_id?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          title?: string
          appointment_type?: Database['public']['Enums']['appointment_type']
          status?: Database['public']['Enums']['appointment_status']
          starts_at?: string
          ends_at?: string
          timezone?: string
          location_or_url?: string | null
          host_id?: string | null
          client_id?: string | null
          lead_id?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'appointments_host_id_fkey'
            columns: ['host_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'appointments_client_id_fkey'
            columns: ['client_id']
            isOneToOne: false
            referencedRelation: 'clients'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'appointments_lead_id_fkey'
            columns: ['lead_id']
            isOneToOne: false
            referencedRelation: 'leads'
            referencedColumns: ['id']
          },
        ]
      }
      appointment_attendees: {
        Row: {
          id: string
          appointment_id: string
          profile_id: string
          attendance_role: Database['public']['Enums']['attendance_role']
          response_status: Database['public']['Enums']['attendance_response']
          created_at: string
        }
        Insert: {
          id?: string
          appointment_id: string
          profile_id: string
          attendance_role?: Database['public']['Enums']['attendance_role']
          response_status?: Database['public']['Enums']['attendance_response']
          created_at?: string
        }
        Update: {
          id?: string
          appointment_id?: string
          profile_id?: string
          attendance_role?: Database['public']['Enums']['attendance_role']
          response_status?: Database['public']['Enums']['attendance_response']
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'appointment_attendees_appointment_id_fkey'
            columns: ['appointment_id']
            isOneToOne: false
            referencedRelation: 'appointments'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'appointment_attendees_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      files: {
        Row: {
          id: string
          bucket: string
          storage_path: string
          file_name: string
          mime_type: string | null
          size_bytes: number | null
          uploaded_by: string | null
          client_id: string | null
          project_id: string | null
          lead_id: string | null
          report_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          bucket?: string
          storage_path: string
          file_name: string
          mime_type?: string | null
          size_bytes?: number | null
          uploaded_by?: string | null
          client_id?: string | null
          project_id?: string | null
          lead_id?: string | null
          report_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          bucket?: string
          storage_path?: string
          file_name?: string
          mime_type?: string | null
          size_bytes?: number | null
          uploaded_by?: string | null
          client_id?: string | null
          project_id?: string | null
          lead_id?: string | null
          report_id?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'files_client_id_fkey'
            columns: ['client_id']
            isOneToOne: false
            referencedRelation: 'clients'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'files_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'files_lead_id_fkey'
            columns: ['lead_id']
            isOneToOne: false
            referencedRelation: 'leads'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'files_report_id_fkey'
            columns: ['report_id']
            isOneToOne: false
            referencedRelation: 'reports'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'files_uploaded_by_fkey'
            columns: ['uploaded_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      reports: {
        Row: {
          id: string
          client_id: string
          project_id: string | null
          title: string
          report_type: string
          period_start: string | null
          period_end: string | null
          status: Database['public']['Enums']['report_status']
          published_at: string | null
          summary: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          client_id: string
          project_id?: string | null
          title: string
          report_type: string
          period_start?: string | null
          period_end?: string | null
          status?: Database['public']['Enums']['report_status']
          published_at?: string | null
          summary?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          client_id?: string
          project_id?: string | null
          title?: string
          report_type?: string
          period_start?: string | null
          period_end?: string | null
          status?: Database['public']['Enums']['report_status']
          published_at?: string | null
          summary?: string | null
          created_by?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'reports_client_id_fkey'
            columns: ['client_id']
            isOneToOne: false
            referencedRelation: 'clients'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'reports_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'reports_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      notifications: {
        Row: {
          id: string
          recipient_id: string
          title: string
          body: string | null
          type: Database['public']['Enums']['notification_type']
          link_path: string | null
          read_at: string | null
          entity_type: string | null
          entity_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          recipient_id: string
          title: string
          body?: string | null
          type?: Database['public']['Enums']['notification_type']
          link_path?: string | null
          read_at?: string | null
          entity_type?: string | null
          entity_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          recipient_id?: string
          title?: string
          body?: string | null
          type?: Database['public']['Enums']['notification_type']
          link_path?: string | null
          read_at?: string | null
          entity_type?: string | null
          entity_id?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'notifications_recipient_id_fkey'
            columns: ['recipient_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      audit_logs: {
        Row: {
          id: string
          actor_id: string | null
          action: string
          entity_type: string
          entity_id: string | null
          ip_address: string | null
          user_agent: string | null
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          actor_id?: string | null
          action: string
          entity_type: string
          entity_id?: string | null
          ip_address?: string | null
          user_agent?: string | null
          metadata?: Json
          created_at?: string
        }
        Update: {
          id?: string
          actor_id?: string | null
          action?: string
          entity_type?: string
          entity_id?: string | null
          ip_address?: string | null
          user_agent?: string | null
          metadata?: Json
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'audit_logs_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_access_client: { Args: { p_client_id: string }; Returns: boolean }
      is_admin: { Args: Record<string, never>; Returns: boolean }
      is_project_member: { Args: { p_project_id: string }; Returns: boolean }
      is_staff: { Args: Record<string, never>; Returns: boolean }
      is_staff_for_client: { Args: { p_client_id: string }; Returns: boolean }
      user_client_ids: { Args: Record<string, never>; Returns: string[] }
    }
    Enums: {
      app_role: 'admin' | 'employee' | 'client'
      appointment_status: 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'
      appointment_type: 'consultation' | 'audit' | 'check_in' | 'onboarding' | 'other'
      attendance_response: 'pending' | 'accepted' | 'declined' | 'tentative'
      attendance_role: 'host' | 'staff' | 'client' | 'guest'
      client_member_role: 'owner' | 'viewer'
      client_status: 'lead' | 'active' | 'paused' | 'churned'
      lead_status: 'new' | 'contacted' | 'qualified' | 'won' | 'lost'
      notification_type: 'info' | 'success' | 'warning' | 'task' | 'appointment' | 'report' | 'system'
      project_status: 'planned' | 'active' | 'on_hold' | 'completed' | 'cancelled'
      report_status: 'draft' | 'published'
      task_priority: 'low' | 'medium' | 'high' | 'urgent'
      task_status: 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']
export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert']
export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update']
export type Enums<T extends keyof Database['public']['Enums']> =
  Database['public']['Enums'][T]
