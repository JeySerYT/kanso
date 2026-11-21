# Kanso — спецификация v0.1

Локальная канбан-доска и координация сессий OpenCode через задачи. Статус: `alpha`.

## 1. Цель

Один бэклог на все проекты, где каждая задача может быть захвачена сессией OpenCode на время работы. Сессии видят, кто чем занят, не берут одно и то же и умеют договариваться при пересечении файлов.

## 2. Границы

Входит:

- хранилище задач на SQLite;
- веб-доска с колонками и drag&drop;
- MCP-инструменты для агента;
- аренда задачи, бронь файлов, зависимости;
- переговоры между сессиями с лимитом и эскалацией;
- автозапуск доски вместе с OpenCode.

Не входит: команды и роли, циклы, roadmap, оценки, учёт времени, мобильное приложение, облачная синхронизация.

## 3. Модель данных

```text
tasks
  id            TEXT PK      ANI-15 (префикс проекта + счётчик)
  title         TEXT
  body          TEXT
  project       TEXT          AniVella
  status        TEXT          backlog | todo | in_progress | review | done | canceled
  priority      INTEGER      0..3, 0 — самый высокий
  labels        TEXT         JSON-массив
  blocked_by    TEXT         JSON-массив id
  created_at    TEXT         ISO 8601 UTC
  updated_at    TEXT
  closed_at     TEXT

claims
  task_id       TEXT PK
  session_id    TEXT
  cwd           TEXT
  touched_paths TEXT         JSON-массив
  claimed_at    TEXT
  lease_until   TEXT
  heartbeat_at  TEXT

comments
  id            INTEGER PK
  task_id       TEXT
  session_id    TEXT
  kind          TEXT         note | handoff | decision
  body          TEXT
  created_at    TEXT

threads
  id            TEXT PK
  task_a        TEXT
  task_b        TEXT
  path          TEXT
  state         TEXT         asked | agreed | needs_decision | closed
  created_at    TEXT

messages
  id            INTEGER PK
  thread_id     TEXT
  from_session  TEXT
  proposal      TEXT         take-now | wait | split | escalate
  body          TEXT
  created_at    TEXT

sessions
  id            TEXT PK
  cwd           TEXT
  agent         TEXT
  started_at    TEXT
  last_seen_at  TEXT
```

Инварианты:

- у задачи не больше одного активного захвата;
- захват невозможен, если `lease_until` в прошлом и не продлён — аренда переходит новому владельцу;
- задача с незакрытыми `blocked_by` не захватывается;
- в треде не больше двух сообщений от каждой стороны.

## 4. Протокол координации

1. `claim(task)` — атомарный захват. Если файлы пересекаются с активным захватом другой сессии, возвращается конфликт.
2. `touch(task, paths)` — объявление файлов. Точное совпадение пути — отказ. Пересечение по каталогу — тред переговоров.
3. Переговоры: обеим сессиям уходит по одному сообщению через `session.prompt`. Ответ — `take-now`, `wait`, `split`, `escalate`.
   - один `wait` → второй получает бронь;
   - оба `split` → брони по непересекающимся путям;
   - оба `take-now` или `escalate` → `needs_decision`, вопрос человеку.
4. `release(task, note)` — снять захват, оставить комментарий с состоянием: ветка, что сделано, следующий шаг.
5. `done(task, note)` — закрыть, разблокировать зависимые.

Просроченная аренда: задача остаётся `in_progress`, но помечается `stale`; следующая сессия может забрать её через `claim` с флагом `takeover`.

## 5. HTTP-контракт

```text
GET    /api/board                  доска: задачи по колонкам, активные захваты
POST   /api/tasks                  создать
GET    /api/tasks/:id              карточка с комментариями
PATCH  /api/tasks/:id              заголовок, тело, приоритет, метки, проект
POST   /api/tasks/:id/move         статус и позиция (drag&drop)
POST   /api/tasks/:id/claim        захват
POST   /api/tasks/:id/touch        объявить файлы
POST   /api/tasks/:id/release      освободить
POST   /api/tasks/:id/comment      комментарий
GET    /api/events                 SSE: изменения задач и конфликтов
GET    /health                     версия и статус
```

Ошибки: `400` — невалидный ввод, `404` — нет задачи, `409` — конфликт захвата или зависимость, `423` — аренда занята другой сессией.

## 6. MCP-инструменты

`task_list`, `task_get`, `task_create`, `task_update`, `task_claim`, `task_touch`, `task_comment`, `task_release`, `task_done`, `task_ask`, `task_reply`.

Каждый инструмент возвращает текст для агента: что произошло, кто владелец, что делать дальше. Ошибка — не исключение, а понятный ответ с кодом.

## 7. Веб-доска

Колонки: Backlog, Todo, In Progress, Review, Done. Карточка: ID, заголовок, проект, приоритет, метки, владелец и остаток аренды. Drawer: тело, комментарии, тред переговоров, кнопки захвата и освобождения. Drag&drop меняет `status` и порядок.

Стиль: тёмный Linear-like, плотная сетка, мелкая типографика, hairline-границы, без тяжёлых теней. Шрифт — Geist или системный гротеск, не Inter.

## 8. Автозапуск

Плагин `~/.config/opencode/plugins/kanso/` в `setup(ctx)` проверяет `GET /health`; если доска не отвечает, запускает `node bin/kanso.js serve` отдельным процессом и пишет PID в `~/.local/share/kanso/serve.pid`. Плагин идемпотентен: второй запуск ничего не делает.

## 9. Критерии приёмки

- 100 параллельных `claim` одной задачи → ровно один владелец.
- `kill -9` владельца → задача освобождается не позже 15 минут.
- Пересечение по файлу: обе сессии получают по одному сообщению, третье не отправляется.
- Тупик → `needs_decision`, карточка помечена, человек получает вопрос.
- Статус, изменённый на доске, виден агенту при следующем запросе и наоборот.
- `GET /health` отдаёт версию из `VERSION`.

## 10. Этапы

1. Спайк: идентичность MCP-сессии и доставка `session.prompt` (в работе).
2. Хранилище + тесты (TDD).
3. HTTP + SSE + тесты контракта.
4. MCP-инструменты.
5. Доска.
6. Переговоры и автозапуск.
7. Документация, `VERSION`, `CHANGELOG`.