// Reference integrity for the instruction surfaces this plugin ships.
//
// Ported from the deep-work / deep-goal guards of the same name. Two things
// about this repo shape the port, and both are load-bearing rather than
// cosmetic:
//
//   1. The sources are ESM (`package.json#type: module`), so this file is too.
//   2. The anchor is a DOCUMENTATION PLACEHOLDER, `<plugin-root>`, which the
//      agent substitutes while reading prose. Nothing in either host's
//      environment expands it. The repo states its derivation rule itself, in
//      skills/deep-docs/SKILL.md: "Resolve `<plugin-root>` from this loaded
//      skill's location; do not derive it from the target project's cwd."
//
// Because of (2) the shell-expansion clause of the reference implementation is
// deliberately NOT ported. That clause answers "will the shell expand this
// anchor here?" — a question with no subject in a repo where no shell ever sees
// the anchor. A rule that cannot fire is worse than an absent one: it still
// reads as coverage. What replaces it is the structural expanded-root rule at
// the bottom of this file, which asks whether ANY path takes its root from
// something a shell or JS would expand, and so bans the shell spelling of the
// anchor without enumerating spellings of it.
//
// Fence balance is checked because a `references/` split once truncated a
// fenced template mid-block in a sibling: the entry kept the opening ``` and
// the first dozen lines, the remainder moved behind a conditional pointer, and
// nothing failed. An odd fence count is the machine-detectable signature.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync,
  rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep, win32 } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ALWAYS_LOADED = ['AGENTS.md', 'CLAUDE.md'];

// The instruction surfaces: everything a skill or agent definition can load,
// plus the two always-loaded agent guides.
const SCANNED_DIRS = ['skills', 'agents'];

function markdownFiles() {
  const out = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.md')) out.push(p);
    }
  };
  for (const d of SCANNED_DIRS) walk(join(ROOT, d));
  // The always-loaded agent guides are instruction surfaces under the same
  // rule. `ALWAYS_LOADED` is asserted to be in the scan set by its own test, so
  // dropping it here fails loudly instead of silently shrinking coverage.
  for (const doc of ALWAYS_LOADED) {
    const p = join(ROOT, doc);
    if (existsSync(p)) out.push(p);
  }
  return out;
}

// Every `.md` under the scanned directories — the documents an attacker would
// want to shadow. A bare Read(`scan-rules.md`) names one of these with no basis
// at all, so it resolves against cwd, which is the target workspace.
const PLUGIN_DOCS = (() => {
  const names = new Set();
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.md')) names.add(entry.name);
    }
  };
  for (const d of SCANNED_DIRS) walk(join(ROOT, d));
  return names;
})();

// Workspace-shadow guard.
//
// A bare `Read references/scan-rules.md` or `node scripts/deep-docs-runtime.js`
// resolves against the *target workspace*, not the plugin — and this plugin's
// whole job is to run inside a project it did not write. A repository under
// analysis can put a file at that path and have it read as instructions or run
// with the caller's Bash permissions.
//
// Parent-relative forms (`../scan-filters/cli-whitelist.md`) are just as
// shadowable. A markdown link resolves against the source file, but a runtime
// read has no such basis — it resolves against cwd. So this guard must NOT
// reuse the reference-integrity resolution at the bottom of this file:
// integrity asks "does this file exist?" and may resolve relative to the
// source; the shadow guard asks "does this instruction name a trustworthy
// basis?", and only an explicit plugin-root anchor does.
//
// Two clauses, both required for every instruction form:
//   A. anchoring   — the path names the plugin root explicitly.
//   B. containment — the resolved path stays inside the plugin root.
// Clause B is not implied by A: `<plugin-root>/../workspace/evil.md` carries
// the anchor and still escapes.
//
// Scope: paths the plugin tells an agent to *open or run*. For `.js`/`.sh` that
// is every mention — naming an executable is only useful for running it — so
// those are checked wherever they appear. A descriptive cross-reference to a
// `.md` in prose is not a load instruction, but deny-by-default below does not
// try to tell the two apart: any token resolving to a real plugin file must be
// anchored regardless of the sentence around it.
//
// SEPARATORS. Windows is a supported host — `.github/workflows/ci.yml` runs the
// suite on windows-latest under both pwsh and cmd — so
// `scripts\deep-docs-runtime.js` names the same file as
// `scripts/deep-docs-runtime.js`. A matcher that knows only `/` lets the whole
// deny-by-default invariant be bypassed with one character; measured in a
// sibling, the slash form produced seven failures and the backslash form none.
//
// The fix is not to teach each matcher a second shape — that leaves the mixed
// form (`scripts\lib/x.js`) open and re-opens on the next rule added. Instead
// every extracted token is normalised once, at tokenisation, so deny-by-default,
// the FORMS, bare-basename and containment all judge one canonical spelling
// without being taught anything. Runs of separators collapse together, so an
// escaped `scripts\\x.js` in a string literal normalises to the same path.
// Over-normalising is the safe direction here: a token only matters once it
// resolves to a real file in the plugin, and prose containing a stray backslash
// resolves to nothing.
const SEP = String.raw`[\\/]`;
const normalizePath = (token) => token.replace(/[\\/]+/g, '/');

// SHIPPED FILE INDEX.
//
// The authority is `git ls-files`, and the reason is specific to how this plugin
// is installed: the marketplace fetches the repository at a pinned commit
// (`source.sha` in deep-suite's marketplace.json), so what a user gets is the
// TRACKED TREE — there is no npm pack step and `package.json` declares no
// `files` array to consult. Anything gitignored therefore cannot exist in an
// installed plugin, which is exactly the property the maintainer-only sweep at
// the bottom of this file depends on.
//
// Deriving from git rather than walking the filesystem removes a whole class of
// divergence a sibling measured the hard way: a directory-skip walk let 348 of
// 673 index keys come from gitignored directories present only on a maintainer's
// machine, so what deny-by-default could see differed between a checkout and
// CI — with CI on the lax side.
//
// `toKey` and `tracked` are seams, not switches: each defaults to the production
// derivation and turns nothing off. They exist so a POSIX runner can build the
// index the way a Windows host spells it and then drive the real lookup against
// it. A source-text assertion can only pin the spelling of a call; these make
// both sides of the comparison behaviourally decidable.
const repoKey = (from, to, rel = relative) => normalizePath(rel(from, to));

function trackedFiles() {
  const out = execFileSync('git', ['-C', ROOT, 'ls-files', '-z'], { encoding: 'utf8' });
  const files = out.split('\0').filter(Boolean);
  // A zero here would read exactly like a clean index and silence every rule
  // underneath. Fail loudly instead.
  assert.ok(files.length > 0, 'git ls-files returned nothing — the shipped index has no source');
  return files;
}

function buildPluginFiles({ toKey = (p) => repoKey(ROOT, p), tracked = trackedFiles() } = {}) {
  const rel = new Set();
  for (const gitPath of tracked) {
    // Normalise the KEY as well as the lookup. `relative()` returns backslashes
    // on Windows, so a raw key set and a normalised lookup are two different
    // spellings and every `has()` misses — which makes deny-by-default report
    // nothing and the guard pass while a violation is present. Silently green is
    // the worst failure mode a guard has, and ci.yml runs windows-latest.
    rel.add(normalizePath(toKey(join(ROOT, gitPath))));
  }
  return rel;
}

const PLUGIN_FILES = buildPluginFiles();

// Directory names a path can be rooted at, DERIVED from the shipped tree rather
// than listed. Every enumeration in this guard's history — command verbs, prefix
// characters, fixture plant lists, exempt languages, variable names — proved
// fail-open, and a hand-written directory list is the same defect: it covers the
// directories someone remembered on the day it was written. Asking the tree
// means a new shipped directory is covered the moment it exists.
//
// Longest-first so the alternation cannot settle for a prefix of a longer name.
const PLUGIN_DIRS = (() => {
  const dirs = new Set();
  for (const key of PLUGIN_FILES) {
    const parts = key.split('/');
    for (let i = 0; i < parts.length - 1; i += 1) dirs.add(parts[i]);
  }
  return [...dirs]
    .sort((a, b) => b.length - a.length)
    .map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
})();

const ANCHOR = String.raw`<plugin-root>`;
const ANCHORED_TOKEN = new RegExp(`^(?:${ANCHOR})/`);
const PATH_BODY = String.raw`[A-Za-z0-9._/\\${'{}'}|$<>-]+`;
const REL = String.raw`\.{1,2}${SEP}`;
// A match must not start mid-token. `.deep-docs/` is this plugin's workspace
// output root and `deep-docs/` is a shipped skill directory, so without this the
// executable-token FORM reads `.deep-docs/hook.js` as an unanchored plugin path
// and flags the one directory whose whole contract is to resolve against the
// analysed project. Negative lookbehind rather than a list of allowed leading
// characters, for the same reason the maintainer-only sweep uses one: every
// character nobody thought of is otherwise a bypass.
//
// It belongs only on the FORM that scans free text. The other three are anchored
// to a verb and match contiguously after it, so a lookbehind there can never
// change a verdict — measured: adding it to all four and then deleting it from
// the three killed no test, which is the signature of a clause that cannot fire.
const NOT_MID_TOKEN = String.raw`(?<![A-Za-z0-9._/\\{}<>$-])`;
const ANY_ROOT = String.raw`(?:(?:${ANCHOR})${SEP}|${REL}|(?:${PLUGIN_DIRS})${SEP})`;

// Each pattern captures the path token in group 1, so anchoring and containment
// are judged per token rather than per line — a line mixing an anchored and a
// bare path must still fail on the bare one.
// Extensions are asked of the shipped index, not listed. The listed version missed
// what the plugin actually ships: deep-wiki ships a `.py`, and all three ship a
// `.yml` that no list held. A new file type added tomorrow joins these sets by
// existing, which is the point.
const SHIPPED_EXTS = [...new Set([...PLUGIN_FILES]
  .map((k) => (k.match(/\.([A-Za-z0-9]+)$/) || [])[1]).filter(Boolean))].sort();
// For "is this token an instruction to RUN something", the list is INVERTED. Naming
// the executable extensions is fail-open — the extension nobody thought of is
// silently inert. Naming the inert ones is fail-closed: an unfamiliar extension is
// treated as runnable and gets flagged, and the cost of being wrong is a review
// conversation instead of a miss.
const INERT_EXTS = new Set(['md', 'mdx', 'json', 'jsonl', 'yaml', 'yml', 'toml', 'txt',
  'csv', 'tsv', 'lock', 'html', 'css', 'xml', 'map', 'snap', 'png', 'svg', 'gif', 'ico',
  'gitkeep', 'gitignore', 'gitattributes', 'nvmrc', 'editorconfig']);
