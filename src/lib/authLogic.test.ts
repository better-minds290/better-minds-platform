import {
  getRedirectPath,
  restoreSessionWithRetry,
  shouldApplySessionUser,
  shouldClearAuthOnEvent,
  shouldIgnoreAuthEvent,
  shouldRedirectToLogin,
  shouldShowAccessRestricted,
  shouldShowAuthLoading,
  shouldShowDeactivated,
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

// 1. Fresh unauthenticated visit → redirect only after initialization
assertFalse(shouldRedirectToLogin({ ...baseGuard, initialized: false, user: null }), "uninit: no redirect");
assertTrue(shouldShowAuthLoading({ ...baseGuard, initialized: false, user: null }), "uninit: show loading");
assertTrue(
  shouldRedirectToLogin({ ...baseGuard, initialized: true, user: null, profile: null }),
  "initialized unauthenticated: redirect"
);

// 2. Successful auth state → no redirect
assertFalse(shouldRedirectToLogin(baseGuard), "authenticated: no redirect");
assertFalse(shouldShowAuthLoading(baseGuard), "authenticated ready: no loading");

// 3. Protected route after login must not redirect during initialization
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

// 4. Persisted session restore path (user present, profile loading)
assertTrue(
  shouldShowAuthLoading({
    initialized: true,
    user: { id: "u1" },
    profile: null,
    profileLoading: true,
    allowedRoles: ["learner"],
  }),
  "profile loading with roles: wait"
);

// 5. INITIAL_SESSION null must not clear auth (handled by ignoring event)
assertTrue(shouldIgnoreAuthEvent("INITIAL_SESSION"), "ignore INITIAL_SESSION");
assertFalse(shouldClearAuthOnEvent("INITIAL_SESSION"), "INITIAL_SESSION does not clear");
assertFalse(shouldApplySessionUser("INITIAL_SESSION", null), "INITIAL_SESSION null ignored");

// 6. Genuine SIGNED_OUT clears auth
assertTrue(shouldClearAuthOnEvent("SIGNED_OUT"), "SIGNED_OUT clears");
assertFalse(shouldApplySessionUser("SIGNED_OUT", null), "SIGNED_OUT does not apply user");

// 7. Profile loading must not misclassify role
assertFalse(
  shouldShowAccessRestricted({
    ...baseGuard,
    profile: null,
    profileLoading: true,
    allowedRoles: ["admin"],
  }),
  "profile loading: no access restricted yet"
);

// 8–10. Role redirects
assertEqual(getRedirectPath("learner"), "/dashboard", "learner redirect");
assertEqual(getRedirectPath("vietnamese_teacher"), "/teacher/dashboard", "vn teacher redirect");
assertEqual(getRedirectPath("foreign_teacher"), "/teacher/dashboard", "foreign teacher redirect");
assertEqual(getRedirectPath("admin"), "/admin/dashboard", "admin redirect");

// 11. Deactivated account
assertTrue(
  shouldShowDeactivated({ ...baseGuard, profile: { role: "learner", is_active: false } }),
  "deactivated detected"
);
assertFalse(shouldShowDeactivated(baseGuard), "active account not deactivated");

// 12. Wrong role access restricted
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
