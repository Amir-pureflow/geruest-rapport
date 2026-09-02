import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** null, solange .env fehlt — die App läuft dann im lokalen Offline-Modus. */
export const supabase: SupabaseClient | null =
  supabaseUrl && key ? createClient(supabaseUrl, key) : null;