const EXEC_EXTS = SHIPPED_EXTS.filter((e) => !INERT_EXTS.has(e));
// The EXISTENCE sweep deliberately takes ANY extension. Deriving it from what the repo
// ships made it blind exactly where the reference is certainly broken: an anchored
// `…/missing-config.toml` went unchecked BECAUSE no `.toml` is shipped. The derived set
// earns its keep in EXECUTABLE_EXT below, where the question is "would this be run".
const RESOLVABLE_EXT = SHIPPED_EXTS.join('|');
const EXECUTABLE_EXT = EXEC_EXTS.join('|');

// One list, used by both rules that decide "is this token in command position".
// They had drifted: `BARE_EXEC_BASENAME` accepted `deno` and `bun`, `interpreter-exec`
// did not, in this same file — so `bun scripts/missing-tool` was silent while
// `bun missing-tool.js` was caught. This is still an enumeration and still fail-open on
// the interpreter nobody added; sharing it does not settle that, it only stops the two
// halves from disagreeing about the same question.
const INTERPRETERS = 'bash|sh|zsh|node|python3?|deno|bun|npx|pnpm|yarn|tsx|ts-node';
const FORMS = [
  // 1. interpreter exec: `node X`, `bash X`, `sh X`, `python X`
  ['interpreter-exec', new RegExp(String.raw`\b(?:${INTERPRETERS})\s+["'\`]?(${ANY_ROOT}${PATH_BODY})`, 'g')],
  // 2. read verb: `Read X`, `Follow X`. Korean pointer phrasings ("…를 읽는다")
  //    are covered by deny-by-default below; this catches the English verbs.
  ['read-verb', new RegExp(String.raw`\b(?:Read|Follow|read|follow)\s*\(?\s*["'\`]?(${ANY_ROOT}${PATH_BODY}\.md)`, 'g')],
  // 3. direct exec / source
  ['direct-exec', new RegExp(String.raw`(?:\b(?:source|exec)\s+|^\s*\.\s+)["'\`]?(${ANY_ROOT}${PATH_BODY})`, 'gm')],
  // 4. executable path token anywhere.
  //    The trailing boundary matters: without it `.js` matches the prefix of
  //    `plugin.json` and the guard reports a file that does not exist.
  ['executable-token', new RegExp(String.raw`${NOT_MID_TOKEN}((?:${ANCHOR})${SEP}|${REL}|(?:${PLUGIN_DIRS})${SEP})([A-Za-z0-9._/\\-]*\.(?:${EXECUTABLE_EXT})(?![A-Za-z0-9]))`, 'g')],
];

// DENY BY DEFAULT.
//
// Enumerating instruction syntaxes is the losing half of the problem — each
// round of the original review found a form outside the current allowlist:
// execution paths, parent-relative reads, traversal, unscanned root files, bare
// basenames, a JSON attachment. So the question is not "is this a known
// instruction syntax?" but "does this token resolve to a real file in the
// plugin?". Anything that does must be anchored, whatever the verb, extension or
// sentence around it — which covers `.json`, `.yaml`, extensionless scripts and
// assets that do not exist yet, without another form list. Anything that does
// not resolve is prose about the target project and passes.
//
// The class this structurally cannot see is a path under a gitignored directory,
// which never resolves in the plugin at all. That is handled by the
// maintainer-only sweep at the bottom, not by luck.

// Single-segment root metadata named descriptively. This plugin's entire subject
// matter is the *target project's* `CLAUDE.md` / `AGENTS.md` / `package.json`,
// so a bare mention of one is the intended reading and not a plugin path at all.
// Multi-segment paths get no such pass.
//
// Compared case-insensitively, and that is not cosmetic. macOS and Windows fold
// case, so `agents.md` — how these documents name the agents.md *standard* — is
// the same file as the planted root `AGENTS.md` in the malicious-workspace
// fixture. Measured: with a case-sensitive exemption that fixture reported three
// landings on macOS and would report none on Linux, for the same documents. A
// guard whose verdict depends on the runner's filesystem is the same divergence
// the git-derived index exists to remove, and ci.yml runs all three platforms.
const ROOT_METADATA = new Set(['package.json', 'plugin.json', 'AGENTS.md', 'CLAUDE.md',
  'ARCHITECTURE.md', 'README.md', 'README.ko.md', 'CHANGELOG.md', 'CHANGELOG.ko.md',
  'CONTRIBUTING.md', 'SECURITY.md', 'LICENSE', 'SKILL.md'].map((n) => n.toLowerCase()));

// Path-shaped tokens: multi-segment paths, plus dotted single segments.
// The `+` on the separator class is load-bearing. Without it a run of separators
// breaks the segment repetition, the whole-path alternative fails, and the
// tokeniser falls back to the bare-basename alternative — which resolves to
// nothing, so deny-by-default never sees the path. `.js` names survive that gap
// because the executable-token FORM's body class spans a run on its own; `.md`
// with no read verb has no such umbrella.
const PATH_TOKEN = /[A-Za-z0-9_.@${}<>-]+(?:[\\/]+[A-Za-z0-9_.@{}|*-]+)+|[A-Za-z0-9_-]+\.[A-Za-z0-9]{1,6}\b/g;

