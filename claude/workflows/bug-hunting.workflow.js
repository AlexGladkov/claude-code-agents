export const meta = {
  name: 'bug-hunting',
  description: 'Поиск и фикс бага консилиумом: репро → диагноз (parallel) → фикс по scope → валидация → отчёт',
  whenToUse: 'Баг, регрессия, краш, исключение, 500, неожиданное поведение. Запускается скиллом /bug.',
  phases: [
    { title: 'Resolve', detail: 'Резолв роль→агент из проектного CLAUDE.md ## Agents (с дефолтами)' },
    { title: 'Reproduce', detail: 'Воспроизвести баг, собрать симптомы/стектрейс/затронутые слои' },
    { title: 'Diagnose', detail: 'Консилиум parallel: diagnostics/architect/security/devops → root cause' },
    { title: 'Fix', detail: 'Executing-агенты по file-scope закрывают весь кластер (mode=full-fix)' },
    { title: 'Validate', detail: 'Юнит-тесты/сборка + сверка симптома' },
    { title: 'Report', detail: 'swarm-report/<slug>-<date>.md' },
  ],
}

// ── args (передаёт skill /bug) ────────────────────────────────────────────
//   request : сырой текст бага от юзера
//   cwd     : абсолютный путь корня проекта
//   date    : YYYY-MM-DD (скрипт не имеет доступа к Date.now)
//   slug    : basename репо/cwd
//   mode        : 'full-fix' | 'diagnose-only'
//   stableRepro : bool — юзер утверждает СТАБИЛЬНОЕ репро (скилл ставит true при явном
//                 «стабильно/каждый раз/всегда»). Тогда гейт НЕ бейлит на not-reproducible —
//                 симптом существует, репро-фаза инструментирует и идёт в диагноз.
//   e2eSession  : имя playwright-cli сессии (для web-e2e-валидации). Скилл резолвит ДО запуска
//                 по правилам CLAUDE.md (Validation). Пусто → web-e2e через playwright пропускается.
const A = (typeof args === 'string') ? (JSON.parse(args) || {}) : (args || {})
const REQUEST = (A && A.request) || ''
const CWD = (A && A.cwd) || '.'
const DATE = (A && A.date) || 'unknown-date'
const SLUG = (A && A.slug) || 'project'
const MODE = (A && A.mode) || 'full-fix'
const STABLE_REPRO = (A && A.stableRepro) === true
const E2E_SESSION = (A && A.e2eSession) || ''

