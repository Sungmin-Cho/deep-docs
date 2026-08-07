<!-- 출처: code.claude.com/docs/en/memory, code.claude.com/docs/en/best-practices, claude.com/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models (Anthropic 공식) -->

# CLAUDE.md Authoring Rules

`doc-author`가 CLAUDE.md를 **생성(create) / 재구성(restructure)**할 때 따르는 규칙. 기본 정책은 **AGENTS.md 우선 단일 소스(D13, `README.md` cross-document 규칙)** — CLAUDE.md는 `@AGENTS.md`를 import하는 **thin wrapper**이며 Claude Code 특화 내용만 담는다.

## 기본 형태 — thin wrapper

AGENTS.md가 **이미 존재하거나 같은 garden 세션에서 적용 확정된 경우**의 골격:

```
@AGENTS.md

# Claude Code 특화 지침
<Claude Code에서만 의미 있는 내용만>
```

- 첫 줄은 `@AGENTS.md` import — 공용 지침의 단일 소스는 AGENTS.md다.
- import 아래에는 **Claude Code 특화 내용만** 남긴다. 특화 내용이 없으면 import 한 줄만 있는 CLAUDE.md도 유효하다.

## 필터 — "Claude Code에서만 의미 있는 것만" (thin wrapper)

포함 (Claude Code 특화):

- Claude Code 전용 기능 관련 지침: hooks 권장 한 줄(D8), 커스텀 slash command / skill 사용법, MCP 서버 참고, permissions / `settings.json` 주의점.
- Claude Code에서만 다르게 동작하는 함정 (예: plan mode, subagent dispatch 관련 프로젝트 규칙).

제외 (전부 AGENTS.md 담당):

- build / test / lint 명령, tech stack, 디렉터리 구조, 컨벤션, 일반 gotchas — 런타임 공용 지침.
- 공용 지침의 CLAUDE.md 중복 기재 — `@AGENTS.md` import로 이미 로드된다.
- 세션에서 자동 축적되는 성격의 기록 — 선호, 일회성 맥락, 진행 상황. auto-memory가 담당하므로 CLAUDE.md에 수동으로 넣지 않는다.

## fallback — 단독(full) 골격

AGENTS.md가 없고 이번 세션에서도 적용 확정되지 않은 경우(예: 사용자가 AGENTS.md 생성 gap을 거부), CLAUDE.md는 단독 지침 문서다. `@AGENTS.md` import를 넣지 않고(dead import 금지) Anthropic 공식 골격을 쓴다:

```
Project overview(1~2줄) → Gotchas → 선택이 모호한 명령(이유 포함) → 기본값과 다른 규칙 → 다른 문서로의 포인터
```

단독 골격의 필터는 "Claude가 코드에서 알 수 없는 것만":

- 포함: **함정(gotchas)** 을 최우선으로, **선택이 모호한 명령**(어느 것을 왜 쓰는지 함께 — 매니페스트 Read는 모호성 판단용이고, 하나뿐이라 모호하지 않은 명령은 쓰지 않는다), **기본값과 다른 규칙**.
- 제외: 코드를 읽으면 바로 아는 것 — **tech stack 나열**, **디렉터리 구조 나열**, 모호하지 않은 명령 나열. 자명한 관행, **파일별 설명**, **linter가 이미 강제하는 스타일**. 이것들은 Rule 11(`self-discoverable`)이 적발하는 대상이므로 생성 단계에서 만들지 않는다.
- **섹션은 선택이다.** 채울 내용이 없으면 비운다 — 빈 섹션을 자명한 정보로 메우지 않는다. 섹션 부재는 thin-doc 사유가 아니다(`scan-rules.md` Rule 9의 doc-kind 분기).

## progressive disclosure

지침이 길어지면 한 문서를 늘리지 말고, 적시에 로드되는 파일 트리로 나누는 편이 낫다. 다만 **doc-author는 파일을 만들거나 옮길 수 없다** — 권한이 `Read, Glob, Grep`뿐이고 `authoring-commit`은 root-only allowlist다.

- draft 본문에는 **이미 존재하는 문서로의 포인터만** 넣는다 (D9 — 거부되거나 없는 문서로의 포인터는 dead reference를 새로 만든다).
- 분할 자체는 수행하지 않는다. 분할이 필요하다는 판단은 gap의 `rationale`과 audit의 context-efficiency 관측으로 **사용자에게 권장**될 뿐이다.

## 길이

- **thin wrapper 목표 ≤30줄** — import + Claude 특화만 남으면 자연 달성된다.
- **단독(full) 골격: soft 목표 ≤100줄, hard ceiling = 200줄** (Anthropic 공식 권고). 200줄 근처면 압축/분할을 **시도**한다.
- **hard fail 없음 (audit과 대칭)**: 초과는 authoring 실패가 아니라 `size-warning`(audit-only, **비차단**)으로 보고만 된다. 과압축으로 정보를 잃지 않는다.

## hook 회피 원칙 (D8)

"항상 X 전에 Y" 류의 **강제 규칙은 prose로 작성하지 않는다**. 이런 행동 강제는 harness(PreToolUse hook)가 실행하는 것이지 prose 지침으로 보장되지 않는다. 필요 시 "이 동작은 PreToolUse hook으로 강제하길 권장" 한 줄만 남긴다. 기존 문서에 이미 있는 이런 강제 규칙은 `scan-rules.md`의 Rule 10(b) `over-constraint`가 audit-only로 탐지한다.

## mode 분기

### create

- AGENTS.md 존재/세션 확정 → **thin wrapper 골격**으로 신규 작성.
- 아니면 → **fallback 단독 골격**. 코드 분석(디렉터리/매니페스트/린터)에서 도출 가능한 것만 채운다.

### restructure — 고유 콘텐츠 식별 + 공용 콘텐츠 이관 (§6.2)

기존 문서를 파싱해 각 블록을 분류한다:

- **"재생성 가능"(→ `removal_candidates`)** = 코드 / 빌드설정 / 공식 규칙에서 **직접 도출 가능한** 문장만 (예: 매니페스트에서 그대로 읽히는 build 명령, 디렉터리 구조 나열).
- **"AGENTS.md로 이관된 공용 블록"(→ `removal_candidates`, reason에 이관 명시)** = AGENTS.md가 이미 담고 있거나 같은 세션의 AGENTS.md draft가 수용한 런타임 공용 지침. **이관은 삭제가 아니다** — 내용은 AGENTS.md에 존재하고 `@AGENTS.md` import로 계속 로드된다. garden은 per-removal 승인 시 이관 사실을 함께 보여준다.
- **그 외 전부 `preserved_blocks`로 기본 보존(보수적 편향)** — Claude 특화인지 애매한 블록은 **보존**(default-keep). 사람이 작성한 함정/의사결정 근거/팀 컨벤션은 애매하면 보존.
- 분류 결과는 구조화 result로 반환하고, garden이 `removal_candidates`를 per-removal 승인받아 **미승인분을 draft에 재삽입**한다 → default-keep이 contract로 강제됨(silent drop 불가). 미승인 이관 블록이 재삽입되어 AGENTS.md와 일시적으로 중복돼도 안전이 우선이다 — 잔여 중복은 이후 scan의 duplicate/audit 신호로 다시 드러난다.
