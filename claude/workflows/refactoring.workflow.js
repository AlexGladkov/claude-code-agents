export const meta = {
  name: 'refactoring',
  description: 'Рефакторинг консилиумом: стек-детект → линт-гейт → аудит (parallel) → triage → exec по scope → валидация → отчёт',
  whenToUse: 'Рефакторинг, аудит кода, почистить код. Запускается скиллом /refactor.',
  phases: [
    { title: 'Resolve', detail: 'Резолв роль→агент из проектного CLAUDE.md ## Agents (с дефолтами)' },
    { title: 'StackDetect', detail: 'Автодетект стека по CLAUDE.md + файловой структуре проекта' },
    { title: 'LintGate', detail: 'Прогон линтеров (detekt/ktlint/biome/swiftlint), сбор нарушений' },
    { title: 'Audit', detail: 'Консилиум parallel: architect/developer/security/test → structured findings' },
    { title: 'Triage', detail: 'Группировка findings по severity, формирование плана рефакторинга' },
    { title: 'Execute', detail: 'Exec-агенты по file-scope isolation:worktree применяют правки (mode=apply)' },
    { title: 'Validate', detail: 'Регрессионный консилиум + линт ре-ран + юнит-тесты (сборка)' },
    { title: 'Report', detail: 'swarm-report/<slug>-<date>-refactor.md' },
  ],
}

// ── args (передаёт skill /refactor) ──────────────────────────────────────────
//   request        : запрос от пользователя
//   cwd            : абсолютный путь корня проекта
//   date           : YYYY-MM-DD
//   slug           : basename репо/cwd
//   mode           : 'audit-only' | 'apply'
//   scope          : 'all' | 'backend' | 'mobile' | 'web' | <custom path>
//   severityFilter : 'all' | 'critical+high' | 'critical-only'
const REQUEST = (args && args.request) || ''
const CWD = (args && args.cwd) || '.'
const DATE = (args && args.date) || 'unknown-date'
const SLUG = (args && args.slug) || 'project'
const MODE = (args && args.mode) || 'audit-only'
const SCOPE = (args && args.scope) || 'all'
const SEVERITY_FILTER = (args && args.severityFilter) || 'critical+high'

// Дефолтная карта роль→агент (из глобального CLAUDE.md). Resolve переопределяет
// если в проектном CLAUDE.md есть секция ## Agents.
const DEFAULT_CONSILIUM = {
  architect: 'voltagent-lang:java-architect',
  developer: 'voltagent-lang:kotlin-specialist',
  security: 'security-kotlin',
  test: 'test-spring',
  devops: 'devops-orchestrator',
}
const DEFAULT_EXECUTING = [
  { layer: 'backend', scope: 'backend/**/*.kt, springApp/**/*.kt', agent: 'refactor-spring' },
  { layer: 'mobile', scope: 'composeApp/**/*.kt, shared/**/*.kt, core-kmp/**/*.kt', agent: 'refactor-mobile' },
  { layer: 'web', scope: '**/*.vue, **/*.ts', agent: 'voltagent-lang:vue-expert' },
]

// ── Schemas ───────────────────────────────────────────────────────────────────

const RESOLVE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['consilium', 'executing'],
  properties: {
    consilium: {
      type: 'object',
      additionalProperties: false,
      required: ['architect', 'developer', 'security', 'test'],
      properties: {
        architect: { type: 'string' },
        developer: { type: 'string' },
        security: { type: 'string' },
        test: { type: 'string' },
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

const STACK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['techStack', 'activeRoles', 'detectedLayers'],
  properties: {
    techStack: { type: 'array', items: { type: 'string' } },
    activeRoles: { type: 'array', items: { type: 'string' } },
    detectedLayers: { type: 'array', items: { type: 'string', enum: ['backend', 'mobile', 'web'] } },
  },
}

const LINT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['violations', 'summary'],
  properties: {
    violations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'line', 'rule', 'message'],
        properties: {
          file: { type: 'string' },
          line: { type: 'string' },
          rule: { type: 'string' },
          message: { type: 'string' },
        },
      },
    },
    summary: { type: 'string' },
  },
}

const AUDIT_FINDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['role', 'findings'],
  properties: {
    role: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'line', 'issue', 'severity', 'fix', 'effort'],
        properties: {
          file: { type: 'string' },
          line: { type: 'string' },
          issue: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          fix: { type: 'string' },
          effort: { type: 'string', enum: ['trivial', 'small', 'medium', 'large'] },
        },
      },
    },
  },
}

const TRIAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['critical', 'high', 'medium', 'low', 'totalFindings', 'approvedPlan'],
  properties: {
    critical: { type: 'array', items: { type: 'object' } },
    high: { type: 'array', items: { type: 'object' } },
    medium: { type: 'array', items: { type: 'object' } },
    low: { type: 'array', items: { type: 'object' } },
    totalFindings: { type: 'number' },
    approvedPlan: {
      type: 'array',
      description: 'Findings отфильтрованные по severityFilter, готовые к exec',
      items: { type: 'object' },
    },
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

const REGRESSION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['role', 'verdict', 'details'],
  properties: {
    role: { type: 'string' },
    verdict: { type: 'string', enum: ['PASS', 'FAIL'] },
    details: { type: 'string' },
  },
}

const VALIDATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['passed', 'lintAfter', 'lintDelta', 'regressionResults', 'testOutput'],
  properties: {
    passed: { type: 'boolean' },
    lintAfter: { type: 'number' },
    lintDelta: { type: 'number' },
    regressionResults: { type: 'array', items: { type: 'object' } },
    testOutput: { type: 'string' },
  },
}

// ── Phase 0: Resolve ──────────────────────────────────────────────────────────
phase('Resolve')
const resolved = await agent(
  `Ты резолвер агентов для оркестрации в проекте по пути ${CWD}.
Прочитай ${CWD}/CLAUDE.md, секцию "## Agents" (Консилиум + Executing), если она есть.
Верни карту роль→конкретный агент для консилиума (architect, developer, security, test)
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

// ── Phase 1: StackDetect ──────────────────────────────────────────────────────
phase('StackDetect')
const stackInfo = await agent(
  `Проект: ${CWD}. Scope: ${SCOPE}.
Определи технологический стек АВТОМАТИЧЕСКИ (без вопросов пользователю):
1. Прочитай ${CWD}/CLAUDE.md секцию ## Agents / ### Executing — scope даёт стек.
2. Просмотри корень проекта (ls ${CWD}):
   - build.gradle.kts с org.springframework.boot → spring-boot
   - build.gradle.kts с kotlin("multiplatform") или composeApp/ → kotlin-multiplatform
   - package.json с vue → vue3
   - package.json с react → react
   - Package.swift или iosApp/ → swift
   - pom.xml → java-maven
   - Podfile → cocoapods
3. Сформируй techStack список, activeRoles (architect/developer/security/test/frontend/api),
   detectedLayers (backend/mobile/web).`,
  { label: 'stack-detect', phase: 'StackDetect', schema: STACK_SCHEMA, model: 'haiku' }
)

const techStack = (stackInfo && stackInfo.techStack) || []
const detectedLayers = (stackInfo && stackInfo.detectedLayers) || ['backend']

// ── Phase 2: LintGate ─────────────────────────────────────────────────────────
phase('LintGate')
const lintResult = await agent(
  `Проект: ${CWD}. Стек: ${JSON.stringify(techStack)}.
Запусти статический анализ через Bash:
1. Проверь наличие .lint/full-lint.sh → запусти если есть.
2. Fallback по стеку:
   - spring-boot / kotlin-multiplatform → ./gradlew detekt 2>&1 | head -200; ktlint --reporter=plain 2>&1 | head -100
   - vue3 / react → npx biome check src/ 2>&1 | head -200 || npx eslint src/ 2>&1 | head -200
   - swift → swiftlint lint 2>&1 | head -200
3. Собери violations в формате [{file, line, rule, message}].
Возвращай ТОЛЬКО реальный вывод — не выдумывай нарушения.`,
  { label: 'lint-gate', phase: 'LintGate', schema: LINT_SCHEMA }
)

const lintViolations = (lintResult && lintResult.violations) || []
const lintBefore = lintViolations.length

// ── Phase 3: Audit — консилиум parallel ──────────────────────────────────────
phase('Audit')
const auditLenses = [
  {
    role: 'architect',
    agent: consilium.architect,
    checklist: `SOLID violations, god classes (>500 LOC), cyclic dependencies, layer leaks (controller→repo),
unused abstractions, incorrect DI scope. Stack-specific: controller→service→repo layering,
@Transactional on service not repo/controller, UseCase returns Result<T>, no cross-layer deps.`,
  },
  {
    role: 'developer',
    agent: consilium.developer,
    checklist: `Dead code, duplicate logic (>20 LOC copy-paste), unreachable branches, unused imports/vars,
long methods (>100 LOC), deep nesting (>4 levels), magic numbers. Stack: while(true) loops,
delay() in production, mutable state not wrapped in StateFlow, force unwraps in Swift.`,
  },
  {
    role: 'security',
    agent: consilium.security,
    checklist: `Hardcoded secrets/passwords/tokens, SQL injection, XSS, insecure deserialization,
missing auth checks, exposed internal errors in API, insecure crypto. Stack: missing @PreAuthorize,
CORS misconfiguration, exposed actuator endpoints, hardcoded DB credentials.`,
  },
  {
    role: 'test',
    agent: consilium.test,
    checklist: `Missing tests for public API, no edge case coverage, flaky tests (time/order-dependent),
test-prod coupling (shared mutable state), no negative tests. Missing input validation,
inconsistent naming, missing error responses (4xx/5xx), N+1 queries.`,
  },
]

const auditFindings = (await parallel(auditLenses.map((l) => () =>
  agent(
    `Рефакторинг-аудит проекта.
Запрос: "${REQUEST}". Стек: ${JSON.stringify(techStack)}.
Scope: ${SCOPE}.
Lint violations (уже найдены, НЕ дублируй): ${JSON.stringify(lintViolations.slice(0, 50))}.

Твоя роль — ${l.role}. Читай реальный код (ast-index/grep/read).
Проверь по чеклисту:
${l.checklist}

Для КАЖДОЙ находки верни: file, line, issue, severity (critical|high|medium|low), fix, effort (trivial|small|medium|large).
Если нарушений нет — findings = [].
НЕ включать lint violations — они уже учтены.`,
    { label: `audit:${l.role}`, phase: 'Audit', schema: AUDIT_FINDING_SCHEMA, agentType: l.agent }
  )
))).filter(Boolean)

// ── Phase 4: Triage ───────────────────────────────────────────────────────────
phase('Triage')
const triage = await agent(
  `Собери ВСЕ findings из аудита и lint gate. Сгруппируй по severity.
Lint findings (${lintBefore}): ${JSON.stringify(lintViolations.slice(0, 30))}.
Audit findings: ${JSON.stringify(auditFindings)}.
Severity filter для approve: "${SEVERITY_FILTER}".

Сформируй approvedPlan — только findings matching severityFilter:
- "all" → все severity
- "critical+high" → только critical и high
- "critical-only" → только critical

Верни: critical[], high[], medium[], low[], totalFindings (число), approvedPlan[].`,
  { label: 'triage', phase: 'Triage', schema: TRIAGE_SCHEMA }
)

if (MODE === 'audit-only') {
  // audit-only: формируем отчёт без применения правок
  phase('Report')
  const auditReportPath = `./swarm-report/${SLUG}-${DATE}-refactor.md`
  await agent(
    `Напиши отчёт аудита в файл ${CWD}/${auditReportPath} (используй Write).

# Refactoring Audit Report — ${DATE}

## Summary
- Stack: ${JSON.stringify(techStack)}
- Scope: ${SCOPE}
- Mode: audit-only (код не изменялся)

## Lint Gate
- Violations: ${lintBefore}
${JSON.stringify(lintViolations.slice(0, 50), null, 2)}

## Audit Findings
${JSON.stringify(triage, null, 2)}

## Approved Plan (severityFilter: ${SEVERITY_FILTER})
${JSON.stringify(triage && triage.approvedPlan, null, 2)}

Структура отчёта: stack, scope, lint delta, findings по severity, approved plan, рекомендации.`,
    { label: 'report-audit-only', phase: 'Report', model: 'haiku' }
  )
  return {
    status: 'audited',
    techStack,
    lintViolations: lintBefore,
    triage,
    report: auditReportPath,
  }
}

// ── Phase 5: Execute — exec-агенты по слоям (parallel, worktree isolation) ────
phase('Execute')
const approvedPlan = (triage && triage.approvedPlan) || []

// Определяем какие слои затронуты на основе файлов в approved plan
const planFiles = approvedPlan.map((f) => f.file || '').join(' ')
const targetLayers = executing.filter((e) => {
  if (SCOPE === 'all') return true
  if (SCOPE === e.layer) return true
  // Проверяем по именам файлов в плане
  const scopePatterns = e.scope.split(',').map((s) => s.trim().replace(/\*\*/g, ''))
  return scopePatterns.some((p) => planFiles.includes(p.replace('/*.', '.')))
})
const execTargets = targetLayers.length ? targetLayers : executing.slice(0, 1)

const execResults = (await parallel(execTargets.map((t) => () =>
  agent(
    `Проект: ${CWD}. Слой: ${t.layer}. Файлы под твоим scope: ${t.scope}.
Approved план рефакторинга (только твои файлы):
${JSON.stringify(approvedPlan.filter((f) => {
  const scopePatterns = t.scope.split(',').map((s) => s.trim().replace(/\*\*/g, ''))
  return !f.file || scopePatterns.some((p) => (f.file || '').includes(p.replace('/*.', '.')))
}))}.

Правила:
- Менять ТОЛЬКО то что в плане — никаких побочных улучшений
- Сохранять публичный API (если не указано иное в плане)
- Не ломать существующие тесты
- Следовать архитектурным правилам проекта (из ${CWD}/CLAUDE.md)

Верни список изменённых файлов и краткое описание что и почему изменено.`,
    { label: `exec:${t.layer}`, phase: 'Execute', schema: EXEC_SCHEMA, agentType: t.agent, isolation: 'worktree' }
  )
))).filter(Boolean)

// ── Phase 6: Validate ─────────────────────────────────────────────────────────
phase('Validate')
const changedFiles = execResults.flatMap((r) => r.changedFiles || [])

// 6.1 Lint re-run + regression consilium + tests — параллельно
const [lintAfterResult, ...regressionResults] = await parallel([
  () => agent(
    `Проект: ${CWD}. Стек: ${JSON.stringify(techStack)}.
Повтори lint gate (как в LintGate фазе). Верни количество violations и summary.
Сравни с исходным: было ${lintBefore} violations.`,
    { label: 'lint-rerun', phase: 'Validate', model: 'haiku' }
  ),
  () => agent(
    `Проект: ${CWD}. Роль: developer (diagnostics).
Проверь изменённые файлы: ${JSON.stringify(changedFiles)}.
Ищи новые баги, регрессии, NPE, изменённое поведение, сломанные импорты.
Верни verdict: PASS или FAIL + детали.`,
    { label: 'regression:developer', phase: 'Validate', schema: REGRESSION_SCHEMA, agentType: consilium.developer }
  ),
  () => agent(
    `Проект: ${CWD}. Роль: architect.
Проверь изменённые файлы: ${JSON.stringify(changedFiles)}.
Ищи архитектурную деградацию, новые dependency cycles, layer violations.
Верни verdict: PASS или FAIL + детали.`,
    { label: 'regression:architect', phase: 'Validate', schema: REGRESSION_SCHEMA, agentType: consilium.architect }
  ),
  () => agent(
    `Проект: ${CWD}. Роль: security.
Проверь изменённые файлы: ${JSON.stringify(changedFiles)}.
Ищи новые уязвимости, удалённые security-проверки, exposed data.
Верни verdict: PASS или FAIL + детали.`,
    { label: 'regression:security', phase: 'Validate', schema: REGRESSION_SCHEMA, agentType: consilium.security }
  ),
  () => agent(
    `Проект: ${CWD}. Запусти сборку и юнит-тесты через Bash.
Найди скрипт: ./gradlew build test / npm test / swift test.
Верни вывод команды (первые 200 строк). Статус: passed (true/false).`,
    { label: 'validate-tests', phase: 'Validate', model: 'sonnet' }
  ),
])

const lintAfterCount = lintAfterResult
  ? (typeof lintAfterResult === 'object' && lintAfterResult.lintAfter
      ? lintAfterResult.lintAfter
      : lintBefore)
  : lintBefore
const lintDelta = lintAfterCount - lintBefore
const regressionFails = regressionResults
  .filter((r) => r && r.verdict === 'FAIL')
const testResult = regressionResults[regressionResults.length - 1]
const testPassed = testResult && (testResult.passed !== false)
const validationPassed = regressionFails.length === 0 && lintDelta <= 0 && testPassed

// ── Phase 7: Report ───────────────────────────────────────────────────────────
phase('Report')
const reportPath = `./swarm-report/${SLUG}-${DATE}-refactor.md`
await agent(
  `Напиши финальный отчёт рефакторинга в файл ${CWD}/${reportPath} (Write).

# Refactoring Report — ${DATE}

## Summary
- Stack: ${JSON.stringify(techStack)}
- Scope: ${SCOPE}
- Mode: ${MODE}
- Severity filter: ${SEVERITY_FILTER}

## Findings
| Severity | Found | Fixed | Skipped |
|----------|-------|-------|---------|
(заполни из данных ниже)

Triage: ${JSON.stringify(triage)}.

## Lint Delta
- Before: ${lintBefore} violations
- After: ${lintAfterCount} violations
- Delta: ${lintDelta > 0 ? '+' + lintDelta + ' (ухудшение!)' : lintDelta + ' (' + (lintDelta < 0 ? 'улучшение' : 'без изменений') + ')'}

## Changes
${JSON.stringify(execResults)}.

## Validation
Regression consilium: ${JSON.stringify(regressionResults.slice(0, 3))}.
Tests: ${JSON.stringify(testResult)}.
Overall: ${validationPassed ? 'PASS' : 'FAIL — есть проблемы'}.

${regressionFails.length > 0 ? '## Rollback Required\n' + JSON.stringify(regressionFails) : ''}

Структура: stack, scope, findings-таблица, lint delta, список изменённых файлов с описанием, результат валидации.`,
  { label: 'report', phase: 'Report', model: 'haiku' }
)

return {
  status: validationPassed ? 'refactored' : 'refactored-with-issues',
  techStack,
  lintBefore,
  lintAfter: lintAfterCount,
  lintDelta,
  triage,
  execResults,
  validationPassed,
  regressionFails,
  report: reportPath,
}
