# 03: Разбивка на модули (wide refactor)

**What to build:** board.js → ES-модули web/js/* (main, core, board, drag, events, toolbar, drawer, compose, palette, hotkeys, language; graph — шаг 4), board.css → web/css/* (base, layout, buttons, toolbar, board, dialogs, drawer, overlays, feedback, responsive; graph — шаг 4). Нативный ESM и <link>, без сборщика. Поведение 1-в-1.

**Blocked by:** 01, 02.

**Status:** done

- [x] Один entry-модуль в index.html, монолит удалён
- [x] Все существующие браузерные сценарии зелёные (палитра, фильтры, хоткеи, rename, undo, drag&drop, SSE, RU/EN, mobile)
- [x] npm test зелёный, консоль без ошибок