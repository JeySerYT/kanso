# Kanso

[![CI](https://github.com/JeySerYT/kanso/actions/workflows/ci.yml/badge.svg)](https://github.com/JeySerYT/kanso/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/JeySerYT/kanso?include_prereleases&style=flat-square)](https://github.com/JeySerYT/kanso/releases)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.5-3c873a?style=flat-square)](https://nodejs.org)
[![License](https://img.shields.io/github/license/JeySerYT/kanso?style=flat-square)](LICENSE)

A local kanban board for several OpenCode sessions: tasks in one SQLite file, a lease while a session works, and negotiations when file paths collide. A web board on `localhost` and a CLI for the agent, with no cloud and no external services.

The name comes from 簡素 (*kanso*, "simplicity"): short, typed with one hand, no conflict with Linear or Jira.

## Contents

- [Why](#why)
- [Install](#install)
- [Quick start](#quick-start)
- [Commands](#commands)
- [Coordination](#coordination)
- [Web board](#web-board)
- [Projects and branches](#projects-and-branches)
- [Localization](#localization)
- [Configuration](#configuration)
- [Development](#development)
- [License](#license)

## Why

- Tasks live in one place for every project instead of seven folders.
- A session claims a task through a lease, so two sessions never grab the same work.
- When file paths overlap, sessions negotiate themselves; a deadlock goes to the human.
- The board opens in the browser and data never leaves the machine.
- The UI and CLI speak Russian and English; a new language is one JSON file away.

## Install

Node.js ≥ 22.5 is required. There are no dependencies, so `npm install` is not needed.

```sh
git clone https://github.com/JeySerYT/kanso.git
cd kanso
node bin/kanso.js serve
```

The board opens at <http://localhost:7777>. To call `kanso` without the full path, run `npm link` inside the repository.

## Quick start

```sh
kanso serve                                                       # board
kanso new "Fix the export" --project AniVella --status todo        # queue a task
kanso next --paths src/export.js                                   # claim the top task
kanso comment ANI-1 "Cause found: empty filter"                    # note
kanso done ANI-1 --note "Export no longer crashes on empty filter" # close
```

`kanso list` shows the queue, `kanso --help` lists every command and the status cycle, and `kanso help <command>` explains one command.

## Commands

Session identity comes from `OPENCODE_SESSION_ID`, which OpenCode sets for every session. If the variable is absent, `local` is used; you can also pass `--session` explicitly.

```sh
kanso --help                                commands, flags and the status cycle
kanso list [--project P] [--status S]       queue
kanso next [--project P] [--paths a,b]      claim the top task from todo
kanso new "title" [--project P] [--branch B] [--label a,b] [--priority 0..4] [--status todo] [--body "..."]
kanso get ANI-1                             task, owner, threads
kanso claim ANI-1 [--paths src/a.js,b]      claim with file reservation
kanso touch ANI-1 src/a.js src/b.js         declare files
kanso move ANI-1 in_progress                change status
kanso comment ANI-1 "text"                  add a comment
kanso release ANI-1 --note "state"          drop the lease, keep the state
kanso done ANI-1 --note "result"            close the task
kanso delete ANI-1 --yes                    delete permanently (refuses without --yes)
kanso threads [--state asked]               negotiation threads
kanso reply THR-1 take-now|wait|split|escalate [text]
kanso whoami                                session, cwd, current task
kanso serve [--port 7777] [--host 0.0.0.0] [--db path] [--roots a,b]   board
```

Commands print a short text for the agent: what happened, who owns the task, what to do next. An error is a line with a code (`locked`, `blocked`, `path_locked`, `needs_agreement`), not a stack trace; the full stack appears with `KANSO_DEBUG=1`.

## Coordination

1. `claim` atomically grabs the task and takes a 15-minute lease. The lease is extended by `touch`, `comment`, and `move`.
2. `touch` declares files. An exact path match is refused; a directory overlap opens a negotiation thread.
3. A thread allows at most two messages per side. `wait` yields, two `split` actions divide the paths, two `take-now` or `escalate` actions lead to `needs_decision` for a human.
4. `release` and `done` drop the lease; `done` unblocks dependent tasks.
5. `delete` removes the task permanently along with comments and threads; another session's live lease forbids deletion. `blocked_by` references in other tasks are cleaned up, and a fully unblocked backlog task moves to todo. In the web board there is a "Delete permanently" button with a confirmation dialog.

## Web board

Navigation lives in the sidebar: brand, "New task", search, projects with task counts, connection status, version, and the language switcher. Above the board is a toolbar: label and priority filters, a "Leased" toggle, sorting (manual / priority / updated / created), COMPACT/COMFORT density, "Menu", and a hotkey cheat sheet. Sorting and density persist between sessions.

Five columns — Backlog, Todo, In progress, Review, Done; Canceled appears once there are canceled tasks. The board scrolls horizontally with the mouse wheel.

A card shows the project, branch, priority `p0–p4` (editable right on the card), colored labels (clicking a label applies a filter), the owner, and the lease countdown `T-MM:SS`; an expired lease is highlighted. Double-clicking the title renames the task inline. Cards can be dragged with the mouse and moved from the keyboard (`Alt` + arrows); arrows without `Alt` move focus, `1–5` change the status of the focused card, `Enter` opens the drawer.

The command palette `Ctrl/Cmd+K` creates tasks, searches, jumps to projects, applies filters, sorts, and switches language; `/` is search, `C` is a new task, `?` is the cheat sheet. The drawer shows the body, a meta grid, editing for priority and labels, comments, threads, and the lease; "Cancel task" restores the task through a toast with undo.

The visual style is a "control room": CRT terminal, monospaced data, zero border radius, a single red accent, and a green lease indicator. Tokens and redesign decisions live in `docs/redesign.md`.

When creating a task, the project is picked from discovered git repositories and the branch from that project's branches. You can type a new project and another branch by hand. Labels are chosen by clicking from a shared registry; a new label can be created right there.

The interface updates over SSE. The server watches `PRAGMA data_version`, so changes made by the CLI in another process show up on the board without a reload.

## Projects and branches

A project is the name of a git repository. Kanso looks for repositories under `KANSO_ROOTS` (separated by `:` on Linux) up to depth 4 and skips `node_modules`, `.git`, `dist`, `build`, `vendor`, `.worktrees`. Without the variable it uses common folders such as `~/Documents`, `~/Projects`, `~/Developer`. The list is cached for 15 seconds; `?refresh=1` resets the cache.

A branch is optional: a task can live without one. The repository's current branch is marked with `*` in the list.

## Localization

Dictionaries live in `web/locales/ru.json` and `web/locales/en.json` and are shared by the web board and the CLI. The UI language is stored in `localStorage.kanso.lang`; the CLI takes it from `KANSO_LANG`, `LC_ALL`, `LC_MESSAGES`, or `LANG`, falling back to `ru`.

To add a language, copy `en.json`, translate the values, add the code to `SUPPORTED` in `web/i18n.js` and `src/i18n.js`, add an entry to the switcher, and run `npm test`: a test checks that the key sets match.

## Configuration

| Variable | What it sets |
|---|---|
| `KANSO_DB` | SQLite file path instead of `~/.local/share/kanso/board.db` |
| `KANSO_ROOTS` | repository search roots, separated by `:` |
| `KANSO_LANG` | CLI language: `ru` or `en` |
| `KANSO_PORT` / `KANSO_HOST` | board address for `kanso serve` |
| `OPENCODE_SESSION_ID` | session identity used for leases |
| `KANSO_DEBUG` | `1` prints the CLI stack trace |

The `~/.local/share/kanso/board.db` database runs in WAL mode with a 5-second `busy_timeout`. A backup is a copy of the file.

## Development

```sh
npm test                        # full suite
node --test test/store.test.js  # one file
npm start                       # board
```

```
bin/        CLI entry
src/        storage, conflicts, HTTP, CLI, git projects, i18n, OpenCode client
web/        static board: HTML, CSS, JS, locales/, Geist fonts
test/       tests (node:test)
docs/       specification and design notes
```

`VERSION` is the single source of truth for the version. `package.json` must match it, and a test enforces that. The format is `X.Y.Z` plus the `alpha` / `beta` / `release` stage.

## License

[MIT](LICENSE).