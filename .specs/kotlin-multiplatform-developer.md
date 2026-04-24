# Спецификация: kotlin-multiplatform-developer

## Назначение

Агент создаёт **полный KMP feature slice** — от domain-модели до UI — со строгой feature-sliced архитектурой и правилами source sets.

Создаёт все слои:
- `domain/` — модели, UseCase, Repository
- `data/` — LocalDataSource, RemoteDataSource
- `presentation/` — Decompose Component, ViewState, Events
- `di/` — DI-модуль фичи

---

## Стек (фиксирован)

| Слой         | Технология                            |
|--------------|---------------------------------------|
| UI           | Compose Multiplatform                 |
| Навигация    | Decompose                             |
| HTTP         | Ktor Client                           |
| БД           | SQLDelight                            |
| DI           | Kodein / Koin (спрашивает у юзера)    |
| Сериализация | Kotlinx Serialization                 |

---

## Платформы (все обязательны)

- `androidMain` — Android
- `iosMain` (iosX64, iosArm64, iosSimulatorArm64) — iOS/Swift
- `desktopMain` (jvm) — Desktop
- `webMain` (wasmJs) — Web

---

## Структура папок

```
shared/
  commonMain/
    feature/
      <featureName>/
        domain/
          model/
          usecase/
          repository/
        data/
          datasource/
        presentation/
          component/
          viewstate/
        di/
    core/
      network/
      database/
      navigation/
      di/
      ui/
      util/
  androidMain/
    core/network/
    core/database/
  iosMain/
    core/network/
    core/database/
  desktopMain/
    core/network/
    core/database/
  webMain/
    core/network/
    core/database/
```

---

## Hard Invariants

1. Нет платформенного кода в commonMain (`android.*`, `Foundation`, `UIKit` — запрещено)
2. expect/actual — только в `core/`, никогда в `feature/`
3. Слои: domain не знает data/presentation, data не знает domain/presentation
4. Нет горизонтальных зависимостей между фичами
5. UseCase.execute() → Result<T> всегда
6. Repository — конкретный класс, никаких interfaces
7. Repository не зависит от Repository, DataSource не зависит от DataSource
8. Component — единственный источник стейта (нет remember в View)
9. Один класс — один файл

---

## DI

- Агент спрашивает у пользователя: Kodein / Koin / свой вариант
- Один di-файл на фичу: `feature/<name>/di/<FeatureName>Module.kt`

---

## Naming

| Артефакт          | Паттерн                          |
|-------------------|----------------------------------|
| UseCase           | `<Feature><Action>UseCase.kt`    |
| Repository        | `<Feature>Repository.kt`         |
| LocalDataSource   | `<Feature>LocalDataSource.kt`    |
| RemoteDataSource  | `<Feature>RemoteDataSource.kt`   |
| Component         | `<Feature>Component.kt`          |
| ViewState         | `<Feature>ViewState.kt`          |
| Events            | `<Feature>ViewEvent.kt`          |
| DI module         | `val <featureName>Module = module {}` |

---

## Architecture Validation чеклист

1. Нет `android.*`, `Foundation`, `UIKit` в commonMain
2. Все UseCase.execute() → Result<T>
3. Нет import из другой feature/ директории
4. expect/actual только в core/
5. View не вызывает UseCase/Repository напрямую
6. Repository не зависит от Repository
7. DataSource не зависит от DataSource
8. Один класс — один файл
