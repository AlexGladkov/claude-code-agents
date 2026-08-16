export const meta = {
  name: 'business-feature',
  description: 'Реализация бизнес-фичи консилиумом: research → plan → spec DoD/DoR → executing → validation → отчёт',
  whenToUse: 'Новая функциональность, доработка, интеграция, новый экран, API endpoint. Запускается скиллом /feature.',
  phases: [
    { title: 'Resolve', detail: 'Резолв роль→агент из проектного CLAUDE.md ## Agents (с дефолтами)' },
    { title: 'Research', detail: 'Консилиум parallel: architect/frontend/ui/security/devops/api → анализ задачи и кодобазы' },
    { title: 'Plan', detail: 'Синтез плана реализации из находок консилиума' },
    { title: 'Spec', detail: 'DoD/DoR фичи: машина состояний, все визуальные состояния, edge cases, бизнес-правила' },
    { title: 'Executing', detail: 'Exec-агенты по file-scope реализуют фичу в feature-ветке (isolation: worktree)' },
    { title: 'Validate', detail: 'Сборка + юнит-тесты + сверка с DoD/DoR' },
    { title: 'Report', detail: 'swarm-report/<slug>-<date>-feature.md' },
  ],
}

// ── args (передаёт skill /feature) ───────────────────────────────────────────
//   request    : описание фичи от пользователя
//   cwd        : абсолютный путь корня проекта
//   date       : YYYY-MM-DD (скрипт не имеет доступа к Date.now)
//   slug       : basename репо/cwd
//   baseBranch : ветка, от которой бранчеваться (из гейта в skill)
const REQUEST = (args && args.request) || ''
const CWD = (args && args.cwd) || '.'
const DATE = (args && args.date) || 'unknown-date'
const SLUG = (args && args.slug) || 'project'
const BASE_BRANCH = (args && args.baseBranch) || 'main'

// Дефолтная карта роль→агент (из глобального CLAUDE.md). Resolve её переопределяет,
// если в проектном CLAUDE.md есть секция ## Agents.
const DEFAULT_CONSILIUM = {
  architect: 'voltagent-lang:java-architect',
  frontend: 'voltagent-lang:vue-expert',
  ui: 'voltagent-core-dev:ui-designer',
  security: 'security-kotlin',
  devops: 'devops-orchestrator',
  api: 'voltagent-core-dev:api-designer',
}
const DEFAULT_EXECUTING = [
  { scope: 'backend/**/*.kt, springApp/**/*.kt', agent: 'builder-spring-feature', layer: 'backend' },
  { scope: 'composeApp/**/*.kt, shared/**/*.kt, core-kmp/**/*.kt', agent: 'kotlin-multiplatform-developer', layer: 'mobile' },
  { scope: '**/*.vue, **/*.ts', agent: 'voltagent-lang:vue-expert', layer: 'web' },
]

const RESOLVE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['consilium', 'executing'],
  properties: {
    consilium: {
      type: 'object',
      additionalProperties: false,
      required: ['architect', 'frontend', 'ui', 'security', 'devops', 'api'],
      properties: {
        architect: { type: 'string' },
        frontend: { type: 'string' },
        ui: { type: 'string' },
        security: { type: 'string' },
        devops: { type: 'string' },
        api: { type: 'string' },
      },
    },
    executing: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['scope', 'agent', 'layer'],
        properties: {
          scope: { type: 'string' },
          agent: { type: 'string' },
          layer: { type: 'string' },
        },
      },
    },
  },
}

const FINDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['role', 'analysis', 'concerns', 'recommendations'],
  properties: {
    role: { type: 'string' },
    analysis: { type: 'string', description: 'Что выяснено с точки зрения роли' },
    concerns: { type: 'array', items: { type: 'string' }, description: 'Риски, ограничения, зависимости' },
    recommendations: { type: 'array', items: { type: 'string' }, description: 'Что важно учесть при реализации' },
  },
}

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'steps', 'affectedLayers', 'risks'],
  properties: {
    summary: { type: 'string' },
    steps: { type: 'array', items: { type: 'string' } },
    affectedLayers: { type: 'array', items: { type: 'string', enum: ['backend', 'mobile', 'web'] } },
    risks: { type: 'array', items: { type: 'string' } },
  },
}

