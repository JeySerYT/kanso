# 02: Зависимости в drawer + защита от циклов

**What to build:** в drawer секция «Blocked by»: текущие блокировки с удалением, пикер задач (поиск по id/названию, кроме самой задачи), сохранение через существующий PATCH blocked_by. Store отклоняет self-reference и циклы (код cycle) при create/patch.

**Blocked by:** None (после 01, чтобы не конфликтовать в store).

**Status:** ready-for-agent

- [ ] Валидация self/cycle в store + тесты
- [ ] Пикер и список блокировок в drawer, RU/EN паритет
- [ ] PATCH сохраняет, доска и SSE обновляются
- [ ] npm test зелёный, браузерный сценарий зелёный