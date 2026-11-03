# Tasks

## TODO
- [x] Write the intern guide (sign-in, device login, failures, design) <!-- t:3n17 -->
- [x] Phase 1: signInProblems, signInFailed, sign-in-problem template, LoginFlowReturn; login and callback render instead of redirecting; tests with a fake IdP <!-- t:i5jd -->
- [x] Phase 2: pollDevice treats 5xx/429 as transient; hint line; offer a new code on expiry when interactive; tests <!-- t:e31k -->
- [x] Phase 3: device page message for wrong codes; help text; manual check on the cluster (signed-out browser, finish elsewhere) <!-- t:loyb -->
- [x] After deploy: manual check on the cluster (open the device link in a signed-out browser, finish in another; expect the problem page and Continue to the approval form). Closed as obsolete: that deploy was v2; v3's sign-in problem page is pkg/doors/auth (signInFailed); v2's code was removed in #12 (SLOP3-004 cutover, 2026-11-03). <!-- t:k629 -->
