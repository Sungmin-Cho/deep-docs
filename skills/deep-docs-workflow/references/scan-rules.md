# Scan Rules — Auto-fix, Authoring, Audit-only

This file fixes classification semantics. Executable discovery and reference facts come from `<plugin-root>/scripts/runtime/scan.js`; semantic evidence is gathered with scanner Read/Glob/Grep only.

## Executable candidate scope

`buildScanContext()` statically discovers:

1. every non-symlink `CLAUDE.md` and `AGENTS.md` outside excluded/state trees;
2. root `README.md`, `CONTRIBUTING.md`, and `ARCHITECTURE.md`;
3. Markdown under `docs/`.

It then calls `filterDocumentCandidatesByGitIgnore()`:

- in HEAD/unborn Git repositories, tracked candidates are retained even if later ignore rules match;
- untracked candidates are sent as NUL-delimited bytes to `git check-ignore --stdin -z`, which applies repository, nested, exclude, and global Git rules;
- unexpected status, unknown returned path, inconsistent records, malformed bytes, or Git disappearance fails closed;
- in the explicit `non-git` or missing-Git fallback, static candidates remain admitted and the runtime does not partially interpret ignore syntax itself.

Every admitted document is rechecked as a regular non-symlink file before reading. Scanner never broadens this set with a second discovery implementation.

## Rule-to-agent mapping

| Rule | Scanner phase | Category |
|---|---|---|
| 1 dead reference | reference validation | auto-fix only with exact evidence |
| 2 moved path | runtime `rename-history` | auto-fix only with exact Git rename record |
| 3 stale example/command | CLI/env semantic validation | conditional auto-fix |
| 4 duplicate instruction | segment-local exact match + translation group | conditional auto-fix |
| 5 size/organization | `documents[].size_lines` | audit-only |
| 6 rule/code contradiction | semantic inference | audit-only |
| 7 coverage gap | semantic inference | audit-only and Rule 9 input |
| 8 map/manual ratio | semantic inference | audit-only |
| 9 missing/thin document | root-only authoring guards | authoring |
| 10 over-constrained instruction | semantic inference | audit-only |
| 11 self-discoverable content | semantic inference | audit-only |

## Auto-fix rules

### 1. Dead reference

A runtime-extracted path, symbol, environment variable, or command is absent from the actual repository facts. Fenced/indented examples were already excluded. Current issue fields are `current_value` and `suggested_value`; emit an auto-fix only when `suggested_value` is exact, otherwise emit audit-only evidence.

### 2. Moved path

For a normalized dead path, call `rename-history` through the shared runtime. It uses argv-only Git rename records and returns an empty history for Git-missing, non-Git, and unborn roots. An exact returned successor permits auto-fix. Empty or ambiguous history never permits a guessed replacement.

### 3. Stale example/command

Use `<plugin-root>/skills/deep-docs-workflow/references/scan-filters/cli-whitelist.md`, `ScanContextV1.package_scripts`, and repository configuration evidence. A missing exact project script with a known replacement can be auto-fixed. Unknown future/system commands, code examples without an exact replacement, and ambiguous environment variables are audit-only.

### 4. Duplicate instruction

Use `splitNonFencedSegments()` output and exact 3-line-or-longer windows that stay within one prose segment. An exact block outside a common `translation_group` can be auto-fixed. Translation-family repetition and merely similar blocks are audit-only.

## Audit-only rules

### 5. Size/organization

Strict warning boundaries are CLAUDE/AGENTS `>100`, README `>300`, other docs `>200`. Organization requires structural judgment and is never an automatic split.

### 6. Rule/code contradiction

Report sampled contradictory patterns with evidence. Inference and false-positive risk forbid automatic mutation.

### 7. Coverage gap

Report important modules not represented in documentation. Retain `uncovered_modules[]` for Rule 9; do not scan twice or convert the report itself into an edit.

### 8. Map/manual ratio

Report direct-instruction versus external-pointer proportions without a target score.

### 10. Over-constrained instruction

Emitted as issue `type` `over-constraint`.

Applies only to `CLAUDE.md` and `AGENTS.md`, at the root and nested. `README.md`, `CONTRIBUTING.md`, `ARCHITECTURE.md`, and Markdown under `docs/` are human-facing and are never candidates for this rule.

Two evidence families qualify.