// `files` is injectable for the same reason `toKey` is. `rel` is injectable
// alongside it because the `fromSource` normalisation is otherwise unpinnable:
// on POSIX `relative()` already returns slashes, so removing the normalisation
// is a no-op here and no mutation can see it. Only a win32 `relative` exercises
// it, and it has to be injected into the production call site — a copy of the
// logic in a test pins the test's arithmetic, not the guard's.
function resolvesInPlugin(token, sourceFile, files = PLUGIN_FILES, rel = relative) {
  const clean = normalizePath(token).replace(/^\.\//, '');
  if (files.has(clean)) return true;
  try {
    const fromSource = repoKey(ROOT, resolve(dirname(sourceFile), clean), rel);
    if (files.has(fromSource)) return true;
  } catch { /* unresolvable token — prose */ }
  return false;
}

// Scope, defined once. Yields the path tokens on a line that the invariant
// governs, with the documented exemptions applied. Both the classifier and the
// malicious-workspace fixture consume this, so they cannot test different rules.
function* scopedTokens(line) {
  PATH_TOKEN.lastIndex = 0;
  let m;
  while ((m = PATH_TOKEN.exec(line))) {
    // `<` and `>` are in the character class only to admit the anchor and this
    // repo's `<target-root>` / `<doc_kind>` placeholders. Without trimming them,
    // `<skills/…/x.md 첨부>` extracts with a leading `<`, fails to resolve, and
    // the token silently escapes the guard.
    let token = m[0];
    if (token.startsWith('<') && !token.startsWith(ANCHOR)) token = token.slice(1);
    if (token.endsWith('>') && !token.includes(ANCHOR)) token = token.slice(0, -1);
    // Normalise once, here, so every consumer of scopedTokens — the classifier
    // and the malicious-workspace fixture alike — judges the same string. Doing
    // it any later means the basename exemption below sees `SKILL.md` where the
    // whole token was `skills\deep-docs\SKILL.md`, which is precisely the hole.
    token = normalizePath(token);
    if (!token.includes('/') && ROOT_METADATA.has(token.toLowerCase())) continue;
    const before = line.slice(Math.max(0, m.index - 30), m.index);
    // Already inside an anchored path, written with either separator.
    if (new RegExp(String.raw`${ANCHOR}["'\s]*[\\/]?$`).test(before)) continue;
    // Markdown link target `](x.md)` — rendered navigation between documents,
    // not an instruction handed to a file tool. Markdown does not interpolate,
    // so these must stay source-relative; the link-destination test below pins
    // that they are never anchored.
    if (/\]\($/.test(before)) continue;
    yield token;
  }
}

const ROOT_SENTINEL = sep === '/' ? '/plugin-root' : 'C:\\plugin-root';

// Clause B. Substitute the anchor with a sentinel root, resolve, and require the
// result to stay inside it. Tokens carrying template placeholders (`<doc_kind>`)
// cannot be resolved literally, so they are checked lexically for `..` instead.
function escapesRoot(token) {
  const body = normalizePath(token).replace(new RegExp(`^(?:${ANCHOR})/`), '');
  if (/[{}|$<>]/.test(body)) return body.split('/').includes('..');
  const resolved = resolve(ROOT_SENTINEL, body);
  return resolved !== ROOT_SENTINEL && !resolved.startsWith(ROOT_SENTINEL + sep);
}

// Symlink escape: an anchored, lexically-contained path can still point out of
// the root if a component is a symlink. Only checkable for targets that exist.
//
// `root` is a parameter rather than a closed-over constant so the fixture can
// use a throwaway root outside the repository. A sibling planted its symlink
// *inside* the real root, which raced another test's repo-tree copy — `node
// --test` runs files in parallel processes — and made the suite fail 5 runs in
// 20. A flaky security guard is worse than a missing one: it teaches people to
// re-run until green.
function escapesViaSymlink(token, root = ROOT) {
  const body = normalizePath(token).replace(new RegExp(`^(?:${ANCHOR})/`), '');
  if (/[{}|$<>]/.test(body)) return false;
  const target = join(root, body);
  if (!existsSync(target)) return false;
  const real = realpathSync(target);
  const realRoot = realpathSync(root);
  return real !== realRoot && !real.startsWith(realRoot + sep);
}

function denyByDefaultHits(line, sourceFile, root = ROOT) {
  const out = [];
  for (const token of scopedTokens(line)) {
    if (ANCHORED_TOKEN.test(token)) {
      // Clause B is enforced here, not deferred. The reference implementation
      // waves anchored tokens through with a "clause B checks these" comment,
      // which is not true of this path — a `.json` or extensionless anchored
      // token matches no FORM, so nothing else would ever look at it. Both the
      // lexical check and its symlink form therefore run right here.
      if (escapesRoot(token)) out.push({ form: 'resolves-in-plugin', token, why: 'escapes plugin root' });
      else if (escapesViaSymlink(token, root)) out.push({ form: 'resolves-in-plugin', token, why: 'escapes via symlink' });
      continue;
    }
    // Forward defence only: a maintainer-only path never resolves in the plugin,
    // so this line is unreachable today. All of the actual protection is in the
    // two maintainer-only tests below. It is kept so that adding such a path to
    // the shipped set later fails the caveat test rather than this rule silently.
    if (NON_SHIPPED_DECLARED.has(token)) continue;
    if (resolvesInPlugin(token, sourceFile)) {
      out.push({ form: 'resolves-in-plugin', token, why: 'unanchored' });
    }
  }
  return out;
}

// bare basename read: Read(`scan-rules.md`). It resolves to no repo-relative
// path, so the rule above cannot see it — yet it is the weakest form of all,
// resolving straight against cwd. Only basenames that name a real plugin
// document are flagged, so ordinary prose is untouched.
const BARE_BASENAME = /\b(?:Read|Follow|read|follow)\s*\(?\s*["'`]([A-Za-z0-9][A-Za-z0-9._-]*\.md)(?:#[^`"']*)?["'`]/g;

// The executable twin. `Read`/`Follow` on a `.md` was covered; an interpreter on
// a runnable file was not, and that shape is strictly more dangerous: `node
// deep-docs-runtime.js` resolves against cwd — the analysed workspace — and
// running a planted file there is arbitrary code execution with the caller's
// permissions. Membership in the shipped set is still required, so prose that
// merely names a script is untouched; it is the interpreter that makes it an
// instruction.
const BARE_EXEC_BASENAME =
  new RegExp(String.raw`\b(?:${INTERPRETERS})\s+["'\`]?([A-Za-z0-9][A-Za-z0-9._-]*\.(?:${EXECUTABLE_EXT}))["'\`]?`, 'g');

function bareBasenameHits(line) {
  const out = [];
  BARE_BASENAME.lastIndex = 0;
  let m;
  while ((m = BARE_BASENAME.exec(line))) {
    if (PLUGIN_DOCS.has(m[1])) out.push({ form: 'bare-basename', token: m[1], why: 'unanchored' });
  }
  const shippedBasenames = new Set([...PLUGIN_FILES].map((f) => f.split('/').pop()));
  BARE_EXEC_BASENAME.lastIndex = 0;
  while ((m = BARE_EXEC_BASENAME.exec(line))) {
    if (shippedBasenames.has(m[1])) {
      out.push({ form: 'bare-exec-basename', token: m[1], why: 'unanchored' });
    }
  }
  return out;
}

// EXPANDED ROOT.
//
// The anchor is substituted by the agent, so a `$`-spelling of it is not a
// stylistic variant — it is a defect. Neither host sets an environment variable
// for this plugin's root (the skills say so explicitly: "do not require an
// environment variable"), so `${DEEP_DOCS_ROOT}/x` survives verbatim into
// whatever consumes it, and the consumer then reads a path *named*
// `${DEEP_DOCS_ROOT}/x` relative to the workspace: a fixed reference converted
// into a shadowable one.
//
// Written over the SHAPE, not over a list of names. The sibling this came from
// enumerates three spellings, and an enumeration of spellings is the same trap
// as an enumeration of verbs — it covers what someone remembered.
// `VARIABLE_ROOT` asks the structural question instead: does any path here take
// its root from something a shell or JS would expand? That catches
// `${CLAUDE_PLUGIN_ROOT}/…` and `$ANY_OTHER_ROOT/…` without naming either.
// `EXPANDED_ANCHOR` is the narrower companion for the anchor itself, which must
// be wrong even with no path after it.
const VARIABLE_ROOT = /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?[\\/]|%[A-Za-z_][A-Za-z0-9_]*%[\\/]/;
const EXPANDED_ANCHOR = /\$\{?(?:PLUGIN_ROOT|[A-Za-z_][A-Za-z0-9_]*_PLUGIN_ROOT|plugin-root)\b/;

// JS MODULE LOAD — refused outright, in every spelling.
//
// The rule this enforces is "an instruction document does not embed a JS module
// load of a plugin path", not "anchor it properly". There is no safe textual
// form, because `<plugin-root>` is a placeholder an *agent* substitutes while
// reading prose — no JS runtime expands it. `require("<plugin-root>/x.js")` is
// therefore a bare package specifier, so Node searches the *workspace*
// node_modules and loading a planted module there is arbitrary code execution.
// The `${…}` spelling is the same defect, and its backtick form additionally
// interpolates a local variable rather than the environment. This plugin's
// documented runtime interface is the CLI, so any JS module load naming a plugin
// path inside an instruction document is a violation however it is written.
//
// The condition is "does this specifier name a plugin path?", asked the same way
// deny-by-default asks it — not a list of exempt specifiers. `require('fs')`
// names no plugin path and is Node's own resolution, so it passes; the shipped
// version-read command uses exactly that shape and flagging it would be an
// over-flag, while the unanchored `.claude-plugin/plugin.json` on the same line
// is caught by deny-by-default where it belongs.
const JS_MODULE_LOAD = /(?:\brequire\s*\(|\bimport\s*\(|\bimport\b[^;\n]*?\bfrom\s+)\s*["'`]([^"'`\n]+)["'`]/g;

function jsModuleLoadHits(line, sourceFile = join(ROOT, 'AGENTS.md')) {
  const out = [];
  JS_MODULE_LOAD.lastIndex = 0;
  let m;
  while ((m = JS_MODULE_LOAD.exec(line))) {
    const spec = m[1];
    const names = ANCHORED_TOKEN.test(normalizePath(spec))
      || VARIABLE_ROOT.test(spec)
      || resolvesInPlugin(spec, sourceFile);
    if (!names) continue;
    out.push({
      form: 'js-module-load',
      token: spec,
      why: 'JS specifier naming a plugin path — no runtime substitutes the documentation '
        + 'anchor, so Node resolves it as a bare package under the workspace node_modules',
    });
  }
  return out;
}

// Resolve a token for real, from a given cwd, exactly as a runtime agent would.
// Re-running the classifier tells you only what the classifier already believes;
// this performs the resolution and asks which file the instruction lands on. It
// is the second, independent layer, shared by every fixture that needs it so no
// two of them can disagree about what resolution means.
function resolveAsAgentWould(token, cwd) {
  if (ANCHORED_TOKEN.test(token)) {
    return resolve(ROOT, token.replace(new RegExp(`^${ANCHOR}/`), ''));
  }
  return resolve(cwd, token.replace(/^\.\//, ''));
}

// Returns violations on a line: {form, token, why}. Empty when the line is clean.
function shadowableTokens(line, sourceFile = join(ROOT, 'AGENTS.md'), root = ROOT) {
  const out = [];
  for (const [form, re] of FORMS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line))) {
      const token = normalizePath(m[2] === undefined ? m[1] : m[1] + m[2]);
      if (!ANCHORED_TOKEN.test(token)) out.push({ form, token, why: 'unanchored' });
      else if (escapesRoot(token)) out.push({ form, token, why: 'escapes plugin root' });
      else if (escapesViaSymlink(token, root)) out.push({ form, token, why: 'escapes via symlink' });
    }
  }
  out.push(...bareBasenameHits(line));
  out.push(...jsModuleLoadHits(line, sourceFile));
  out.push(...denyByDefaultHits(line, sourceFile, root));
  // A token can match several FORMS plus deny-by-default; report each once.
  const seen = new Set();
  return out.filter((v) => {
    const key = `${v.token}|${v.why}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Maintainer-only paths named in shipped documents.
//
// A gitignored directory does not exist in an installed plugin — the marketplace
// fetches the tracked tree — so a path under one can only ever resolve against
// the ANALYSED PROJECT. Naming it in a shipped instruction hands that
// instruction to the project under analysis: the same substitution the anchoring
// rules exist to prevent, arriving by a route deny-by-default cannot see,
// because the path resolves nowhere in the index.
//
// Not every gitignored directory qualifies, and the split below has three arms,
// each with a stated authority and no list of variable names.
const HOST_PROJECT_DIRS = new Set(['.claude', '.vscode', '.idea', '.cursor']);

function parseIgnoredDirs(body) {
  return body.split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('!') && line.endsWith('/'))
    .map((line) => line.replace(/\/$/, ''));
}

// (1) ASK THE CODE — a directory this plugin WRITES into a project is its own
//     output root. Writing is the discriminator, not joining: a sibling's
//     release gate joins `docs` onto a project root and only READS it, because
//     `docs/` belongs to whatever project is being analysed. An earlier version
//     of this probe matched any join and classified `docs/` as an output root —
//     the rule silencing the exact class it exists for. A variable-name
//     allowlist was then tried and is what this replaces: it admitted 0 of 8
//     call sites in a repo where the project root is simply called `root`.
//
//     The write API set is spelled with an optional `Sync`, unlike the sibling
//     it came from. This runtime is `node:fs/promises` throughout — `.deep-docs`
//     is created by `await mkdir(...)` in scripts/runtime/state.js — so a
//     sync-only list would have found nothing at all and this arm would have
//     been decorative. It is an API enumeration and saying so is the point: its
//     growth condition is the fs module, and the arm is pinned in both
//     directions by its own test below.
const WRITE_API =
  /\b(?:mkdir|writeFile|appendFile|createWriteStream|rm|rmdir|unlink|cp|copyFile|rename)(?:Sync)?\s*\(/;

function pluginWrittenDirs(dirs, sourceRoots = codeRoots()) {
  const found = new Set();
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.[cm]?js$/.test(e.name) || /\.test\.[cm]?js$/.test(e.name)) continue;
      const body = readFileSync(p, 'utf8');
      for (const d of dirs) {
        if (found.has(d)) continue;
        const re = new RegExp(`['"\`]${d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`, 'g');
        let m;
        while ((m = re.exec(body))) {
          if (WRITE_API.test(body.slice(Math.max(0, m.index - 260), m.index + 260))) {
            found.add(d);
            break;
          }
        }
      }
    }
  };
  for (const r of sourceRoots) walk(join(ROOT, r));
  return found;
}

// The directories holding this plugin's runtime code, derived from the shipped
// index rather than listed — the same reason PLUGIN_DIRS is derived. `tests` is
// excluded because a fixture that writes a temp directory is not the plugin
// declaring an output root.
function codeRoots() {
  const roots = new Set();
  for (const key of PLUGIN_FILES) {
    if (!/\.[cm]?js$/.test(key) || /\.test\.[cm]?js$/.test(key)) continue;
    const top = key.split('/')[0];
    if (top !== 'tests' && key.includes('/')) roots.add(top);
  }
  return [...roots];
}

// (2) ASK THE CONVENTION — `.deep-*` is the suite's name for a plugin output
//     root. This deliberately covers a SIBLING's root: this plugin never writes
//     `.deep-review/`, but a document telling an agent to read a sibling's
//     report there is making a correct workspace-relative reference, and
//     flagging it would be an over-flag.
// (3) ASK THE HOST — a tool's per-project directory. `.claude` is Claude Code's,
//     `.vscode` and `.idea` are the editors', `.cursor` is Cursor's. None
//     belongs to any plugin, all live in the analysed project, and a document
//     may correctly name one. This arm IS a small enumeration and saying so is
//     the point: its growth condition is known — a new host or editor project
//     directory — and the alternative, treating anything unproven as a workspace
//     output, is fail-open.
function splitIgnored(ignored, written) {
  const workspaceOutput = new Set([
    ...written,
    ...ignored.filter((d) => d.startsWith('.deep-')),
    ...ignored.filter((d) => HOST_PROJECT_DIRS.has(d)),
  ]);
  // `node_modules` is neither: not a leak and not an output root, just noise.
  const maintainerOnly = ignored
    .filter((d) => !workspaceOutput.has(d) && d !== 'node_modules');
  return { workspaceOutput, maintainerOnly };
}

const IGNORED_DIRS = parseIgnoredDirs(readFileSync(join(ROOT, '.gitignore'), 'utf8'));
const { workspaceOutput: WORKSPACE_OUTPUT_DIRS, maintainerOnly: MAINTAINER_ONLY_DIRS } =
  splitIgnored(IGNORED_DIRS, pluginWrittenDirs(IGNORED_DIRS));

// Declared exceptions: a maintainer-only path a shipped document may name, and
// the clauses that earn the exception.
//
// The declaration is NOT a waiver. The test below makes every naming document
// carry each clause, so an entry here without the sentence is a failure rather
// than a bypass — which is the state this repo is in today, and the reason the
// entry is declared rather than the path being silently swept: the sweep would
// say "undeclared", and this says exactly which sentence is missing.
//
// Pin the PROHIBITION, not the provenance. A sibling's first version matched
// "ships with nothing" alone, which is a fact about the file rather than an
// instruction about it: review trimmed the caveat down to "`docs/DOCS_RULE.md`,
// which ships with nothing.", deleting the whole protective clause, and every
// test still passed. What keeps the path safe is the sentence telling a reader
// not to open it and why — so that is what is required here.
const NON_SHIPPED_DECLARED = new Map([
  ['docs/DOCS_RULE.md', [
    /ships with nothing/,
    /never try to open it at runtime/,
    /only place that path can resolve in an installed plugin is the project being analysed/,
  ]],
]);

// Blockquote markers and hard wraps must not decide whether a caveat counts, so
// the required clauses are matched against a flattened body.
function flatten(body) {
  return body.replace(/\n\s*>?\s*/g, ' ').replace(/\s+/g, ' ');
}

// ---------------------------------------------------------------------------
// HOST CAPABILITIES.
//
// The symlink fixture drives a real filesystem symlink, because the property it
// proves (realpath containment) cannot be demonstrated any other way. On Windows
// without Developer Mode, symlinkSync throws EPERM — which would turn a green
// suite red for a reason that has nothing to do with the invariant. ci.yml runs
// windows-latest, so this is probed rather than inferred from process.platform:
// a Linux CI that somehow lost the capability must not silently skip a security
// test either. The skip reason is a string so it prints, rather than a bare
// `true` that vanishes into the summary.
const SYMLINKS_AVAILABLE = (() => {
  const probe = mkdtempSync(join(tmpdir(), 'dd-symlink-probe-'));
  try {
    writeFileSync(join(probe, 'target'), 'x');
    symlinkSync(join(probe, 'target'), join(probe, 'link'));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
})();

// Indented too: fences nested in a list item or a numbered step are still fences.
const FENCE = /^[ \t]*```/gm;

test('every scanned markdown file has balanced code fences', () => {
  // Parity is a proxy, and it detects neither real failure. `skills/deep-report/SKILL.md`
  // carried fourteen markers — even, so this sweep passed — while a ```bash with an info
  // string failed to close the ```markdown template above it, a later bare marker closed
  // that template instead, and the final block was never closed at all. Half the document
  // rendered as code. So the parity count stays (it catches a truncating split cheaply)
  // and CommonMark's own rule is asserted beside it: a closer matches the opener's
  // character, is at least as long, and carries NO info string.
  //
  // CARVE-OUT, deliberate: `fenceRegions()` must NOT be made CommonMark-correct. It
  // answers a different question — whether a reader copying from a binding to its use
  // crosses a boundary, because two fenced blocks are two shell invocations — and
  // marker counting is the right model for that. The two differing readings are not an
  // inconsistency to tidy away.
  const openAtEof = (body) => {
    let open = null;
    for (const line of body.split('\n')) {
      const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (!m) continue;
      const ch = m[1][0];
      const len = m[1].length;
      if (open === null) { open = { ch, len }; continue; }
      if (ch === open.ch && len >= open.len && !m[2].trim()) open = null;
    }
    return open !== null;
  };
  assert.equal(openAtEof('```js\nx\n```\n'), false, 'a closed block is closed');
  assert.equal(openAtEof('```js\nx\n'), true, 'a truncated block is open at EOF');
  // The real shape, not a shorthand for it: an info-string marker cannot close, so the
  // bare marker meant to end the NESTED block ends the outer one instead, and every
  // later marker is off by one until the last opens a block nothing closes. A
  // two-marker fixture does not reproduce this — it just closes the outer early.
  assert.equal(openAtEof('```markdown\n```bash\nx\n```\nmore\n```\n'), true,
    'same-length nesting shifts every later marker and leaves the last block open');
  assert.equal(openAtEof('````markdown\n```bash\nx\n```\nmore\n````\n'), false,
    'and a longer outer fence nests correctly, which is the fix applied to deep-report');

  const truncated = [];
  for (const file of markdownFiles()) {
    if (openAtEof(readFileSync(file, 'utf8'))) truncated.push(path.relative(ROOT, file));
  }
  assert.deepEqual(truncated, [],
    'a code fence is still open at end of file — the rest of the document renders as '
    + `code:\n  ${truncated.join('\n  ')}`);

  const unbalanced = [];
  let seen = 0;
  for (const file of markdownFiles()) {
    const fences = (readFileSync(file, 'utf8').match(FENCE) || []).length;
    seen += fences;
    if (fences % 2 !== 0) unbalanced.push(`${relative(ROOT, file)} (${fences})`);
  }
  assert.deepEqual(unbalanced, [],
    `unclosed code fence — a split or edit truncated a fenced block:\n  ${unbalanced.join('\n  ')}`);
  // Parity is trivially satisfied by counting zero, so the corpus is balanced only
  // if the pattern still matches something. A column-0-only FENCE left two
  // reference files in a sibling with none of their fences checked and nothing
  // said so; this is the assertion that would have.
  assert.ok(seen > 0, 'the fence pattern matched nothing at all — it has rotted');
});

test('the shipped index is derived from git and is not empty', () => {
  // A zero from this derivation reads exactly like a clean repository and would
  // silence deny-by-default entirely, so the non-vacuity is asserted rather than
  // assumed — and against paths from every scanned surface, so a partial
  // derivation is visible too.
  assert.ok(PLUGIN_FILES.size > 20,
    `the shipped index holds only ${PLUGIN_FILES.size} keys — too few to be real`);
  for (const key of ['skills/deep-docs/SKILL.md', 'agents/doc-scanner.md',
    'scripts/deep-docs-runtime.js', 'scripts/runtime/scan.js']) {
    assert.ok(PLUGIN_FILES.has(key), `${key} must be in the shipped index`);
  }
  // Gitignored trees must be absent, or the maintainer-only sweep is checking a
  // property the index contradicts.
  for (const key of PLUGIN_FILES) {
    assert.ok(!key.startsWith('docs/'),
      `${key} is gitignored but present in the index — the two rules now disagree`);
  }
  // The derived root list must actually name the shipped directories, or every
  // FORM silently stops matching.
  for (const dir of ['skills', 'agents', 'scripts', 'runtime', 'references']) {
    assert.match(PLUGIN_DIRS, new RegExp(`(^|\\|)${dir}(\\||$)`),
      `${dir} must be a derived path root`);
  }
});

test('the always-loaded agent guides are in the scan set', () => {
  // Root-level entries in ALWAYS_LOADED have no separator, so a Windows
  // emulation over them alone cannot fail — it would be a decorative assertion.
  // The derivation is pinned against a real nested document instead, which is
  // where the spelling actually diverges. `rel` is a seam, not a switch: it
  // defaults to the host's and turns nothing off.
  const scanKeys = (rel = relative) =>
    markdownFiles().map((f) => normalizePath(rel(ROOT, f)));
  const scanned = scanKeys();
  for (const doc of ALWAYS_LOADED) {
    assert.ok(existsSync(join(ROOT, doc)), `${doc} must exist to be scanned`);
    assert.ok(scanned.includes(doc), `${doc} must be in the shadow-guard scan set`);
  }
  // The scan set must cover every nested markdown file the plugin ships, checked
  // against the git-derived index rather than against SCANNED_DIRS. Looping over
  // SCANNED_DIRS was tried and is self-referential: shrinking that list shrinks
  // the loop too, so dropping `agents` from the scan set killed nothing while
  // both agent definitions silently left coverage.
  //
  // Nested is the discriminator. A shipped `.md` under a directory is a skill, a
  // skill reference or an agent definition — every one of them an instruction
  // surface. Root-level markdown is repository metadata (README, CHANGELOG,
  // CONTRIBUTING, SECURITY), and the two entries that ARE instruction surfaces
  // are named in ALWAYS_LOADED above and asserted separately.
  const nestedShippedDocs = [...PLUGIN_FILES]
    .filter((k) => k.endsWith('.md') && k.includes('/')).sort();
  assert.ok(nestedShippedDocs.length > 0, 'the index yielded no nested markdown at all');
  const unscanned = nestedShippedDocs.filter((k) => !scanned.includes(k));
  assert.deepEqual(unscanned, [],
    `a shipped instruction document is outside the scan set:\n  ${unscanned.join('\n  ')}`);
  const nested = scanned.find((k) => k.includes('/'));
  assert.ok(nested,
    'the scan set must hold a nested document, or the next assertion proves nothing');
  assert.ok(scanKeys(win32.relative).includes(nested),
    `the Windows spelling of ${nested} must be the same key as the host's — `
    + 'otherwise every membership check against a slash literal misses there');
});

test('no read or exec instruction can be shadowed from the target workspace', () => {
  const violations = [];
  for (const file of markdownFiles()) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      for (const v of shadowableTokens(line, file)) {
        violations.push(`${relative(ROOT, file)}:${i + 1}  [${v.form}] ${v.token} — ${v.why}`);
      }
    });
  }
  assert.deepEqual(violations, [],
    'plugin path read or executed outside the plugin root — anchor it at '
    + `<plugin-root> and keep it inside the root:\n  ${violations.join('\n  ')}`);
});

