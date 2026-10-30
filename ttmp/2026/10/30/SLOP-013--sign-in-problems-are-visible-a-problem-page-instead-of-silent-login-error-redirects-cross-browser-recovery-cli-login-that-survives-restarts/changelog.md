# Changelog

## 2026-10-30

- Initial workspace created

## 2026-10-30

Ticket created; intern guide written (OIDC and device flows, why failures are silent, problem page, destination recovery via login_flows.return_path, logging, CLI transient retries); diary step 1.

### Related Files

- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/ttmp/2026/10/30/SLOP-013--sign-in-problems-are-visible-a-problem-page-instead-of-silent-login-error-redirects-cross-browser-recovery-cli-login-that-survives-restarts/design-doc/01-intern-guide-sign-in-device-login-and-their-failures.md — The guide

## 2026-10-30

Uploaded the intern guide to reMarkable: /ai/2026/10/30/SLOP-013/SLOP-013 Sign-in problems intern guide.pdf (remarquee: OK: uploaded).

## 2026-10-30

Implemented phases 1-3 (5141af5): problem page with destination recovery and logging; CLI waits through 5xx/429, hints, renews on expiry; device page message; docs. Tests and mutation check pass; lint clean.
