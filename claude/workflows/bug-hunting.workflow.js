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
const REQUEST = (args && args.request) || ''
const CWD = (args && args.cwd) || '.'
const DATE = (args && args.date) || 'unknown-date'
const SLUG = (args && args.slug) || 'project'
const MODE = (args && args.mode) || 'full-fix'
const STABLE_REPRO = (args && args.stableRepro) === true

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
phase('Validate')
const validation = await agent(
  `Проект: ${CWD}. Провалидируй фикс бага "${REQUEST}".
Изменённые файлы: ${JSON.stringify(fixes.flatMap((f) => f.changedFiles || []))}.
Запусти сборку и юнит-тесты через Bash (найди gradle/скрипт проекта). Убедись,
что симптом из репро (${repro.summary}) больше не воспроизводится и нет регрессий.
Верни passed + детали (что запускал, вывод).`,
  { label: 'validate', phase: 'Validate', schema: VALIDATE_SCHEMA, model: 'sonnet' }
)

// ── Phase 5: Report ───────────────────────────────────────────────────────
phase('Report')
const reportPath = `./swarm-report/${SLUG}-${DATE}-bug.md`
await agent(
  `Напиши финальный отчёт в файл ${CWD}/${reportPath} (Write).
"# Bug Report — ${DATE}". Запрос: "${REQUEST}".
Репро: ${JSON.stringify(repro)}.
Диагноз (root cause + кластер): ${JSON.stringify(diagnosis)}.
Фиксы: ${JSON.stringify(fixes)}.
Валидация: ${JSON.stringify(validation)}.
Статус: ${validation && validation.passed ? 'Done' : 'Partial — валидация не прошла'}.
Структура: симптом, root cause, что изменено (файлы), результат валидации, риски/откаты.`,
  { label: 'report', phase: 'Report', model: 'haiku' }
)

return {
  status: validation && validation.passed ? 'fixed' : 'fix-unverified',
  repro,
  diagnosis,
  fixes,
  validation,
  report: reportPath,
}
