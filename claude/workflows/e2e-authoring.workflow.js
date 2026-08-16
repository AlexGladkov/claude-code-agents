export const meta = {
  name: 'e2e-authoring',
  description: 'Создание E2E сценария: исследование кода → определение платформ → генерация чеклиста → отчёт. Код приложения не меняется.',
  whenToUse: 'Добавить e2e тест, завести smoke, новый сценарий, создать тест-кейс, написать e2e. Запускается скиллом /e2e-new.',
  phases: [
    { title: 'Resolve', detail: 'Резолв роль→агент из проектного CLAUDE.md ## Agents (с дефолтами)' },
    { title: 'Explore', detail: 'Исследование кода: экраны/компоненты/API покрывающие флоу, определение платформ' },
    { title: 'Author', detail: 'Генерация чеклиста-сценария в формате глобального CLAUDE.md → Write в ./swarm-report/<slug>-e2e-scenario.md' },
    { title: 'Report', detail: 'Краткий отчёт ./swarm-report/<slug>-<date>-e2e-new.md' },
  ],
}

// ── args (передаёт skill /e2e-new) ───────────────────────────────────────────
//   request : исходный запрос пользователя
//   cwd     : абсолютный путь корня проекта
//   date    : YYYY-MM-DD (скрипт не имеет доступа к Date.now)
//   slug    : basename репо/cwd
//   flow    : описание пользовательского флоу для покрытия
const A = (typeof args === 'string') ? (JSON.parse(args) || {}) : (args || {})
const REQUEST = (A && A.request) || ''
const CWD = (A && A.cwd) || '.'
const DATE = (A && A.date) || 'unknown-date'
const SLUG = (A && A.slug) || 'project'
const FLOW = (A && A.flow) || REQUEST

// Дефолтная карта роль→агент (из глобального CLAUDE.md). Resolve переопределяет,
// если в проектном CLAUDE.md есть секция ## Agents.
const DEFAULT_CONSILIUM = {
  architect: 'voltagent-lang:java-architect',
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
      required: ['architect', 'developer', 'test', 'frontend'],
      properties: {
        architect: { type: 'string' },
        developer: { type: 'string' },
        test: { type: 'string' },
        frontend: { type: 'string' },
      },
    },
  },
}

const EXPLORE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['platforms', 'screens', 'steps', 'apiEndpoints'],
  properties: {
    platforms: {
      type: 'array',
      items: { type: 'string', enum: ['Android', 'iOS', 'Web', 'Backend', 'Desktop'] },
      description: 'Платформы, определённые по затронутым файлам',
    },
    screens: {
      type: 'array',
      items: { type: 'string' },
      description: 'Экраны/компоненты/страницы, участвующие во флоу',
    },
    steps: {
      type: 'array',
      items: { type: 'string' },
      description: 'Пользовательские шаги флоу в порядке выполнения (действие + ожидаемый результат)',
    },
    apiEndpoints: {
      type: 'array',
      items: { type: 'string' },
      description: 'API-эндпоинты/методы, задействованные во флоу (если есть)',
    },
  },
}

const AUTHOR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['scenarioPath', 'platforms', 'stepCount'],
  properties: {
    scenarioPath: { type: 'string', description: 'Путь к записанному файлу сценария' },
    platforms: { type: 'array', items: { type: 'string' } },
    stepCount: { type: 'number' },
  },
}

// ── Phase 0: Resolve ──────────────────────────────────────────────────────────
phase('Resolve')
const resolved = await agent(
  `Ты резолвер агентов для оркестрации в проекте по пути ${CWD}.
Прочитай ${CWD}/CLAUDE.md, секцию "## Agents" (Консилиум), если она есть.
Верни карту роль→конкретный агент для ролей: architect, developer, test, frontend.
Если секции ## Agents нет или роль не указана — используй дефолты:
${JSON.stringify(DEFAULT_CONSILIUM)}
Имена агентов бери РОВНО как в проектном CLAUDE.md либо как в дефолтах — не выдумывай.`,
  { label: 'resolve-agents', phase: 'Resolve', schema: RESOLVE_SCHEMA, model: 'haiku' }
)