// One case per instruction form, so the coverage claim is itself tested. A form
// with no case here is a form the guard does not enforce.
//
// Each unsafe line is chosen so that exactly the listed rules can see it, and
// the assertion compares the whole set rather than a count. `length > 0` was
// tried first and is far too weak: deleting `node` and `bash` from
// interpreter-exec killed nothing, because the case was `node
// scripts/deep-docs-runtime.js` — a real shipped path with a runnable
// extension, which executable-token and deny-by-default both catch on their own.
// The isolating cases below therefore name paths that do NOT exist (so
// deny-by-default is blind) with extensions outside the executable-token list.
//
// Where a line is legitimately seen by two rules, both are listed, so trimming
// either one fails here. `safe` is null for js-module-load: that form has no
// safe textual spelling in this repo, and the dedicated test below pins that the
// anchored spelling is refused too.
const FORM_CASES = [
  ['interpreter-exec', ['interpreter-exec'],
    'python3 scripts/missing-tool.py',
    'python3 "<plugin-root>/scripts/missing-tool.py"'],
  ['read-verb', ['read-verb'],
    'Read `references/scan-rules.md` and apply it',
    'Read `<plugin-root>/skills/deep-docs-workflow/references/scan-rules.md` and apply it'],
  ['direct-exec', ['direct-exec'],
    'source scripts/missing-profile.env',
    'source <plugin-root>/scripts/missing-profile.env'],
  ['executable-token', ['executable-token'],
    'the generator is `scripts/runtime/missing-generator.js`',
    'the generator is `<plugin-root>/scripts/runtime/missing-generator.js`'],
  ['bare-basename', ['bare-basename'],
    'Read(`scan-rules.md`)',
    'Read(`<plugin-root>/skills/deep-docs-workflow/references/scan-rules.md`)'],
  ['bare-exec-basename', ['bare-exec-basename'],
    'run `node deep-docs-runtime.js` from the project root',
    'run `node "<plugin-root>/scripts/deep-docs-runtime.js"` from the project root'],
  ['dot-relative', ['read-verb'],
    'Read `../scan-filters/cli-whitelist.md`',
    'Read `<plugin-root>/skills/deep-docs-workflow/references/scan-filters/cli-whitelist.md`'],
  ['resolves-in-plugin', ['resolves-in-plugin'],
    '워크플로우 정본은 `skills/deep-docs/SKILL.md` 이다.',
    '워크플로우 정본은 `<plugin-root>/skills/deep-docs/SKILL.md` 이다.'],
  // Two rules, because a JS specifier naming a real `.js` is also an executable
  // token. Deny-by-default sees it as well, but reports the same token with the
  // same reason as executable-token and is deduplicated away — that overlap is
  // the deduplication working, not a rule going missing.
  ['js-module-load', ['executable-token', 'js-module-load'],
    'const scan = require("scripts/runtime/scan.js");', null],
];

