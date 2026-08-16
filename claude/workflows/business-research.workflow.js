export const meta = {
  name: 'business-research',
  description: 'Анализ рынка/конкурентов/бизнес-модели консилиумом: parallel (market-researcher, competitive-analyst, business-analyst, product-manager) → синтез → отчёт',
  whenToUse: 'Рынок, конкуренты, аналитика, бизнес-модель, монетизация, юнит-экономика, TAM SAM SOM, pricing, revenue. Запускается скиллом /biz-research.',
  phases: [
    { title: 'Resolve', detail: 'Резолв роль→агент из проектного CLAUDE.md ## Agents (с дефолтами)' },
    { title: 'Research', detail: 'Консилиум parallel: market-researcher / competitive-analyst / business-analyst / product-manager → каждый через WebSearch+WebFetch по своей линзе' },
    { title: 'Synthesize', detail: 'product-manager сводит находки в единый отчёт: рынок/размер, конкуренты, модель/монетизация, выводы' },
    { title: 'Report', detail: 'swarm-report/<slug>-<date>-biz-research.md' },
  ],
}

// ── args (передаёт skill /biz-research) ──────────────────────────────────────
//   request : тема исследования от юзера
//   cwd     : абсолютный путь корня проекта
//   date    : YYYY-MM-DD (скрипт не имеет доступа к Date.now)
//   slug    : basename репо/cwd
const REQUEST = (args && args.request) || ''
const CWD = (args && args.cwd) || '.'
const DATE = (args && args.date) || 'unknown-date'
const SLUG = (args && args.slug) || 'project'

// Дефолтная карта роль→агент (из глобального CLAUDE.md). Resolve её переопределяет,
// если в проектном CLAUDE.md есть секция ## Agents.
const DEFAULT_CONSILIUM = {
  'market-researcher': 'voltagent-research:market-researcher',
  'competitive-analyst': 'voltagent-research:competitive-analyst',
  'business-analyst': 'voltagent-biz:business-analyst',
  'product-manager': 'voltagent-biz:product-manager',
  'technical-writer': 'voltagent-biz:technical-writer',
}

const RESOLVE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['consilium'],
  properties: {
    consilium: {
      type: 'object',
      additionalProperties: false,
      required: ['market-researcher', 'competitive-analyst', 'business-analyst', 'product-manager', 'technical-writer'],
      properties: {
        'market-researcher': { type: 'string' },
        'competitive-analyst': { type: 'string' },
        'business-analyst': { type: 'string' },
        'product-manager': { type: 'string' },
        'technical-writer': { type: 'string' },
      },
    },
  },
}

const FINDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['role', 'summary', 'keyFindings', 'sources'],
  properties: {
    role: { type: 'string' },
    summary: { type: 'string', description: 'Краткое резюме по своей линзе (3-5 предложений)' },
    keyFindings: { type: 'array', items: { type: 'string' }, description: 'Список ключевых фактов/цифр/выводов' },
    sources: { type: 'array', items: { type: 'string' }, description: 'URL источников, которые использовались' },
  },
}

const SYNTHESIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['marketOverview', 'competitors', 'businessModel', 'conclusions', 'actionItems'],
  properties: {
    marketOverview: { type: 'string', description: 'Рынок: размер (TAM/SAM/SOM), тренды, динамика' },
    competitors: { type: 'string', description: 'Конкуренты: топ-игроки, позиционирование, слабые места' },
    businessModel: { type: 'string', description: 'Бизнес-модель/монетизация/юнит-экономика/pricing' },
    conclusions: { type: 'string', description: 'Ключевые выводы и возможности' },
    actionItems: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['what', 'priority', 'impact'],
        properties: {
          what: { type: 'string' },
          priority: { type: 'string', enum: ['P0', 'P1', 'P2'] },
          impact: { type: 'string' },
        },
      },
    },
  },
}

// ── Phase 0: Resolve ──────────────────────────────────────────────────────
phase('Resolve')
const resolved = await agent(
  `Ты резолвер агентов для оркестрации в проекте по пути ${CWD}.
Прочитай ${CWD}/CLAUDE.md, секцию "## Agents" (Консилиум), если она есть.
Верни карту роль→конкретный агент для консилиума:
market-researcher, competitive-analyst, business-analyst, product-manager, technical-writer.
Если секции ## Agents нет или роль не указана — используй дефолты:
${JSON.stringify(DEFAULT_CONSILIUM)}
Имена агентов бери РОВНО как в проектном CLAUDE.md либо как в дефолтах — не выдумывай.`,
  { label: 'resolve-agents', phase: 'Resolve', schema: RESOLVE_SCHEMA, model: 'haiku' }
)

