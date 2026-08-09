import { useState, useEffect, useCallback, useRef } from "react";
import { getSupabase, isSupabaseReady, type User, type Session } from "@/lib/supabase";

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: "learner" | "vietnamese_teacher" | "foreign_teacher" | "admin";
  phone: string | null;
  avatar_url: string | null;
  created_at: string;
  is_active: boolean;
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clientReady, setClientReady] = useState(false);

  const mountedRef = useRef(true);
  const fetchingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const initClient = async () => {
      let supabase;
      try {
        supabase = getSupabase();
      } catch (err) {
        console.error("Failed to initialize Supabase client:", err);
        if (!cancelled) setLoading(false);
        return;
      }

      if (!isSupabaseReady()) {
        const unsubscribe = waitForReady(() => {
          if (!cancelled) setClientReady(true);
        });
        return () => unsubscribe?.();
      }

      if (!cancelled) setClientReady(true);
    };

    initClient();

    return () => {
      cancelled = true;
    };
  }, []);

  const fetchProfile = useCallback(async (supabaseClient: ReturnType<typeof getSupabase>, userId: string) => {
    if (fetchingRef.current) {
      return null;
    }
    fetchingRef.current = true;

    try {
      for (let attempt = 0; attempt < 12; attempt++) {
        if (attempt > 0) {
          await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
        }

        try {
          const { data, error: profileError } = await supabaseClient
            .from("profiles")
            .select("*")
            .eq("id", userId)
            .maybeSingle();

          if (!profileError && data) {
            if (mountedRef.current) setProfile(data as Profile | null);
            return data as Profile | null;
          }

          const msg = profileError?.message || "";
          if (msg.includes("session") || msg.includes("undefined") || msg.includes("Cannot read")) {
            console.warn(`Profile fetch retry ${attempt + 1}/12: auth lock, backing off...`);
            continue;
          }

          console.error("Error fetching profile:", profileError);
          if (mountedRef.current) setProfile(null);
          return null;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("session") || msg.includes("undefined") || msg.includes("Cannot read")) {
            console.warn(`Profile fetch retry ${attempt + 1}/12: auth lock (catch), backing off...`);
            continue;
          }
          console.error("Profile fetch failed:", err);
          if (mountedRef.current) setProfile(null);
          return null;
        }
      }

      console.warn("Profile fetch: all retries exhausted, auth state never stabilized");
      return null;
    } finally {
      fetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!clientReady) return;

    let cancelled = false;

    const supabase = getSupabase();

    const initSession = async () => {
      try {
        // First attempt — session might not be in localStorage yet if we just signed in
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

        if (cancelled) return;

        if (sessionError) {
          console.error("Session error:", sessionError);
          setLoading(false);
          return;
        }

        let session = sessionData?.session;

        // If no session found, retry once after a short delay (handles race condition
        // where navigation happens before Supabase finishes writing to localStorage)
        if (!session?.user) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          if (cancelled) return;
          const { data: retryData } = await supabase.auth.getSession();
          session = retryData?.session ?? null;
        }

        if (session?.user) {
          setUser(session.user);
          // Don't set loading false until profile is fetched — otherwise
          // AuthGuard renders children before profile is ready, causing
          // downstream queries with profile?.id === undefined
          setTimeout(() => {
            if (!cancelled) {
              fetchProfile(supabase, session.user.id).finally(() => {
                if (!cancelled) setLoading(false);
              });
            }
          }, 200);

          // Safety timeout: if profile fetch hangs, unblock after 5s
          setTimeout(() => {
            if (!cancelled) setLoading(false);
          }, 5000);
        } else {
          if (!cancelled) setLoading(false);
        }
      } catch (err) {
        console.error("Session init error:", err);
        if (!cancelled) setLoading(false);
      }
    };

    initSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (session?.user) {
        setUser(session.user);
        setTimeout(() => {
          fetchProfile(supabase, session.user.id).then(() => {
            if (!cancelled) setLoading(false);
          });
        }, 200);
      } else {
        setUser(null);
        setProfile(null);
        if (!cancelled) setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
  }, [clientReady, fetchProfile]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      setError(null);
      const supabase = getSupabase();
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) {
        setError(signInError.message);
        return { success: false, error: signInError.message };
      }
      if (!data.user || !data.session) {
        setError("Login failed. Please try again.");
        return { success: false, error: "Login failed. Please try again." };
      }
      // Set user immediately so isAuthenticated flips without waiting for onAuthStateChange
      setUser(data.user);
      setLoading(false);
      // Fetch profile in the background — doesn't block navigation
      setTimeout(() => {
        fetchProfile(supabase, data.user.id);
      }, 200);
      return { success: true };
    },
    [fetchProfile]
  );

  const signUp = useCallback(
    async (email: string, password: string, fullName: string) => {
      setError(null);
      const supabase = getSupabase();

      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const basePath = (__BASE_PATH__ as string) || "/";
      const pathPrefix = basePath === "/" ? "" : basePath;
      const redirectTo = `${origin}${pathPrefix}/login`;

      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName, role: "learner" },
          emailRedirectTo: redirectTo,
        },
      });

      if (signUpError) {
        setError(signUpError.message);
        return { success: false, error: signUpError.message };
      }

      if (!data.user) {
        return { success: false, error: "already_registered", email };
      }

      return { success: true, user: data.user };
    },
    []
  );

  const signOut = useCallback(async () => {
    setError(null);
    // 1. Clear React state immediately so UI reflects logout instantly
    setUser(null);
    setProfile(null);

    // 2. Call Supabase signOut with LOCAL scope (no network round-trip)
    //    and race it against a 2s timeout so it can NEVER hang the button.
    //    The global-scope network call is what was freezing the click.
    try {
      const supabase = getSupabase();
      await Promise.race([
        supabase.auth.signOut({ scope: "local" }),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
    } catch (err) {
      // Never block logout on an error — just log it
      console.warn("Sign out call failed (ignored):", err);
    }

    // 3. Guaranteed fallback: purge any Supabase auth tokens from
    //    localStorage so a fresh page load can't find a stale session.
    try {
      if (typeof window !== "undefined") {
        Object.keys(window.localStorage).forEach((key) => {
          if (key.startsWith("sb-") || key.includes("supabase")) {
            window.localStorage.removeItem(key);
          }
        });
      }
    } catch {
      // ignore storage errors
    }

    return { success: true };
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    setError(null);
    const supabase = getSupabase();

    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const basePath = (__BASE_PATH__ as string) || "/";
    const pathPrefix = basePath === "/" ? "" : basePath;
    const redirectTo = `${origin}${pathPrefix}/reset-password`;

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });

    if (resetError) {
      setError(resetError.message);
      return { success: false, error: resetError.message };
    }

    return { success: true };
  }, []);

  const updatePassword = useCallback(async (newPassword: string) => {
    setError(null);
    const supabase = getSupabase();
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (updateError) {
      setError(updateError.message);
      return { success: false, error: updateError.message };
    }

    return { success: true };
  }, []);

  const changePassword = useCallback(
    async (email: string, currentPassword: string, newPassword: string) => {
      setError(null);
      const supabase = getSupabase();
      let verified = false;

      try {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password: currentPassword,
        });

        if (signInError) {
          const msg = signInError.message.toLowerCase();
          if (
            msg.includes("invalid login credentials") ||
            msg.includes("invalid email or password")
          ) {
            return { success: false, error: "wrong_current_password" };
          }
          return { success: false, error: signInError.message };
        }

        if (!data.user || !data.session) {
          return { success: false, error: "wrong_current_password" };
        }

        verified = true;

        const { error: updateError } = await supabase.auth.updateUser({
          password: newPassword,
        });

        if (updateError) {
          setError(updateError.message);
          return { success: false, error: updateError.message };
        }

        return { success: true };
      } finally {
        if (verified) {
          try {
            await Promise.race([
              supabase.auth.signOut({ scope: "local" }),
              new Promise((resolve) => setTimeout(resolve, 2000)),
            ]);
          } catch (err) {
            console.warn("Sign out after password change failed (ignored):", err);
          }

          try {
            if (typeof window !== "undefined") {
              Object.keys(window.localStorage).forEach((key) => {
                if (key.startsWith("sb-") || key.includes("supabase")) {
                  window.localStorage.removeItem(key);
                }
              });
            }
          } catch {
            // ignore storage errors
          }

          setUser(null);
          setProfile(null);
        }
      }
    },
    []
  );

  return {
    user,
    profile,
    loading,
    error,
    signIn,
    signUp,
    signOut,
    resetPassword,
    updatePassword,
    changePassword,
    isAuthenticated: !!user,
  };
}

function waitForReady(onReady: () => void): () => void {
  let cancelled = false;
  let attempts = 0;
  const maxAttempts = 30;

  const check = () => {
    if (cancelled) return;
    if (isSupabaseReady()) {
      onReady();
      return;
    }
    attempts++;
    if (attempts < maxAttempts) {
      setTimeout(check, 200);
    } else {
      onReady();
    }
  };

  setTimeout(check, 100);

  return () => {
    cancelled = true;
  };
}