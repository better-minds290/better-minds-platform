import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY as string;

let supabaseInstance: ReturnType<typeof createClient> | null = null;

export function getSupabase() {
  if (!supabaseInstance) {
    if (!supabaseUrl || !supabaseAnonKey) {
      console.error(
        "Supabase environment variables are missing. Please connect Supabase in the Readdy dashboard."
      );
      throw new Error(
        "Supabase configuration missing. Connect Supabase to continue."
      );
    }

    supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storage: typeof window !== "undefined" ? window.localStorage : undefined,
      },
    });
  }

  return supabaseInstance;
}

export function isSupabaseReady(): boolean {
  if (!supabaseInstance) return false;
  try {
    return !!(supabaseInstance as Record<string, unknown>).auth;
  } catch {
    return false;
  }
}

export type { User, Session } from "@supabase/supabase-js";