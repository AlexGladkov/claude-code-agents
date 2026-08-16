export const meta = {
  name: 'strat-session',
  description: 'Стратсессия консилиумом: год → кварталы → спринты → задачи. Производит ДРАФТ-план без мутации трекера',
  whenToUse: 'Стратсессия, спланировать год, годовой план, quarterly planning. Запускается скиллом /stratsession. Выдаёт драфт; запись в трекер — отдельным подтверждённым шагом.',
  phases: [
    { title: 'Resolve', detail: 'Резолв роль→агент из проектного CLAUDE.md ## Agents (с дефолтами)' },
    { title: 'Context', detail: 'Read-only: vision-память, CLAUDE.md, свежие swarm-report, git-история' },
    { title: 'Year', detail: 'Консилиум parallel 5 бизнес-агентов → синтез product-manager: годовая тема + столпы' },
    { title: 'Quarters', detail: 'Консилиум delivery → поквартальная декомпозиция Q1..Q4 (без интерактива)' },
    { title: 'Sprints', detail: 'Декомпозиция кварталов на спринты (2 нед, S1..S6)' },
    { title: 'Tasks', detail: 'Декомпозиция спринтов на задачи: title/DoD/оценка/приоритет/зависимости' },
    { title: 'Report', detail: 'Полный драфт-план в swarm-report/stratsession-<slug>-<date>.md. Трекер НЕ трогаем' },
  ],
}

// ── args (передаёт skill /stratsession) ───────────────────────────────────
//   request   : бриф года от юзера (тема, приоритеты, оверрайды)
//   cwd       : абсолютный путь корня проекта
//   date      : YYYY-MM-DD (скрипт не имеет доступа к Date.now)
//   slug      : basename репо/cwd
//   yearStart : дата старта года YYYY-MM-DD (скрипт не вычисляет даты сам)
//   horizon   : горизонт планирования (напр. "4 квартала")
//   platform  : целевой трекер 'github' | 'yandex-tracker' (только для драфта; запись — вне workflow)
const A = (typeof args === 'string') ? (JSON.parse(args) || {}) : (args || {})
const REQUEST = (A && A.request) || ''
const CWD = (A && A.cwd) || '.'
const DATE = (A && A.date) || 'unknown-date'
const SLUG = (A && A.slug) || 'project'
const YEAR_START = (A && A.yearStart) || DATE
const HORIZON = (A && A.horizon) || '4 квартала'
const PLATFORM = (A && A.platform) || 'github'

// Дефолтная карта роль→агент (из глобального CLAUDE.md). Resolve её переопределяет,
// если в проектном CLAUDE.md есть секция ## Agents.
const DEFAULT_CONSILIUM = {
  'product-manager': 'voltagent-biz:product-manager',
  'business-analyst': 'voltagent-biz:business-analyst',
  'market-researcher': 'voltagent-research:market-researcher',
  'competitive-analyst': 'voltagent-research:competitive-analyst',
  'technical-writer': 'voltagent-biz:technical-writer',
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
      required: ['product-manager', 'business-analyst', 'market-researcher', 'competitive-analyst', 'technical-writer', 'architect'],
      properties: {
        'product-manager': { type: 'string' },
        'business-analyst': { type: 'string' },
        'market-researcher': { type: 'string' },
        'competitive-analyst': { type: 'string' },
        'technical-writer': { type: 'string' },
        architect: { type: 'string' },
      },
    },
  },
}

const CONTEXT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'visionPoints', 'openThreads'],
  properties: {
    summary: { type: 'string', description: 'Куда движется проект, генеральная линия' },
    visionPoints: { type: 'array', items: { type: 'string' }, description: 'Ключевые тезисы из vision-памяти / CLAUDE.md' },
    openThreads: { type: 'array', items: { type: 'string' }, description: 'Недоделки, открытые задачи, свежие swarm-report' },
  },
}

