import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * Null, solange .env nicht gesetzt ist — die App (und vor allem die
 * Offline-Erfassung) muss auch ohne Supabase-Projekt laufen.
 */
export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;
