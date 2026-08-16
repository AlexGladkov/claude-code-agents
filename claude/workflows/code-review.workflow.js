export const meta = {
  name: 'code-review',
  description: 'Ревью PR/диффа консилиумом: diff → review (parallel линзы) → синтез → (комменты) → отчёт. READ-ONLY.',
  whenToUse: 'Code review, ревью PR, проверь PR, посмотри PR, отревьюь диф. Запускается скиллом /pr-review.',
  phases: [
    { title: 'Resolve', detail: 'Резолв роль→агент из проектного CLAUDE.md ## Agents (с дефолтами)' },
    { title: 'Diff', detail: 'Собрать изменённый набор (git diff / gh pr diff), список файлов + слои' },
    { title: 'Review', detail: 'Консилиум parallel: architect/security/api/developer/test ревьюят реальный diff' },
    { title: 'Synthesize', detail: 'Свод находок, дедуп, приоритизация по severity, verdict' },
    { title: 'Comment', detail: 'Инлайн-комментарии в PR через gh CLI (только при postComments)' },
    { title: 'Report', detail: 'swarm-report/<slug>-<date>-review.md' },
  ],
}

// ── args (передаёт skill /pr-review) ──────────────────────────────────────
//   request      : сырой текст запроса (что ревьюим)
//   cwd          : абсолютный путь корня проекта
//   date         : YYYY-MM-DD (скрипт не имеет доступа к Date.now)
//   slug         : basename репо/cwd
//   target       : 'pr:<N>' | 'branch' | 'staged'
//   base         : базовая ветка для diff (для target=branch)
//   postComments : постить ли инлайн-комменты в PR (только при target=pr:<N>)
const REQUEST = (args && args.request) || ''
const CWD = (args && args.cwd) || '.'
const DATE = (args && args.date) || 'unknown-date'
const SLUG = (args && args.slug) || 'project'
const TARGET = (args && args.target) || 'branch'
const BASE = (args && args.base) || 'main'
const POST_COMMENTS = !!(args && args.postComments)

const PR_MATCH = /^pr:(.+)$/.exec(TARGET)
const PR_NUMBER = PR_MATCH ? PR_MATCH[1] : null

// Дефолтная карта роль→агент (из глобального CLAUDE.md). Resolve её переопределяет,
// если в проектном CLAUDE.md есть секция ## Agents.
const DEFAULT_CONSILIUM = {
  architect: 'voltagent-lang:java-architect',
  security: 'security-kotlin',
  api: 'voltagent-core-dev:api-designer',
  developer: 'voltagent-lang:kotlin-specialist',
  test: 'test-spring',
  frontend: 'voltagent-lang:vue-expert',
}

const RESOLVE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['consilium'],
  properties: {
    consilium: {
      type: 'object',
      additionalProperties: false,
      required: ['architect', 'security', 'api', 'developer', 'test', 'frontend'],
      properties: {
        architect: { type: 'string' },
        security: { type: 'string' },
        api: { type: 'string' },
        developer: { type: 'string' },
        test: { type: 'string' },
        frontend: { type: 'string' },
      },
    },
  },
}

const DIFF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['hasChanges', 'summary', 'files', 'layers'],
  properties: {
    hasChanges: { type: 'boolean' },
    summary: { type: 'string', description: 'Title/цель PR, что меняется в целом' },
    files: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'layer'],
        properties: {
          path: { type: 'string' },
          layer: { type: 'string', enum: ['backend', 'mobile', 'web', 'infra', 'other'] },
        },
      },
    },
    layers: { type: 'array', items: { type: 'string', enum: ['backend', 'mobile', 'web', 'infra', 'other'] } },
    diff: { type: 'string', description: 'Сам unified diff (может быть усечён для крупных PR)' },
  },
}

const FINDING = {
  type: 'object',
  additionalProperties: false,
  required: ['file', 'line', 'severity', 'issue', 'suggestion'],
  properties: {
    file: { type: 'string' },
    line: { type: 'string', description: 'Номер строки или диапазон' },
    severity: { type: 'string', enum: ['blocker', 'critical', 'major', 'minor', 'info'] },
    causedByPr: { type: 'string', enum: ['yes', 'indirect'] },
    issue: { type: 'string' },
    suggestion: { type: 'string' },
  },
}

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['role', 'findings'],
  properties: {
    role: { type: 'string' },
    findings: { type: 'array', items: FINDING },
  },
}

