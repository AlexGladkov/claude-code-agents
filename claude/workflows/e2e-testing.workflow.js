export const meta = {
  name: 'e2e-testing',
  description: 'Прогон smoke/e2e на проде + автофикс: сценарий → деплой → юнит → e2e по платформам → fix → отчёт',
  whenToUse: 'E2E/smoke прогон, проверка платформ, тестирование на проде с автофиксом. Запускается скиллом /e2e.',
  phases: [
    { title: 'Resolve', detail: 'Резолв роль→агент из проектного CLAUDE.md ## Agents (с дефолтами)' },
    { title: 'Scenario', detail: 'Сформировать/прочитать чеклист ./swarm-report/<slug>-e2e-scenario.md' },
    { title: 'Deploy', detail: 'Деплой на прод через скрипт проекта + health check (обязательно до проверок)' },
    { title: 'Unit', detail: 'Юнит-тесты через Bash' },
    { title: 'E2E', detail: 'Прогон по платформам: Web через playwright-cli -s=session, mobile/desktop skill, backend curl' },
    { title: 'Fix', detail: 'Executing-агенты чинят падения по file-scope (worktree), повторная валидация (mode=fix-on-fail)' },
    { title: 'Report', detail: 'swarm-report/<slug>-<date>-e2e.md' },
  ],
}

// ── args (передаёт skill /e2e) ────────────────────────────────────────────
//   request   : сырой текст запроса от юзера (описание сценария/фичи, может быть пустым)
//   cwd       : абсолютный путь корня проекта
//   date      : YYYY-MM-DD (скрипт не имеет доступа к Date.now)
//   slug      : basename репо/cwd
//   platforms : ['Web'|'Android'|'iOS'|'Desktop'|'Backend', ...] — определены skill по файлам
//   session   : имя playwright-сессии (решено skill интерактивно) | '' если Web не тестируем
//   prodUrl   : prod URL проекта | '' если Web не тестируем
//   mode      : 'fix-on-fail' | 'full-run'
const REQUEST = (args && args.request) || ''
const CWD = (args && args.cwd) || '.'
const DATE = (args && args.date) || 'unknown-date'
const SLUG = (args && args.slug) || 'project'
const PLATFORMS = (args && args.platforms && args.platforms.length) ? args.platforms : ['Backend']
const SESSION = (args && args.session) || ''
const PROD_URL = (args && args.prodUrl) || ''
const MODE = (args && args.mode) || 'fix-on-fail'

const SCENARIO_PATH = `./swarm-report/${SLUG}-e2e-scenario.md`
const REPORT_PATH = `./swarm-report/${SLUG}-${DATE}-e2e.md`

// Дефолтная карта роль→агент (из глобального CLAUDE.md). Resolve её переопределяет,
// если в проектном CLAUDE.md есть секция ## Agents.
const DEFAULT_CONSILIUM = {
  test: 'test-spring',
  diagnostics: 'kotlin-diagnostics',
  devops: 'devops-orchestrator',
  frontend: 'voltagent-lang:vue-expert',
}
const DEFAULT_EXECUTING = [
  { layer: 'backend', scope: 'backend/**/*.kt, springApp/**/*.kt', agent: 'builder-spring-feature' },
  { layer: 'mobile', scope: 'composeApp/**/*.kt, core-kmp/**/*.kt', agent: 'kotlin-multiplatform-developer' },
  { layer: 'web', scope: '**/*.vue, **/*.ts', agent: 'voltagent-lang:vue-expert' },
]

// Платформа → слой executing (для маршрутизации фикса)
const PLATFORM_LAYER = {
  Backend: 'backend',
  Android: 'mobile',
  iOS: 'mobile',
  Web: 'web',
  Desktop: 'web',
}

