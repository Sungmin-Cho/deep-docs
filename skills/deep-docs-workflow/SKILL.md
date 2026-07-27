---
name: deep-docs-workflow
description: |
  deep-docs 워크플로우 계약 — 런타임 경계, `references/` 색인, scan/garden/audit 불변식.
user-invocable: false
---

# Deep Docs Workflow

The normative scan/garden/audit procedure is `skills/deep-docs/SKILL.md`, which `/deep-docs` loads; read this file alongside it. This file holds the runtime boundary, the reference index, and the invariants that hold across all three subcommands.

## Runtime boundary

Deterministic discovery, Git, timestamp, hash, envelope, baseline, and atomic mutation belong to `scripts/deep-docs-runtime.js` and `scripts/runtime/`. Resolve `<plugin-root>` from the loaded skill, not from the target cwd or an environment variable.

`scan-context --root "<target-root>"` creates an absent state directory through the shared guarded Node path and returns `ScanContextV1`. Every other command takes a direct JSON request basename under `.deep-docs/`: `rename-history`, `reuse`, `emit`, `authoring-baseline`, `authoring-commit`, `signature`, `garden-ignore`, and `scan-invalidate`.

The host must not directly write garden-ignored.json or delete last-scan.json. There is no direct-write fallback after a runtime error.

## References

- `references/scan-rules.md`: fixed classification, root-only authoring guards, and scanner mapping.
- `references/audit-metrics.md`: score definitions over Node-produced fields.
- `references/scan-filters/`: executable Node source/field mappings and edge contracts.
- `references/authoring-rules/`: CLAUDE/AGENTS/ARCHITECTURE skeletons and the cross-document rules.

## Invariants

- Scanner writes are bounded to `.deep-docs/`; discovered project documents are read-only to it. It classifies semantically and calls `emit`; it never hand-builds an artifact.
- Author is read/search-only on every host and returns `{ draft_body, preserved_blocks, removal_candidates }`. Baseline capture precedes author dispatch; whole-draft approval precedes `authoring-commit`; the host performs no second write or patch.
- Garden and audit both consume one frozen artifact/revision pair per session. `reuse` validates `envelope.producer === "deep-docs"`, `envelope.artifact_kind === "last-scan"`, `envelope.schema.name === "last-scan"`, `schema_version === "1.0"`, and `envelope.schema.version === "1.1"` before Git, TTL, path-check, HEAD, and worktree facts; a false result means the newly emitted pair is frozen instead.
- State transitions run only through the guarded commands: `signature` then `garden-ignore` for a recorded skip, and `scan-invalidate` exactly once per mutating session. A session with no applied edit and no authoring commit does not invalidate.
- Envelope `schema_version` stays `"1.0"` and the last-scan payload schema stays `"1.1"`. Do not change size/freshness thresholds, root-only missing/thin guards, or the auto-fix/authoring/audit-only trichotomy.
- Audit never mutates project documents or state artifacts, and audit-only findings are never silently promoted to edits.
