---
name: deep-docs
description: Scan, garden, or audit a project's agent-instruction documents. Triggers on `/deep-docs`, "scan documents", "garden CLAUDE.md", "audit docs", "document health", "stale docs", "문서 정비", "문서 스캔", "문서 감사", "문서 가드닝".
user-invocable: true
---

# deep-docs — Document Gardening

에이전트 지침 문서의 건강 상태를 scan, garden, audit 합니다. 결정적 파일시스템·Git·envelope 작업의 단일 진실원본은 `<plugin-root>/scripts/deep-docs-runtime.js`와 `<plugin-root>/scripts/runtime/`입니다.

## Host routing (mandatory)

Resolve `<plugin-root>` from this loaded skill's location; do not derive it from the target project's cwd and do not require an environment variable. Invoke runtime commands as `node "<plugin-root>/scripts/deep-docs-runtime.js" ...`.

| Work | Claude Code | Codex |
|---|---|---|
| scan / automatic re-scan | `Task(subagent_type="deep-docs:doc-scanner", ...)` | Spawn a generic subagent whose first action is to read `<plugin-root>/agents/doc-scanner.md` and treat it as the execution contract. Grant read/search, terminal limited to the quoted Node runtime command, and writes to `<target-root>/.deep-docs/` only. |
| authoring draft | `Task(subagent_type="deep-docs:doc-author", ...)` | Spawn a generic subagent whose first action is to read `<plugin-root>/agents/doc-author.md` and treat it as the execution contract. Grant read/search only, no terminal, no write, edit, or apply-patch capability, and require the same structured result. |

If generic subagents are unavailable, execute the loaded definition inline with the same capability limits and disclose the degraded dispatch. Never silently grant `doc-author` terminal or mutation capability. Preserve baseline-before-author ordering and whole-draft approval in every host.

## Runtime ownership (mandatory)

- `scan-context --root "<target-root>"` performs physical-root validation, creates an absent `.deep-docs/` only through the shared Node mkdir-then-lstat guard, and returns deterministic discovery, reference, timestamp, Git, package-script, dirty-path, and worktree facts.
- All other commands consume an exact JSON request basename under `<target-root>/.deep-docs/` via `--request <basename>`.
- `emit` owns version lookup, envelope construction and validation, atomic replacement of `last-scan.json`, and the returned `artifact_revision`.
- `reuse`, `authoring-baseline`, `authoring-commit`, `signature`, `garden-ignore`, and `scan-invalidate` are the only supported operations for their corresponding state transitions.
- The host must not directly write garden-ignored.json or delete last-scan.json.
- Runtime errors are visible failures. Do not replace them with a direct filesystem fallback.

## Inputs

`scan`, `garden`, or `audit` is the single subcommand; an empty or unknown argument requires the user to choose one of the three, and a mutating garden is never inferred from it. `<target-root>` is the target project's requested root, never the plugin installation root.

## `/deep-docs scan`

1. Run the quoted Node runtime command with `scan-context --root "<target-root>"`. Add `--path-check-enabled` only when the user explicitly opts into host-dependent executable lookup.
2. Dispatch `doc-scanner` through the mandatory host-routing table. Pass the immutable `ScanContextV1`, `<target-root>`, `<plugin-root>`, and the exact quoted runtime command. The scanner uses Read/Glob/Grep for semantic classification and follows `<plugin-root>/skills/deep-docs-workflow/references/scan-rules.md`.
3. The scanner writes only `.deep-docs/scan-payload-request.json`, then invokes `emit --root "<target-root>" --request scan-payload-request.json`. Consume the returned artifact and `artifact_revision`; never synthesize envelope fields in prose.
4. Report the three categories without conflation: auto-fix issues and audit-only issues both live in `payload.documents[].issues[]` under their own `category`, and authoring items live in `payload.gaps[]`.

An empty document set is not an early exit. The scanner still evaluates root-only missing-doc guards for `CLAUDE.md`, `AGENTS.md`, and `ARCHITECTURE.md`; if no guard is met, report that no recommended document qualifies.

## Shared reuse contract for garden and audit

1. Write a bounded request containing `artifact_path: ".deep-docs/last-scan.json"` and the literal `path_check_enabled` flag only when enabled, then call `reuse` through the quoted Node runtime. The runtime validates `envelope.producer === "deep-docs"`, `envelope.artifact_kind === "last-scan"`, `envelope.schema.name === "last-scan"`, `schema_version === "1.0"`, `envelope.schema.version === "1.1"`, and `envelope.producer_version` equal to the installed plugin version — so a release invalidates every cached artifact — before Git, TTL, path-check, HEAD, and worktree facts.
2. A reusable result supplies both an immutable artifact snapshot and its `artifact_revision`. Freeze that exact payload/revision pair for the entire session.
3. Any `{ "reusable": false }` response dispatches the scanner route. Consume the newly emitted artifact and revision rather than retaining the rejected artifact.
4. Non-Git reuse intentionally returns false; after re-scan, garden still freezes the new payload/revision pair for the current session.

## `/deep-docs garden`

### Issue decisions

