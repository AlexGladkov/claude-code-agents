export const meta = {
  name: 'research',
  description: 'Исследование кодовой базы консилиумом: Explore (parallel линзы) → Synthesize → Report. Код не меняется.',
  whenToUse: 'Как устроено, как работает, объясни, исследуй, покажи архитектуру, как организовано. Запускается скиллом /research.',
  phases: [
    { title: 'Resolve', detail: 'Резолв роль→агент из проектного CLAUDE.md ## Agents (с дефолтами)' },
    { title: 'Explore', detail: 'Консилиум parallel: architect/developer/diagnostics читают реальный код под своим углом' },
    { title: 'Synthesize', detail: 'Единая картина: ключевые модули, потоки данных, инварианты' },
    { title: 'Report', detail: 'swarm-report/<slug>-<date>-research.md — структурированное объяснение' },
  ],
}

// ── args (передаёт skill /research) ──────────────────────────────────────────
//   request : тема/вопрос от пользователя
//   cwd     : абсолютный путь корня проекта
//   date    : YYYY-MM-DD (скрипт не имеет доступа к Date.now)
//   slug    : basename репо/cwd
const A = (typeof args === 'string') ? (JSON.parse(args) || {}) : (args || {})
const REQUEST = (A && A.request) || ''
const CWD = (A && A.cwd) || '.'
const DATE = (A && A.date) || 'unknown-date'
const SLUG = (A && A.slug) || 'project'

// Дефолтная карта роль→агент (из глобального CLAUDE.md). Resolve её переопределяет,
// если в проектном CLAUDE.md есть секция ## Agents.
const DEFAULT_CONSILIUM = {
  architect: 'voltagent-lang:java-architect',
  developer: 'voltagent-lang:kotlin-specialist',
  diagnostics: 'kotlin-diagnostics',
  frontend: 'voltagent-lang:vue-expert',
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
      required: ['architect', 'developer', 'diagnostics', 'frontend', 'technical-writer'],
      properties: {
        architect: { type: 'string' },
        developer: { type: 'string' },
        diagnostics: { type: 'string' },
        frontend: { type: 'string' },
        'technical-writer': { type: 'string' },
      },
    },
  },
}

const LENS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['role', 'findings', 'keyModules', 'confidence'],
  properties: {
    role: { type: 'string' },
    findings: { type: 'string', description: 'Что обнаружено с данной точки зрения' },
    keyModules: { type: 'array', items: { type: 'string' }, description: 'Ключевые файлы/модули/классы' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
  },
}

const SYNTHESIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'keyModules', 'dataFlows', 'invariants'],
  properties: {
    summary: { type: 'string', description: 'Единое связное описание как устроена система/компонент' },
    keyModules: { type: 'array', items: { type: 'string' }, description: 'Важнейшие модули и их роли' },
    dataFlows: { type: 'array', items: { type: 'string' }, description: 'Потоки данных и управления' },
    invariants: { type: 'array', items: { type: 'string' }, description: 'Ключевые инварианты/контракты/ограничения' },
  },
}

// ── Phase 0: Resolve ──────────────────────────────────────────────────────────
phase('Resolve')
const resolved = await agent(
  `Ты резолвер агентов для оркестрации в проекте по пути ${CWD}.
Прочитай ${CWD}/CLAUDE.md, секцию "## Agents" → подсекцию "Консилиум", если она есть.
Верни карту роль→конкретный агент для ролей: architect, developer, diagnostics, frontend, technical-writer.
Если секции ## Agents нет или роль не указана — используй дефолты:
${JSON.stringify(DEFAULT_CONSILIUM)}
Имена агентов бери РОВНО как в проектном CLAUDE.md либо как в дефолтах — не выдумывай.`,
  { label: 'resolve-agents', phase: 'Resolve', schema: RESOLVE_SCHEMA, model: 'haiku' }
)

const consilium = (resolved && resolved.consilium) || DEFAULT_CONSILIUM

// ── Phase 1: Explore — консилиум исследовательских линз (parallel barrier) ────
phase('Explore')
const lenses = [
  {
    role: 'architect',
    agent: consilium.architect,
    focus: 'архитектура, модули, зависимости, слои, SOLID-нарушения, точки расширения',
  },
  {
    role: 'developer',
    agent: consilium.developer,
    focus: 'конкретные реализации, паттерны кода, идиомы, ключевые алгоритмы, точки входа',
  },
  {
    role: 'diagnostics',
    agent: consilium.diagnostics,
    focus: 'потоки данных, состояния, граничные случаи, логирование, observability',
  },
]
const lensFindings = (await parallel(lenses.map((l) => () =>
  agent(
    `Проект: ${CWD}. Тема исследования: "${REQUEST}".
Твоя линза — ${l.role}: ${l.focus}.
Исследуй реальный код (используй ast-index/grep/read — читай файлы, НЕ придумывай).
Найди ключевые модули, классы, потоки. Объясни как это устроено с твоей точки зрения.
КОД НЕ МЕНЯТЬ — только чтение и анализ.`,
    { label: `explore:${l.role}`, phase: 'Explore', schema: LENS_SCHEMA, agentType: l.agent }
  )
))).filter(Boolean)

// ── Phase 2: Synthesize ───────────────────────────────────────────────────────
phase('Synthesize')
const synthesis = await agent(
  `Ты синтезируешь единую картину из находок консилиума по теме "${REQUEST}" в проекте ${CWD}.
Находки линз: ${JSON.stringify(lensFindings)}.
Объедини в связное понимание: как устроена система, ключевые модули и их роли,
потоки данных/управления, инварианты и контракты.
Противоречия между линзами — разреши или отметь как открытый вопрос.`,
  { label: 'synthesize', phase: 'Synthesize', schema: SYNTHESIS_SCHEMA, agentType: consilium['technical-writer'] }
)

// ── Phase 3: Report ───────────────────────────────────────────────────────────
phase('Report')
const reportPath = `./swarm-report/${SLUG}-${DATE}-research.md`
await agent(
  `Напиши структурированный отчёт в файл ${CWD}/${reportPath} (используй Write).
Заголовок: "# Research: ${REQUEST} — ${DATE}".
Проект: ${SLUG} (${CWD}).

Используй данные:
- Синтез: ${JSON.stringify(synthesis)}
- Находки линз: ${JSON.stringify(lensFindings)}

Структура отчёта:
## Обзор
Краткий ответ на вопрос "${REQUEST}" (2-4 предложения).

## Архитектура
Ключевые модули и их роли (из synthesis.keyModules).

## Потоки данных
Как данные движутся через систему (из synthesis.dataFlows).

## Инварианты и контракты
Ключевые ограничения и гарантии (из synthesis.invariants).

## Детали по линзам
Краткие находки каждой линзы (architect / developer / diagnostics).

## Открытые вопросы
Неясности или противоречия, если есть.

КОД НЕ МЕНЯТЬ — только написать отчёт.`,
  { label: 'report', phase: 'Report', model: 'haiku' }
)

return {
  status: 'researched',
  request: REQUEST,
  lensCount: lensFindings.length,
  keyModules: (synthesis && synthesis.keyModules) || [],
  report: reportPath,
}
