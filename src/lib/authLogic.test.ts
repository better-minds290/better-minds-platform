import {
  getRedirectPath,
  restoreSessionWithRetry,
  shouldApplySessionUser,
  shouldClearAuthOnEvent,
  shouldIgnoreAuthEvent,
  shouldRedirectToLogin,
  shouldRefetchProfileForAuthEvent,
  shouldShowAccessRestricted,
  shouldShowAuthLoading,
  shouldShowDeactivated,
  shouldSilentlyRefreshSessionUser,
  type AuthGuardInput,
} from "./authLogic";

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(value: boolean, label: string) {
  if (!value) throw new Error(`${label}: expected true, got false`);
}

function assertFalse(value: boolean, label: string) {
  if (value) throw new Error(`${label}: expected false, got true`);
}

const baseGuard: AuthGuardInput = {
  initialized: true,
  user: { id: "u1" },
  profile: { role: "learner", is_active: true },
  profileLoading: false,
};

// 1. Initial unauthenticated load → initialize then redirect
assertFalse(shouldRedirectToLogin({ ...baseGuard, initialized: false, user: null }), "uninit: no redirect");
assertTrue(shouldShowAuthLoading({ ...baseGuard, initialized: false, user: null }), "uninit: show loading");
assertTrue(
  shouldRedirectToLogin({ ...baseGuard, initialized: true, user: null, profile: null }),
  "initialized unauthenticated: redirect"
);

// 2. Initial persisted authenticated session → profile loads, protected page renders
assertFalse(shouldRedirectToLogin(baseGuard), "authenticated: no redirect");
assertFalse(shouldShowAuthLoading(baseGuard), "authenticated ready: no loading");
assertTrue(
  shouldShowAuthLoading({
    initialized: true,
    user: { id: "u1" },
    profile: null,
    profileLoading: true,
    allowedRoles: ["learner"],
  }),
  "first profile load on protected route: block"
);

// 3. Login → profile loads, dashboard renders (same as first load + ready state)
assertFalse(
  shouldShowAuthLoading({
    initialized: true,
    user: { id: "u1" },
    profile: { role: "learner", is_active: true },
    profileLoading: false,
    allowedRoles: ["learner"],
  }),
  "after login with profile: render dashboard"
);

// Post-login init must not redirect during initialization
assertTrue(
  shouldShowAuthLoading({
    initialized: false,
    user: { id: "u1" },
    profile: null,
    profileLoading: true,
    allowedRoles: ["learner"],
  }),
  "post-login init: loading not redirect"
);
assertFalse(
  shouldRedirectToLogin({
    initialized: false,
    user: { id: "u1" },
    profile: null,
    profileLoading: true,
    allowedRoles: ["learner"],
  }),
  "post-login init: no redirect"
);

// 4. Same user TOKEN_REFRESHED → no blocking profile loading / AuthGuard spinner
assertFalse(
  shouldShowAuthLoading({
    ...baseGuard,
    profileLoading: true,
  }),
  "TOKEN_REFRESHED background: AuthGuard stays mounted when profile exists"
);
assertTrue(
  shouldSilentlyRefreshSessionUser({
    event: "TOKEN_REFRESHED",
    currentUserId: "u1",
    nextUserId: "u1",
    hasLoadedProfile: true,
  }),
  "same-user TOKEN_REFRESHED with profile: silent refresh"
);

// 5. Same-user TOKEN_REFRESHED with existing profile → no redundant profile fetch
assertFalse(
  shouldRefetchProfileForAuthEvent({
    event: "TOKEN_REFRESHED",
    currentUserId: "u1",
    nextUserId: "u1",
    hasLoadedProfile: true,
  }),
  "TOKEN_REFRESHED same user: skip profile refetch"
);

// 6. Auth event with DIFFERENT user → must load new profile
assertFalse(
  shouldSilentlyRefreshSessionUser({
    event: "TOKEN_REFRESHED",
    currentUserId: "u1",
    nextUserId: "u2",
    hasLoadedProfile: true,
  }),
  "different user: not silent"
);
assertTrue(
  shouldRefetchProfileForAuthEvent({
    event: "SIGNED_IN",
    currentUserId: "u1",
    nextUserId: "u2",
    hasLoadedProfile: true,
  }),
  "different user sign-in: refetch profile"
);
assertTrue(
  shouldShowAuthLoading({
    initialized: true,
    user: { id: "u2" },
    profile: null,
    profileLoading: true,
    allowedRoles: ["admin"],
  }),
  "different user first profile: block until loaded"
);

