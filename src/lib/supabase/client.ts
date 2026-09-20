import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

/**
 * Creates a browser-safe Supabase client.
 * Pass the publishable anon key only — never the service-role key.
 */
export function createPulseSupabaseClient(
  url: string,
  anonKey: string
): SupabaseClient<Database> {
  if (!url || !anonKey) {
    throw new Error('Supabase URL and anon key are required')
  }
  return createClient<Database>(url, anonKey)
}

export type { Database }
