export const meta = {
  name: 'redesign',
  description: 'Редизайн UI консилиумом: design audit (parallel) → brief → визуальные правки по scope → playwright-валидация → отчёт',
  whenToUse: 'Редизайн, redesign, переделать UI, обновить дизайн, поменять стиль, визуальные изменения, перерисовать. Меняется только визуал, бизнес-логика не трогается. Запускается скиллом /redesign.',
  phases: [
    { title: 'Resolve', detail: 'Резолв роль→агент из проектного CLAUDE.md ## Agents (с дефолтами)' },
    { title: 'Design', detail: 'Консилиум parallel: ui/frontend/architect → аудит текущего UI + предложение по дизайн-системе → синтез Design Brief' },
    { title: 'Implement', detail: 'Exec-агенты по file-scope вносят визуальные правки (isolation: worktree), бизнес-логику не трогают' },
    { title: 'Validate', detail: 'Сборка + Web-проверка через playwright-cli -s=<session> (скриншоты до/после), новый браузер не открывать' },
    { title: 'Report', detail: 'swarm-report/<slug>-<date>-redesign.md' },
  ],
}

// ── args (передаёт skill /redesign) ──────────────────────────────────────────
//   request : сырой текст запроса + пожелания от юзера
//   cwd     : абсолютный путь корня проекта
//   date    : YYYY-MM-DD (скрипт не имеет доступа к Date.now)
//   slug    : basename репо/cwd
//   session : имя playwright-сессии для Web-валидации (решено в skill-гейте)
//   target  : что редизайним (компонент/экран)
const A = (typeof args === 'string') ? (JSON.parse(args) || {}) : (args || {})
const REQUEST = (A && A.request) || ''
const CWD = (A && A.cwd) || '.'
const DATE = (A && A.date) || 'unknown-date'
const SLUG = (A && A.slug) || 'project'
const SESSION = (A && A.session) || SLUG
const TARGET = (A && A.target) || REQUEST

// Дефолтная карта роль→агент (из глобального CLAUDE.md). Resolve её переопределяет,
// если в проектном CLAUDE.md есть секция ## Agents. Урезанный консилиум — только
// визуально-релевантные роли (ui ведущая, frontend, architect).
const DEFAULT_CONSILIUM = {
  ui: 'voltagent-core-dev:ui-designer',
  frontend: 'voltagent-lang:vue-expert',
  architect: 'voltagent-lang:java-architect',
}
const DEFAULT_EXECUTING = [
  { scope: '**/*.vue, **/*.ts, **/*.css', agent: 'voltagent-lang:vue-expert', layer: 'web' },
  { scope: 'composeApp/**/*.kt', agent: 'builder-compose-feature', layer: 'mobile' },
]

const RESOLVE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['consilium', 'executing'],
  properties: {
    consilium: {
      type: 'object',
      additionalProperties: false,
      required: ['ui', 'frontend', 'architect'],
      properties: {
        ui: { type: 'string' },
        frontend: { type: 'string' },
        architect: { type: 'string' },
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

const AUDIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['role', 'observations', 'designSystemNotes', 'recommendations'],
  properties: {
    role: { type: 'string' },
    observations: { type: 'string', description: 'Текущее состояние UI с точки зрения линзы' },
    designSystemNotes: { type: 'string', description: 'Расхождения с DESIGN_SYSTEM / предложения по её токенам (роль ui обязана заполнить)' },
    recommendations: { type: 'array', items: { type: 'string' } },
  },
}

const BRIEF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['designSystem', 'components', 'tokens', 'layers', 'unchanged'],
  properties: {
    designSystem: { type: 'string', description: 'Имя DESIGN_SYSTEM проекта или "(не выбрана)"' },
    components: { type: 'array', items: { type: 'string' }, description: 'Компоненты к изменению + что именно менять' },
    tokens: { type: 'string', description: 'Цвета/типографика/spacing/радиусы со ссылками на токены дизайн-системы' },
    layers: { type: 'array', items: { type: 'string' }, description: 'Затронутые слои (web/mobile)' },
    unchanged: { type: 'array', items: { type: 'string' }, description: 'Что явно НЕ меняется (бизнес-логика, поведение)' },
  },
}

const IMPL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['layer', 'changedFiles', 'summary'],
  properties: {
    layer: { type: 'string' },
    changedFiles: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string', description: 'Какие визуальные правки внесены (без смены бизнес-логики)' },
  },
}

const VALIDATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['passed', 'details', 'screenshots'],
  properties: {
    passed: { type: 'boolean' },
    details: { type: 'string' },
    screenshots: { type: 'array', items: { type: 'string' }, description: 'Пути к скриншотам до/после' },
  },
}