const LENS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['role', 'priorities', 'risks', 'proposeForYear'],
  properties: {
    role: { type: 'string' },
    priorities: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    proposeForYear: { type: 'array', items: { type: 'string' } },
  },
}

const YEAR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['theme', 'pillars', 'keyRisks'],
  properties: {
    theme: { type: 'string', description: 'Одна годовая тема' },
    pillars: {
      type: 'array',
      description: '3-5 стратегических столпов (крупных направлений)',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'value'],
        properties: {
          name: { type: 'string' },
          value: { type: 'string', description: 'Ценность/результат для пользователя' },
        },
      },
    },
    keyRisks: { type: 'array', items: { type: 'string' } },
  },
}

const QUARTERS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['quarters'],
  properties: {
    quarters: {
      type: 'array',
      description: 'Ровно 4 квартала Q1..Q4 сразу (без интерактива)',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'theme', 'outcomes', 'epics', 'dependencies'],
        properties: {
          id: { type: 'string', description: 'Q1 / Q2 / Q3 / Q4' },
          theme: { type: 'string' },
          outcomes: { type: 'array', items: { type: 'string' }, description: 'Что юзер сможет ДЕЛАТЬ в конце квартала (OKR-стиль)' },
          epics: { type: 'array', items: { type: 'string' } },
          dependencies: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
}

const SPRINTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sprints'],
  properties: {
    sprints: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'quarter', 'goal', 'epicSlices'],
        properties: {
          id: { type: 'string', description: 'S1..S6' },
          quarter: { type: 'string', description: 'Q1..Q4' },
          goal: { type: 'string', description: 'Цель спринта продуктовым языком' },
          epicSlices: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
}

const TASKS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tasks'],
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'quarter', 'sprint', 'epic', 'area', 'priority', 'estimate', 'dod', 'dependencies'],
        properties: {
          title: { type: 'string', description: 'Глаголом: «Добавить X»' },
          quarter: { type: 'string' },
          sprint: { type: 'string', description: 'S1..S6' },
          epic: { type: 'string' },
          area: { type: 'string', description: 'backend/desktop/mobile/ios/web/infra' },
          priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
          estimate: { type: 'string', description: 'S/M/L или story points' },
          dod: { type: 'array', items: { type: 'string' }, description: 'Критерии готовности' },
          dependencies: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
}

// ── Phase 0: Resolve ──────────────────────────────────────────────────────
phase('Resolve')
const resolved = await agent(
  `Ты резолвер агентов для оркестрации стратсессии в проекте по пути ${CWD}.
Прочитай ${CWD}/CLAUDE.md, секцию "## Agents" (Консилиум), если она есть.
Верни карту роль→конкретный агент для консилиума стратсессии
(product-manager, business-analyst, market-researcher, competitive-analyst, technical-writer, architect).
Если секции ## Agents нет или роль не указана — используй дефолты:
консилиум = ${JSON.stringify(DEFAULT_CONSILIUM)}
Имена агентов бери РОВНО как в проектном CLAUDE.md либо как в дефолтах — не выдумывай.`,
  { label: 'resolve-agents', phase: 'Resolve', schema: RESOLVE_SCHEMA, model: 'haiku' }
)

const consilium = (resolved && resolved.consilium) || DEFAULT_CONSILIUM

// ── Phase 1: Context (read-only, Explore) ─────────────────────────────────
phase('Context')
const context = await agent(
  `Проект: ${CWD}. Собери контекст горизонта для стратегической сессии — БЕЗ вопросов, read-only.
Прочитай: vision-память проекта (~/.claude/projects/-Users-neuradev/memory/… — vision.md, product-vision и т.п.),
${CWD}/CLAUDE.md, README*, backlog координатора (coordinator/${SLUG}/backlog.md, vision.md) если есть,
свежие ${CWD}/swarm-report/*.md, недавнюю git-историю (git log).
Верни: куда движется проект (генеральная линия), ключевые тезисы vision, открытые недоделки/треды.
НИЧЕГО не меняй.`,
  { label: 'context', phase: 'Context', schema: CONTEXT_SCHEMA, agentType: 'Explore' }
)