Process only auto-fix issues as edits. `size-warning`, rule/code contradictions, coverage gaps, map/manual observations, `over-constraint`, and `self-discoverable` remain audit-only.

Do not Read `.deep-docs/garden-ignored.json` to pre-filter the prompt list. It is untrusted target-project state, and no guarded lookup command exists yet — a `garden-ignore-check` route is planned for a later release. Recording an already-recorded issue is harmless in the meantime: `garden-ignore` deduplicates on signature and returns `added: false` without changing the file.

For each auto-fix issue, show the proposed diff and use the canonical 4+2 choice flow:

- A: apply this issue;
- B: skip once;
- C: skip and record;
- Batch: ask a second two-option question, D apply the remaining same-type issues or E skip them.

Batch covers the issue that triggered it plus every remaining actionable issue of the same type in this session — it is not filtered by any prior ignore record. D/E state is in-memory for this invocation only. A/D project-document edits remain owned by the main garden session. C is never a direct state write: call `signature` with the exact issue fields, then pass that exact result plus source fields to `garden-ignore`. A mutation failure must remain visible.

### Authoring decisions

Process gaps AGENTS-first (authoring-rules D13): handle an `AGENTS.md` gap before a `CLAUDE.md` gap from the same frozen snapshot. A `CLAUDE.md` draft may carry the `@AGENTS.md` import and migration removals only when `AGENTS.md` already exists or its authoring commit succeeded earlier in this session; if the `AGENTS.md` gap was rejected, the `CLAUDE.md` draft uses the standalone skeleton without the import. When authoring `AGENTS.md` while a root `CLAUDE.md` exists, attach that document's content to the `doc-author` prompt as the migration source.

For every frozen `payload.gaps[]` item, keep the following order:

1. Before dispatching `doc-author`, call `authoring-baseline` with the exact root-only `{ target_path, mode, doc_kind }`. This captures create absence or restructure bytes through the runtime.
2. Dispatch `doc-author` through the mandatory host-routing table. It returns `{ draft_body, preserved_blocks, removal_candidates }` and cannot mutate anything.
3. Ask separately about every removal candidate. Reinsert every unapproved removal at its anchor, defaulting to preservation.
4. Verify every `preserved_blocks` value occurs in the final draft. Show the whole final draft for approval in both create and restructure modes. A rejection performs no mutation.
5. Only after approval call `authoring-commit` with the original baseline, final draft, preserved blocks, and doc kind. The runtime immediately revalidates the baseline, target allowlist, symlink/ignore boundary, and the AGENTS.md UTF-8 32 KiB ceiling before atomic replacement.
6. The host session must not perform a second Write or patch of that document.
7. For an optional authoring-gap C decision, obtain `signature` and call `garden-ignore` exactly as for an issue.

Cross-document pointers and the `@AGENTS.md` import are added only when their target already exists or was approved and committed in this same session. The default coexistence policy is AGENTS-first single source: `AGENTS.md` holds shared instructions and `CLAUDE.md` keeps only the import plus Claude Code-specific content. Symlink coexistence is not used.

### Completion and invalidation

If at least one A/D project-document edit or one `authoring-commit` succeeded, call `scan-invalidate` exactly once with the frozen snapshot's `artifact_revision`:

- `matched`: that exact snapshot was invalidated;
- `changed`: preserve the newer artifact and report that it superseded the session snapshot;
- `absent`: idempotent success.

A session containing only B/C/E decisions does not invalidate the scan. The host never unlinks the artifact directly.

Show audit-only items after the actionable flow; do not silently promote them to edits.

## Garden-ignore schema contract

The runtime owns `garden-ignored.json` at schema version 1 and computes each record's `signature` as `sha256:<64 lowercase hex>` over the issue `type`, `path`, and the first 200 Unicode code points of `content_preview`. For missing-doc use the doc kind as preview; for thin-doc use the existing document's first 200 code points. Obtain the value from the `signature` command and append it through `garden-ignore` — never hand-compute the digest or hand-merge the file.

## `/deep-docs audit`

1. Obtain and freeze a snapshot through the shared reuse contract; automatic re-scan uses the scanner host route.
2. Use `documents[].size_lines`, `last_modified_epoch`, and `references` from the Node-produced context plus scanner-classified issue counts. Do not reimplement filesystem or Git measurements in the host.
3. Apply `<plugin-root>/skills/deep-docs-workflow/references/audit-metrics.md` exactly: size, freshness, reference accuracy, duplication, map/manual ratio, and the unscored context-efficiency axis. Average only measurable scored metrics and round to one decimal place; the map/manual ratio and the context-efficiency axis are displayed but never averaged.
4. Report per-document values, the overall band, recommendations, and audit-only observations. Audit never mutates project documents or state artifacts.

## Schema invariants

Top-level envelope `schema_version` remains `"1.0"`; last-scan payload schema remains `"1.1"`. Do not change scoring thresholds, gap guards, the category trichotomy, or schema versions in this workflow. The per-rule membership of auto-fix, authoring, and audit-only is fixed by `<plugin-root>/skills/deep-docs-workflow/references/scan-rules.md`; an issue without an exact `suggested_value` is demoted to audit-only rather than promoted.