test('every enumerated instruction form is enforced', () => {
  for (const [label, forms, unsafe, safe] of FORM_CASES) {
    const hits = shadowableTokens(unsafe);
    assert.deepEqual([...new Set(hits.map((h) => h.form))].sort(), [...forms].sort(),
      `${label}: exactly these rules must catch it — ${unsafe}\n  got ${JSON.stringify(hits)}`);
    if (safe === null) continue;
    assert.deepEqual(shadowableTokens(safe), [], `${label}: guard must accept — ${safe}`);
  }
});

test('a JS module load of a plugin path is refused in every spelling', () => {
  for (const line of [
    'const scan = require("scripts/runtime/scan.js");',
    'const scan = require("<plugin-root>/scripts/runtime/scan.js");',
    'const scan = require("${CLAUDE_PLUGIN_ROOT}/scripts/runtime/scan.js");',
    'import scan from `${DEEP_DOCS_ROOT}/scripts/runtime/scan.js`;',
    'const { buildScanContext } = await import("scripts/runtime/scan.js");',
  ]) {
    assert.ok(jsModuleLoadHits(line).length > 0, `must flag JS module load: ${line}`);
  }
  // The rule is about plugin paths, not about the word `require`. A built-in or
  // package specifier names no plugin path, and the shipped version-read command
  // uses exactly that shape — flagging it would be an over-flag that gets the
  // rule trimmed. The unanchored plugin path on the same line is still caught,
  // by deny-by-default, which is where it belongs.
  for (const line of [
    'const { readFileSync } = require("node:fs");',
    `node -p "JSON.parse(require('fs').readFileSync('x','utf8')).version"`,
    'import assert from "node:assert/strict";',
  ]) {
    assert.deepEqual(jsModuleLoadHits(line), [],
      `a specifier naming no plugin path must pass: ${line}`);
  }
  const versionRead =
    `node -p "JSON.parse(require('fs').readFileSync('.claude-plugin/plugin.json','utf8')).version"`;
  assert.deepEqual(jsModuleLoadHits(versionRead), [],
    'the built-in specifier must not be the reason this line is flagged');
  assert.deepEqual(
    shadowableTokens(versionRead).map((v) => `${v.form}|${v.token}`),
    ['resolves-in-plugin|.claude-plugin/plugin.json'],
    'the unanchored plugin path is what must be reported, and only it');
});

test('anchored paths that escape the plugin root are rejected (containment)', () => {
  const traversals = [
    'Read `<plugin-root>/../workspace/evil.md`',
    'node "<plugin-root>/../workspace/evil.js"',
  ];
  for (const line of traversals) {
    const hits = shadowableTokens(line);
    assert.ok(hits.length > 0, `containment must reject: ${line}`);
    assert.equal(hits[0].why, 'escapes plugin root', `wrong reason for: ${line}`);
  }
  // A `..` that stays inside the root is fine.
  assert.deepEqual(
    shadowableTokens('Read `<plugin-root>/skills/deep-docs/../deep-docs-workflow/SKILL.md`'), [],
    'in-root traversal must be accepted');
});

test('mixed lines fail on the bare token', () => {
  const line = 'Read `<plugin-root>/skills/deep-docs/SKILL.md` then Read `../deep-docs-workflow/SKILL.md`';
  const hits = shadowableTokens(line);
  assert.equal(hits.length, 1, `exactly the bare token must be flagged, got ${JSON.stringify(hits)}`);
  assert.equal(hits[0].why, 'unanchored');
});

test('a malicious workspace cannot shadow any instruction the plugin issues', () => {
  // End-to-end statement of the invariant. Plant shadows in a fake target
  // workspace for every file the plugin ships, then confirm no instruction in
  // the repo would resolve to one of them. Because every instruction should be
  // anchored, cwd is irrelevant — which is the property under test, not an
  // accident of this fixture.
  const evil = mkdtempSync(join(tmpdir(), 'dd-evil-workspace-'));
  try {
    // Derived from the shipped index, not enumerated, and repo-relative only.
    // A hand-written plant list only covers the paths someone remembered: in a
    // sibling, five unsafe spellings fired the classifier while this layer — the
    // only one that proves a planted file is actually reached — stayed silent,
    // because nothing had been planted where they would land.
    //
    // Bare basenames are deliberately NOT planted. That was tried and reverted:
    // a document that merely mentions a shipped basename in prose then registers
    // as a landing. That shape is handled by detection instead (BARE_BASENAME /
    // BARE_EXEC_BASENAME), where a verb or interpreter is what makes it an
    // instruction.
    for (const rel of PLUGIN_FILES) {
      const dest = join(evil, rel);
      mkdirSync(dirname(dest), { recursive: true });
      if (!existsSync(dest)) writeFileSync(dest, '# SHADOW — must never be read\n');
    }

    // Excluding directory landings is safe only while no shipped SUBdirECTORY is
    // a Node LOAD_AS_DIRECTORY target. A nested `index.js` or `package.json`
    // would make a planted DIRECTORY reachable by name again, and nothing else
    // would notice, because `isFile()` would keep skipping it. The repository
    // root's own `package.json` is not such a target — nothing names the root by
    // path — so the check is scoped to nested ones.
    assert.deepEqual(
      [...PLUGIN_FILES].filter((k) => /\/(?:index\.[cm]?js|package\.json)$/.test(k)).sort(),
      [],
      'a shipped directory just became loadable by name — the isFile() landing '
      + 'filter now hides a reachable shadow, and must be revisited');

    const landed = [];
    for (const file of markdownFiles()) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        for (const token of scopedTokens(line)) {
          const target = resolveAsAgentWould(token, evil);
          // A landing must be a FILE. Planting every shipped path creates the
          // directories above it, so `existsSync` alone reports a hit for any
          // prose that names a shipped directory — `scripts/runtime`, say —
          // where nothing shadowable was planted at all.
          if (target.startsWith(evil + sep) && existsSync(target) && statSync(target).isFile()) {
            landed.push(`${relative(ROOT, file)}:${i + 1}  ${token} → ${target}`);
          }
        }
      });
    }
    assert.deepEqual(landed, [],
      `these instructions resolve onto a planted shadow file:\n  ${landed.join('\n  ')}`);

    // Non-vacuity: the same resolution, given an unanchored token, does land on
    // the shadow — so an empty result above is a property of the documents, not
    // of a resolver that never finds anything.
    const control = resolveAsAgentWould('scripts/runtime/scan.js', evil);
    assert.ok(control.startsWith(evil + sep) && existsSync(control),
      'fixture is vacuous — an unanchored token must land on the planted shadow');
    // …and its anchored twin must NOT, so "landed" is a property of the token
    // rather than of a resolver that points everything at the evil root.
    assert.equal(
      resolveAsAgentWould('<plugin-root>/scripts/runtime/scan.js', evil).startsWith(evil + sep),
      false,
      'an anchored token must resolve into the plugin, never the workspace');
  } finally {
    rmSync(evil, { recursive: true, force: true });
  }
});

test('a separator run reaches the planted file, not just the classifier', () => {
  // The defect this pins is invisible to a failure count. With a one-character
  // separator element in PATH_TOKEN, a run-spelled path (`scripts\\runtime\\x.js`)
  // still makes the classifier report — a FORM matches the raw text — while the
  // reachability fixture goes blind, because scopedTokens dies at the second
  // separator and yields only the bare basename. Counting failures reads that as
  // "caught"; it is the layer that proves an instruction actually lands on a
  // planted file that has stopped working, and that is the only layer that
  // demonstrates the attack rather than describing it.
  const evil = mkdtempSync(join(tmpdir(), 'dd-run-evil-'));
  try {
    mkdirSync(join(evil, 'scripts', 'runtime'), { recursive: true });
    writeFileSync(join(evil, 'scripts', 'runtime', 'scan.js'), 'console.log("SHADOW");\n');

    for (const [label, line] of [
      ['single slash', 'node scripts/runtime/scan.js --root .'],
      ['single backslash', 'node scripts\\runtime\\scan.js --root .'],
      ['backslash run', 'node scripts\\\\runtime\\\\scan.js --root .'],
      ['slash run', 'node scripts//runtime//scan.js --root .'],
      ['mixed run', 'node scripts\\/runtime\\/scan.js --root .'],
    ]) {
      assert.ok(shadowableTokens(line).length > 0,
        `layer 1 (classifier) must flag: ${label} — ${line}`);
      const landed = [...scopedTokens(line)]
        .map((t) => resolveAsAgentWould(t, evil))
        .filter((t) => t.startsWith(evil + sep) && existsSync(t) && statSync(t).isFile());
      assert.ok(landed.length > 0,
        `layer 2 (reachability) must land on the planted shadow: ${label} — ${line}. `
        + `scopedTokens yielded ${JSON.stringify([...scopedTokens(line)])}`);
    }
  } finally {
    rmSync(evil, { recursive: true, force: true });
  }
});

