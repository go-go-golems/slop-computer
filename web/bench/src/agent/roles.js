// agent/roles.js — the subagents the agent can delegate to.
//
// mode: what the subagent's evals may write (read: nothing; tests:
// scenarios/ and fixtures/; auto: anything). own: it works in a proposal of
// its own. evals: its default budget, taken from the caller's.
//
// Public API: ROLES, MAX_DEPTH.

export const ROLES = {
  explorer: { describe: 'Read-only investigator. Reads code, the dev instance\'s data and frames; answers with evidence and `file:line` links. Cannot write.', mode: 'read', evals: 12 },
  reviewer: { describe: 'Reviews a proposal: reads its diff, renders and checks its frames, runs its scenarios, and returns a verdict. Cannot write.', mode: 'read', evals: 12, output: '{verdict: "approve"|"changes", comments: string}' },
  qa: { describe: 'QA. Runs the scenarios (scenarios.runAll), writes scenarios for important flows that have none (scenarios.save; fixtures.save for edge-case data), sweeps every frame for overflow, contrast, accessibility and console errors, and files a pin on each problem with ui.pin(frameId, target, text). May write only scenarios/ and fixtures/.', mode: 'tests', evals: 16, output: '{pins: number, scenarios: {passed: number, failed: number, added: number}, summary: string}' },
  builder: { describe: 'Builds what it is asked in a proposal of its own (the person reviews it), checks the frames, and summarizes what it changed.', mode: 'auto', own: true, evals: 20 },
}
export const MAX_DEPTH = 2