- **Style absolutes**, severity low. An absolute imperative — never, always, 절대, 반드시, 금지 — applied to comment density, naming, formatting, documentation length, or code length, where model judgement is the better mechanism. The recommendation is a judgement-oriented rewrite.
- **Behavioural sequencing**, severity medium. An "always do Y before X" rule. Prose does not guarantee it and harness-level enforcement does, so severity is higher: the instruction is not merely excessive, it is unreliable. State the recommendation host-neutrally as harness-level enforcement; Claude Code's mechanism is a PreToolUse hook, which is a Claude Code-specific concept and must not be prescribed inside an `AGENTS.md` finding.

Absolutes covering security, credentials, data loss, destructive operations, external contracts, protocol or schema compatibility, and licensing are legitimate and are never reported. Report nothing when the area is unclear. The failure this rule must avoid is recommending that a genuine safety rule be relaxed, not missing an over-constrained sentence.

### 11. Self-discoverable content

Emitted as issue `type` `self-discoverable`. Findings carry severity `low`.

The same document scope as Rule 10 applies: `CLAUDE.md` and `AGENTS.md` only.

Report a block only when it restates a fact the runtime already holds — `ScanContextV1.package_scripts`, a build manifest's declared dependencies, or the directory tree reachable by Glob — and carries no judgement information. A listing that says which option to choose, or why, is retained. Stated as one test: keep it when a "why" or a "which one" is attached.

The judged unit is a heading together with the fenced block it introduces, and the evidence is the prose outside that fence. Fence contents are not parsed as individual references, so the existing fenced/indented exclusion is unchanged. A heading followed only by a fence is reported; a fence whose surrounding prose says which command to use, or why, is not.

### Common issue fields for rules 10 and 11

Neither rule is ever auto-fixable. A judgement-oriented rewrite and the removal of a self-discoverable passage are both authorial work rather than an exact substitution, exactly as splitting a document is for `size-warning`. Emit no `suggested_value` on either type.

Fix `line` to the first line of the reported span and `current_value` to the verbatim excerpt of that span, so a repeated scan of an unchanged document reports the same position and excerpt.

## Authoring rule

### 9. Missing/thin root document

Only root `CLAUDE.md`, `AGENTS.md`, and `ARCHITECTURE.md` qualify. The default management policy is AGENTS-first single source (authoring-rules D13): shared agent instructions live in `AGENTS.md`, and `CLAUDE.md` is a thin wrapper holding an `@AGENTS.md` import plus Claude Code-specific content only.

- Missing AGENTS requires a recognized build manifest and a source directory, or an existing root `CLAUDE.md` (whose shared content becomes the migration source, stated in the rationale); severity medium.
- Missing CLAUDE requires both a recognized build manifest and a source directory; severity medium. The create skeleton is the thin wrapper when `AGENTS.md` exists or a missing-doc AGENTS gap is emitted in the same scan, otherwise the standalone full skeleton.
- Missing ARCHITECTURE requires approximately 10k or more source lines; severity high.
- Thin documents are conservative, and the qualifying evidence now depends on the doc kind. For `architecture-md`, a required-section deficit meeting the authoring-rule threshold still qualifies, because its skeleton is unchanged and structure is that document's purpose. For `claude-md` and `agents-md`, whose skeletons make sections optional under authoring-rules D14, a missing section is not by itself a thin-doc reason and only Rule 7's `uncovered_modules[] / total_modules` meeting its threshold qualifies. Severity low to medium. Additionally, a root `CLAUDE.md` that lacks the `@AGENTS.md` import while carrying shared runtime instructions is a thin-doc restructure candidate (D13 wrapper deficit) when `AGENTS.md` exists or a missing-doc AGENTS gap is emitted in the same scan; the evidence states the missing import.
- A Git-ignored target is excluded. Monorepo package-local targets are deferred to v2.
- `missing-doc` requires `exists: false` and `mode: "create"`.
- `thin-doc` requires `exists: true` and `mode: "restructure"`.
- `doc_kind` must map exactly to the root target allowlist.

Scanner emits only a `payload.gaps[]` authoring specification. Drafting is read-only `doc-author` work; approved replacement is guarded by `authoring-baseline` then `authoring-commit`. Garden processes an `AGENTS.md` gap before a `CLAUDE.md` gap from the same snapshot (D13 ordering), so the `@AGENTS.md` import never points at a rejected or absent document.

## Stable output contract

- Document issues remain in `payload.documents[].issues[]`.
- Authoring gaps remain in `payload.gaps[]` and do not increment `summary.total_issues`.
- Categories remain the auto-fix / authoring / audit-only trichotomy.
- Envelope schema `"1.0"` and last-scan payload schema `"1.1"` remain unchanged.
