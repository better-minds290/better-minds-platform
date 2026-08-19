import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getSupabase, isSupabaseReady, type User } from "@/lib/supabase";
import {
  restoreSessionWithRetry,
  shouldApplySessionUser,
  shouldClearAuthOnEvent,
  shouldIgnoreAuthEvent,
  shouldSilentlyRefreshSessionUser,
} from "@/lib/authLogic";

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

export interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  /** True while initial session restoration OR profile fetch for current user is in progress. */
  loading: boolean;
  /** True once the first session restoration pass has completed. */
  initialized: boolean;
  /** True while profile is being fetched for the current authenticated user. */
  profileLoading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signUp: (
    email: string,
    password: string,
    fullName: string
  ) => Promise<{ success: boolean; error?: string; email?: string; user?: User }>;
  signOut: () => Promise<{ success: boolean }>;
  resetPassword: (email: string) => Promise<{ success: boolean; error?: string }>;
  updatePassword: (newPassword: string) => Promise<{ success: boolean; error?: string }>;
  changePassword: (
    email: string,
    currentPassword: string,
    newPassword: string
  ) => Promise<{ success: boolean; error?: string }>;
  isAuthenticated: boolean;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

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

function purgeSupabaseStorage(): void {
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
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientReady, setClientReady] = useState(false);

  const mountedRef = useRef(true);
  const profileRequestRef = useRef(0);
  const activeUserIdRef = useRef<string | null>(null);
  const profileRef = useRef<Profile | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  useEffect(() => {
    let cancelled = false;

    const initClient = () => {
      try {
        getSupabase();
      } catch (err) {
        console.error("Failed to initialize Supabase client:", err);
        if (!cancelled) {
          setInitialized(true);
        }
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

  const fetchProfileForUser = useCallback(
    async (supabaseClient: ReturnType<typeof getSupabase>, userId: string) => {
      const requestId = ++profileRequestRef.current;
      activeUserIdRef.current = userId;

      if (mountedRef.current) {
        setProfileLoading(true);
      }

      try {
        for (let attempt = 0; attempt < 12; attempt++) {
          if (requestId !== profileRequestRef.current || activeUserIdRef.current !== userId) {
            return null;
          }

          if (attempt > 0) {
            await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
          }

          try {
            const { data, error: profileError } = await supabaseClient
              .from("profiles")
              .select("*")
              .eq("id", userId)
              .maybeSingle();

            if (requestId !== profileRequestRef.current || activeUserIdRef.current !== userId) {
              return null;
            }

            if (!profileError && data) {
              if (mountedRef.current) {
                setProfile(data as Profile);
              }
              return data as Profile;
            }

            const msg = profileError?.message || "";
            if (msg.includes("session") || msg.includes("undefined") || msg.includes("Cannot read")) {
              console.warn(`Profile fetch retry ${attempt + 1}/12: auth lock, backing off...`);
              continue;
            }

            console.error("Error fetching profile:", profileError);
            if (mountedRef.current) {
              setProfile(null);
            }
            return null;
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("session") || msg.includes("undefined") || msg.includes("Cannot read")) {
              console.warn(`Profile fetch retry ${attempt + 1}/12: auth lock (catch), backing off...`);
              continue;
            }
            console.error("Profile fetch failed:", err);
            if (mountedRef.current) {
              setProfile(null);
            }
            return null;
          }
        }

        console.warn("Profile fetch: all retries exhausted, auth state never stabilized");
        return null;
      } finally {
        if (requestId === profileRequestRef.current && mountedRef.current) {
          setProfileLoading(false);
        }
      }
    },
    []
  );

  const applyAuthenticatedUser = useCallback(
    async (supabaseClient: ReturnType<typeof getSupabase>, nextUser: User) => {
      activeUserIdRef.current = nextUser.id;
      if (mountedRef.current) {
        setUser(nextUser);
      }
      await fetchProfileForUser(supabaseClient, nextUser.id);
    },
    [fetchProfileForUser]
  );

  const clearAuthState = useCallback(() => {
    profileRequestRef.current += 1;
    activeUserIdRef.current = null;
    if (mountedRef.current) {
      setUser(null);
      setProfile(null);
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!clientReady) return;

    let cancelled = false;
    const supabase = getSupabase();

    const initAuth = async () => {
      try {
        const session = await restoreSessionWithRetry(async () => {
          const result = await supabase.auth.getSession();
          return {
            data: { session: result.data.session },
            error: result.error as Error | null,
          };
        });

        if (cancelled) return;

        if (session?.user) {
          await applyAuthenticatedUser(supabase, session.user);
        }
      } catch (err) {
        console.error("Session init error:", err);
      } finally {
        if (!cancelled && mountedRef.current) {
          setInitialized(true);
        }
      }
    };

    initAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;

      if (shouldIgnoreAuthEvent(event)) {
        return;
      }

      if (shouldClearAuthOnEvent(event)) {
        clearAuthState();
        return;
      }

      if (shouldApplySessionUser(event, session) && session?.user) {
        const nextUser = session.user;
        const hasLoadedProfile =
          profileRef.current !== null && activeUserIdRef.current === nextUser.id;

        if (
          shouldSilentlyRefreshSessionUser({
            event,
            currentUserId: activeUserIdRef.current,
            nextUserId: nextUser.id,
            hasLoadedProfile,
          })
        ) {
          activeUserIdRef.current = nextUser.id;
          if (mountedRef.current) {
            setUser(nextUser);
          }
          return;
        }

        void applyAuthenticatedUser(supabase, nextUser);
      }
    });

    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
  }, [clientReady, applyAuthenticatedUser, clearAuthState]);

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

      await applyAuthenticatedUser(supabase, data.user);
      return { success: true };
    },
    [applyAuthenticatedUser]
  );

  const signUp = useCallback(async (email: string, password: string, fullName: string) => {
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
  }, []);

  const signOut = useCallback(async () => {
    setError(null);
    clearAuthState();

    try {
      const supabase = getSupabase();
      await Promise.race([
        supabase.auth.signOut({ scope: "local" }),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
    } catch (err) {
      console.warn("Sign out call failed (ignored):", err);
    }

    purgeSupabaseStorage();
    return { success: true };
  }, [clearAuthState]);

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

          purgeSupabaseStorage();
          clearAuthState();
        }
      }
    },
    [clearAuthState]
  );

  const loading = !initialized || profileLoading;

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      loading,
      initialized,
      profileLoading,
      error,
      signIn,
      signUp,
      signOut,
      resetPassword,
      updatePassword,
      changePassword,
      isAuthenticated: !!user,
    }),
    [
      user,
      profile,
      loading,
      initialized,
      profileLoading,
      error,
      signIn,
      signUp,
      signOut,
      resetPassword,
      updatePassword,
      changePassword,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
