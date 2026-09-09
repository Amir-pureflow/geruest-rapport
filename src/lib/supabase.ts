import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Ohne Schrägstrich am Ende — sonst entstehen beim Anhängen doppelte Slashes. */
export const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/+$/, '');
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** null, solange .env fehlt — die App läuft dann im lokalen Offline-Modus. */
export const supabase: SupabaseClient | null =
  supabaseUrl && key ? createClient(supabaseUrl, key) : null;
