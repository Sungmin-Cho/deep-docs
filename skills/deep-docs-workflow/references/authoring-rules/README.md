# Authoring Rules — Index

`doc-author`가 권장 에이전트 지침 문서를 **생성/재구성**할 때 참조하는 공식 규칙 모음. garden의 authoring sub-flow가 `doc-author`를 spawn할 때, `authoring_spec.doc_kind`에 맞는 규칙 파일을 로드한다. 기존 `scan-filters/`와 동일한 reference 패턴.

## 규칙 파일

| doc_kind | 파일 | 출처 |
|---|---|---|
| `claude-md` | [`<plugin-root>/skills/deep-docs-workflow/references/authoring-rules/claude-md.md`](claude-md.md) | Anthropic 공식 (code.claude.com/docs) |
| `agents-md` | [`<plugin-root>/skills/deep-docs-workflow/references/authoring-rules/agents-md.md`](agents-md.md) | OpenAI Codex 공식 + agents.md 표준 |
| `architecture-md` | [`<plugin-root>/skills/deep-docs-workflow/references/authoring-rules/architecture-md.md`](architecture-md.md) | matklad ARCHITECTURE.md 표준 |

## 공통 원칙

- **출처 주석**: 각 규칙 파일은 상단에 공식 출처 URL을 주석으로 명시한다 (생성 로직의 근거 + 버전 관리).
- **길이 자가검사**: 각 문서 종류의 길이 목표(soft)와 차단선(hard)을 doc-author가 draft 산출 시 자가검사한다. 줄 수 초과는 비차단 size-warning, AGENTS 32KiB만 hard fail (garden이 Write 직전 정확 강제).
- **default-keep**: restructure 시 애매한 콘텐츠는 보존한다. "재생성 가능"만 `removal_candidates`로, 그 외는 `preserved_blocks`로 보수적 분류.
- **판단 우선 (D14)**: 생성 시 두 가지를 만들지 않는다 — 매니페스트나 디렉터리 트리에서 그대로 읽히는 서술과, 스타일·장황함 영역의 절대 규칙. `scan-rules.md`의 Rule 10·11이 탐지하는 것과 같은 기준이며, 보고와 생성이 같은 기준을 쓰게 하는 것이 이 결정의 목적이다.
  - 따라서 `claude-md`와 `agents-md`의 골격에서 **섹션은 선택**이다. 채울 내용이 없는 섹션을 자명한 정보로 메우는 것이 위 두 금지에 정면으로 걸리기 때문이다. `architecture-md`는 구조 자체가 문서의 목적이므로 여기서 제외한다.
  - 이 섹션 선택화가 `scan-rules.md` Rule 9의 thin-doc doc-kind 분기가 근거로 인용하는 바로 그 사실이다 — 그쪽 문장이 "authoring-rules D14"를 가리키므로 이 항목이 그 내용을 실제로 담아야 한다.

## cross-document 연결 규칙 (D9)

doc-author가 여러 문서를 다룰 때의 연결 정책:

1. **ARCHITECTURE 참조 포인터** — CLAUDE.md / AGENTS.md 생성 시, ARCHITECTURE.md가 **이미 존재하거나 같은 garden 세션에서 적용 확정된 경우에만** "코드 구조는 ARCHITECTURE.md 참조" 한 줄 포인터를 삽입한다 (`@import` 아님 — `@import`는 세션마다 전량 로드되어 토큰 낭비). **거부된/미존재 문서로의 포인터는 금지** — dead-reference를 새로 만들기 때문.

2. **AGENTS.md 우선 단일 소스 (D13)** — 기본 관리 문서는 **AGENTS.md**다. 런타임 공용 지침(명령/컨벤션/구조/함정)은 전부 AGENTS.md에 두고, CLAUDE.md는 첫 줄 `@AGENTS.md` import + **Claude Code 특화 내용만** 담는 thin wrapper로 유지한다. 공용 지침을 CLAUDE.md에 중복 기재하지 않는다. (rule 1의 `@import` 토큰 비용 경고는 ARCHITECTURE 같은 참고 문서에 대한 것이다 — AGENTS.md는 세션마다 로드되어야 하는 지침 본문이므로 `@import`가 의도된 동작.)

3. **AGENTS-first 순서** — 같은 garden 세션에서 AGENTS.md gap을 CLAUDE.md gap보다 먼저 처리한다. `@AGENTS.md` import는 AGENTS.md가 **이미 존재하거나 같은 세션에서 적용 확정된 경우에만** 삽입한다(rule 1의 dead-pointer 금지와 동일 원리). AGENTS.md 생성이 거부되면 CLAUDE.md는 thin wrapper로 전환하지 않고 단독 full 골격(`<plugin-root>/skills/deep-docs-workflow/references/authoring-rules/claude-md.md` fallback)을 유지한다.

4. **심볼릭 링크 금지** — 심볼릭 링크 공존은 Windows 호환성 위험이 있고 scanner의 non-symlink discovery 정책과 충돌해(symlink 문서는 스캔에서 제외됨) 사용하지 않는다. 공존 수단은 `@AGENTS.md` import 하나다.
