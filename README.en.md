# Kanso

A local kanban board and coordination layer for OpenCode sessions through tasks: one SQLite file, a web board on `localhost`, and a CLI for the agent.

The name comes from 簡素 (*kanso*, "simplicity"): short, typed with one hand, no conflict with Linear or Jira.

## Why

- Tasks live in one place for every project instead of seven folders.
- A session claims a task through a lease, so two sessions never grab the same work.
- When files overlap, sessions negotiate themselves; a deadlock goes to the human.
- The board opens in the browser and data never leaves the machine.
- The UI and CLI speak Russian and English; a new language is one JSON file away.

## Quick start

```sh
npm test                          # tests
node bin/kanso.js serve           # board on http://localhost:7777
node bin/kanso.js list            # tasks in the terminal
node bin/kanso.js new "Title" --project AniVella --branch main
```

`npm install` is not needed: there are no dependencies.

## Agent workflow

Session identity comes from `OPENCODE_SESSION_ID`, which OpenCode sets for every session. If the variable is absent, `local` is used.

In the examples, `kanso` means `node bin/kanso.js`. You can add an alias or run `npm link`.

```sh
kanso list [--project P] [--status S]       queue
kanso new "title" [--project P] [--branch B] [--label a,b] [--priority 0..4] [--body "..."]
kanso get ANI-1                             task, owner, threads
kanso claim ANI-1 [--paths src/a.js,b]      claim with file reservation
kanso touch ANI-1 src/a.js src/b.js         declare files
kanso move ANI-1 in_progress                change status
kanso comment ANI-1 "text"                  comment
kanso release ANI-1 --note "state"          release and leave the state
kanso done ANI-1 --note "result"            close
kanso delete ANI-1 --yes                    delete permanently (refuses without --yes)
kanso threads [--state asked]               negotiation threads
kanso reply THR-1 take-now|wait|split|escalate [text]
kanso whoami                                session, cwd, current task
kanso serve [--port 7777] [--db path] [--roots a,b]   board
```

Commands print short text for the agent: what happened, who owns the task, what to do next. Errors are a line with a code (`locked`, `blocked`, `path_locked`, `needs_agreement`), not a stack trace.

## Coordination

1. `claim` atomically claims a task and leases it for 15 minutes. `touch`, `comment`, and `move` renew the lease.
2. `touch` declares files. An exact path match is a refusal; a directory overlap opens a negotiation thread.
3. A thread holds at most two messages per side. `wait` yields, two `split` replies divide the paths, two `take-now` or `escalate` replies → `needs_decision` for the human.
4. `release` and `done` drop the lease; `done` unblocks dependent tasks.
5. `delete` removes a task permanently along with its comments and threads; another session's active lease forbids deletion. `blocked_by` references in other tasks are cleaned up, and a fully unblocked backlog task moves to todo. In the web UI — a "Delete permanently" button with confirmation.

## Web board

Navigation lives in the sidebar: brand, "New task", search, projects with task counts, connection status, version, and the language switch. Above the board sits a toolbar: label and priority filters, a "Leased" toggle, sort (manual / priority / updated / created), COMPACT/COMFORT density, "Menu", and the shortcut help. Sort and density persist between sessions. There are five columns — Backlog, To do, In progress, Review, Done; "Canceled" appears when canceled tasks exist. The board scrolls horizontally with the mouse wheel.

A card shows the project, branch, priority `p0–p4` (changeable on the card), colored labels (clicking a label sets the filter), owner, and a `T-MM:SS` lease countdown; an expired lease is highlighted. Double-clicking the title renames the task inline. Cards can be dragged with the mouse or moved from the keyboard (`Alt` + arrows); plain arrows move focus, `1–5` set the focused card's status, `Enter` opens the drawer. The command palette (`Ctrl/Cmd+K`) creates tasks, searches, jumps to projects, filters, sorts, and switches language; `/` focuses search, `C` creates a task, `?` shows the cheat sheet. The drawer shows the body, a meta grid, priority and label editing, comments, threads, and the lease; "Cancel task" can be undone from a toast.

The board style is a "dispatch console": CRT terminal, monospaced data, zero border radius, one red accent and a green lease indicator. Redesign tokens and decisions live in `docs/redesign.en.md`.

When creating a task, the project is picked from the discovered git repositories and the branch from that project's branches. A new project and another branch can be typed in manually. Labels are picked by clicking the shared registry; a new label can be created on the spot.

The UI updates over SSE. The server watches `PRAGMA data_version`, so changes made by the CLI in another process appear on the board without a reload.

## Projects and branches

A project is a git repository name. Kanso discovers repositories under `KANSO_ROOTS` (separated by `:` on Linux) to depth 4 and skips `node_modules`, `.git`, `dist`, `build`, `vendor`, `.worktrees`. Without the variable it uses common folders such as `~/Документы/Project's`, `~/Projects`, `~/Developer`. The list is cached for 15 seconds; `?refresh=1` resets the cache.

A branch is optional: a task can live without one. The repository's current branch is marked with `*` in the list.

## Localization

The dictionaries live in `web/locales/ru.json` and `web/locales/en.json` and are shared by the web board and the CLI. The UI language is stored in `localStorage.kanso.lang`; the CLI takes the language from `KANSO_LANG`, `LC_ALL`, `LC_MESSAGES`, or `LANG`, otherwise `ru`.

To add a language, copy `en.json`, translate the values, add the code to `SUPPORTED` in `web/i18n.js` and `src/i18n.js`, add an item to the switch, and run `npm test`: the test checks that the key sets match.

## Autostart

The plugin `~/.config/opencode/plugins/kanso/tui.tsx` is wired into `~/.config/opencode/cli.json`. When the TUI starts it checks `/health`; if the board does not answer, it starts `node bin/kanso.js serve` and stops it on exit. A second instance does nothing.

Environment variables: `KANSO_DIR` — project folder, `KANSO_URL` — board address, `KANSO_NODE` — Node path, `KANSO_DB` — database file, `KANSO_ROOTS` — repository search roots, `KANSO_LANG` — CLI language.

## Data

`~/.local/share/kanso/board.db` is SQLite in WAL mode with a 5 second `busy_timeout`. The path is overridden with `KANSO_DB` or `--db`. A backup is a copy of the file.

## Structure

```
bin/        CLI entry
src/        storage, conflicts, HTTP, CLI, git projects, i18n, OpenCode client
web/        static board: HTML, CSS, JS, locales/, Geist fonts
test/       tests (node:test)
docs/       specification in Russian and English
```

## Version

`VERSION` is the single source of truth. `package.json` must match; a test enforces it. The format is `X.Y.Z` plus an `alpha` / `beta` / `release` stage.