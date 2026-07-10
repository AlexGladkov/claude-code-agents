---
name: coordinator-yolo-stop
description: Остановить автономный ночной режим координатора (coordinator-yolo) и выдать отчёт о проделанном. Use when user wakes up / wants to stop YOLO mode and see what was done overnight.
user_invocable: true
---

# coordinator-yolo-stop

Остановить YOLO-цикл координатора и выдать **отчёт о проделанном за ночь**.

## Что сделать

1. **Остановить цикл** `coordinator-yolo` (`/loop`): прекратить запланированные тики, не планировать следующий.

2. **Собрать отчёт** `./swarm-report/yolo-<slug>-<YYYY-MM-DD>.md` из `coordinator/<slug>/yolo-log.md` + git:
   - Ветка, окно работы, число тиков.
   - **Сделано**: коммиты (hash · задача · цель).
   - **Откаты**: что не взлетело и почему.
   - Сводка: `git diff --stat main...<yolo-branch>`.
   - **Рекомендации на утро**: что ревьюить первым, что мержить, что выкинуть.

3. **Оставить yolo-ветку как есть** — не мержить, не пушить, не удалять. Юзер решает сам.

4. Показать юзеру краткое резюме + путь к отчёту + имя ветки для ревью:
   ```bash
   git diff --stat main...<yolo-branch>
   git log --oneline main..<yolo-branch>
   ```

## Инвариант

Только гасит цикл и отчитывается. Не мержит, не пушит, не трогает main. Память и ветка сохранены.
