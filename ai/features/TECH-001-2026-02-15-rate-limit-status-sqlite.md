# Feature: TECH-001 Rate-limit-status из глобальной статистики SQLite

**Status:** READY | **Priority:** P1 | **Date:** 2026-02-15

## Goal
Сделать /rate-limit-status источником правды глобальную статистику OpenCode из SQLite, чтобы отчёт учитывал все запросы всех моделей и показывал ретраи/фолбэки/лимиты с прогнозом за последние 30 дней.

## Context
Сейчас отчёт /rate-limit-status строится на in-memory метриках плагина, поэтому при обычных запросах статистика пустая. Пользователь хочет, чтобы отчёт отражал полную картину по моделям, опираясь на общие данные OpenCode. Решение должно читать SQLite БД OpenCode, учитывать сообщения user и assistant, и вычислять ретраи/фолбэки по эвристике последовательностей сообщений. По умолчанию нужен горизонт 30 дней.

## Non-Goals
- Переписывать механизм fallback/retry в плагине
- Менять формат команд OpenCode
- Добавлять телеметрию вне локальной БД

## Scope

**In scope:**
- Чтение глобальной статистики из SQLite OpenCode
- Учет сообщений user и assistant в метриках моделей
- Эвристика ретраев и фолбэков на основе последовательностей сообщений
- Окно по умолчанию 30 дней
- Прогноз до следующей блокировки как среднее число запросов между rate limit событиями

**Out of scope:**
- Анализ данных старше 30 дней
- Полная реконструкция точных причин fallback вне доступных данных
- UI/TUI изменения за пределами отчёта

## Research

**Sources:**
- OpenCode CLI stats: https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/cli/cmd/stats.ts
- OpenCode DB path (CLI): команда opencode db path
- Локальная БД: ~/.local/share/opencode/opencode.db
- Логи OpenCode: ~/.local/share/opencode/log/*.log (для справки)
- Текущий отчёт: src/tui/StatusReporter.ts

**Key takeaways:**
- OpenCode хранит глобальную статистику в SQLite (opencode.db).
- Таблицы session/message/part используются для подсчёта сообщений и токенов.
- rate-limit-status сейчас читает только in-memory метрики плагина.
- Для ретраев/фолбэков нет явных полей, нужна эвристика по последовательностям сообщений.

## Allowed Files

1. ai/backlog.md
2. ai/features/TECH-001-2026-02-15-rate-limit-status-sqlite.md
3. src/tui/StatusReporter.ts
4. src/metrics/MetricsManager.ts
5. src/types/index.ts
6. src/config/defaults.ts
7. src/utils/opencodeDb.ts
8. README.md

## Detailed Implementation Plan

### Research Sources
- OpenCode stats CLI (source): https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/cli/cmd/stats.ts
- OpenCode DB path (CLI): opencode db path

### Task 1: Добавить модуль чтения SQLite
**Type:** code
**Files:**
    - create: src/utils/opencodeDb.ts
    - modify: src/types/index.ts
    - modify: src/config/defaults.ts
**Pattern:** прямое чтение SQLite, безопасная деградация при отсутствии БД
**Acceptance:** модуль возвращает агрегаты по моделям за окно 30 дней и умеет переопределять путь БД через конфиг

### Task 2: Переподключить StatusReporter к глобальной статистике
**Type:** code
**Files:**
    - modify: src/tui/StatusReporter.ts
**Pattern:** отчёт строится из глобальных агрегатов + текущих fallback метрик
**Acceptance:** /rate-limit-status показывает модели и запросы даже без fallback событий

### Task 3: Эвристика ретраев и фолбэков
**Type:** code
**Files:**
    - modify: src/utils/opencodeDb.ts
    - modify: src/tui/StatusReporter.ts
**Pattern:** ретрай = повторный запрос в той же сессии с тем же parentID; фолбэк = смена providerID/modelID в таких повторах
**Acceptance:** отчёт показывает ретраи и фолбэки по вычисленной эвристике

### Task 4: Документация
**Type:** docs
**Files:**
    - modify: README.md
**Pattern:** описание источника статистики и окна 30 дней
**Acceptance:** README описывает источник статистики и ограничения

### Execution Order
1 → 2 → 3 → 4

## Acceptance Criteria

- /rate-limit-status отображает модели и запросы на данных SQLite за последние 30 дней
- В отчёте учитываются сообщения user и assistant
- Ретраи и фолбэки вычисляются по согласованной эвристике
- Прогноз до следующей блокировки считается как среднее число запросов между rate limit событиями
- При отсутствии БД или ошибок чтения отчёт показывает понятное предупреждение и деградирует без крэша

## Execution Notes

- Окно по умолчанию 30 дней, но путь БД должен быть переопределяемым через конфиг.
- Формат отчёта сохранить совместимым с текущим markdown.
- Для подсчёта rate limit использовать ошибки, содержащие паттерны: rate limit, usage limit, high concurrency, quota exceeded, 429.
- Пример SQL агрегации (ориентир):
    SELECT providerID, modelID, COUNT(*)
    FROM message
    WHERE time.created >= :windowStart
    GROUP BY providerID, modelID

## Autopilot Log

## Drift Log

**Checked:** 2026-02-15 00:00 UTC
**Result:** no_drift

### Changes Detected

    | File | Change Type | Action Taken |
    |------|-------------|--------------|
    | — | — | — |

### References Updated

- —
