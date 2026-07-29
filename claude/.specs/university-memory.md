# Спецификация: university-memory

## Суть

Система «University Memory» — source-of-truth YAML-файл с 4-уровневой структурой университета (Университет → Факультет → Кафедра → Дисциплина), Bash-генератор для раскладки под популярные AI harness, и ректор-агент — полный оркестратор верхнего уровня.

## Компоненты

| Компонент | Файл | Назначение |
|-----------|------|-----------|
| Source-of-truth | `config/university.yaml` | Единственный источник истины о структуре университета |
| Генератор | `scripts/generate-harness.sh` | Bash-скрипт, генерирует файлы для каждого harness |
| Ректор-агент | `agents/education/rector.md` | Оркестратор верхнего уровня, читает YAML |

## Ключевые решения

### Иерархия — 4 уровня

```
Университет (university)
  └── Факультет (faculty)
        └── Кафедра (department)
              └── Дисциплина (discipline)
```

- Дисциплина ссылается на файл агента (`agent-file`)
- Агенты создаются вручную, YAML их только подхватывает
- Структура расширяемая — много факультетов и кафедр в будущем

### Только education

YAML описывает только образовательных агентов. Coding-агенты (`agents/coding/`) — отдельная история, не входят в структуру университета.

### Формат source-of-truth: YAML

Файл `config/university.yaml`. Структурированный, легко парсить Bash-скриптом (yq).

### Метаданные дисциплины

Каждая дисциплина содержит:
- `name` — slug дисциплины (совпадает с name в YAML-фронтматтере агента)
- `title` — человекочитаемое название
- `description` — краткое описание
- `agent-file` — путь к файлу агента относительно корня
- `hours` — рекомендуемый объём в академических часах
- `competencies` — список компетенций, которые даёт дисциплина

### Генератор: Bash

Скрипт `scripts/generate-harness.sh`:
- Читает `config/university.yaml` через `yq`
- Генерирует файлы под каждый harness
- Содержимое = структура университета + пути к агентам (не инлайн агентов)

### Целевые harness

| Harness | Генерируемый файл |
|---------|-------------------|
| Claude Code | `CLAUDE.md` (секция university) |
| Cursor | `.cursorrules` |
| GitHub Copilot | `.github/copilot-instructions.md` |
| Windsurf | `.windsurfrules` |
| Codex / OpenCode | `AGENTS.md` |

### Сгенерированные файлы — в .gitignore

Генерированные файлы НЕ коммитятся. Пользователь клонирует репо, запускает `scripts/generate-harness.sh`, файлы появляются локально.

Добавить в `.gitignore`:
```
# Generated harness files
CLAUDE.md
.cursorrules
.github/copilot-instructions.md
.windsurfrules
AGENTS.md
```

**Исключение:** Если CLAUDE.md уже существует в корне (текущий проектный CLAUDE.md) — генератор должен ДОПОЛНЯТЬ его секцией, а не перезаписывать. Или использовать отдельный файл (решение ниже).

**Решение:** Генератор создаёт файлы в папку `generated/` и выводит инструкцию как подключить. Для Claude Code — это `CLAUDE.md` в корне (merge). Для остальных — копия в нужное место.

Итоговая структура:
```
generated/
  claude-university.md
  cursorrules-university
  copilot-university.md
  windsurf-university
  agents-university.md
```

Скрипт с флагом `--install` копирует в нужные места (с подтверждением перезаписи).

### Ректор-агент

**Роль:** Полный оркестратор верхнего уровня.

**Возможности:**
1. **Чтение структуры** — парсит `config/university.yaml`, знает все факультеты/кафедры/дисциплины
2. **Формирование учебных планов** — на основе запроса студента и структуры университета
3. **Межфакультетские программы** — может формировать программы на стыке факультетов (биоинформатика = IT + биология)
4. **Оркестрация department-head** — запускает зав-кафедрами через Task tool для реализации планов
5. **Отчётность** — агрегирует прогресс со всех кафедр
6. **Управление бюджетом часов** — контролирует общий объём и распределение по дисциплинам

**Прогресс — разделённый:**
- `department-head` владеет прогрессом своей кафедры (`~/.claude/education/departments/<dept>/progress.md`)
- Ректор агрегирует прогресс всех кафедр, формирует общую картину
- Ректор НЕ редактирует файлы прогресса кафедр напрямую

**Взаимодействие с department-head:**
- Ректор формирует учебный план → передаёт department-head
- department-head принимает внешний план (уже заложено в спеке) и выполняет
- department-head отчитывается ректору о прогрессе

**Метаданные агента:**

```yaml
name: rector
description: Ректор университета. Полный оркестратор — формирует учебные планы, управляет кафедрами, создаёт межфакультетские программы, отслеживает прогресс, контролирует бюджет часов.
model: opus
color: purple
```

---

## Структура config/university.yaml