const SPEC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dod', 'dor', 'states', 'edgeCases', 'businessRules'],
  properties: {
    dod: { type: 'array', items: { type: 'string' }, description: 'Definition of Done: критерии приёмки' },
    dor: { type: 'array', items: { type: 'string' }, description: 'Definition of Ready: что должно быть готово до старта' },
    states: {
      type: 'object',
      additionalProperties: false,
      required: ['loading', 'empty', 'error', 'offline', 'populated'],
      properties: {
        loading: { type: 'string' },
        empty: { type: 'string' },
        error: { type: 'string' },
        offline: { type: 'string' },
        populated: { type: 'string' },
      },
    },
    edgeCases: { type: 'array', items: { type: 'string' } },
    businessRules: { type: 'array', items: { type: 'string' } },
  },
}

const EXEC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['layer', 'changedFiles', 'summary'],
  properties: {
    layer: { type: 'string' },
    changedFiles: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}

const VALIDATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['passed', 'buildPassed', 'testsPassed', 'dodChecked', 'details'],
  properties: {
    passed: { type: 'boolean' },
    buildPassed: { type: 'boolean' },
    testsPassed: { type: 'boolean' },
    dodChecked: { type: 'boolean', description: 'Все состояния и edge cases из DoD реализованы' },
    details: { type: 'string' },
  },
}

// ── Phase 0: Resolve ──────────────────────────────────────────────────────────
phase('Resolve')
const resolved = await agent(
  `Ты резолвер агентов для оркестрации в проекте по пути ${CWD}.
Прочитай ${CWD}/CLAUDE.md, секцию "## Agents" (Консилиум + Executing), если она есть.
Верни карту роль→конкретный агент для консилиума (architect, frontend, ui, security, devops, api)
и список executing-агентов по file-scope.
Если секции ## Agents нет или роль не указана — используй дефолты:
консилиум = ${JSON.stringify(DEFAULT_CONSILIUM)}
executing = ${JSON.stringify(DEFAULT_EXECUTING)}
Имена агентов бери РОВНО как в проектном CLAUDE.md либо как в дефолтах — не выдумывай.`,
  { label: 'resolve-agents', phase: 'Resolve', schema: RESOLVE_SCHEMA, model: 'haiku' }
)

const consilium = (resolved && resolved.consilium) || DEFAULT_CONSILIUM
const executing = (resolved && resolved.executing && resolved.executing.length)
  ? resolved.executing
  : DEFAULT_EXECUTING

// ── Phase 1: Research — консилиум (parallel barrier) ─────────────────────────
phase('Research')
const lenses = [
  { role: 'architect', agent: consilium.architect, focus: 'архитектура, модули, зависимости, SOLID, как вписать фичу без нарушения инвариантов' },
  { role: 'frontend', agent: consilium.frontend, focus: 'UI/UX паттерны, компоненты, навигация, state management' },
  { role: 'ui', agent: consilium.ui, focus: 'визуальные состояния (Loading/Empty/Error/Offline/Populated), консистентность с соседними экранами, дизайн-система' },
  { role: 'security', agent: consilium.security, focus: 'OWASP, авторизация, валидация входных данных, уязвимости' },
  { role: 'devops', agent: consilium.devops, focus: 'инфра, конфиги, feature flags, деплой, окружения' },
  { role: 'api', agent: consilium.api, focus: 'контракты API, REST/GraphQL, обратная совместимость, версионирование' },
]
const findings = (await parallel(lenses.map((l) => () =>
  agent(
    `Проект: ${CWD}. Фича от пользователя: "${REQUEST}".
Твоя линза — ${l.role}: ${l.focus}.
Исследуй кодобазу (ast-index/grep/read). Найди что важно учесть при реализации этой фичи
с твоей точки зрения. Верни анализ, риски и конкретные рекомендации.`,
    { label: `research:${l.role}`, phase: 'Research', schema: FINDING_SCHEMA, agentType: l.agent }
  )
))).filter(Boolean)

// ── Phase 2: Plan ─────────────────────────────────────────────────────────────
phase('Plan')
const plan = await agent(
  `Ты синтезируешь план реализации фичи "${REQUEST}" по результатам консилиума.
Проект: ${CWD}. Находки консилиума: ${JSON.stringify(findings)}.
Составь пошаговый план реализации с учётом ВСЕХ рекомендаций и рисков.
Укажи затронутые слои (backend/mobile/web) и ключевые риски.`,
  { label: 'plan-synth', phase: 'Plan', schema: PLAN_SCHEMA }
)