const RESOLVE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['consilium', 'executing'],
  properties: {
    consilium: {
      type: 'object',
      additionalProperties: false,
      required: ['test', 'diagnostics', 'devops', 'frontend'],
      properties: {
        test: { type: 'string' },
        diagnostics: { type: 'string' },
        devops: { type: 'string' },
        frontend: { type: 'string' },
      },
    },
    executing: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['layer', 'scope', 'agent'],
        properties: {
          layer: { type: 'string' },
          scope: { type: 'string' },
          agent: { type: 'string' },
        },
      },
    },
  },
}

const SCENARIO_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['path', 'stepCount', 'summary'],
  properties: {
    path: { type: 'string' },
    stepCount: { type: 'number' },
    summary: { type: 'string', description: 'Краткое описание покрываемого флоу' },
  },
}

const DEPLOY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['deployed', 'details'],
  properties: {
    deployed: { type: 'boolean' },
    details: { type: 'string', description: 'Какой скрипт запущен, результат health check' },
  },
}

const UNIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['passed', 'details'],
  properties: {
    passed: { type: 'boolean' },
    details: { type: 'string' },
  },
}

const E2E_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['platform', 'passed', 'failedSteps', 'details'],
  properties: {
    platform: { type: 'string' },
    passed: { type: 'boolean' },
    failedSteps: { type: 'array', items: { type: 'string' }, description: 'Шаги сценария, которые упали' },
    details: { type: 'string' },
  },
}

const FIX_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['layer', 'changedFiles', 'summary'],
  properties: {
    layer: { type: 'string' },
    changedFiles: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}

const REVALIDATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['passed', 'details'],
  properties: {
    passed: { type: 'boolean' },
    details: { type: 'string' },
  },
}