```yaml
university:
  name: "AI University"
  description: "Университет с AI-преподавателями"

  faculties:
    - id: medicine
      title: "Медицинский факультет"
      description: "Фундаментальная и клиническая медицина"

      departments:
        - id: biology
          title: "Кафедра биологии"
          description: "Биологические науки для медиков"
          head: department-head
          head-file: agents/education/biology/department-head.md

          disciplines:
            - name: anatomy-teacher
              title: "Анатомия человека"
              description: "Системная, клиническая и топографическая анатомия"
              agent-file: agents/education/biology/anatomy-teacher.md
              hours: 120
              competencies:
                - "Знание анатомической терминологии (рус + лат)"
                - "Описание строения органов и систем"
                - "Топографические отношения структур"
                - "Клинические корреляции"

            - name: physiology-teacher
              title: "Физиология человека"
              description: "Нормальная физиология всех систем организма"
              agent-file: agents/education/biology/physiology-teacher.md
              hours: 140
              competencies:
                - "Понимание механизмов регуляции"
                - "Интерпретация физиологических показателей"
                - "Объяснение патофизиологических процессов"

            - name: neurobiology-teacher
              title: "Нейробиология"
              description: "Клеточная и системная нейробиология"
              agent-file: agents/education/biology/neurobiology-teacher.md
              hours: 100
              competencies:
                - "Понимание нейронных механизмов"
                - "Синаптическая передача и пластичность"
                - "Сенсорные и моторные системы"
                - "Нейрофармакология"

    # Пример расширения:
    # - id: computer-science
    #   title: "Факультет информатики"
    #   departments:
    #     - id: programming
    #       title: "Кафедра программирования"
    #       disciplines:
    #         - name: kotlin-teacher
    #           title: "Kotlin"
    #           agent-file: agents/education/cs/kotlin-teacher.md
    #           hours: 80
    #           competencies:
    #             - "Базовый синтаксис Kotlin"
    #             - "Корутины и асинхронность"

  # Межфакультетские программы
  cross-faculty-programs:
    # Пример:
    # - id: bioinformatics
    #   title: "Биоинформатика"
    #   description: "Междисциплинарная программа на стыке IT и биологии"
    #   faculties: [medicine, computer-science]
    #   disciplines:
    #     - neurobiology-teacher
    #     - kotlin-teacher
    #   hours: 200
```

---

## Генератор: scripts/generate-harness.sh

