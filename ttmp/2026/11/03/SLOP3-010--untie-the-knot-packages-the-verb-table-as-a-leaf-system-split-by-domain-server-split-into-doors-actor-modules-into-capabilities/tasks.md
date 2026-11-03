# Tasks

## TODO
- [x] PR 1: the verb table as a leaf — pkg/verbs imports only core; commands move to pkg/commands; verbs.Table; Run without Env; five allowlist entries removed (guide Part 7) <!-- t:6tkk -->
- [x] PR 2: system.db split by domain — pkg/sysdb plus identity, registry, policy, llm ledger, billing; domain commands move to their domains; access.Directory resolves access -> system (guide Part 8) <!-- t:kbpu -->
- [x] PR 3: pkg/server split into doors — pkg/host assembly; doors/{web,auth,api,mcp,pages,actors,billing,office}; no door imports another (guide Part 9) <!-- t:3t42 -->
- [ ] PR 4: actor modules into capabilities — caps/{files,sql,room,storage}; JS bindings in doors/actors; actor.Module; pkg/actor is the runtime only (guide Part 10) <!-- t:9bc6 -->