const SYNTH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'counts', 'findings'],
  properties: {
    verdict: { type: 'string', enum: ['APPROVE', 'COMMENT', 'REQUEST_CHANGES'] },
    counts: {
      type: 'object',
      additionalProperties: false,
      required: ['blocker', 'critical', 'major', 'minor', 'info'],
      properties: {
        blocker: { type: 'number' },
        critical: { type: 'number' },
        major: { type: 'number' },
        minor: { type: 'number' },
        info: { type: 'number' },
      },
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'line', 'severity', 'issue', 'suggestion', 'roles'],
        properties: {
          file: { type: 'string' },
          line: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'critical', 'major', 'minor', 'info'] },
          issue: { type: 'string' },
          suggestion: { type: 'string' },
          roles: { type: 'array', items: { type: 'string' }, description: 'Роли-источники находки' },
        },
      },
    },
  },
}

const COMMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['posted', 'details'],
  properties: {
    posted: { type: 'boolean' },
    details: { type: 'string' },
  },
}

// ── Как получить diff под выбранный target (для промптов) ─────────────────
const diffCmd = PR_NUMBER
  ? `gh pr diff ${PR_NUMBER} (файлы: gh pr diff ${PR_NUMBER} --name-only; мета: gh pr view ${PR_NUMBER} --json title,body,baseRefName,headRefName,files)`
  : TARGET === 'staged'
    ? `git -C ${CWD} diff --staged (файлы: git -C ${CWD} diff --staged --name-only)`
    : `git -C ${CWD} diff ${BASE}..HEAD (файлы: git -C ${CWD} diff ${BASE}..HEAD --name-only)`

// ── Phase 0: Resolve ──────────────────────────────────────────────────────
phase('Resolve')
const resolved = await agent(
  `Ты резолвер агентов для оркестрации в проекте по пути ${CWD}.
Прочитай ${CWD}/CLAUDE.md, секцию "## Agents" (Консилиум), если она есть.
Верни карту роль→конкретный агент для консилиума ревью: architect, security, api, developer, test, frontend.
Если секции ## Agents нет или роль не указана — используй дефолты:
${JSON.stringify(DEFAULT_CONSILIUM)}
Имена агентов бери РОВНО как в проектном CLAUDE.md либо как в дефолтах — не выдумывай.`,
  { label: 'resolve-agents', phase: 'Resolve', schema: RESOLVE_SCHEMA, model: 'haiku' }
)

const consilium = (resolved && resolved.consilium) || DEFAULT_CONSILIUM

// ── Phase 1: Diff ─────────────────────────────────────────────────────────
phase('Diff')
const diff = await agent(
  `Проект: ${CWD}. Цель ревью: "${REQUEST}". Target: ${TARGET}.
Собери набор изменений через Bash: ${diffCmd}.
Верни: hasChanges, краткое summary (цель/title PR если есть — из gh pr view),
список файлов с их слоем (backend/mobile/web/infra/other по путям), список слоёв,
и сам unified diff (при большом объёме — усеки, оставив содержательные хунки).
Ничего НЕ меняй в коде — только сбор данных для ревью.`,
  { label: 'collect-diff', phase: 'Diff', schema: DIFF_SCHEMA, model: 'sonnet' }
)

if (!diff || diff.hasChanges === false || !(diff.files && diff.files.length)) {
  phase('Report')
  const emptyPath = `./swarm-report/${SLUG}-${DATE}-review.md`
  await agent(
    `Напиши отчёт в файл ${CWD}/${emptyPath} (используй Write).
"# Code Review: пустой diff — ${DATE}". Запрос: "${REQUEST}". Target: ${TARGET}.
Diff-сбор: ${JSON.stringify(diff)}. Объясни, что менять нечего (нет изменений в выбранном target)
и что проверить (правильный ли base/PR, застейджены ли файлы).`,
    { label: 'report-empty', phase: 'Report', model: 'haiku' }
  )
  return { status: 'reviewed', findings: [], report: emptyPath }
}

// ── Phase 2: Review — консилиум (parallel barrier) ────────────────────────
phase('Review')
const SCOPE_RULES = `## SCOPE (СТРОГО, read-only)
Ревьюй ТОЛЬКО код, изменённый в этом diff (добавленные/затронутые строки).
Полные файлы читай ЛИШЬ как контекст. НЕ репорти pre-existing проблемы (существовавшие до изменений).
Тест: "проблема ПОЯВИЛАСЬ из-за этих изменений или была раньше?" — появилась → репорти, была → нет.
Исключение: неизменённую строку можно репортить, только если изменение diff её ЛОМАЕТ (баг/краш/уязвимость) — тогда causedByPr:indirect.
КОД НЕ МЕНЯЙ (никаких Edit/Write в исходники). Только находки.`