// ── Phase 0: Resolve ──────────────────────────────────────────────────────
phase('Resolve')
const resolved = await agent(
  `Ты резолвер агентов для оркестрации в проекте по пути ${CWD}.
Прочитай ${CWD}/CLAUDE.md, секцию "## Agents" (Консилиум + Executing), если она есть.
Верни карту роль→конкретный агент для консилиума (ui, frontend, architect)
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

// ── Phase 1: Design — консилиум (parallel barrier) → синтез Design Brief ───
phase('Design')
const lenses = [
  { role: 'ui', agent: consilium.ui, focus: `Ведущая роль. Прочитай ${CWD}/CLAUDE.md, найди строку DESIGN_SYSTEM. Если найдена — прочитай ~/.claude/design-systems/<name>.md и опирайся на её токены (цвета, типографика, spacing). Если НЕ найдена — в designSystemNotes добавь предупреждение "ДИЗАЙН-СИСТЕМА НЕ ВЫБРАНА" и предложи 2-3 подходящих варианта. Анализируй текущий UI цели редизайна и список расхождений с дизайн-системой` },
  { role: 'frontend', agent: consilium.frontend, focus: 'Компонентная структура, переиспользуемость, стейт UI, паттерны вёрстки' },
  { role: 'architect', agent: consilium.architect, focus: 'Зависимости между UI-компонентами, shared-код между платформами, изоляция визуального слоя от бизнес-логики' },
]
const audits = (await parallel(lenses.map((l) => () =>
  agent(
    `Проект: ${CWD}. Запрос на редизайн: "${REQUEST}". Цель редизайна: "${TARGET}".
Твоя линза — ${l.role}: ${l.focus}.
Проанализируй ТЕКУЩЕЕ состояние UI цели (читай реальный код: ast-index/grep/read).
Меняется ТОЛЬКО визуал — бизнес-логику не трогаем.
Верни наблюдения, заметки по дизайн-системе и конкретные рекомендации.`,
    { label: `design:${l.role}`, phase: 'Design', schema: AUDIT_SCHEMA, agentType: l.agent }
  )
))).filter(Boolean)

const brief = await agent(
  `Ты синтезируешь Design Brief для редизайна "${TARGET}" (запрос: "${REQUEST}").
Аудит консилиума: ${JSON.stringify(audits)}.
Прочитай ${CWD}/CLAUDE.md, найди DESIGN_SYSTEM (если есть — читай ~/.claude/design-systems/<name>.md).
Собери одобряемый план: конкретные компоненты к изменению, токены (цвета/типографика/spacing/радиусы)
со ссылками на дизайн-систему, затронутые слои (web/mobile) и явный список того, что НЕ меняется
(вся бизнес-логика и поведение остаются). Каждый пункт — атомарное визуальное изменение.`,
  { label: 'design-brief', phase: 'Design', schema: BRIEF_SCHEMA }
)

// ── Phase 2: Implement — exec-агенты по слоям (parallel, worktree isolation) ─
phase('Implement')
const briefLayers = (brief && brief.layers && brief.layers.length) ? brief.layers : ['web']
const implTargets = briefLayers
  .map((layer) => executing.find((e) => e.layer === layer))
  .filter(Boolean)
const implAgents = implTargets.length ? implTargets : [executing[0]]

const impls = (await parallel(implAgents.map((t) => () =>
  agent(
    `Проект: ${CWD}. Слой: ${t.layer}. Файлы под твоим scope: ${t.scope}.
Design Brief: ${JSON.stringify(brief)}.
Внеси ТОЛЬКО визуальные правки (стили, вёрстка, токены дизайн-системы) по этому Brief.
СТРОГО НЕ меняй бизнес-логику, обработчики, стейт-машину, API — только представление.
Все визуальные значения бери из дизайн-системы (токены, не хардкоды).
Верни список изменённых файлов и краткое описание правок.`,
    { label: `implement:${t.layer}`, phase: 'Implement', schema: IMPL_SCHEMA, agentType: t.agent, isolation: 'worktree' }
  )
))).filter(Boolean)

// ── Phase 3: Validate — сборка + Web-проверка через playwright-cli ─────────
phase('Validate')
const validation = await agent(
  `Проект: ${CWD}. Провалидируй редизайн "${TARGET}".
Изменённые файлы: ${JSON.stringify(impls.flatMap((f) => f.changedFiles || []))}.
Design Brief: ${JSON.stringify(brief)}.
1) Запусти сборку проекта через Bash (найди gradle/npm/скрипт проекта), убедись что нет ошибок.
2) Web-проверка ТОЛЬКО через playwright-cli с именованной сессией "${SESSION}":
   - НЕ открывай новый браузер. Работай в уже открытой сессии.
   - playwright-cli -s=${SESSION} goto <url цели> ; playwright-cli -s=${SESSION} snapshot
   - Сделай скриншоты до/после: playwright-cli -s=${SESSION} screenshot
   - Сверь визуал с Design Brief (компоненты, токены).
ЗАПРЕЩЕНО выводить окно браузера на передний план.
Верни passed + детали (что собирал/проверял, вывод) + пути к скриншотам.`,
  { label: 'validate', phase: 'Validate', schema: VALIDATE_SCHEMA, model: 'sonnet' }
)

// ── Phase 4: Report ───────────────────────────────────────────────────────
phase('Report')
const reportPath = `./swarm-report/${SLUG}-${DATE}-redesign.md`
await agent(
  `Напиши финальный отчёт в файл ${CWD}/${reportPath} (используй Write).
"# Redesign Report — ${DATE}". Запрос: "${REQUEST}". Цель: "${TARGET}".
Дизайн-система: ${brief && brief.designSystem}.
Design Audit (консилиум): ${JSON.stringify(audits)}.
Design Brief (план): ${JSON.stringify(brief)}.
Реализация (файлы, правки): ${JSON.stringify(impls)}.
Валидация (сборка + playwright, скриншоты): ${JSON.stringify(validation)}.
Статус: ${validation && validation.passed ? 'Done' : 'Partial — валидация не прошла'}.
Структура: область редизайна, дизайн-система, расхождения, Brief, что реализовано (файлы),
результаты визуальной проверки (скриншоты до/после), что НЕ менялось (бизнес-логика), риски/откаты.`,
  { label: 'report', phase: 'Report', model: 'haiku' }
)

return {
  status: validation && validation.passed ? 'redesigned' : 'redesign-unverified',
  changedFiles: impls.flatMap((f) => f.changedFiles || []),
  report: reportPath,
}
