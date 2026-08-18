import type { Session } from "@supabase/supabase-js";

export type ProfileRole = "learner" | "vietnamese_teacher" | "foreign_teacher" | "admin";

export type AuthGuardProfile = {
  role: ProfileRole;
  is_active?: boolean;
};

export type AuthGuardInput = {
  initialized: boolean;
  user: unknown | null;
  profile: AuthGuardProfile | null;
  profileLoading: boolean;
  allowedRoles?: ProfileRole[];
};

/** Bounded backoff delays (ms) before each getSession attempt during cold start. */
export const SESSION_RESTORE_DELAYS_MS = [0, 100, 200, 400, 800] as const;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function restoreSessionWithRetry(
  getSession: () => Promise<{ data: { session: Session | null }; error: Error | null }>,
  delays: readonly number[] = SESSION_RESTORE_DELAYS_MS
): Promise<Session | null> {
  for (let i = 0; i < delays.length; i++) {
    if (delays[i] > 0) {
      await sleep(delays[i]);
    }
    const { data, error } = await getSession();
    if (error) {
      throw error;
    }
    if (data.session?.user) {
      return data.session;
    }
  }
  return null;
}

export function getRedirectPath(role: ProfileRole): string {
  switch (role) {
    case "learner":
      return "/dashboard";
    case "vietnamese_teacher":
    case "foreign_teacher":
      return "/teacher/dashboard";
    case "admin":
      return "/admin/dashboard";
    default:
      return "/dashboard";
  }
}

export function shouldShowAuthLoading(input: AuthGuardInput): boolean {
  if (!input.initialized) {
    return true;
  }
  if (input.user && input.allowedRoles?.length && input.profileLoading) {
    return true;
  }
  return false;
}

export function shouldRedirectToLogin(input: AuthGuardInput): boolean {
  return input.initialized && !input.user;
}

export function shouldShowDeactivated(input: AuthGuardInput): boolean {
  return !!input.profile && input.profile.is_active === false;
}

export function shouldShowAccessRestricted(input: AuthGuardInput): boolean {
  if (!input.profile || !input.allowedRoles?.length) {
    return false;
  }
  return !input.allowedRoles.includes(input.profile.role);
}

/** Whether an auth listener event should clear user/profile state. */
export function shouldClearAuthOnEvent(event: string): boolean {
  return event === "SIGNED_OUT" || event === "USER_DELETED";
}

/** Whether an auth listener event should be ignored (init handles it). */
export function shouldIgnoreAuthEvent(event: string): boolean {
  return event === "INITIAL_SESSION";
}

/** Whether an auth listener event should apply session user to state. */
export function shouldApplySessionUser(event: string, session: Session | null): boolean {
  if (shouldIgnoreAuthEvent(event) || shouldClearAuthOnEvent(event)) {
    return false;
  }
  return !!session?.user;
}
