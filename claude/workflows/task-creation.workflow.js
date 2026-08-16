export const meta = {
  name: 'task-creation',
  description: 'Заведение задачи в трекере: Draft (формализация) → Create (issue в GitHub/Яндекс Трекер) → Report',
  whenToUse: 'Завести таску, создать задачу, добавить в трекер, создай тикет. Запускается скиллом /task.',
  phases: [
    { title: 'Resolve', detail: 'Резолв роль→агент из проектного CLAUDE.md ## Agents (с дефолтами)' },
    { title: 'Draft', detail: 'Формализация запроса: title, описание, acceptance criteria, labels, type' },
    { title: 'Create', detail: 'Создание issue в выбранной платформе (GitHub gh CLI / Яндекс Трекер MCP). Только эта фаза мутирует трекер.' },
    { title: 'Report', detail: 'swarm-report/<slug>-<date>-task.md' },
  ],
}

// ── args (передаёт skill /task) ───────────────────────────────────────────
//   request  : сырой текст задачи от юзера
//   cwd      : абсолютный путь корня проекта
//   date     : YYYY-MM-DD (скрипт не имеет доступа к Date.now)
//   slug     : basename репо/cwd
//   platform : 'github' | 'yandex'
//   queue    : owner/repo (GitHub) или ключ очереди (Яндекс Трекер)
const A = (typeof args === 'string') ? (JSON.parse(args) || {}) : (args || {})
const REQUEST = (A && A.request) || ''
const CWD = (A && A.cwd) || '.'
const DATE = (A && A.date) || 'unknown-date'
const SLUG = (A && A.slug) || 'project'
const PLATFORM = (A && A.platform) || 'github'
const QUEUE = (A && A.queue) || ''

// Дефолтная карта роль→агент (из глобального CLAUDE.md). Resolve переопределяет
// если в проектном CLAUDE.md есть секция ## Agents.
const DEFAULT_CONSILIUM = {
  'technical-writer': 'voltagent-biz:technical-writer',
  'business-analyst': 'voltagent-biz:business-analyst',
  architect: 'voltagent-lang:java-architect',
}

const RESOLVE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['consilium'],
  properties: {
    consilium: {
      type: 'object',
      additionalProperties: false,
      required: ['technical-writer', 'business-analyst', 'architect'],
      properties: {
        'technical-writer': { type: 'string' },
        'business-analyst': { type: 'string' },
        architect: { type: 'string' },
      },
    },
  },
}

const DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'type', 'description', 'acceptanceCriteria', 'labels'],
  properties: {
    title: { type: 'string', description: 'Краткий заголовок задачи, глаголом: "Добавить X", "Исправить Y"' },
    type: { type: 'string', enum: ['bug', 'feature', 'improvement', 'task'], description: 'Тип задачи' },
    description: { type: 'string', description: 'Что нужно сделать и зачем — 2-5 предложений' },
    acceptanceCriteria: { type: 'array', items: { type: 'string' }, description: 'Критерии готовности (AC)' },
    labels: { type: 'array', items: { type: 'string' }, description: 'Метки: bug, feature, backend, mobile, web, ios и т.п.' },
    priority: { type: 'string', enum: ['critical', 'high', 'normal', 'low'], description: 'Приоритет если очевиден из контекста' },
  },
}

const CREATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['issueUrl', 'issueId', 'platform'],
  properties: {
    issueUrl: { type: 'string', description: 'Полная ссылка на созданный issue/задачу' },
    issueId: { type: 'string', description: 'Номер или ключ задачи (например #42 или MYPROJECT-15)' },
    platform: { type: 'string' },
  },
}

// ── Phase 0: Resolve ──────────────────────────────────────────────────────
phase('Resolve')
const resolved = await agent(
  `Ты резолвер агентов для оркестрации в проекте по пути ${CWD}.
Прочитай ${CWD}/CLAUDE.md, секцию "## Agents" → "Консилиум", если она есть.
Верни карту роль→агент для ролей: technical-writer, business-analyst, architect.
Если секции нет или роль не указана — используй дефолты:
${JSON.stringify(DEFAULT_CONSILIUM)}
Имена агентов бери РОВНО как в проектном CLAUDE.md либо как в дефолтах — не выдумывай.`,
  { label: 'resolve-agents', phase: 'Resolve', schema: RESOLVE_SCHEMA, model: 'haiku' }
)