// ── Phase 2: Year — консилиум parallel → синтез product-manager ────────────
phase('Year')
const yearLenses = [
  { role: 'product-manager', agent: consilium['product-manager'], focus: 'продуктовая стратегия, годовая тема, стратегические столпы, PMF' },
  { role: 'business-analyst', agent: consilium['business-analyst'], focus: 'ROI, юнит-экономика, бизнес-ценность направлений, ранжирование' },
  { role: 'market-researcher', agent: consilium['market-researcher'], focus: 'рынок, тренды, окна возможностей, тайминг' },
  { role: 'competitive-analyst', agent: consilium['competitive-analyst'], focus: 'конкуренты, позиционирование, дифференциация' },
  { role: 'architect', agent: consilium.architect, focus: 'техническая выполнимость столпов, фундамент, тех-риски года' },
]
const yearFindings = (await parallel(yearLenses.map((l) => () =>
  agent(
    `Проект: ${CWD}. Бриф года от юзера: "${REQUEST}".
Старт года: ${YEAR_START}. Горизонт: ${HORIZON}.
Контекст горизонта: ${JSON.stringify(context)}.
Твоя линза — ${l.role}: ${l.focus}.
Дай приоритеты своей линзы на год + риски + что заложить в год.
Формулируй продуктовым языком (результат/ценность для пользователя), тех-детали — отдельным блоком.`,
    { label: `year:${l.role}`, phase: 'Year', schema: LENS_SCHEMA, agentType: l.agent }
  )
))).filter(Boolean)

const year = await agent(
  `Ты product-manager, синтезируешь годовой план из перспектив консилиума.
Бриф года: "${REQUEST}". Старт: ${YEAR_START}. Горизонт: ${HORIZON}.
Контекст: ${JSON.stringify(context)}.
Находки консилиума (5 линз): ${JSON.stringify(yearFindings)}.
Синтезируй ОДНУ годовую тему + 3-5 стратегических столпов (крупных направлений), каждый — с ценностью
для пользователя. Отметь ключевые риски по линзам и конфликты между ними.
Формулируй продуктовым языком: «что юзер получит и сможет ДЕЛАТЬ».`,
  { label: 'year-synth', phase: 'Year', schema: YEAR_SCHEMA, agentType: consilium['product-manager'] }
)

// ── Phase 3: Quarters — консилиум delivery → Q1..Q4 сразу ──────────────────
phase('Quarters')
const quarterLenses = [
  { role: 'business-analyst', agent: consilium['business-analyst'], focus: 'ценность/ROI, приоритизация, порядок эпиков' },
  { role: 'architect', agent: consilium.architect, focus: 'выполнимость, объём, тех-риски, порядок фундамента' },
  { role: 'technical-writer', agent: consilium['technical-writer'], focus: 'формулировки целей квартала, что документировать/донести' },
]
const quarterInputs = (await parallel(quarterLenses.map((l) => () =>
  agent(
    `Проект: ${CWD}. Годовой план: ${JSON.stringify(year)}. Старт года: ${YEAR_START}. Горизонт: ${HORIZON}.
Твоя линза — ${l.role}: ${l.focus}.
Дай входы для поквартальной декомпозиции столпов года: что в какой квартал, порядок, зависимости, риски.`,
    { label: `quarters:${l.role}`, phase: 'Quarters', schema: LENS_SCHEMA, agentType: l.agent }
  )
))).filter(Boolean)

