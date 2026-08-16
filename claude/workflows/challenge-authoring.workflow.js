export const meta = {
  name: 'challenge-authoring',
  description: 'Создание контента челленджа + прогон E2E на проде: Resolve → Author (дизайн-спека + контент дней) → Create via UI → Deploy → E2E (playwright) → Report',
  whenToUse: 'Челлендж, создать челлендж, новый челлендж, контент челленджа, дни челленджа, проверить челлендж. Запускается скиллом /challenge.',
  phases: [
    { title: 'Resolve', detail: 'Резолв роль→агент из проектного CLAUDE.md ## Agents (с дефолтами)' },
    { title: 'Author', detail: 'Дизайн-спека челленджа + генерация контента по дням (теория/задачи/критерии)' },
    { title: 'Create via UI', detail: 'Ввод челленджа через реальный UI платформы (playwright/mobile), UI-ONLY' },
    { title: 'Deploy', detail: 'Деплой на прод через скрипт проекта + health check' },
    { title: 'E2E', detail: 'E2E-проверка полного флоу на проде через playwright-cli -s=<session>' },
    { title: 'Report', detail: 'swarm-report/<slug>-<date>-challenge.md' },
  ],
}

// ── args (передаёт skill /challenge) ──────────────────────────────────────
//   request : сырой текст запроса от юзера (тема/описание челленджа)
//   cwd     : абсолютный путь корня проекта
//   date    : YYYY-MM-DD (скрипт не имеет доступа к Date.now)
//   slug    : basename репо/cwd
//   session : имя playwright-сессии, зарезолвленное скиллом ДО запуска
//   params  : { тема, дни, accessType, язык, уровень } — параметры челленджа из гейта
const A = (typeof args === 'string') ? (JSON.parse(args) || {}) : (args || {})
const REQUEST = (A && A.request) || ''
const CWD = (A && A.cwd) || '.'
const DATE = (A && A.date) || 'unknown-date'
const SLUG = (A && A.slug) || 'project'
const SESSION = (A && A.session) || SLUG
const PARAMS = (A && A.params) || {}

// Дефолтная карта роль→агент (из глобального CLAUDE.md). Resolve её переопределяет,
// если в проектном CLAUDE.md есть секция ## Agents.
const DEFAULT_CONSILIUM = {
  'product-manager': 'voltagent-biz:product-manager',
  'technical-writer': 'voltagent-biz:technical-writer',
  test: 'test-spring',
  devops: 'devops-orchestrator',
}
const DEFAULT_EXECUTING = [
  { scope: 'backend/**/*.kt, springApp/**/*.kt', agent: 'builder-spring-feature', layer: 'backend' },
  { scope: 'composeApp/**/*.kt, core-kmp/**/*.kt', agent: 'kotlin-multiplatform-developer', layer: 'mobile' },
]

const RESOLVE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['consilium', 'executing'],
  properties: {
    consilium: {
      type: 'object',
      additionalProperties: false,
      required: ['product-manager', 'technical-writer', 'test', 'devops'],
      properties: {
        'product-manager': { type: 'string' },
        'technical-writer': { type: 'string' },
        test: { type: 'string' },
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

const DAY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['day', 'title', 'theoryContent', 'tasksContent', 'objectives', 'expectedDeliverables', 'submissionFormats', 'evaluationCriteria', 'passingScore'],
  properties: {
    day: { type: 'integer' },
    title: { type: 'string' },
    theoryContent: { type: 'string', description: 'HTML теория, 500-2000 слов, прогрессивная сложность' },
    tasksContent: { type: 'string', description: 'HTML описание задачи, конкретные deliverables' },
    objectives: { type: 'array', items: { type: 'string' } },
    expectedDeliverables: { type: 'array', items: { type: 'string' } },
    expectedFilePatterns: { type: 'array', items: { type: 'string' } },
    submissionFormats: { type: 'array', items: { type: 'string', enum: ['FILE', 'TEXT', 'CODE', 'IMAGE'] } },
    evaluationCriteria: { type: 'array', items: { type: 'string' } },
    passingScore: { type: 'integer' },
  },
}

const AUTHOR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'description', 'mainCategory', 'hardcodeLevel', 'duration', 'accessType', 'language', 'days', 'contentFile'],
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    mainCategory: { type: 'string' },
    hardcodeLevel: { type: 'string' },
    duration: { type: 'integer', description: 'число дней' },
    tags: { type: 'array', items: { type: 'string' } },
    prerequisites: { type: 'array', items: { type: 'string' } },
    learningOutcomes: { type: 'array', items: { type: 'string' } },
    accessType: { type: 'string', enum: ['FREE', 'PAID', 'SUBSCRIPTION'] },
    language: { type: 'string' },
    days: { type: 'array', items: DAY_SCHEMA },
    contentFile: { type: 'string', description: 'путь к temp-файлу с полным контентом для UI-ввода' },
  },
}

const CREATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['created', 'platform', 'summary'],
  properties: {
    created: { type: 'boolean' },
    platform: { type: 'string', enum: ['web', 'android', 'ios'] },
    challengeUrlOrId: { type: 'string' },
    fallbackUsed: { type: 'boolean', description: 'true если UI сломан и пришлось fallback на API/SQL (техдолг)' },
    summary: { type: 'string' },
  },
}

const DEPLOY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['deployed', 'details'],
  properties: {
    deployed: { type: 'boolean' },
    healthOk: { type: 'boolean' },
    details: { type: 'string' },
  },
}

const E2E_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['passed', 'checks', 'scenarioFile', 'details'],
  properties: {
    passed: { type: 'boolean' },
    checks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'ok'],
        properties: {
          name: { type: 'string' },
          ok: { type: 'boolean' },
          note: { type: 'string' },
        },
      },
    },
    scenarioFile: { type: 'string' },
    screenshots: { type: 'array', items: { type: 'string' } },
    details: { type: 'string' },
  },
}

// ── Phase 0: Resolve ──────────────────────────────────────────────────────
phase('Resolve')
const resolved = await agent(
  `Ты резолвер агентов для оркестрации в проекте по пути ${CWD}.
Прочитай ${CWD}/CLAUDE.md, секцию "## Agents" (Консилиум + Executing), если она есть.
Верни карту роль→конкретный агент для консилиума (product-manager, technical-writer, test, devops)
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

// ── Phase 1: Author — дизайн-спека + генерация контента по дням ────────────
// Стадии профиля Design + Content. product-manager формирует структуру,
// technical-writer генерирует контент. Контент = HTML-строки для UI-ввода;
// пишем их в temp-файл (isolation:'worktree', т.к. это файл в репо).
phase('Author')
const author = await agent(
  `Проект: ${CWD}. Запрос пользователя: "${REQUEST}".
Параметры челленджа (из гейта скилла): ${JSON.stringify(PARAMS)}.
Твоя задача — стадии Design + Content профиля challenge-authoring.

DESIGN (структура челленджа):
- name, description, mainCategory, hardcodeLevel
- duration (число дней; если не задано в params — выведи из темы, Day 1 = онбординг, последний = capstone)
- tags, prerequisites, learningOutcomes, accessType (FREE/PAID/SUBSCRIPTION), language

CONTENT (для КАЖДОГО дня сгенерируй):
- theoryContent — HTML-теория, 500-2000 слов, прогрессивная сложность, с примерами кода
- tasksContent — HTML описание задачи, КОНКРЕТНЫЕ deliverables (не «сделай что-нибудь»)
- objectives — цели обучения дня
- expectedDeliverables — что юзер сдаёт
- expectedFilePatterns — паттерны файлов (напр. *.kt, docker-compose.yml)
- submissionFormats — FILE/TEXT/CODE/IMAGE
- evaluationCriteria — измеримые критерии для AI-оценки, привязанные к objectives
- passingScore — минимум для прохождения (дефолт 70)

Правила качества: теория прогрессивная, Day 1 проще (онбординг), последний день — capstone.
Сохрани ПОЛНЫЙ контент всех дней в temp-файл ${CWD}/swarm-report/${SLUG}-${DATE}-challenge-content.md
(через Write) — из него потом идёт UI-ввод. Верни contentFile = путь к этому файлу.`,
  {
    label: 'author-challenge',
    phase: 'Author',
    schema: AUTHOR_SCHEMA,
    agentType: consilium['technical-writer'],
    isolation: 'worktree',
  }
)

// ── Phase 2: Create via UI — UI-ONLY ввод челленджа ───────────────────────
phase('Create via UI')
const created = await agent(
  `Проект: ${CWD}. Создай челлендж "${author && author.name}" через РЕАЛЬНЫЙ UI платформы.
Спека и контент: ${JSON.stringify({ name: author && author.name, duration: author && author.duration, contentFile: author && author.contentFile })}.
Полный контент дней лежит в файле ${author && author.contentFile} — читай его для ввода.

CRITICAL — UI-ONLY: создание ТОЛЬКО через UI, НЕ через прямой SQL и НЕ через raw curl.
- Web: команды \`playwright-cli -s=${SESSION}\` (снапшот → fill/click → submit). Сессия УЖЕ
  зарезолвлена скиллом — НЕ вызывай \`playwright-cli open\`, НЕ открывай новый браузер, работай
  в сессии ${SESSION}. Если ref не найден — переснять snapshot.
- Android/iOS: соответствующий harness (/test-android, /test-ios) через Bash.
Шаги: экран создания челленджа → заполнить метаданные (name/description/category/level/tags) →
для каждого дня заполнить theory/tasks/objectives/deliverables/criteria → сохранить/опубликовать →
убедиться, что челлендж появился в списке.
Если create-UI отсутствует или сломан — НЕ чинить молча: верни created=false, опиши блокер;
fallback на API/SQL допустим только как исключение — тогда выстави fallbackUsed=true (это техдолг).
Верни платформу, id/url челленджа и краткое резюме.`,
  { label: 'create-via-ui', phase: 'Create via UI', schema: CREATE_SCHEMA, model: 'sonnet' }
)