// 7. Genuine SIGNED_OUT → clears auth
assertTrue(shouldClearAuthOnEvent("SIGNED_OUT"), "SIGNED_OUT clears");
assertFalse(shouldApplySessionUser("SIGNED_OUT", null), "SIGNED_OUT does not apply user");
assertTrue(
  shouldRedirectToLogin({ ...baseGuard, initialized: true, user: null, profile: null }),
  "after sign-out: redirect to login"
);

// 8. Background profile refresh with existing profile → protected content remains mounted
assertFalse(
  shouldShowAuthLoading({
    initialized: true,
    user: { id: "u1" },
    profile: { role: "admin", is_active: true },
    profileLoading: true,
    allowedRoles: ["admin"],
  }),
  "background refresh with profile: keep content mounted"
);

// 9. First-ever profile load on role-protected route → still waits
assertTrue(
  shouldShowAuthLoading({
    initialized: true,
    user: { id: "u1" },
    profile: null,
    profileLoading: true,
    allowedRoles: ["learner"],
  }),
  "first profile load: AuthGuard blocks"
);
assertFalse(
  shouldShowAuthLoading({
    initialized: true,
    user: { id: "u1" },
    profile: null,
    profileLoading: false,
    allowedRoles: ["learner"],
  }),
  "user without profile and not loading: do not block forever"
);

// TOKEN_REFRESHED without profile yet → still needs profile fetch
assertFalse(
  shouldSilentlyRefreshSessionUser({
    event: "TOKEN_REFRESHED",
    currentUserId: "u1",
    nextUserId: "u1",
    hasLoadedProfile: false,
  }),
  "TOKEN_REFRESHED without profile: not silent"
);
assertTrue(
  shouldRefetchProfileForAuthEvent({
    event: "TOKEN_REFRESHED",
    currentUserId: "u1",
    nextUserId: "u1",
    hasLoadedProfile: false,
  }),
  "TOKEN_REFRESHED without profile: refetch"
);

// INITIAL_SESSION ignored
assertTrue(shouldIgnoreAuthEvent("INITIAL_SESSION"), "ignore INITIAL_SESSION");
assertFalse(shouldClearAuthOnEvent("INITIAL_SESSION"), "INITIAL_SESSION does not clear");
assertFalse(shouldApplySessionUser("INITIAL_SESSION", null), "INITIAL_SESSION null ignored");

// Profile loading must not misclassify role
assertFalse(
  shouldShowAccessRestricted({
    ...baseGuard,
    profile: null,
    profileLoading: true,
    allowedRoles: ["admin"],
  }),
  "profile loading: no access restricted yet"
);

// Role redirects
assertEqual(getRedirectPath("learner"), "/dashboard", "learner redirect");
assertEqual(getRedirectPath("vietnamese_teacher"), "/teacher/dashboard", "vn teacher redirect");
assertEqual(getRedirectPath("foreign_teacher"), "/teacher/dashboard", "foreign teacher redirect");
assertEqual(getRedirectPath("admin"), "/admin/dashboard", "admin redirect");

// Deactivated account
assertTrue(
  shouldShowDeactivated({ ...baseGuard, profile: { role: "learner", is_active: false } }),
  "deactivated detected"
);
assertFalse(shouldShowDeactivated(baseGuard), "active account not deactivated");

// Wrong role access restricted
assertTrue(
  shouldShowAccessRestricted({
    ...baseGuard,
    profile: { role: "learner", is_active: true },
    allowedRoles: ["admin"],
  }),
  "wrong role restricted"
);

// Session restore retry finds session on later attempt
{
  let calls = 0;
  const session = restoreSessionWithRetry(async () => {
    calls += 1;
    if (calls < 3) {
      return { data: { session: null }, error: null };
    }
    return {
      data: { session: { user: { id: "u-retry" } } as never },
      error: null,
    };
  }, [0, 0, 0]);

  void session.then((result) => {
    assertEqual(!!result?.user, true, "restore retry finds session");
    assertEqual(calls, 3, "restore retry attempt count");
  });
}

// Session restore with no session completes deterministically
{
  let calls = 0;
  const session = restoreSessionWithRetry(async () => {
    calls += 1;
    return { data: { session: null }, error: null };
  }, [0, 0]);

  void session.then((result) => {
    assertEqual(result, null, "restore returns null when no session");
    assertEqual(calls, 2, "restore exhausts attempts");
  });
}

console.log("authLogic.test.ts: all assertions passed");