test('markdown link destinations are never the plugin-root placeholder', () => {
  // The mirror image of the anchor rule. Markdown does not interpolate, so an
  // anchored link destination is a literal broken URL. Link targets are an
  // exception class in the guard above; this asserts the exception is actually
  // honoured in the documents.
  const re = new RegExp(String.raw`\]\((${ANCHOR}[^)]*|\$\{?[A-Za-z_][^)]*)\)`, 'g');
  // Non-vacuity, on the axis rather than on whatever the corpus holds today.
  for (const probe of ['[x](<plugin-root>/skills/a.md)', '[x](${CLAUDE_PLUGIN_ROOT}/a.md)',
    '[x]($DEEP_DOCS_ROOT/a.md)']) {
    re.lastIndex = 0;
    assert.ok(re.exec(probe), `the sweep must see: ${probe}`);
  }
  re.lastIndex = 0;
  assert.equal(re.exec('[x](claude-md.md)'), null, 'a source-relative destination is correct');

  const broken = [];
  for (const file of markdownFiles()) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line))) broken.push(`${relative(ROOT, file)}:${i + 1}  ](${m[1]})`);
    });
  }
  assert.deepEqual(broken, [],
    'markdown link destination uses a placeholder that nothing expands — use a '
    + `source-relative path instead:\n  ${broken.join('\n  ')}`);
});

test('the ignored-directory split is derived, three-armed, and two-way', () => {
  // The split is the one place the maintainer-only rule can be turned off, so
  // every arm is asserted in both directions. Driven first over synthetic input
  // through the same production functions, because the real .gitignore does not
  // exercise every arm — an arm with no input is an arm no mutation can kill.
  const synthetic = parseIgnoredDirs([
    '# a comment', '', '.deep-x/', 'docs/', 'node_modules/', '.vscode/',
    '!keep/', 'build/', 'not-a-dir.txt', '.DS_Store',
  ].join('\n'));
  assert.deepEqual(synthetic, ['.deep-x', 'docs', 'node_modules', '.vscode', 'build'],
    'the .gitignore parse must take directory entries only, and skip comments and negations');
  const synth = splitIgnored(synthetic, new Set(['build']));
  assert.deepEqual(synth.maintainerOnly, ['docs'],
    'convention (.deep-x), host (.vscode), write-probe (build) and node_modules must all '
    + `be carved out, leaving docs alone — got ${JSON.stringify(synth.maintainerOnly)}`);
  for (const carved of ['.deep-x', '.vscode', 'build']) {
    assert.ok(synth.workspaceOutput.has(carved), `${carved} must be classed as a workspace output`);
  }
  assert.equal(synth.workspaceOutput.has('docs'), false,
    'docs must never be classed as a workspace output — that silences the rule');

  // Now the real repository.
  assert.ok(IGNORED_DIRS.length > 0, '.gitignore yielded no ignored directories');
  assert.ok(WORKSPACE_OUTPUT_DIRS.has('.deep-docs'),
    "this plugin's own output root must be carved out — writing there is the contract");
  assert.ok(WORKSPACE_OUTPUT_DIRS.has('.deep-review'),
    'a sibling output root must be carved out too — naming it is a correct reference');
  assert.ok(MAINTAINER_ONLY_DIRS.includes('docs'),
    'docs must stay maintainer-only — it is the class this rule exists for');
  for (const dir of MAINTAINER_ONLY_DIRS) {
    assert.ok(!dir.startsWith('.deep-'), `${dir} is an output root but is swept`);
  }
  assert.ok(MAINTAINER_ONLY_DIRS.length < IGNORED_DIRS.length,
    'nothing was split off — then the rule is unchanged, which is not what its comment claims');
  assert.ok(MAINTAINER_ONLY_DIRS.length > 0,
    'the split emptied the rule — that silences it');
});

test('the write probe finds this runtime, and does not overreach', () => {
  // Arm (1) of the split, pinned directly. It is dominated by the `.deep-*`
  // convention for `.deep-docs`, so without this test the arm could be deleted
  // and nothing would fail — and its own defect mode is the reverse of a missed
  // detection: a probe that says "written" about a directory the plugin only
  // READS silences the rule for exactly the class it exists for.
  const roots = codeRoots();
  assert.ok(roots.includes('scripts'),
    `the runtime source root must be derived, got ${JSON.stringify(roots)}`);
  const written = pluginWrittenDirs(IGNORED_DIRS);
  assert.ok(written.has('.deep-docs'),
    'the probe must find the state directory this runtime creates — it is written with '
    + 'the promise-based `await mkdir(...)`, so a sync-only API list finds nothing');
  assert.equal(written.has('docs'), false,
    'docs is never written by this plugin — a probe that says otherwise has silenced the rule');
  assert.equal(written.has('.deep-review'), false,
    'this plugin does not write a sibling output root; only the convention arm may carve it out');
});

test('a path the plugin never ships carries the sentence that makes it safe', () => {
  // Self-consistency axis. A gitignored path can resolve NOWHERE ELSE than the
  // analysed project, and deny-by-default structurally cannot see it: that rule
  // only flags what resolves inside the plugin. Writing a rule is not enforcing
  // it, so the exemption is asserted rather than assumed.
  const missing = [];
  for (const [declared, clauses] of NON_SHIPPED_DECLARED) {
    assert.ok(!PLUGIN_FILES.has(declared),
      `${declared} is declared non-shipped but is in the shipped index`);
    for (const file of markdownFiles()) {
      const body = readFileSync(file, 'utf8');
      if (!body.includes(declared)) continue;
      const flat = flatten(body);
      for (const clause of clauses) {
        if (!clause.test(flat)) {
          missing.push(`${relative(ROOT, file)} names ${declared} but is missing: ${clause.source}`);
        }
      }
    }
  }
  assert.deepEqual(missing, [],
    'a document names a path that ships with nothing, without the caveat that keeps a '
    + `reader from opening it in the analysed project:\n  ${missing.join('\n  ')}`);
});

test('no undeclared path under a maintainer-only directory is named', () => {
  // The generalisation of the caveat rule. Lexical over raw lines, never
  // consulting the resolver: that is what makes it immune to any index blind
  // spot, and why both separators are spelled out — `normalizePath` never
  // reaches here, so with `/` alone the backslash spelling walks straight past.
  //
  // Negative lookbehind rather than a prefix list. Enumerating the characters
  // that may precede a path makes every character nobody thought of a bypass:
  // `**docs/X.md**` and `[docs/Y.md](…)` are ordinary markdown and slip past a
  // space/backtick/quote/paren list.
  const escaped = MAINTAINER_ONLY_DIRS.map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(String.raw`(?<![A-Za-z0-9._\\/-])(?:\.[\\/])?((?:${escaped})[\\/][A-Za-z0-9._\\/-]+)`, 'g');

  for (const probe of ['See `docs/backlog.md` for the rest.', 'See `docs\\backlog.md` too.',
    '**docs/bold.md** matters', '[docs/link.md](x) matters']) {
    re.lastIndex = 0;
    assert.ok(re.exec(probe), `the sweep must see: ${probe}`);
  }
  re.lastIndex = 0;
  assert.equal(re.exec('nodocs/notapath.md is mid-token'), null,
    'a match must not start mid-token');

  const violations = [];
  for (const file of markdownFiles()) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line))) {
        if (NON_SHIPPED_DECLARED.has(m[1])) continue;   // earned by the caveat test above
        violations.push(`${relative(ROOT, file)}:${i + 1}  ${m[1]}`);
      }
    });
  }
  assert.deepEqual(violations, [],
    'a path under a maintainer-only directory is named in a shipped document; it '
    + `resolves only against the analysed project:\n  ${violations.join('\n  ')}`);
});

test('a backslash separator does not hide a path from the guard', () => {
  // Review of a sibling found the slash form producing seven failures and the
  // backslash form producing none — the same unanchored reference to the same
  // file, invisible because the matchers knew only `/`. Windows is a supported
  // host (ci.yml runs it under pwsh and cmd), so that is a legitimate spelling
  // and not a typo, and one character bypassed the whole invariant.
  const TABLE = [
    ['unanchored slash', 'Run `node scripts/deep-docs-runtime.js` to start.'],
    ['unanchored backslash', 'Run `node scripts\\deep-docs-runtime.js` to start.'],
    ['read-verb slash', 'Read `skills/deep-docs/SKILL.md`'],
    ['read-verb backslash', 'Read `skills\\deep-docs\\SKILL.md`'],
    ['mixed separators', 'Run `node scripts\\runtime/scan.js` to start.'],
    ['read-verb mixed', 'Read `skills/deep-docs\\SKILL.md` first.'],
    // The rows below carry no read verb and no runnable extension, so the
    // executable-token FORM cannot cover for the tokeniser. They are the only
    // rows that actually exercise the `+` on PATH_TOKEN's separator class.
    ['run, .md, no verb', 'The workflow lives at skills//deep-docs-workflow//SKILL.md today.'],
    ['backslash run, .md, no verb', 'The workflow lives at skills\\\\deep-docs-workflow\\\\SKILL.md today.'],
    ['mixed run, .md, no verb', 'The workflow lives at skills\\/deep-docs-workflow/\\SKILL.md today.'],
  ];
  for (const [label, line] of TABLE) {
    assert.ok(shadowableTokens(line).length > 0, `${label} must be flagged: ${line}`);
  }

  // An anchored traversal written with backslashes is still a traversal, and must
  // be rejected for that reason rather than as "unanchored". Asserting the reason
  // is what keeps this row from passing for the wrong cause: with normalizePath
  // removed the token stays `<plugin-root>\..\…`, fails ANCHORED_TOKEN, and is
  // flagged — correctly, but as an anchoring failure.
  const traversal = shadowableTokens('node "<plugin-root>\\..\\workspace\\evil.json"');
  assert.ok(traversal.length > 0, 'anchored backslash traversal must be flagged');
  assert.equal(traversal[0].why, 'escapes plugin root',
    `traversal must fail on containment, not anchoring: ${JSON.stringify(traversal)}`);

  // Escape parity: a doubled backslash is how the same path appears inside a
  // string literal, and separator runs collapse, so it resolves identically.
  assert.ok(shadowableTokens('const p = "scripts\\\\runtime\\\\scan.js";').length > 0,
    'an escaped backslash path must be flagged too');

  // PER-AXIS ISOLATION. The rows above are caught by several rules at once, so
  // they prove the bug is closed without proving which piece closed it. Each case
  // below is chosen so exactly one piece can see it.

  // PATH_TOKEN + the normalise-before-exemption ordering, isolated. No read verb,
  // so no FORM matches, and a basename ROOT_METADATA exempts on its own — so if
  // the token is not extracted whole and canonicalised before the exemption
  // lookup, nothing sees it at all.
  assert.ok(
    shadowableTokens('워크플로우 정본은 `skills\\deep-docs\\SKILL.md` 이다.').length > 0,
    'deny-by-default must extract a backslash path whole, not just its basename');

  // ANY_ROOT/REL separator, isolated. Deny-by-default asks whether a token
  // resolves inside the plugin, so a path to a file that does not exist is
  // invisible to it — only a FORM can match, and only if the separator directly
  // after the root directory is accepted.
  assert.ok(shadowableTokens('Read `skills\\missing.md` before starting.').length > 0,
    'a FORM must accept a backslash directly after the root directory');

  // PATH_BODY separator, isolated. Slash after the root so ANY_ROOT matches
  // either way; the backslash is inside the body, and the file does not exist so
  // deny-by-default cannot cover for it.
  assert.ok(shadowableTokens('Read `skills/zzz\\missing.md` before starting.').length > 0,
    'a FORM must match a backslash inside the path body');

  // executable-token, isolated: no interpreter, no read verb, and a file that
  // does not exist, so this rule is the only one that can see it. It carries its
  // own inline copy of the root and body patterns, so the other FORMS learning
  // `\` teaches it nothing.
  // The second case used `.sh`, which this plugin does not ship — so once the
  // extension set was derived from the index instead of listed, the case stopped
  // being a case. Both spellings must use an extension that is actually runnable
  // here, or the FORM's coverage claim rests on a token it would never see.
  assert.ok(EXEC_EXTS.includes('js'), 'the cases below assume `.js` is runnable here');
  for (const line of [
    'the generator is at `scripts\\runtime\\missing-generator.js`',
    'the helper `scripts\\missing-helper.js` is invoked at Stop',
  ]) {
    const hits = shadowableTokens(line);
    assert.deepEqual(hits.map((h) => h.form), ['executable-token'],
      `executable-token must be the rule that catches this, alone: ${line}`);
  }

  assert.deepEqual(
    shadowableTokens('Read `<plugin-root>\\skills\\deep-docs\\SKILL.md`'), [],
    'an anchored backslash path must be accepted, not flagged as unanchored');
});