const quarters = await agent(
  `Ты декомпозируешь годовой план на 4 квартала СРАЗУ (без интерактива, всё за один проход).
Годовой план: ${JSON.stringify(year)}. Старт года: ${YEAR_START}.
Входы консилиума delivery: ${JSON.stringify(quarterInputs)}.
Для каждого квартала Q1..Q4: тема, outcomes (что юзер сможет ДЕЛАТЬ в конце квартала, OKR-стиль),
эпики, зависимости. Реализм: не пихать больше, чем влезает; помечать порядок и зависимости.
Продуктовый язык на outcomes.`,
  { label: 'quarters-decompose', phase: 'Quarters', schema: QUARTERS_SCHEMA, agentType: consilium['business-analyst'] }
)

// ── Phase 4: Sprints — декомпозиция кварталов на спринты ───────────────────
phase('Sprints')
const sprints = await agent(
  `Ты декомпозируешь кварталы на спринты (дефолт 2 недели, S1..S6 на квартал).
Кварталы: ${JSON.stringify(quarters)}. Старт года: ${YEAR_START}.
Для каждого спринта: id (S1..S6), квартал, цель спринта (продуктовым языком), срезы эпиков с учётом ёмкости.
Реализм: ёмкость спринта ограничена, порядок и зависимости учитывать. Всё сразу, без интерактива.`,
  { label: 'sprints-decompose', phase: 'Sprints', schema: SPRINTS_SCHEMA, agentType: consilium['business-analyst'] }
)

// ── Phase 5: Tasks — декомпозиция спринтов на задачи ───────────────────────
phase('Tasks')
const tasks = await agent(
  `Ты декомпозируешь спринты на конкретные задачи для трекера (${PLATFORM}).
Кварталы: ${JSON.stringify(quarters)}. Спринты: ${JSON.stringify(sprints)}.
Для каждой задачи: title глаголом («Добавить X»), quarter (Q1..Q4), sprint (S1..S6), epic, area
(backend/desktop/mobile/ios/web/infra), priority (P0-P3), estimate (S/M/L или SP), DoD (критерии готовности),
зависимости. Реализм: оценка обязательна, не раздувать спринт. Всё сразу, без интерактива.`,
  { label: 'tasks-decompose', phase: 'Tasks', schema: TASKS_SCHEMA, agentType: consilium['technical-writer'] }
)

// ── Phase 6: Report — полный драфт-план. Трекер НЕ трогаем ─────────────────
phase('Report')
const draftPath = `./swarm-report/stratsession-${SLUG}-${DATE}.md`
await agent(
  `Напиши ПОЛНЫЙ драфт-план стратсессии в файл ${CWD}/${draftPath} (используй Write).
Заголовок "# Стратсессия ${SLUG} — драфт-план (${DATE})".
Старт года: ${YEAR_START}. Горизонт: ${HORIZON}. Целевой трекер (для будущей записи): ${PLATFORM}.
Данные:
- Контекст: ${JSON.stringify(context)}
- Годовая тема + столпы + риски: ${JSON.stringify(year)}
- Кварталы Q1..Q4 (тема/outcomes/эпики/зависимости): ${JSON.stringify(quarters)}
- Спринты (S1..S6, цели, срезы): ${JSON.stringify(sprints)}
- Задачи (title/DoD/оценка/приоритет/область/зависимости): ${JSON.stringify(tasks)}

Структура файла: (1) Годовая тема и столпы; (2) Кварталы — по каждому тема, «В конце квартала ты
сможешь: … / Демо-момент: … / Чего ещё НЕ будет: …», эпики, зависимости; (3) Спринты по кварталам;
(4) Дерево задач по спринтам (таблица: title · область · приоритет · оценка · DoD · зависимости);
(5) раздел «Следующий шаг» — что запись в трекер (${PLATFORM}) выполняется отдельным подтверждённым
шагом после ревью этого драфта.
ВАЖНО: НЕ создавай никаких milestone/labels/issues/версий/эпиков в трекере — только пиши файл.`,
  { label: 'report-draft', phase: 'Report', model: 'sonnet' }
)

return {
  status: 'planned',
  platform: PLATFORM,
  draftPath,
  plan: { year, quarters, sprints, tasks },
}
