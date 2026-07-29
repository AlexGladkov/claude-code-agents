---
name: coordinator-yolo
description: Автономный ночной режим координатора — для когда юзер ушёл спать. Координатор сам решает задачи исходя из долгосрочных целей (vision), работает интервальным пульсом задача-за-задачей. ВСЕ изменения копятся ТОЛЬКО в изолированной yolo-ветке от main, никогда не трогает main, не пушит. Use when user is away/asleep and wants safe autonomous progress. Stop with coordinator-yolo-stop.
user_invocable: true
---

# coordinator-yolo

**Автономный ночной режим.** Юзер ушёл — координатор сам двигает проект исходя из долгосрочных целей, но в изолированной песочнице: все изменения только в yolo-ветке от main, ничего не ломается, никаких вопросов.

## Аргумент

`$ARGUMENTS` — интервал пульса (`10m`, `15m`, `30m`). Пусто → `10m`.

## Что сделать

1. Прочитать методологию агента `agents/control/coordinator-yolo.md`.

2. **Проверить предусловия** (иначе НЕ стартовать):
   - Есть `coordinator/<slug>/vision.md` (иначе → сначала `/coordinator` bootstrap).
   - `git status --short` пусто (чистое дерево).
   - Определяется build + test проекта.

3. **Отвести ветку от main:**
   ```bash
   SLUG=$(basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)")
   TS=$(date +%Y%m%d-%H%M)
   git checkout main && git checkout -b "yolo/$SLUG-$TS"
   ```

4. **Запустить интервальный цикл**, каждый тик делегирует один пульс агенту `coordinator-yolo`:
   ```
   /loop <interval> Task(subagent_type: "coordinator-yolo", prompt: "выполни один автономный yolo-тик в ветке yolo/<slug>-<ts>: выбери задачу по vision, исполни, валидируй, закоммить в yolo-ветку или откати")
   ```

5. Сообщить юзеру: режим запущен, имя ветки, интервал, как остановить (`/coordinator-yolo-stop`).

## РЕЛЬСЫ (жёстко)

- Только yolo-ветка от main. Никогда: main, merge, push, force, prod-deploy, деструктивный git.
- Каждая задача валидируется (build+test) перед коммитом. Сломал → откат задачи, лог, дальше.
- Никаких `AskUserQuestion` — юзер недоступен, решения автономны и логируются с «почему».
- Уважать антискоуп `vision.md`.
- Атомарные коммиты: один коммит = одна задача.

## Стоп

`/coordinator-yolo-stop` — гасит цикл и выдаёт отчёт `swarm-report/yolo-<slug>-<date>.md`.