test('normalising separators does not promote prose into a path', () => {
  // Collapsing separator runs makes over-flagging the failure mode to watch, so
  // the text that must stay silent is pinned. But "produces no violation" has two
  // mechanisms behind it, and asserting only the outcome hides which one is
  // load-bearing.

  // A. The tokeniser must not see a path here at all. Escape sequences and regex
  //    bodies are the shapes most at risk once `\` is a separator.
  for (const line of [
    'escape a quote with \\" and a backslash with \\\\',
    'Use `\\n` for a newline and `\\t` for a tab.',
    'A literal backslash is written `\\\\` in a JS string literal.',
    'The validator matches /^[A-Za-z]+\\/[a-z-]+$/ against each entry.',
  ]) {
    assert.deepEqual([...scopedTokens(line)], [],
      `no path token may be extracted from: ${line}`);
    assert.deepEqual(shadowableTokens(line), [], `must not be flagged: ${line}`);
  }

  // B. Here the tokeniser does extract something — a Windows path quoted inside
  //    user input is genuinely path-shaped — and it stays silent only because it
  //    resolves to no plugin file. That is a claim about the rule, so it gets the
  //    non-vacuity check: declare those exact tokens plugin files and the line
  //    must be flagged. Nothing is stubbed; only the file set the rule consults
  //    is changed, so what runs is the real classifier.
  for (const [line, expected] of [
    ['Windows paths in user input (`C:\\Users\\me\\project`) are normalised before use.',
      ['Users/me/project']],
    ['The workspace was at `D:\\repos\\acme\\notes.md` on that machine.',
      ['repos/acme/notes.md']],
    ['const p = "C:\\\\Users\\\\me\\\\notes.md";', ['Users/me/notes.md']],
  ]) {
    assert.deepEqual([...scopedTokens(line)], expected,
      `separator runs must collapse to one canonical token: ${line}`);
    assert.deepEqual(shadowableTokens(line), [], `must not be flagged: ${line}`);

    for (const t of expected) PLUGIN_FILES.add(t);
    try {
      assert.ok(shadowableTokens(line).length > 0,
        'vacuous negative — this line stays silent even when its tokens name real '
        + `plugin files, so asserting its silence proves nothing: ${line}`);
    } finally {
      for (const t of expected) PLUGIN_FILES.delete(t);
    }
  }

  // C. And the workspace output root this plugin writes must not read as a
  //    plugin path just because a shipped skill directory shares its name.
  //    `.deep-docs/` resolves against the analysed project by contract, so
  //    flagging it would be an over-flag on the one directory the plugin owns
  //    there. The `.js` row is the one that discriminates: without the
  //    executable-token lookbehind, `deep-docs/hook.js` matches inside
  //    `.deep-docs/hook.js` and the rule fires on its own output root. The other
  //    two rows are protected by the FORMS being anchored to their verb and stay
  //    clean either way — they are here to state the class, not to pin it.
  for (const line of [
    'The scanner writes only `.deep-docs/scan-payload-request.json`.',
    'Read `.deep-docs/last-scan.md` from the target root.',
    'The generated hook is `.deep-docs/hook.js` under the target root.',
  ]) {
    assert.deepEqual(shadowableTokens(line), [],
      `the workspace output root must not be flagged as a plugin path: ${line}`);
  }
  // Non-vacuity for that row: strip the leading dot and the same shape IS a
  // plugin path, so the silence above is about the mid-token boundary and not
  // about a rule that never fires on this shape at all.
  assert.ok(shadowableTokens('The generated hook is `deep-docs/hook.js` today.').length > 0,
    'the same shape without the leading dot must still be flagged');
});

test('the root-metadata exemption does not depend on the host filesystem', () => {
  // These documents name the agents.md STANDARD in prose. On a case-folding
  // filesystem that token is the same file as the root `AGENTS.md` the
  // malicious-workspace fixture plants, so a case-sensitive exemption makes the
  // fixture report landings on macOS and Windows and none on Linux — for the
  // same corpus. The exemption is therefore compared case-insensitively, and
  // both directions are pinned here rather than left to whichever runner is
  // handy.
  for (const line of [
    '출처는 OpenAI Codex 공식 가이드 + agents.md 표준.',
    'the `AGENTS.md` standard, and the `Claude.md` wrapper',
  ]) {
    assert.deepEqual([...scopedTokens(line)], [],
      `a root-metadata basename must be exempt in any case: ${line}`);
    assert.deepEqual(shadowableTokens(line), [], `and must not be flagged: ${line}`);
  }
  // Non-vacuity: the exemption must not have swallowed every dotted single
  // segment — a basename that is not root metadata is still yielded, and a
  // shipped one is still flagged when a read verb makes it an instruction.
  assert.deepEqual([...scopedTokens('follow `scan-rules.md` closely')], ['scan-rules.md']);
  assert.ok(shadowableTokens('Read `scan-rules.md`').length > 0,
    'a shipped document basename under a read verb must still be flagged');
});

test('the anchor cannot be spelled as a shell variable anywhere', () => {
  // Closed by a different mechanism than deep-work uses. There it is a
  // `non-expanding-anchor` check hung off a list of commands, which misses `cp`,
  // `mv`, `install` and any wrapper — enumeration creeping back on a second
  // axis. And here it would have no subject at all: the anchor is substituted by
  // the agent, not by a shell, so quoting cannot change the outcome either way.
  // This plugin bans the shell spelling outright in every scanned file instead.
  const line = "cp '${DEEP_DOCS_ROOT}/scripts/deep-docs-runtime.js' /tmp/x";
  assert.ok(EXPANDED_ANCHOR.test(line) || VARIABLE_ROOT.test(line),
    'the expanded-root rule must reject the shell spelling regardless of the command');
  assert.ok(VARIABLE_ROOT.test('node "${CLAUDE_PLUGIN_ROOT}/scripts/deep-docs-runtime.js"'),
    "and a sibling repo's anchor spelling, which nothing here substitutes either");
  // Each arm of VARIABLE_ROOT gets its own case. Review measured that narrowing the
  // pattern to braces only turned no test red: the bare-`$VAR` arm worked and could
  // have been deleted in any tidy-up with the suite still green.
  assert.ok(VARIABLE_ROOT.test('node $DOCS_HOME/scripts/deep-docs-runtime.js'),
    'and a bare $VAR root, named by nothing in this rule');
  // AGENTS.md:16 commits this plugin to native Windows without Git Bash, so cmd.exe
  // expansion is a live spelling here, not a curiosity.
  assert.ok(VARIABLE_ROOT.test('node "%CLAUDE_PLUGIN_ROOT%\\scripts\\deep-docs-runtime.js"'),
    'and the cmd.exe spelling, on a runtime this plugin supports natively');
  assert.ok(EXPANDED_ANCHOR.test('export $DEEP_DOCS_PLUGIN_ROOT'),
    'the bare `$` spelling counts even with no path after it');
  // Negatives: the shapes this repo legitimately writes must stay clean, or the
  // rule bans the documentation placeholders it depends on.
  for (const clean of [
    'node "<plugin-root>/scripts/deep-docs-runtime.js" scan-context --root "<target-root>"',
    'Writes land under `<target-root>/.deep-docs/` only.',
    'Codex: `$deep-docs:deep-docs scan`',
  ]) {
    assert.ok(!VARIABLE_ROOT.test(clean) && !EXPANDED_ANCHOR.test(clean),
      `must stay clean: ${clean}`);
  }
  // And it is verb-agnostic: no command appears in this line at all.
  assert.ok(shadowableTokens('scripts/deep-docs-runtime.js 를 참조한다').length > 0,
    'deny-by-default must flag a bare plugin path with no command verb present');
});

function expandedRootOffenders(files = markdownFiles(), read = readFileSync) {
  const offenders = [];
  for (const file of files) {
    read(file, 'utf8').split('\n').forEach((line, i) => {
      if (VARIABLE_ROOT.test(line) || EXPANDED_ANCHOR.test(line)) {
        offenders.push(`${relative(ROOT, file)}:${i + 1}  ${line.trim()}`);
      }
    });
  }
  return offenders;
}

test('the plugin uses exactly one anchor spelling', () => {
  // The corpus holds no expanded root today, so the sweep cannot fail by itself
  // — with the whole condition deleted this test would stay green while the rule
  // it names went away. The sweep is therefore driven over a synthetic document
  // first, through the same function the corpus goes through.
  const fake = join(ROOT, 'skills', 'fixture.md');
  const bodies = new Map([[fake, [
    'node "<plugin-root>/scripts/deep-docs-runtime.js" scan-context',   // the correct form
    'node "${DEEP_DOCS_ROOT}/scripts/deep-docs-runtime.js" scan-context', // expanded anchor
    'node "${CLAUDE_PLUGIN_ROOT}/scripts/deep-docs-runtime.js"',        // a sibling's anchor
    'Writes land under `<target-root>/.deep-docs/` only.',              // not a path root
  ].join('\n')]]);
  const found = expandedRootOffenders([fake], (f) => bodies.get(f));
  assert.deepEqual(found.map((o) => o.split(':')[1].split(' ')[0]), ['2', '3'],
    `exactly the two expanded roots must be reported, got ${JSON.stringify(found)}`);

  const offenders = expandedRootOffenders();
  assert.deepEqual(offenders, [],
    'a path is rooted at something a shell or JS would expand — this plugin anchors on '
    + `the derived ${ANCHOR} placeholder only:\n  ${offenders.join('\n  ')}`);
});