// Дефолтная карта роль→агент (из глобального CLAUDE.md). Resolve её переопределяет,
// если в проектном CLAUDE.md есть секция ## Agents.
const DEFAULT_CONSILIUM = {
  diagnostics: 'kotlin-diagnostics',
  architect: 'voltagent-lang:java-architect',
  security: 'security-kotlin',
  devops: 'devops-orchestrator',
}
const DEFAULT_EXECUTING = [
  { scope: 'backend/**/*.kt', agent: 'builder-spring-feature', layer: 'backend' },
  { scope: 'shared/**/*.kt, composeApp/**/*.kt, core-kmp/**/*.kt', agent: 'kotlin-multiplatform-developer', layer: 'mobile' },
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
      required: ['diagnostics', 'architect', 'security', 'devops'],
      properties: {
        diagnostics: { type: 'string' },
        architect: { type: 'string' },
        security: { type: 'string' },
        devops: { type: 'string' },
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

const REPRO_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reproducible', 'symptomConfirmed', 'summary', 'layers', 'suspectFiles'],
  properties: {
    reproducible: { type: 'boolean', description: 'Удалось ли ТРИГГЕРНУТЬ баг локально прямо сейчас' },
    symptomConfirmed: { type: 'boolean', description: 'Подтверждён ли МЕХАНИЗМ симптома в коде (нашёл путь, который объясняет наблюдаемое), даже если не триггернул вживую' },
    summary: { type: 'string', description: 'Что наблюдается, шаги, стектрейс/логи, найденный механизм' },
    layers: { type: 'array', items: { type: 'string', enum: ['backend', 'mobile', 'web'] } },
    suspectFiles: { type: 'array', items: { type: 'string' } },
  },
}

const FINDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['role', 'rootCauseHypothesis', 'evidence', 'confidence'],
  properties: {
    role: { type: 'string' },
    rootCauseHypothesis: { type: 'string' },
    evidence: { type: 'string' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
  },
}

const DIAGNOSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rootCause', 'cluster', 'fixLayers'],
  properties: {
    rootCause: { type: 'string' },
    cluster: { type: 'array', items: { type: 'string' }, description: 'Все родственные дыры того же корня, не только симптом' },
    fixLayers: { type: 'array', items: { type: 'string', enum: ['backend', 'mobile', 'web'] } },
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

const VALIDATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['passed', 'buildPassed', 'buildCommand', 'buildExitCode', 'buildEvidence', 'testsPassed', 'testsEvidence', 'details'],
  properties: {
    passed: { type: 'boolean', description: 'Итог = buildPassed && testsPassed. НЕ ставить true без реальных доказательств ниже' },
    buildPassed: { type: 'boolean' },
    buildCommand: { type: 'string', description: 'Точная команда сборки (как запускал)' },
    buildExitCode: { type: 'integer', description: 'Реальный код возврата сборки (0 = успех). НЕ маскировать через | tail/| grep — использовать set -o pipefail или $?' },
    buildEvidence: { type: 'string', description: 'РЕАЛЬНЫЙ хвост вывода: строка BUILD SUCCEEDED / BUILD FAILED / BUILD SUCCESSFUL / ошибки компиляции. Дословно из лога.' },
    testsPassed: { type: 'boolean' },
    testsEvidence: { type: 'string', description: 'РЕАЛЬНАЯ строка итога тестов ("Executed N tests, 0 failures" / "N passed" / "FAILED"). Дословно.' },
    details: { type: 'string', description: 'Что запускал, симптом воспроизводится ли ещё, регрессии' },
  },
}

const E2E_VALIDATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ran', 'passed', 'platform', 'evidence'],
  properties: {
    ran: { type: 'boolean', description: 'Реально ли прогнан UI/E2E кейс на живом приложении. false = не прогнан (нет сессии/приложения) — тогда passed НЕ считается пройденным, а честно skipped' },
    passed: { type: 'boolean', description: 'Симптом на живом приложении устранён (только если ran=true)' },
    platform: { type: 'string', description: 'web | android | ios | desktop | backend | none' },
    evidence: { type: 'string', description: 'Что именно дёргал (шаги пользователя по фиче), инструмент (playwright-cli/mobile MCP/desktop), наблюдаемый результат (snapshot/screenshot ref). Если ran=false — честная причина.' },
  },
}

