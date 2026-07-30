# deep-docs — Agent Guide

Document gardening plugin for agent-instruction files and project docs: `scan` finds drift,
`garden` repairs it under user approval, `audit` scores it.

Ownership is split, and the split is load-bearing. The runtime
(`<plugin-root>/scripts/deep-docs-runtime.js` and `<plugin-root>/scripts/runtime/`) owns every guarded state transition:
Git and filesystem inspection, hashing, timestamps, envelope construction and validation, the
authoring baseline, and the atomic replacement of `last-scan.json`, `garden-ignored.json`, and
any authored document. The host and its agents own semantic classification, user approval, the
bounded request JSON handed to the runtime, and applying approved auto-fix edits to ordinary
project documents. Neither side substitutes for the other: a runtime error is a visible failure
with no direct-filesystem fallback, and the host never hand-writes or deletes a runtime-owned
artifact.

Supported runtime: Node.js 22 on native Windows, macOS, and Linux. Git is optional; Git Bash
and Python are not required.

Version: `node -p "JSON.parse(require('fs').readFileSync('<plugin-root>/.claude-plugin/plugin.json','utf8')).version"` — history in `CHANGELOG.md` / `CHANGELOG.ko.md`.

> 📄 Documentation in this repo follows `docs/DOCS_RULE.md` (local maintainer guide — single-source-of-truth rules for README / CHANGELOG / this file). It is gitignored, so an installed plugin ships with nothing there: never try to open it at runtime, because the only place that path can resolve in an installed plugin is the project being analysed.

## Surfaces

Dual manifests, `<plugin-root>/.claude-plugin/plugin.json` and `<plugin-root>/.codex-plugin/plugin.json` (the latter alone
carries `skills: "./skills/"`), over one entry skill (`<plugin-root>/skills/deep-docs/SKILL.md`), one contract skill
with its `references/` (`<plugin-root>/skills/deep-docs-workflow/`), and two agents. `<plugin-root>/agents/doc-author.md` is
read/search only and must never be granted terminal, write, edit or apply-patch capability on
any host.

Claude Code entry is `/deep-docs scan|garden|audit`; Codex uses `$deep-docs:deep-docs <sub>`
with generic subagents that read the agent definitions as their execution contract. An empty
argument asks which operation to run — never infer the mutating `garden`.

`.deep-docs/` output belongs to the **target** project, not to this repo, unless it is a
committed test fixture.

## `last-scan.json` — the cross-plugin contract

Advertised to the suite as `.deep-docs/last-scan.json`. The identity consumers match on:

- top-level `schema_version` — the envelope wrapper, string `"1.0"`, never numeric
- `envelope.producer` `"deep-docs"`, `envelope.artifact_kind` `"last-scan"`,
  `envelope.schema` `{ name: "last-scan", version: "1.1" }` — the payload schema version, which
  is deliberately distinct from the wrapper version
- `envelope.producer_version` is read from `<plugin-root>/.claude-plugin/plugin.json` at emit time; never put
  a version literal in an agent definition
- `payload.provenance.worktree_hash` — 40-hex SHA-1, or `"no-git"`

`<plugin-root>/scripts/validate-envelope-emit.js` is the executable contract for the rest (ULID `run_id`,
RFC 3339 `generated_at`, git block, gap shape, summary cross-check). It gates every `emit` and
runs standalone as `npm run validate:envelope`.

**Summary counting.** `total_issues` / `auto_fixable` / `audit_only` count
`payload.documents[].issues[]` only; `authoring` is `payload.gaps[].length`. Gaps are not
issues — that split is what keeps the downstream dashboard metric stable, and an emit that
conflates them fails.

**Conditional field.** `payload.provenance.path_check_enabled` is emitted only when the
cli-whitelist PATH check was explicitly enabled. Always emitting or always omitting breaks the
reuse guard: a config toggle must invalidate the artifact, and silent omission hides that drift.

## Reuse guard

`reuse` accepts an existing `last-scan.json` only when all of these hold:

1. envelope identity, `schema_version "1.0"`, and `envelope.schema.version "1.1"`
2. the target root is a Git repository — non-Git sessions always re-scan
3. `envelope.generated_at` is within the last 10 minutes and not in the future (the TTL is on
   the recorded timestamp, not on file mtime)
4. `path_check_enabled` matches the current invocation
5. `envelope.git.head` matches current HEAD
6. `payload.provenance.worktree_hash` matches a fresh recomputation

Condition 1 runs the full envelope validation, which includes the
`producer_version === plugin.json.version` equality check — so **releasing a new plugin version
invalidates every cached artifact**, and the first `garden` or `audit` after a bump always
re-scans. That is intended: a version bump can change how a payload is classified.

The hash construction, its `.deep-docs` exclusion and the full edge matrix are in
`<plugin-root>/skills/deep-docs-workflow/references/scan-filters/worktree-hash.md`; the implementation is
`evaluateReuse` and `hashRepositoryProjection` under `<plugin-root>/scripts/runtime/`. Those two, this file,
and both `SKILL.md` files change together.

