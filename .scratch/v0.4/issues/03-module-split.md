# 03: Разбивка на модули (wide refactor)

**What to build:** board.js → ES-модули web/js/* (main, state, api/sse, cards, drawer, compose, palette, toolbar, hotkeys, toast), board.css → web/css/* (base, layout, cards, drawer, dialogs, toolbar, responsive). Нативный ESM и <link>, без сборщика. Поведение 1-в-1.

**Blocked by:** 01, 02.

**Status:** ready-for-agent

- [ ] Один entry-модуль в index.html, монолит удалён
- [ ] Все существующие браузерные сценарии зелёные (палитра, фильтры, хоткеи, rename, undo, drag&drop, SSE, RU/EN, mobile)
- [ ] npm test зелёный, консоль без ошибок