// ── Phase 3: Deploy на прод (обязателен перед E2E) ────────────────────────
phase('Deploy')
const deploy = await agent(
  `Проект: ${CWD}. Задеплой на прод перед E2E-проверкой челленджа.
Найди deploy-скрипт проекта (skill /deploy, Makefile, scripts/deploy.sh или аналог) и выполни
через Bash. Дождись успешного health check. Верни deployed + healthOk + детали (что запускал, вывод).
Если контент/челлендж создавался только через UI прод-стенда и отдельный деплой не нужен —
верни deployed=true с пометкой, что деплой не требовался.`,
  { label: 'deploy', phase: 'Deploy', schema: DEPLOY_SCHEMA, agentType: consilium.devops }
)

// ── Phase 4: E2E — полный флоу на проде через playwright-cli ───────────────
phase('E2E')
const e2e = await agent(
  `Проект: ${CWD}. Прогони E2E полного флоу челленджа "${author && author.name}" на ПРОДЕ.
Создание: ${JSON.stringify(created)}. Деплой: ${JSON.stringify(deploy)}.

Сначала создай файл сценария ${CWD}/swarm-report/${SLUG}-challenge-e2e-scenario.md с чеклистом
шагов (формат "- [ ] N. действие + ожидаемый результат"). После каждого пройденного шага помечай
его "- [x]" через Edit — файл персистентен и устойчив к компактизации.

Проверки (ВСЕ через UI):
1. Челлендж виден в списке (найти скроллом/поиском)
2. Экран деталей грузится, все поля рендерятся
3. Дни грузятся корректно (пройти по каждому)
4. Теория рендерится (открыть день, увидеть контент)
5. Кнопка Start работает
6. После Start — Day 1 theory + tasks видны
7. Submit работает (загрузить тестовый файл / ввести тестовый текст)
8. AI-фидбек возвращается (дождаться анализа, увидеть score + feedback)
9. Чат работает (отправить тестовое сообщение, AI отвечает)

Web — ТОЛЬКО через \`playwright-cli -s=${SESSION}\` (goto/snapshot/click/fill/screenshot). Сессия
${SESSION} УЖЕ открыта и зарезолвлена скиллом — НЕ открывай новый браузер, НЕ вызывай
\`playwright-cli open\`. Если ref не найден — переснять snapshot. Скриншоты ключевых шагов —
в swarm-report/. Android/iOS — через /test-android, /test-ios (Bash).
Верни passed, список checks (name+ok), путь scenarioFile, список screenshots, детали.`,
  { label: 'e2e', phase: 'E2E', schema: E2E_SCHEMA, model: 'sonnet' }
)

// ── Phase 5: Report ───────────────────────────────────────────────────────
phase('Report')
const reportPath = `./swarm-report/${SLUG}-${DATE}-challenge.md`
await agent(
  `Напиши финальный отчёт в файл ${CWD}/${reportPath} (используй Write).
"# Challenge Report — ${DATE}". Запрос: "${REQUEST}". Параметры: ${JSON.stringify(PARAMS)}.
Спека челленджа (name/category/level/duration/accessType + структура дней):
${JSON.stringify({ name: author && author.name, mainCategory: author && author.mainCategory, hardcodeLevel: author && author.hardcodeLevel, duration: author && author.duration, accessType: author && author.accessType, days: (author && author.days || []).map((d) => ({ day: d.day, title: d.title })) })}.
Метод создания (платформа UI, fallback?): ${JSON.stringify(created)}.
Деплой: ${JSON.stringify(deploy)}.
Результаты E2E на проде (со скриншотами): ${JSON.stringify(e2e)}.
Статус: ${e2e && e2e.passed ? 'Done' : 'Partial — E2E не полностью прошёл'}.
Структура: название/категория/уровень/длительность, сводка дней, метод создания,
результаты проверки по шагам, найденные проблемы, техдолг (если был fallback на API/SQL).`,
  { label: 'report', phase: 'Report', model: 'haiku' }
)

return {
  status: e2e && e2e.passed ? 'done' : 'partial',
  challenge: author && { name: author.name, duration: author.duration, accessType: author.accessType },
  created,
  deploy,
  e2e,
  report: reportPath,
}