const lenses = [
  { role: 'architect', agent: consilium.architect, focus: 'SOLID, слоёная архитектура, зависимости, god-классы, циклические зависимости, нарушение boundaries' },
  { role: 'security', agent: consilium.security, focus: 'OWASP Top 10, hardcoded secrets, SQL/XSS injection, missing auth, exposed internals, небезопасная крипта' },
  { role: 'api', agent: consilium.api, focus: 'контракты API, валидация входных, naming consistency, error responses, breaking changes, обратная совместимость' },
  { role: 'developer', agent: consilium.developer, focus: 'языковые идиомы, best practices стека, anti-patterns, корректность типов, naming, код-стиль проекта' },
  { role: 'test', agent: consilium.test, focus: 'покрытие изменений тестами, качество тестов, отсутствие проверок edge-case, регресс-риски без тестов' },
]
const reviews = (await parallel(lenses.map((l) => () =>
  agent(
    `Проект: ${CWD}. Code review. Цель: "${REQUEST}". Target: ${TARGET}.
Данные diff: ${JSON.stringify(diff)}.
Твоя линза — ${l.role}: ${l.focus}.
Ревьюй РЕАЛЬНЫЙ diff под этим углом. Читай окружающий код как контекст (ast-index/grep/read).
${SCOPE_RULES}
Верни role + findings (severity/файл/строка/причинность/проблема/фикс). Если чисто — findings: [].`,
    { label: `review:${l.role}`, phase: 'Review', schema: REVIEW_SCHEMA, agentType: l.agent }
  )
))).filter(Boolean)

// ── Phase 3: Synthesize ───────────────────────────────────────────────────
phase('Synthesize')
const synthesis = await agent(
  `Ты сводишь находки code review PR/диффа "${REQUEST}".
Находки консилиума (по ролям): ${JSON.stringify(reviews)}.
Diff-контекст: ${JSON.stringify(diff)}.
Задача:
1. Дедуп: одну проблему в одном файле/строке — объединить, взять максимальный severity, перечислить роли-источники.
2. Отфильтровать pre-existing (не связанные с изменениями) находки.
3. Adversarially перепроверь сомнительные/спорные находки (ложные срабатывания — убрать).
4. Приоритизируй по severity, посчитай counts.
5. Verdict: есть blocker или critical → REQUEST_CHANGES; только major и ниже → COMMENT; только minor+info или пусто → APPROVE.
Верни verdict + counts + отсортированный список findings с roles. Код НЕ трогай.`,
  { label: 'synthesize', phase: 'Synthesize', schema: SYNTH_SCHEMA, model: 'sonnet' }
)

// ── Phase 4: Comment — инлайн-комменты в PR (опционально) ──────────────────
let commentResult = null
if (POST_COMMENTS && PR_NUMBER) {
  phase('Comment')
  commentResult = await agent(
    `Проект: ${CWD}. Запости результаты code review инлайн-комментариями в PR #${PR_NUMBER} через gh CLI (Bash).
Свод ревью: ${JSON.stringify(synthesis)}.
Для каждой находки — инлайн-коммент на файл:строку (gh api repos/:owner/:repo/pulls/${PR_NUMBER}/comments
или gh pr review ${PR_NUMBER} с --comment и телом-сводкой, если инлайн по позиции не выходит).
Тело коммента: [severity][roles] issue → suggestion.
НЕ approve/не merge/не push и НЕ меняй код — только оставляй ревью-комментарии.
Верни posted + details (что и куда запостил).`,
    { label: 'comment-pr', phase: 'Comment', schema: COMMENT_SCHEMA, model: 'sonnet' }
  )
}

// ── Phase 5: Report ───────────────────────────────────────────────────────
phase('Report')
const reportPath = `./swarm-report/${SLUG}-${DATE}-review.md`
await agent(
  `Напиши финальный отчёт code review в файл ${CWD}/${reportPath} (используй Write). КОД/worktree НЕ трогай.
"# Code Review — ${DATE}". Запрос: "${REQUEST}". Target: ${TARGET}${PR_NUMBER ? ` (PR #${PR_NUMBER})` : ''}.
Diff-сводка: ${JSON.stringify(diff)}.
Свод находок: ${JSON.stringify(synthesis)}.
Комменты в PR: ${JSON.stringify(commentResult)}.
Структура: Verdict (${synthesis && synthesis.verdict}), затронутые файлы+слои,
находки по severity (Blocker/Critical/Major/Minor/Info) в формате [roles] file:line — issue → suggestion,
итоговый Summary с counts. Отметь, постились ли комменты в PR.`,
  { label: 'report', phase: 'Report', model: 'haiku' }
)

return {
  status: 'reviewed',
  verdict: synthesis && synthesis.verdict,
  counts: synthesis && synthesis.counts,
  findings: (synthesis && synthesis.findings) || [],
  comments: commentResult,
  report: reportPath,
}