### Зависимости
- `yq` (https://github.com/mikefarah/yq) — YAML-процессор
- `bash` 4+

### Использование

```bash
# Генерация всех файлов в generated/
./scripts/generate-harness.sh

# Генерация + установка в нужные места
./scripts/generate-harness.sh --install

# Генерация только для конкретного harness
./scripts/generate-harness.sh --only claude
./scripts/generate-harness.sh --only cursor
```

### Логика генерации

1. Прочитать `config/university.yaml`
2. Для каждого harness сгенерировать файл с содержимым:
   - Заголовок / преамбула
   - Структура университета (дерево)
   - Для каждой дисциплины: название, описание, путь к агенту, часы, компетенции
   - Межфакультетские программы (если есть)
   - Инструкция для AI: «при запросе на обучение — найди нужную дисциплину, прочитай файл агента, запусти как субагента»

3. Сохранить в `generated/`
4. При `--install`: скопировать в нужные места с подтверждением

### Формат выходных файлов

Все файлы генерируются в Markdown. Содержимое адаптируется под конвенции каждого harness, но смысл один:

```markdown
# University Structure

This repository contains AI teaching agents organized as a university.

## Faculties

### Медицинский факультет (medicine)
Фундаментальная и клиническая медицина

#### Кафедра биологии (biology)
Зав. кафедрой: `agents/education/biology/department-head.md`

| Дисциплина | Агент | Часы | Компетенции |
|-----------|-------|------|-------------|
| Анатомия человека | `agents/education/biology/anatomy-teacher.md` | 120 | Терминология, строение, топография, клиника |
| Физиология человека | `agents/education/biology/physiology-teacher.md` | 140 | Регуляция, показатели, патофизиология |
| Нейробиология | `agents/education/biology/neurobiology-teacher.md` | 100 | Нейроны, синапсы, сенсорика, нейрофарма |

## How to use

To start learning, read the relevant agent file and invoke it as a subagent.
For orchestrated learning, use the rector agent: `agents/education/rector.md`
```

---

## Ректор-агент: agents/education/rector.md

### Дискавери

При каждой сессии:
1. Прочитать `config/university.yaml` — получить полную структуру
2. Для каждого department-head: проверить существование файла
3. Для каждой дисциплины: проверить существование agent-file
4. Сформировать реестр доступных факультетов/кафедр/дисциплин
5. Если файл не найден — пометить как unavailable, не крашиться

### Прогресс — разделённый

```
~/.claude/education/
  rector-overview.md          # Агрегированный прогресс, формируется ректором
  departments/
    biology/
      progress.md             # Прогресс по кафедре биологии, владеет department-head
    programming/
      progress.md             # Прогресс по кафедре программирования
    ...
```

Ректор ЧИТАЕТ файлы кафедр, но НЕ редактирует их. Пишет только `rector-overview.md`.

### Режимы работы

| Запрос | Режим |
|--------|-------|
| «Хочу учиться», тема/область | **Маршрутизация** — найти нужную кафедру, запустить department-head |
| «Составь программу по X» | **Планирование** — межфакультетская или однофакультетская программа |
| «Покажи прогресс» | **Отчётность** — агрегация по всем кафедрам |
| «Проверь знания» | **Межфакультетская проверка** — кейс на стыке факультетов |
| «Что доступно?» | **Каталог** — показать структуру университета |

### Формирование учебных планов

1. Прочитать YAML-структуру
2. Определить нужные дисциплины по запросу
3. Учесть компетенции и часы из YAML
4. Если план межфакультетский — использовать cross-faculty-programs или сформировать ad-hoc
5. Передать план соответствующим department-head через Task tool
6. department-head принимает внешний план (уже заложено в спеке)

### Бюджет часов

Ректор контролирует:
- Общий объём часов по программе
- Распределение между дисциплинами (из YAML `hours`)
- Прогресс: сколько часов «потрачено» vs план
- Рекомендации по корректировке темпа

### Межфакультетские программы

Формируются из:
1. Явно описанных в `cross-faculty-programs` (YAML)
2. Ad-hoc по запросу студента — ректор комбинирует дисциплины из разных факультетов

Для ad-hoc программ:
- Ректор определяет какие дисциплины нужны
- Проверяет пререквизиты между ними (через файлы агентов)
- Формирует единый план с правильным порядком
- Запускает department-head каждой затронутой кафедры

### Взаимодействие ректор → department-head

```
Task tool:
  subagent_type: department-head
  model: opus
  prompt: |
    Прими учебный план от ректора и выполни его.

    Учебный план:
    <план в стандартном формате>

    Студент:
    - Текущий прогресс: <из rector-overview.md>

    Требования:
    - Проведи обучение по плану
    - После завершения обнови свой progress.md
    - Верни: краткий отчёт о результатах
```

### Отчётность

Файл `~/.claude/education/rector-overview.md`:

```markdown
# Обзор прогресса — Ректор

## Дата обновления: YYYY-MM-DD

## Общая статистика
- Активных программ: N
- Факультетов задействовано: M
- Общий прогресс: X%

## По факультетам

### Медицинский факультет
#### Кафедра биологии
- Прогресс: 45%
- Пройдено дисциплин: 1/3
- Часов потрачено: ~30 из 360
- Последняя активность: YYYY-MM-DD

## Активные программы

### Программа: Основы медицины
- Тип: однофакультетская
- Факультет: Медицинский
- Прогресс: 45%
- Дисциплины: анатомия (80%), физиология (30%), нейро (0%)

## Рекомендации
- ...
```

---

## Обновление существующих компонентов

### department-head — изменения

Файл прогресса переносится:
- **Было:** `~/.claude/education/progress.md`
- **Стало:** `~/.claude/education/departments/<dept-id>/progress.md`

department-head должен:
1. Определить свой `dept-id` (из YAML или из своего расположения в файловой системе)
2. Читать/писать прогресс по новому пути
3. Уметь принимать внешний учебный план от ректора (уже заложено в спеке)

### .gitignore — дополнить

```
# Generated harness files
generated/
.cursorrules
.windsurfrules
.github/copilot-instructions.md
AGENTS.md
```

### README.md — обновить

Добавить секцию про University Structure, генератор, ректора.

---

## Файловая структура после реализации

```
config/
  university.yaml              # Source-of-truth

scripts/
  generate-harness.sh          # Bash-генератор

generated/                     # .gitignore'd
  claude-university.md
  cursorrules-university
  copilot-university.md
  windsurf-university
  agents-university.md

agents/
  education/
    rector.md                  # НОВЫЙ — ректор
    biology/
      department-head.md       # Обновлённый — новый путь прогресса
      anatomy-teacher.md
      physiology-teacher.md
      neurobiology-teacher.md
  coding/
    kotlin/
      ...                      # Без изменений
```

---

## Требования к расширяемости

1. Добавление факультета = добавление блока в YAML + папки с агентами
2. Добавление кафедры = добавление блока в YAML + department-head + агенты
3. Добавление дисциплины = добавление записи в YAML + файл агента
4. Генератор автоматически подхватывает все изменения из YAML
5. Ректор автоматически обнаруживает новые структуры при старте сессии
6. department-head не требует изменений при добавлении новых преподавателей (уже есть дискавери)