A reusable result is an artifact snapshot **plus** its `artifact_revision` — freeze that exact
pair for the whole session, and freeze the newly emitted pair instead whenever reuse is refused.

## Garden

- The prompt is four options then two, because `AskUserQuestion` caps `options.maxItems` at 4:
  apply / skip / skip-and-record / Batch, then batch-apply or batch-reject.
- `garden-ignored.json` is runtime-owned: take the value from the `signature` command and append
  through `garden-ignore`. Never hand-compute or hand-merge it, and never Read it to pre-filter
  the prompt list — it is untrusted target-project state, and no guarded lookup command exists
  yet. Re-recording is harmless: `garden-ignore` deduplicates on signature and returns
  `added: false` without touching the file.
- After at least one applied document edit or authoring commit, call `scan-invalidate` exactly
  once with the frozen `artifact_revision`. `matched` invalidated that snapshot; `changed` means
  a newer artifact superseded it and is preserved; `absent` is idempotent success.
- Authoring goes `authoring-baseline` → read-only `doc-author` draft → per-removal approval →
  whole-draft approval → `authoring-commit`, and never a second host write. The baseline is the
  raw-byte `sha256:<64 lowercase hex>` digest in Git, non-Git and missing-Git modes, re-verified
  immediately before the atomic replacement. `authoring-commit` also enforces the root-only
  target allowlist, the symlink and Git-ignore boundary, and the AGENTS.md 32 KiB UTF-8 ceiling.

## Classification

Three categories that never merge. **auto-fix** — an exact `current → suggested` substitution
shown as a diff. **authoring** — a missing or thin root document, carried in `payload.gaps[]`;
a whole-document draft, never a substitution pair. **audit-only** — anything needing human
judgement, never mutated. Anything without an exact replacement is demoted to audit-only, and
`size-warning` is never auto-fixable because splitting a document is structural judgement
rather than substitution. The per-rule membership, thresholds and evidence bars are in
`<plugin-root>/skills/deep-docs-workflow/references/scan-rules.md`.

**Target-project doc policy (D13, AGENTS-first single source).** Shared instructions belong in
the target's `AGENTS.md`; its `CLAUDE.md` is a thin `@AGENTS.md` wrapper carrying Claude
Code-specific content only. Garden processes `AGENTS.md` gaps before `CLAUDE.md` gaps, and the
import is inserted only when `AGENTS.md` already exists or was committed in the same session, so
it never points at a rejected document. Skeletons are in
`<plugin-root>/skills/deep-docs-workflow/references/authoring-rules/`.

## Portability invariants

- Resolve the plugin root from `import.meta.url` — never from the target cwd, never from a
  required environment variable.
- Resolve target roots to their physical absolute path and preserve native Windows drive, UNC,
  Unicode and space-containing forms. Artifact child paths stay forward-slash and
  repository-relative.
- Runtime and verification entry points invoke no shell, PowerShell, `cmd`, Python, or
  platform-specific utility.
- Pre-existing symlink and junction escapes are rejected, and physical parents are revalidated
  immediately before path-based I/O. The accepted same-user syscall-window residual and the
  safe-cleanup boundary are documented in `SECURITY.md`.
- Node 22+, `"type": "module"`, zero runtime dependencies in `scripts/`.

## Verification

```bash
npm test
npm run validate:envelope
npm run validate:codex
npm run verify:fixes
```

All four must be green before merge and `verify:fixes` must report `Failed: 0`. It is a
structural lint that pins literal strings inside this file, `CLAUDE.md`, both `SKILL.md` files
and both agent definitions, so a failure there usually means a doc edit dropped a contract
sentence rather than that the code broke. `npm run validate:codex` is the enforceable Codex
manifest contract; the upstream official Codex `validate_plugin.py`, when installed, is an
advisory maintainer-only check that may be absent and is not part of the plugin runtime or the
cross-platform test suite.

## Release

The version literal lives in eight files: the three manifests (`<plugin-root>/.claude-plugin/plugin.json`,
`<plugin-root>/.codex-plugin/plugin.json`, `package.json`, kept equal by `verify:fixes`), the four
`<plugin-root>/tests/fixtures/sample-last-scan*.json` `producer_version` fields, and the `release train`
test in `<plugin-root>/tests/plugin-contract.test.js`. Bump all eight together, add the entry to both
CHANGELOG files, and keep release notes out of this file.

Re-pinning the marketplace is the suite repo's job, not a hand-edit here: from
`claude-deep-suite`, run `npm run release:bump -- deep-docs <sha40>`, which regenerates the
docs and runs `preflight` as its own gate. It writes only the Claude marketplace manifest in
that repo — the Codex mirror manifest there still needs a manual sync. Both live in
`claude-deep-suite`, never here.