// ── Phase 3: Spec DoD/DoR ─────────────────────────────────────────────────────
phase('Spec')
const spec = await agent(
  `Проект: ${CWD}. Фича: "${REQUEST}".
План: ${JSON.stringify(plan)}.
Находки консилиума (ui): ${JSON.stringify(findings.find((f) => f.role === 'ui'))}.
Опиши контракт приёмки фичи: DoD (критерии готовности), DoR (что должно быть готово до старта).
ВСЕ визуальные состояния: Loading, Empty+CTA, Error+retry, Offline, Populated.
Edge cases (E1–E15). Бизнес-правила и инварианты. Консистентность с соседними экранами.
Это ТЗ — без него Executing не начинается.`,
  { label: 'spec-dod', phase: 'Spec', schema: SPEC_SCHEMA }
)

// ── Phase 4: Executing — exec-агенты по слоям (parallel, feature branch) ─────
phase('Executing')
const affectedLayers = (plan && plan.affectedLayers && plan.affectedLayers.length)
  ? plan.affectedLayers
  : ['backend']
const execTargets = affectedLayers
  .map((layer) => executing.find((e) => e.layer === layer))
  .filter(Boolean)
const execAgents = execTargets.length ? execTargets : [executing[0]]

const execResults = (await parallel(execAgents.map((t) => () =>
  agent(
    `Проект: ${CWD}. Слой: ${t.layer}. Файлы под твоим scope: ${t.scope}.
Фича: "${REQUEST}".
Ветка: от origin/${BASE_BRANCH} создай feature/$(echo "${REQUEST}" | tr ' ' '-' | tr '[:upper:]' '[:lower:]' | head -c 40).
Используй: git fetch origin ${BASE_BRANCH} && git checkout -b <branch-name> origin/${BASE_BRANCH}.
Plan: ${JSON.stringify(plan)}.
Spec DoD/DoR: ${JSON.stringify(spec)}.
Реализуй ВСЕ состояния и edge cases из DoD — не только happy path.
Верни список изменённых файлов и краткое описание реализованного.`,
    { label: `exec:${t.layer}`, phase: 'Executing', schema: EXEC_SCHEMA, agentType: t.agent, isolation: 'worktree' }
  )
))).filter(Boolean)

// ── Phase 5: Validate ─────────────────────────────────────────────────────────
phase('Validate')
const allChangedFiles = execResults.flatMap((r) => r.changedFiles || [])

const validation = await agent(
  `Проект: ${CWD}. Провалидируй реализацию фичи "${REQUEST}".
Изменённые файлы: ${JSON.stringify(allChangedFiles)}.
Spec DoD/DoR: ${JSON.stringify(spec)}.
Шаги:
1. Запусти сборку через Bash (gradle/скрипт проекта) — убедись что собирается.
2. Запусти юнит-тесты — убедись что проходят, нет регрессий.
3. Сверься с DoD из spec: каждое состояние (Loading/Empty/Error/Offline/Populated) и
   каждый edge case реализованы? Если что-то пропущено — отметь dodChecked=false и опиши.
Верни passed + buildPassed + testsPassed + dodChecked + детали (что запускал, вывод).`,
  { label: 'validate', phase: 'Validate', schema: VALIDATE_SCHEMA, model: 'sonnet' }
)

// ── Phase 6: Report ───────────────────────────────────────────────────────────
phase('Report')
const reportPath = `./swarm-report/${SLUG}-${DATE}-feature.md`
await agent(
  `Напиши финальный отчёт в файл ${CWD}/${reportPath} (Write).
"# Feature Report — ${DATE}". Фича: "${REQUEST}".
Консилиум (находки): ${JSON.stringify(findings)}.
Plan: ${JSON.stringify(plan)}.
Spec DoD/DoR: ${JSON.stringify(spec)}.
Executing: ${JSON.stringify(execResults)}.
Validation: ${JSON.stringify(validation)}.
Статус: ${validation && validation.passed ? 'Done' : 'Partial — валидация не прошла'}.
Структура: название фичи, дата, описание задачи, резюме консилиума, план, что реализовано (файлы),
результат валидации (сборка/тесты/DoD-сверка), риски/откаты, статус.`,
  { label: 'report', phase: 'Report', model: 'haiku' }
)

return {
  status: validation && validation.passed ? 'done' : 'partial',
  plan,
  spec,
  execResults,
  validation,
  report: reportPath,
}
