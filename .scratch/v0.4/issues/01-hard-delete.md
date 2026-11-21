# 01: Hard delete end-to-end

**What to build:** пользователь удаляет задачу навсегда: кнопка в drawer → диалог подтверждения с названием → задача исчезает из базы, drawer закрывается, информационный тост (без undo), все вкладки обновляются по SSE. Чужая активная аренда блокирует удаление. Ссылки blocked_by у других задач чистятся, разблокированный backlog переезжает в todo. CLI: `delete <id> --yes`.

**Blocked by:** None (can start immediately).

**Status:** done (коммит ecd6bb9)

- [x] store.deleteTask: успех, not_found, leased (чужая активная аренда), каскад claims/comments/threads, чистка blocked_by, backlog→todo
- [x] HTTP DELETE /api/tasks/:id → 200/404/409, SSE task.deleted, 405 use_canceled_status убран
- [x] CLI delete требует --yes, тексты через i18n
- [x] Web: кнопка в drawer, диалог подтверждения, тост, команда в палитре, RU/EN паритет
- [x] npm test зелёный (74/74), браузерные сценарии удаления зелёные (17 проверок, включая SSE-закрытие drawer в соседней вкладке)