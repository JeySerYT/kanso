# 02: Зависимости в drawer + защита от циклов

**What to build:** в drawer секция «Blocked by»: текущие блокировки с удалением, пикер задач (поиск по id/названию, кроме самой задачи), сохранение через существующий PATCH blocked_by. Store отклоняет self-reference и циклы (код cycle) при create/patch.

**Blocked by:** None (после 01, чтобы не конфликтовать в store).

**Status:** done (коммит 24efd84)

- [x] Валидация self/cycle в store + тесты (test/dependencies.test.js, 7 тестов)
- [x] Пикер и список блокировок в drawer, RU/EN паритет
- [x] PATCH сохраняет, доска и SSE обновляются
- [x] npm test зелёный (81/81), браузерный сценарий зелёный (13 проверок)