const consilium = (resolved && resolved.consilium) || DEFAULT_CONSILIUM

// ── Phase 1: Draft — формализация задачи ─────────────────────────────────
phase('Draft')
const draft = await agent(
  `Проект: ${CWD}. Запрос пользователя: "${REQUEST}".
Платформа трекера: ${PLATFORM}. Очередь/репозиторий: ${QUEUE}.

Твоя задача — формализовать запрос в структурированную задачу для трекера.
При необходимости прочитай CLAUDE.md проекта и ключевые файлы (ast-index search / grep)
чтобы получить контекст: какой компонент затронут, какой слой (backend/mobile/web).

Сформируй:
- title: краткий глаголом ("Добавить X", "Исправить Y")
- type: bug / feature / improvement / task
- description: что нужно сделать и зачем (2-5 предложений)
- acceptanceCriteria: конкретные критерии готовности (минимум 2)
- labels: метки исходя из типа и затронутой области
- priority: если очевидно из контекста запроса

НЕ создавай issue — только формализуй структуру.`,
  { label: 'draft', phase: 'Draft', schema: DRAFT_SCHEMA, agentType: consilium['technical-writer'] }
)

// ── Phase 2: Create — мутация трекера ────────────────────────────────────
phase('Create')

const issueBody = [
  draft.description,
  '',
  '## Acceptance Criteria',
  ...(draft.acceptanceCriteria || []).map((ac) => `- [ ] ${ac}`),
  '',
  `**Priority:** ${draft.priority || 'normal'}`,
  `**Type:** ${draft.type}`,
].join('\n')

let created

if (PLATFORM === 'github') {
  created = await agent(
    `Создай GitHub Issue в репозитории "${QUEUE || 'определи из git remote'}".
Используй gh CLI:
  gh issue create --repo "${QUEUE}" \\
    --title "${(draft.title || '').replace(/"/g, '\\"')}" \\
    --label "${(draft.labels || []).join(',')}" \\
    --body "<body>"

Тело issue:
${issueBody}

Если labels не существуют — создай через gh label create перед созданием issue.
Если QUEUE пустой — определи репозиторий через: gh repo view --json nameWithOwner -q .nameWithOwner
Верни issueUrl (полная ссылка https://github.com/...) и issueId (например #42).`,
    { label: 'create-github', phase: 'Create', schema: CREATE_SCHEMA, model: 'sonnet' }
  )
} else {
  created = await agent(
    `Создай задачу в Яндекс Трекере в очереди "${QUEUE}".
Используй MCP-инструменты yandex-tracker (issue_create).

Параметры задачи:
- queue: "${QUEUE}"
- summary (заголовок): "${(draft.title || '').replace(/"/g, '\\"')}"
- description: ${JSON.stringify(issueBody)}
- type: ${draft.type === 'bug' ? 'bug' : 'task'}
- priority: ${draft.priority || 'normal'}

Верни issueUrl (ссылка на задачу в трекере) и issueId (ключ задачи, например ${QUEUE}-42).`,
    { label: 'create-yandex', phase: 'Create', schema: CREATE_SCHEMA, model: 'sonnet' }
  )
}

// ── Phase 3: Report ───────────────────────────────────────────────────────
phase('Report')
const reportPath = `./swarm-report/${SLUG}-${DATE}-task.md`
await agent(
  `Напиши отчёт о созданной задаче в файл ${CWD}/${reportPath} (используй Write).
Заголовок: "# Task Created — ${DATE}".

Содержимое:
- Исходный запрос: "${REQUEST}"
- Платформа: ${PLATFORM}
- Задача: ${created && created.issueId} — ${draft && draft.title}
- Ссылка: ${created && created.issueUrl}
- Тип: ${draft && draft.type}
- Приоритет: ${draft && draft.priority || 'normal'}
- Labels: ${draft && (draft.labels || []).join(', ')}
- Описание: ${draft && draft.description}
- Acceptance Criteria:
${(draft && draft.acceptanceCriteria || []).map((ac) => `  - [ ] ${ac}`).join('\n')}

Код и worktree проекта НЕ трогались. Только задача в трекере.`,
  { label: 'report', phase: 'Report', model: 'haiku' }
)

return {
  status: 'created',
  platform: PLATFORM,
  issueUrl: created && created.issueUrl,
  issueId: created && created.issueId,
  title: draft && draft.title,
  report: reportPath,
}