// ── Phase 0: Resolve ──────────────────────────────────────────────────────
phase('Resolve')
const resolved = await agent(
  `Ты резолвер агентов для оркестрации в проекте по пути ${CWD}.
Прочитай ${CWD}/CLAUDE.md, секцию "## Agents" (Консилиум + Executing), если она есть.
Верни карту роль→конкретный агент для консилиума (test, diagnostics, devops, frontend)
и список executing-агентов по file-scope (layer/scope/agent).
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

// ── Phase 1: Scenario — сформировать/прочитать чеклист (источник правды) ────
phase('Scenario')
const scenario = await agent(
  `Проект: ${CWD}. Платформы прогона: ${JSON.stringify(PLATFORMS)}.
Запрос пользователя: "${REQUEST}".
Файл сценария: ${CWD}/${SCENARIO_PATH}.

Задача: подготовить сценарий-чеклист как ЕДИНЫЙ источник правды для прогона.
1. Если файл ${SCENARIO_PATH} уже существует — прочитай его (Read). Это персистентное
   состояние: выполненные шаги помечены [x], их НЕ трогаем. Верни как есть.
2. Если файла нет — исследуй код (ast-index/grep/read) под покрываемый флоу
   (из "${REQUEST}" или основной пользовательский путь проекта) и СОЗДАЙ файл (Write)
   в формате:
   "# E2E Scenario: <название>"
   "Платформы: ${PLATFORMS.join(', ')}"
   "## Шаги"
   "- [ ] 1. <конкретное действие пользователя + ожидаемый результат>"
   "- [ ] 2. ..."
Каждый шаг — атомарное действие + проверка. Верни путь, число шагов, краткое описание флоу.`,
  { label: 'scenario', phase: 'Scenario', schema: SCENARIO_SCHEMA }
)

// ── Phase 2: Deploy — прод обязателен ДО любых проверок ────────────────────
phase('Deploy')
const deploy = await agent(
  `Проект: ${CWD}. ИНВАРИАНТ Validation: все проверки только на ПРОДЕ, деплой обязателен ДО них.
Найди deploy-механизм проекта (skill /deploy, Makefile target deploy, scripts/deploy.sh или аналог)
и выполни деплой на прод через Bash. Дождись успешного health check (curl проверка эндпоинта
здоровья / доступности prod URL ${PROD_URL || '<определи из проекта>'}).
Верни deployed=true только если health check прошёл. Иначе deployed=false с причиной.`,
  { label: 'deploy', phase: 'Deploy', schema: DEPLOY_SCHEMA, model: 'sonnet' }
)

if (!deploy || deploy.deployed === false) {
  phase('Report')
  await agent(
    `Напиши отчёт в файл ${CWD}/${REPORT_PATH} (Write).
"# E2E Report: деплой не прошёл — ${DATE}". Запрос: "${REQUEST}".
Платформы: ${JSON.stringify(PLATFORMS)}. Итог деплоя: ${JSON.stringify(deploy)}.
Прогон НЕ запускался (инвариант: без успешного деплоя на прод проверки не проводятся).
Опиши что запускалось и почему health check не прошёл, что нужно починить.`,
    { label: 'report-nodeploy', phase: 'Report', model: 'haiku' }
  )
  return { status: 'deploy-failed', deploy, report: REPORT_PATH }
}

// ── Phase 3: Unit — юнит-тесты ─────────────────────────────────────────────
phase('Unit')
const unit = await agent(
  `Проект: ${CWD}. Запусти юнит-тесты через Bash (найди gradle/npm/скрипт проекта).
Верни passed + детали (что запускал, краткий вывод, число упавших).`,
  { label: 'unit', phase: 'Unit', schema: UNIT_SCHEMA, agentType: consilium.test }
)

// ── Phase 4: E2E — прогон по платформам (per-платформа, НЕинтерактивно) ─────
phase('E2E')
const e2eRuns = (await parallel(PLATFORMS.map((platform) => () => {
  const commonTail =
    `Файл сценария (источник правды): ${CWD}/${SCENARIO_PATH}.
УСТОЙЧИВОСТЬ К КОМПАКТИЗАЦИИ: перед действиями ПЕРЕЧИТАЙ файл сценария (Read);
уже выполненные шаги [x] НЕ проверяй повторно, продолжай с первого [ ].
После прохождения каждого шага помечай его в файле как "- [x] N. ... ✅ (проверено)" (Edit).
Верни platform, passed, список failedSteps (упавшие шаги), детали.`

  if (platform === 'Web') {
    return agent(
      `Проект: ${CWD}. Платформа: Web. ПРОД URL: ${PROD_URL}.
Playwright-сессия УЖЕ готова (решена до запуска): "${SESSION}". Браузер НЕ открывай,
на передний план НЕ выводи — используй только готовую сессию.
Прогон через Bash строго командами:
  playwright-cli -s=${SESSION} goto ${PROD_URL}
  playwright-cli -s=${SESSION} snapshot           (получить ref-ы e1,e2,...)
  playwright-cli -s=${SESSION} click <ref> / fill <ref> <text>
  playwright-cli -s=${SESSION} screenshot         (для отчёта)
Если click даёт "Ref not found" — сделай snapshot заново и возьми актуальный ref.
Пройди шаги сценария по порядку на ПРОДЕ. ${commonTail}`,
      { label: 'e2e:Web', phase: 'E2E', schema: E2E_SCHEMA, model: 'sonnet' }
    )
  }
  if (platform === 'Android' || platform === 'iOS' || platform === 'Desktop') {
    const skillName = platform === 'Android' ? '/test-android'
      : platform === 'iOS' ? '/test-ios' : '/test-desktop'
    return agent(
      `Проект: ${CWD}. Платформа: ${platform}. Прогон на ПРОД-сборке.
Используй skill ${skillName} (CLI-обёртка mobile MCP) через Bash для взаимодействия с UI.
Пройди шаги сценария по порядку. ${commonTail}`,
      { label: `e2e:${platform}`, phase: 'E2E', schema: E2E_SCHEMA, model: 'sonnet' }
    )
  }
  // Backend
  return agent(
    `Проект: ${CWD}. Платформа: Backend. ПРОД URL: ${PROD_URL || '<определи из проекта>'}.
Прогон через Bash (curl/httpie) по эндпоинтам на ПРОДЕ. Проверь коды ответа/контракты
согласно шагам сценария. ${commonTail}`,
    { label: 'e2e:Backend', phase: 'E2E', schema: E2E_SCHEMA, agentType: consilium.diagnostics }
  )
})).filter(Boolean)

const failedRuns = e2eRuns.filter((r) => r && r.passed === false)
const allPassed = failedRuns.length === 0

// ── Phase 5: Fix — автофикс падений (mode=fix-on-fail) ──────────────────────
let fixes = []
let revalidation = null
if (MODE === 'fix-on-fail' && !allPassed) {
  phase('Fix')
  // Слои для фикса = слои упавших платформ
  const failedLayers = Array.from(new Set(
    failedRuns.map((r) => PLATFORM_LAYER[r.platform]).filter(Boolean)
  ))
  const fixTargets = failedLayers
    .map((layer) => executing.find((e) => e.layer === layer))
    .filter(Boolean)
  const fixAgents = fixTargets.length ? fixTargets : [executing[0]]

  fixes = (await parallel(fixAgents.map((t) => () =>
    agent(
      `Проект: ${CWD}. Слой: ${t.layer}. Файлы под твоим scope: ${t.scope}.
Упавшие e2e-прогоны: ${JSON.stringify(failedRuns)}.
Сценарий: ${CWD}/${SCENARIO_PATH}.
Найди корневую причину падений на этом слое и почини код. Верни изменённые файлы и описание.`,
      { label: `fix:${t.layer}`, phase: 'Fix', schema: FIX_SCHEMA, agentType: t.agent, isolation: 'worktree' }
    )
  ))).filter(Boolean)

  // Повторная валидация: юнит-тесты + сверка упавших шагов (без интерактива, сессия готова)
  revalidation = await agent(
    `Проект: ${CWD}. Провалидируй фикс после e2e-падений.
Изменённые файлы: ${JSON.stringify(fixes.flatMap((f) => f.changedFiles || []))}.
1. Прогони юнит-тесты через Bash.
2. Для Web-падений повтори упавшие шаги на ПРОДЕ через playwright-cli -s=${SESSION}
   (браузер НЕ открывай — сессия готова); для Backend — curl; для mobile — соответствующий
   /test-* skill. Проверь, что ранее упавшие шаги (${JSON.stringify(failedRuns.flatMap((r) => r.failedSteps || []))})
   теперь проходят и нет регрессий.
Верни passed + детали.`,
    { label: 'revalidate', phase: 'Fix', schema: REVALIDATE_SCHEMA, model: 'sonnet' }
  )
}

// ── Phase 6: Report ────────────────────────────────────────────────────────
phase('Report')
const finalPassed = allPassed || (revalidation && revalidation.passed)
await agent(
  `Напиши финальный отчёт в файл ${CWD}/${REPORT_PATH} (Write).
"# E2E Report — ${DATE}". Запрос: "${REQUEST}".
Платформы: ${JSON.stringify(PLATFORMS)}. Playwright-сессия: "${SESSION}". Прод URL: ${PROD_URL}.
Сценарий: ${JSON.stringify(scenario)} (файл ${SCENARIO_PATH}).
Деплой: ${JSON.stringify(deploy)}.
Юнит-тесты: ${JSON.stringify(unit)}.
E2E-прогоны по платформам: ${JSON.stringify(e2eRuns)}.
Режим: ${MODE}. Фиксы: ${JSON.stringify(fixes)}. Повторная валидация: ${JSON.stringify(revalidation)}.
Статус: ${finalPassed ? 'Done — все прогоны зелёные' : 'Failed — есть упавшие шаги'}.
Структура: покрываемый флоу, деплой, юнит, прогон по платформам (пройдено/упало),
автофикс (файлы) если был, результат повторной валидации, риски/откаты.`,
  { label: 'report', phase: 'Report', model: 'haiku' }
)

return {
  status: finalPassed ? 'passed' : 'failed',
  scenario,
  deploy,
  unit,
  e2eRuns,
  fixes,
  revalidation,
  report: REPORT_PATH,
}