const consilium = (resolved && resolved.consilium) || DEFAULT_CONSILIUM

// ── Phase 1: Research — консилиум (parallel barrier) ─────────────────────
phase('Research')
const lenses = [
  {
    role: 'market-researcher',
    agent: consilium['market-researcher'],
    focus: 'размер рынка (TAM/SAM/SOM), динамика роста, ключевые тренды, объёмы, гео-сегменты',
  },
  {
    role: 'competitive-analyst',
    agent: consilium['competitive-analyst'],
    focus: 'конкуренты: топ-игроки, их позиционирование, pricing, слабые места, дифференциация, рыночные доли',
  },
  {
    role: 'business-analyst',
    agent: consilium['business-analyst'],
    focus: 'бизнес-процессы, юнит-экономика, ROI, unit margins, CAC/LTV, операционные метрики',
  },
  {
    role: 'product-manager',
    agent: consilium['product-manager'],
    focus: 'продуктовая стратегия, PMF, приоритеты фич, go-to-market, монетизация и revenue-модели',
  },
]

const findings = (await parallel(lenses.map((l) => () =>
  agent(
    `Тема исследования: "${REQUEST}".
Твоя линза — ${l.role}: ${l.focus}.
Проведи исследование через WebSearch и WebFetch: найди реальные данные, цифры, факты.
Используй несколько источников (3-5 минимум). Не выдумывай цифры — только из источников.
Верни: краткое резюме, ключевые находки (факты/цифры), список URL источников.`,
    { label: `research:${l.role}`, phase: 'Research', schema: FINDING_SCHEMA, agentType: l.agent }
  )
))).filter(Boolean)

// ── Phase 2: Synthesize ───────────────────────────────────────────────────
phase('Synthesize')
const synthesis = await agent(
  `Ты синтезируешь бизнес-исследование по теме "${REQUEST}".
Находки консилиума: ${JSON.stringify(findings)}.
Сведи в единый структурированный анализ:
- marketOverview: рынок, TAM/SAM/SOM, тренды
- competitors: топ-конкуренты, позиционирование, слабые места
- businessModel: модели монетизации, pricing, юнит-экономика
- conclusions: ключевые выводы и возможности
- actionItems: приоритизированные действия (P0/P1/P2) с ожидаемым impact
Синтез должен быть связным, не просто копипастой из находок.`,
  { label: 'synthesize', phase: 'Synthesize', schema: SYNTHESIS_SCHEMA, agentType: consilium['product-manager'] }
)

// ── Phase 3: Report ───────────────────────────────────────────────────────
phase('Report')
const reportPath = `./swarm-report/${SLUG}-${DATE}-biz-research.md`
await agent(
  `Напиши финальный отчёт бизнес-исследования в файл ${CWD}/${reportPath} (используй Write).
Заголовок: "# Бизнес-исследование: ${REQUEST} — ${DATE}".

Структура отчёта:
## Запрос
${REQUEST}

## Рынок
(из synthesis.marketOverview)

## Конкуренты
(из synthesis.competitors)

## Бизнес-модель и монетизация
(из synthesis.businessModel)

## Ключевые выводы
(из synthesis.conclusions)

## Action Items
(таблица из synthesis.actionItems: Что / Приоритет / Ожидаемый эффект)

## Источники
(все URL из findings[*].sources, без дублей)

## Статус
Done

Данные для отчёта:
synthesis = ${JSON.stringify(synthesis)}
findings (источники) = ${JSON.stringify(findings.map((f) => ({ role: f.role, sources: f.sources })))}

ВАЖНО: код и файлы проекта не трогать. Писать ТОЛЬКО отчёт в swarm-report/.`,
  { label: 'report', phase: 'Report', model: 'haiku' }
)

return {
  status: 'analyzed',
  request: REQUEST,
  synthesis,
  findingsCount: findings.length,
  report: reportPath,
}