const consilium = (resolved && resolved.consilium) || DEFAULT_CONSILIUM

// ── Phase 1: Explore ──────────────────────────────────────────────────────────
phase('Explore')

// Маппинг файл→платформа (из глобального CLAUDE.md), применяется агентом при поиске.
const PLATFORM_MAPPING = `
springApp/**, core-kmp/**/domain/**  → Backend
webApp/**                            → Web
composeApp/**                        → Android
iosApp/**                            → iOS
core-kmp/**                          → Android + iOS
`.trim()

const explore = await agent(
  `Проект: ${CWD}. Пользовательский флоу для покрытия E2E: "${FLOW}".
Исходный запрос: "${REQUEST}".

Задача — исследовать код проекта и понять КАК реализован этот флоу:
1. Найди экраны/компоненты/страницы, участвующие во флоу (ast-index search, grep, read).
2. Определи платформы по затронутым файлам согласно маппингу:
${PLATFORM_MAPPING}
   Если проект имеет свой маппинг в CLAUDE.md — использовать его.
   Fallback: если не удалось определить — Backend.
3. Составь последовательность пользовательских шагов флоу (действие + ожидаемый результат).
4. Найди задействованные API-эндпоинты/методы (если применимо).

Только читай код — ничего не меняй. Используй ast-index/grep/read.`,
  { label: 'explore', phase: 'Explore', schema: EXPLORE_SCHEMA, agentType: consilium.architect }
)

// ── Phase 2: Author ───────────────────────────────────────────────────────────
phase('Author')
const scenarioPath = `./swarm-report/${SLUG}-e2e-scenario.md`

const authored = await agent(
  `Проект: ${CWD}. Флоу: "${FLOW}".
Результат исследования кода: ${JSON.stringify(explore)}.

Задача — сгенерировать чеклист E2E сценария и записать его в файл.

Формат файла (СТРОГО соблюдай):
\`\`\`markdown
# E2E Scenario: <название флоу>
Платформы: <через запятую из explore.platforms>

## Шаги
- [ ] 1. <действие пользователя> → <ожидаемый результат>
- [ ] 2. <действие пользователя> → <ожидаемый результат>
...
\`\`\`

Каждый шаг — конкретное действие + ожидаемый результат (что видит/получает пользователь).
Шагов должно быть достаточно для полного покрытия флоу (минимум 5, обычно 8-15).
Включи граничные случаи и негативные сценарии если они очевидны из кода.

Запиши файл через Write в: ${CWD}/${scenarioPath}
Код приложения НЕ трогай. Только этот файл сценария.`,
  { label: 'author', phase: 'Author', schema: AUTHOR_SCHEMA, agentType: consilium.test }
)

// ── Phase 3: Report ───────────────────────────────────────────────────────────
phase('Report')
const reportPath = `./swarm-report/${SLUG}-${DATE}-e2e-new.md`

await agent(
  `Напиши краткий отчёт в файл ${CWD}/${reportPath} (используй Write).
Заголовок: "# E2E Scenario Created — ${DATE}".

Содержание:
- Флоу: "${FLOW}"
- Запрос: "${REQUEST}"
- Платформы: ${JSON.stringify((explore && explore.platforms) || [])}
- Экраны/компоненты: ${JSON.stringify((explore && explore.screens) || [])}
- Файл сценария: ${scenarioPath}
- Шагов в сценарии: ${(authored && authored.stepCount) || '?'}
- API-эндпоинты: ${JSON.stringify((explore && explore.apiEndpoints) || [])}

Код приложения не изменялся. Сценарий готов к прогону через /e2e-testing.`,
  { label: 'report', phase: 'Report', model: 'haiku' }
)

return {
  status: 'authored',
  flow: FLOW,
  platforms: (explore && explore.platforms) || [],
  scenarioPath,
  reportPath,
  stepCount: (authored && authored.stepCount) || 0,
}
