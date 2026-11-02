# Changelog

## 2026-11-01

- Initial workspace created

## 2026-11-01

Cutover PRs: slop-computer #12 (remove v2), #13 (v3 with history, CI/CD, ZITADEL logout, readyz on pod address, files.cat fix), GitOps draft #406.

## 2026-11-01

Review on #13: views close on access change, catch-up head first, live-host /_s/ sandboxed, runtime cursor and snapshot fixes; actor calls survive a stopping actor (CI failure); merge of main for GitHub's conflict state.

## 2026-11-02

scripts/02-deploy-apps.sh moved to the repository's scripts/deploy-apps.sh (make deploy-apps); it now builds Blocks and Pinup with apps/upstream/*/build*.sh instead of SLOP3-001's 07-build-blocks-pinup.sh.