// ── Phase 0: Resolve ──────────────────────────────────────────────────────
phase('Resolve')
const resolved = await agent(
  `Ты резолвер агентов для оркестрации в проекте по пути ${CWD}.
Прочитай ${CWD}/CLAUDE.md, секцию "## Agents" (Консилиум + Executing), если она есть.
Верни карту роль→конкретный агент для консилиума (diagnostics, architect, security, devops)
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

// ── Phase 1: Reproduce ────────────────────────────────────────────────────
phase('Reproduce')
const repro = await agent(
  `Проект: ${CWD}. Баг от пользователя: "${REQUEST}".
Задача — ВОСПРОИЗВЕСТИ баг и собрать факты: точные симптомы, шаги, стектрейс/логи если есть.
Найди подозрительные файлы (используй ast-index/grep). Определи затронутые слои
(backend / mobile / web). НЕ чини ничего. Только диагностический сбор.
${STABLE_REPRO ? `
ВАЖНО: пользователь утверждает СТАБИЛЬНОЕ репро («каждый раз/всегда»). Значит баг ТОЧНО существует.
Если не можешь триггернуть вживую — это НЕ повод закрывать как not-reproducible. Вместо этого:
ИНСТРУМЕНТИРУЙ — прочитай реальный код по симптому, найди МЕХАНИЗМ (путь кода, который объясняет
наблюдаемое), выставь symptomConfirmed=true как только нашёл правдоподобный путь. Чистая сборка и
зелёные тесты НЕ опровергают симптом — тесты могут его не покрывать. Не отмахивайся вердиктом
«архитектура безопасна» при живом юзер-репро — ищи дальше.` : ''}
Верни reproducible (триггернул ли вживую) И symptomConfirmed (нашёл ли механизм в коде).`,
  { label: 'reproduce', phase: 'Reproduce', schema: REPRO_SCHEMA, agentType: consilium.diagnostics }
)

// Бейл на not-reproducible ТОЛЬКО если ни триггер, ни механизм не подтверждены И юзер не заявлял
// стабильное репро. При stableRepro симптом существует по определению — идём в диагноз всегда.
const shouldBail = !repro
  || (repro.reproducible === false && repro.symptomConfirmed === false && !STABLE_REPRO)
if (shouldBail) {
  phase('Report')
  const notReproPath = `./swarm-report/${SLUG}-${DATE}-bug.md`
  await agent(
    `Напиши отчёт в файл ${CWD}/${notReproPath} (используй Write).
Заголовок "# Bug Report: не воспроизведено — ${DATE}".
Запрос: "${REQUEST}". Итог репро: ${JSON.stringify(repro)}.
Опиши что пробовали и почему не воспроизвелось, какие данные нужны от юзера.`,
    { label: 'report-notrepro', phase: 'Report', model: 'haiku' }
  )
  return { status: 'not-reproducible', repro, report: notReproPath }
}

// ── Phase 2: Diagnose — консилиум (parallel barrier) ──────────────────────
phase('Diagnose')
const lenses = [
  { role: 'diagnostics', agent: consilium.diagnostics, focus: 'логи, стектрейсы, инструментирование, runtime-поведение' },
  { role: 'architect', agent: consilium.architect, focus: 'архитектурные причины, зависимости модулей, нарушение инвариантов' },
  { role: 'security', agent: consilium.security, focus: 'уязвимости, утечки, проблемы авторизации/валидации' },
  { role: 'devops', agent: consilium.devops, focus: 'инфраструктура, окружение, конфиги, деплой' },
]
const findings = (await parallel(lenses.map((l) => () =>
  agent(
    `Проект: ${CWD}. Баг: "${REQUEST}".
Результат репродьюса: ${JSON.stringify(repro)}.
Твоя линза — ${l.role}: ${l.focus}.
Найди КОРНЕВУЮ причину с этой точки зрения. Читай реальный код (ast-index/grep/read).
Верни гипотезу root cause + доказательства из кода + уверенность.`,
    { label: `diagnose:${l.role}`, phase: 'Diagnose', schema: FINDING_SCHEMA, agentType: l.agent }
  )
))).filter(Boolean)

const diagnosis = await agent(
  `Ты синтезируешь диагноз из находок консилиума по багу "${REQUEST}".
Находки: ${JSON.stringify(findings)}.
Репро: ${JSON.stringify(repro)}.
Определи ОДНУ корневую причину. Собери ВЕСЬ кластер родственных дыр того же корня
(не только симптом — баг обычно симптом непроработанного состояния).
Укажи слои для фикса (backend/mobile/web).`,
  { label: 'diagnose-synth', phase: 'Diagnose', schema: DIAGNOSIS_SCHEMA }
)

if (MODE === 'diagnose-only') {
  phase('Report')
  const diagPath = `./swarm-report/${SLUG}-${DATE}-bug.md`
  await agent(
    `Напиши отчёт-диагноз в файл ${CWD}/${diagPath} (Write).
"# Bug Diagnosis — ${DATE}". Запрос: "${REQUEST}".
Репро: ${JSON.stringify(repro)}. Находки консилиума: ${JSON.stringify(findings)}.
Диагноз: ${JSON.stringify(diagnosis)}. Фикс НЕ применялся (mode=diagnose-only).`,
    { label: 'report-diagnose', phase: 'Report', model: 'haiku' }
  )
  return { status: 'diagnosed', repro, findings, diagnosis, report: diagPath }
}

// ── Phase 3: Fix — executing-агенты по слоям (parallel, worktree isolation) ─
phase('Fix')
const fixLayers = (diagnosis && diagnosis.fixLayers && diagnosis.fixLayers.length)
  ? diagnosis.fixLayers
  : (repro.layers || [])
const fixTargets = fixLayers
  .map((layer) => executing.find((e) => e.layer === layer))
  .filter(Boolean)
const fixAgents = fixTargets.length ? fixTargets : [executing[0]]

const fixes = (await parallel(fixAgents.map((t) => () =>
  agent(
    `Проект: ${CWD}. Слой: ${t.layer}. Файлы под твоим scope: ${t.scope}.
Диагноз: ${JSON.stringify(diagnosis)}.
Закрой ВЕСЬ кластер (${JSON.stringify(diagnosis.cluster)}), а не только симптом.
Внеси правки в код. Верни список изменённых файлов и краткое описание.`,
    { label: `fix:${t.layer}`, phase: 'Fix', schema: FIX_SCHEMA, agentType: t.agent, isolation: 'worktree' }
  )
))).filter(Boolean)

// ── Phase 4: Validate ─────────────────────────────────────────────────────
// Два независимых валидатора идут параллельно: (1) evidence-based сборка+тесты,
// (2) E2E-прогон реального кейса фичи на живом приложении. Оба ОБЯЗАНЫ прикладывать
// реальные доказательства — самоотчёт «прошло» без вывода не принимается.
phase('Validate')
const changedFiles = fixes.flatMap((f) => f.changedFiles || [])
const validationLayers = (diagnosis && diagnosis.fixLayers && diagnosis.fixLayers.length)
  ? diagnosis.fixLayers
  : (repro.layers || [])

const [validation, e2e] = await parallel([
  () => agent(
    `Проект: ${CWD}. Провалидируй фикс бага "${REQUEST}" — СБОРКА + ЮНИТ-ТЕСТЫ.
Изменённые файлы: ${JSON.stringify(changedFiles)}.

СТРОГО (иначе валидация недостоверна — был случай, когда агент соврал «BUILD SUCCEEDED», а сборка падала):
1. Найди систему сборки проекта (gradle/xcodebuild/swift build/npm/Makefile) сам.
2. Запусти сборку в Bash так, чтобы ПОЛУЧИТЬ РЕАЛЬНЫЙ EXIT CODE — НЕ маскируй через
   \`| tail\`/\`| grep\` (пайп отдаёт код последней команды!). Используй \`set -o pipefail\`
   ИЛИ пиши вывод в файл и отдельно \`echo $?\`, потом grep по файлу.
3. Прочитай реальную строку-маркер (BUILD SUCCEEDED / BUILD FAILED / BUILD SUCCESSFUL /
   FAILURE / error:) и впиши её ДОСЛОВНО в buildEvidence. Верни buildExitCode как есть.
4. buildPassed=true ТОЛЬКО если exitCode==0 И маркер успеха присутствует. Иначе false.
5. Прогони юнит-тесты аналогично; впиши дословную строку итога ("Executed N tests, 0 failures"
   и т.п.) в testsEvidence. testsPassed по факту.
6. passed = buildPassed && testsPassed. Проверь, что симптом (${repro.summary}) устранён.
Врать про прохождение ЗАПРЕЩЕНО — прикладывай только реальный вывод.`,
    { label: 'validate:build', phase: 'Validate', schema: VALIDATE_SCHEMA, model: 'sonnet' }
  ),
  () => agent(
    `Проект: ${CWD}. E2E-ВАЛИДАЦИЯ фикса бага "${REQUEST}" на ЖИВОМ приложении.
Затронутые слои: ${JSON.stringify(validationLayers)}. Изменённые файлы: ${JSON.stringify(changedFiles)}.
Симптом для проверки: ${repro.summary}

Задача — прогнать РЕАЛЬНЫЙ пользовательский кейс по затронутой фиче и убедиться, что симптом
ушёл, а не только «код собрался». Определи платформу по затронутым файлам/слоям и возьми инструмент:
- Любое ПРИЛОЖЕНИЕ (mobile И desktop: Android / iOS / macOS/desktop, Compose/SwiftUI/AppKit/etc)
  → «Claude in mobile» = mobile MCP (единый драйвер всех app-платформ). Через ToolSearch подними
  mcp__mobile__* (device/app/ui/screen/input) ИЛИ skill-обёртки /test-android, /test-ios, /test-desktop
  через Bash. Собери/запусти приложение, пройди шаги фичи, сними ui-tree/screenshot.
- Web (webApp/**, *.vue, *.ts) → playwright-cli через Bash. Сессия: "${E2E_SESSION || '(не передана)'}".
  Сессия пуста — НЕ открывай новый браузер, верни ran=false с причиной. Есть →
  \`playwright-cli -s=${E2E_SESSION || '<session>'} goto/snapshot/click/screenshot\`, пройди кейс.
- Backend → curl/httpie реальные запросы по фиче.
Приложи РЕАЛЬНЫЕ наблюдения (ui-tree/snapshot/screenshot ref, ответ сервера) в evidence.
ЧЕСТНО: если живьём прогнать нельзя (нет сессии/устройства/деплоя) — ran=false + причина;
НЕ выдавай build-only за e2e. НЕ выводи окно на передний план (osascript и т.п. запрещены).`,
    { label: 'validate:e2e', phase: 'Validate', schema: E2E_VALIDATE_SCHEMA, model: 'sonnet' }
  ),
])

