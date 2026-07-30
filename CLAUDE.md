@AGENTS.md

# deep-docs — Claude Code notes

`AGENTS.md` above is the single source for every shared contract: the `last-scan.json`
envelope, the reuse guard, garden and authoring flow, classification, portability invariants,
verification and release. Only Claude Code-specific notes belong here.

Sub-agents are dispatched as `Task(subagent_type="deep-docs:doc-scanner")` and
`Task(subagent_type="deep-docs:doc-author")`. Codex spawns generic subagents that read
`<plugin-root>/agents/doc-scanner.md` / `<plugin-root>/agents/doc-author.md` instead, with the same capability limits.
Both routes are specified in `<plugin-root>/skills/deep-docs/SKILL.md`; keep them in step.

## Facts this file must keep

`<plugin-root>/scripts/verify-fixes.js` and `<plugin-root>/tests/plugin-contract.test.js` require the following in
**both** guides, so they are stated here as well as in `AGENTS.md` — do not delete them as
duplicates.

- Supported runtime is Node.js 22 on native Windows, macOS, and Linux.
- Read the version with
  `node -p "JSON.parse(require('fs').readFileSync('<plugin-root>/.claude-plugin/plugin.json','utf8')).version"`.
- 📄 Documentation in this repo follows `docs/DOCS_RULE.md` (local maintainer guide —
  single-source-of-truth rules for README / CHANGELOG / this file). It is gitignored, so an
  installed plugin ships with nothing there: never try to open it at runtime, because the
  only place that path can resolve in an installed plugin is the project being analysed.
- `npm run validate:codex` is the enforceable Codex manifest contract. The upstream official
  Codex `validate_plugin.py`, when installed, is an advisory maintainer-only check
  that may be absent; it is not part of the plugin runtime or the cross-platform test suite.