test('an anchored path that leaves the root through a symlink is rejected', {
  skip: SYMLINKS_AVAILABLE ? false : 'this host cannot create symlinks (unprivileged Windows)',
}, () => {
  // `escapes via symlink` is produced on two code paths and, without this test,
  // asserted on neither: containment only ever exercises the lexical `..` form.
  // `resolve` is lexical, so an anchored, `..`-free path whose component is a
  // symlink passes every other check and still lands outside the plugin.
  const outside = mkdtempSync(join(tmpdir(), 'dd-symlink-outside-'));
  const fakeRoot = mkdtempSync(join(tmpdir(), 'dd-symlink-root-'));
  try {
    writeFileSync(join(outside, 'evil.md'), '# SHADOW — outside the plugin root\n');
    mkdirSync(join(fakeRoot, 'skills'), { recursive: true });
    symlinkSync(join(outside, 'evil.md'), join(fakeRoot, 'skills', 'evil.md'));
    writeFileSync(join(fakeRoot, 'skills', 'ok.md'), '# in-root\n');
    const token = '<plugin-root>/skills/evil.md';

    // Non-vacuity: the token is anchored and lexically contained, so every other
    // clause accepts it. Only the symlink check can reject it.
    assert.ok(ANCHORED_TOKEN.test(token), 'fixture token must be anchored');
    assert.equal(escapesRoot(token), false, 'fixture token must be lexically contained');

    // Both production sites: the FORMS path and the deny-by-default path.
    const viaForm = shadowableTokens(`Read \`${token}\``, undefined, fakeRoot);
    assert.ok(viaForm.some((v) => v.why === 'escapes via symlink'),
      `read-verb path must reject the symlink: ${JSON.stringify(viaForm)}`);
    const viaDeny = denyByDefaultHits(`증명은 \`${token}\` 를 따른다`, join(ROOT, 'AGENTS.md'), fakeRoot);
    assert.ok(viaDeny.some((v) => v.why === 'escapes via symlink'),
      `deny-by-default path must reject the symlink: ${JSON.stringify(viaDeny)}`);

    // A real in-root target of the same shape is still accepted, so the rule is
    // about where the link points and not about the directory it sits in.
    assert.deepEqual(
      shadowableTokens('Read `<plugin-root>/skills/ok.md`', undefined, fakeRoot), [],
      'a real in-root file must still be accepted');
  } finally {
    rmSync(fakeRoot, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('every referenced plugin path resolves inside the root', () => {
  const patterns = [
    // Trailing boundary, same reason as the guard: without it `.js` matches the
    // prefix of `.json` and the resolver reports files that never existed.
    [new RegExp(String.raw`${ANCHOR}[\\/]([A-Za-z0-9._\\/-]+\.(?:[A-Za-z0-9]+)(?![A-Za-z0-9]))`, 'g'), false],
    [/`(\.\.[\\/][A-Za-z0-9._\\/-]+\.md)(?:#[a-z0-9-]+)?`/g, true],
    [/\]\((\.\.?[\\/][A-Za-z0-9._\\/-]+\.md)\)/g, true],
  ];

  // Either separator in every pattern. This resolver reads the raw body on
  // purpose, so normalizePath never reaches it and each pattern has to accept
  // `\` itself. Slash-only left the backslash spelling of an out-of-root
  // reference visible to the classifier but INVISIBLE here — the layer that
  // actually checks containment. A failure count hides exactly that, because the
  // classifier keeps the total non-zero; only naming the tests that fired shows
  // which layer went quiet. One sample per pattern, both spellings, because two
  // of the three match nothing in the current corpus and would otherwise have no
  // coverage at all.
  const samples = [
    ['<plugin-root>/../workspace/evil.json', '<plugin-root>\\..\\workspace\\evil.json'],
    ['`../shared/x.md`', '`..\\shared\\x.md`'],
    ['[l](../shared/x.md)', '[l](..\\shared\\x.md)'],
  ];
  patterns.forEach(([re], i) => {
    for (const spelling of samples[i]) {
      re.lastIndex = 0;
      assert.ok(re.exec(spelling), `pattern ${i} must see both spellings: ${spelling}`);
    }
  });

  const broken = [];
  let resolved = 0;
  const realRoot = realpathSync(ROOT);
  for (const file of markdownFiles()) {
    const body = readFileSync(file, 'utf8');
    for (const [re, isRelative] of patterns) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(body))) {
        // Normalising the capture is load-bearing but NOT pinned: removing it
        // breaks no test, because no shipped document uses the backslash
        // spelling yet. The failure would first appear as a false `missing` on a
        // file that exists. Recorded, not claimed.
        const spelling = normalizePath(m[1]);
        const target = isRelative
          ? resolve(dirname(file), spelling)
          : join(ROOT, spelling);
        if (!existsSync(target)) {
          broken.push(`${relative(ROOT, file)} -> ${m[1]} (missing)`);
          continue;
        }
        // Existing is not enough: a target that resolves outside the plugin root
        // — lexically or through a symlinked component — is exactly the file an
        // attacker wants accepted. Containment is checked here too, so the two
        // tests cannot disagree about what counts as in-root.
        const real = realpathSync(target);
        if (real !== realRoot && !real.startsWith(realRoot + sep)) {
          broken.push(`${relative(ROOT, file)} -> ${m[1]} (resolves outside the plugin root: ${real})`);
          continue;
        }
        resolved += 1;
      }
    }
  }
  assert.deepEqual(broken, [], `unresolvable or out-of-root reference:\n  ${broken.join('\n  ')}`);
  assert.ok(resolved > 0, 'sweep matched no references at all — the patterns have rotted');
});

test('normalisation is applied to both sides of every comparison (Windows emulation)', () => {
  // On Windows the key builder returns backslash-joined keys. Patching only the
  // key side reproduces that. A guard that normalises the lookup but not the key
  // compares two different spellings and every `has()` misses — deny-by-default
  // then reports nothing and the suite passes **while a violation is present**.
  // Silently green is the worst state a guard can be in, and ci.yml runs
  // windows-latest, so this is pinned here rather than verified once by hand.
  const wrongSpelling = [...PLUGIN_FILES].filter((k) => k.includes('\\'));
  assert.deepEqual(wrongSpelling, [],
    'PLUGIN_FILES keys must be canonicalised at construction, not left in the host '
    + `separator:\n  ${wrongSpelling.slice(0, 10).join('\n  ')}`);

  const winRel = win32.relative('C:\\plugin-root', 'C:\\plugin-root\\scripts\\runtime\\scan.js');
  assert.equal(winRel, 'scripts\\runtime\\scan.js',
    'precondition — win32 relative must produce the backslash spelling');
  assert.equal(repoKey('C:\\plugin-root', 'C:\\plugin-root\\scripts\\runtime\\scan.js', win32.relative),
    'scripts/runtime/scan.js',
    'repoKey must canonicalise whatever separator its host relative() returns');
  assert.equal(PLUGIN_FILES.has(winRel), false,
    'the host-shaped spelling must not be a key — otherwise this test proves nothing');

  // End-to-end: rebuild the whole index the way a Windows host would spell it —
  // every shipped file, re-rooted under a win32 path, run back through the same
  // derivation — and require the result to be identical. This is what makes the
  // axis provable from a POSIX runner: with the normalisation removed from
  // repoKey, every one of these keys comes back with backslashes.
  const winRoot = 'C:\\plugin-root';
  const rebuilt = new Set([...PLUGIN_FILES].map((key) =>
    repoKey(winRoot, win32.join(winRoot, ...key.split('/')), win32.relative)));
  assert.deepEqual([...rebuilt].sort(), [...PLUGIN_FILES].sort(),
    'the index a Windows host builds must be key-for-key identical to this one');

  // Both call sites, driven behaviourally rather than pinned by source text. A
  // source-text assertion pins the spelling of a call; it cannot see the
  // normalisation being removed from inside the function that call names.
  const winKeys = buildPluginFiles({
    toKey: (p) => relative(ROOT, p).split(sep).join('\\'),
  });
  assert.ok(winKeys.has('scripts/runtime/scan.js'),
    'key generation must normalise, not merely store what the platform produced');

  // Nested source on purpose: from a root-level document `dirname` is ROOT, so
  // the source-relative branch reproduces the direct branch and would rescue an
  // un-normalised token side, hiding what this test claims to pin.
  const nested = join(ROOT, 'skills', 'deep-docs', 'SKILL.md');
  for (const spelling of ['scripts/runtime/scan.js', 'scripts\\runtime\\scan.js']) {
    assert.equal(resolvesInPlugin(spelling, nested, winKeys), true,
      `lookup must resolve against Windows-shaped keys: ${spelling}`);
  }

  // Non-vacuity, with a backslash token on purpose. A slash token makes this pair
  // decorative — the un-normalised key set misses either way, so it passes
  // however the token was handled. The backslash spelling discriminates.
  //
  // It is *dominated* in the current arrangement: the backslash lookup above
  // fails first on the same mutation, so this line adds no detection today. It is
  // kept as a backstop, because the assertion that dominates it is an enumeration
  // of spellings — and enumerations get trimmed.
  const rawKeys = new Set([...winKeys].map((k) => k.split('/').join('\\')));
  assert.equal(resolvesInPlugin('scripts\\runtime\\scan.js', nested, rawKeys), false,
    'un-normalised keys must not be reachable by an un-normalised token');

  // The `fromSource` half, exercised through the production call site with a
  // win32 `relative`. A relative token whose direct lookup misses must still
  // resolve via the source-relative branch, which it can only do if that branch
  // normalises its own result first. Nothing else can see this: on POSIX
  // `relative()` already returns slashes, so removing it is a no-op.
  const winRelative = (from, to) => relative(from, to).split('/').join('\\');
  // This pin is vacuous unless the DIRECT branch misses. `resolvesInPlugin`
  // strips the leading `./` and looks the bare basename up first; if a file of
  // that name sits at the repo root it returns there and the source-relative
  // branch — the thing being pinned — never runs, while the assertion still sees
  // `true`.
  assert.equal(winKeys.has('scan.js'), false,
    'a root-level scan.js would make the next assertion vacuous');
  assert.equal(
    resolvesInPlugin('./scan.js', join(ROOT, 'scripts', 'runtime', 'sibling.js'),
      winKeys, winRelative),
    true,
    'the source-relative branch must normalise its own result before looking it up');
});