// ── Phase 5: Report ───────────────────────────────────────────────────────
phase('Report')
const reportPath = `./swarm-report/${SLUG}-${DATE}-bug.md`
const buildTestsOk = !!(validation && validation.passed)
const e2eOk = !!(e2e && e2e.ran && e2e.passed)
const e2eSkipped = !e2e || e2e.ran === false
const overallStatus = buildTestsOk
  ? (e2eOk ? 'fixed' : (e2eSkipped ? 'fixed-e2e-skipped' : 'fixed-e2e-failed'))
  : 'fix-unverified'

await agent(
  `Напиши финальный отчёт в файл ${CWD}/${reportPath} (Write).
"# Bug Report — ${DATE}". Запрос: "${REQUEST}".
Репро: ${JSON.stringify(repro)}.
Диагноз (root cause + кластер): ${JSON.stringify(diagnosis)}.
Фиксы: ${JSON.stringify(fixes)}.
Валидация сборка+тесты (с реальными доказательствами): ${JSON.stringify(validation)}.
E2E на живом приложении: ${JSON.stringify(e2e)}.
Статус: ${overallStatus}.
Структура: симптом, root cause, что изменено (файлы), результат валидации (ПРИВЕДИ реальные
build/test маркеры и e2e-наблюдения дословно), риски/откаты. Если e2e не прогнан — явно отметь
что фича живьём НЕ проверена и это нужно сделать вручную.`,
  { label: 'report', phase: 'Report', model: 'haiku' }
)

return {
  status: overallStatus,
  repro,
  diagnosis,
  fixes,
  validation,
  e2e,
  report: reportPath,
}
