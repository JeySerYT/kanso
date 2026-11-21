# Kanso — specification v0.1

A local kanban board and coordination layer for OpenCode sessions through tasks. Status: `alpha`.

## 1. Goal

One backlog for every project, where any task can be claimed by an OpenCode session for the duration of the work. Sessions see who is busy, never take the same task, and negotiate when their files overlap.

## 2. Scope

In scope:

- task storage on SQLite;
- web board with columns and drag&drop;
- CLI for the agent;
- task leases, file reservations, dependencies;
- session negotiations with a message limit and escalation;
- starting the board together with OpenCode;
- Russian and English UI with room for more languages.

Out of scope: teams and roles, cycles, roadmaps, estimates, time tracking, a mobile app, cloud sync.

## 3. Data model

```text
tasks
  id            TEXT PK      ANI-15 (project prefix + counter)
  title         TEXT
  body          TEXT
  project       TEXT          AniVella
  branch        TEXT          git branch, optional
  status        TEXT          backlog | todo | in_progress | review | done | canceled
  priority      INTEGER      0..4, 0 is the highest
  position      REAL          order inside a column
  labels        TEXT          JSON array of label names
  blocked_by    TEXT          JSON array of ids
  created_at    TEXT          ISO 8601 UTC
  updated_at    TEXT
  closed_at     TEXT

labels
  name          TEXT PK       up to 32 characters
  color         TEXT          #rrggbb
  created_at    TEXT          ISO 8601 UTC

claims
  task_id       TEXT PK
  session_id    TEXT
  cwd           TEXT
  touched_paths TEXT          JSON array
  claimed_at    TEXT
  lease_until   TEXT
  heartbeat_at  TEXT

comments
  id            INTEGER PK
  task_id       TEXT
  session_id    TEXT
  kind          TEXT          note | handoff | decision
  body          TEXT
  created_at    TEXT

threads
  id            TEXT PK
  task_a        TEXT
  task_b        TEXT
  path          TEXT
  state         TEXT          asked | agreed | needs_decision | closed
  created_at    TEXT

messages
  id            INTEGER PK
  thread_id     TEXT
  from_session  TEXT
  proposal      TEXT          take-now | wait | split | escalate
  body          TEXT
  created_at    TEXT

sessions
  id            TEXT PK
  cwd           TEXT
  agent         TEXT
  started_at    TEXT
  last_seen_at  TEXT
```

Invariants:

- a task has at most one active claim;
- claim fails when `lease_until` is in the past and was not renewed — the lease passes to the new owner;
- a task with open `blocked_by` cannot be claimed;
- a thread holds at most two messages per side;
- a label exists in the `labels` registry, and creating it again does not change its color;
- a priority outside `0..4` is rejected with `priority_out_of_range`.

A project is the name of a git repository (the directory basename). A branch is an optional task field: the available branches come from the project repository. Repositories are discovered under `KANSO_ROOTS` (separated by `path.delimiter`, `:` on Linux); the default is a set of common folders such as `~/Документы/Project's` and `~/Projects`. Search depth is 4, and service directories (`node_modules`, `.git`, `dist`, `build`, `vendor`, `.worktrees`) are skipped. The result is cached for 15 seconds; `GET /api/projects?refresh=1` resets the cache.

## 4. Coordination protocol

1. `claim(task)` — atomic claim. If the files overlap an active claim from another session, a conflict is returned.
2. `touch(task, paths)` — declare files. An exact path match is a refusal. A directory overlap opens a negotiation thread.
3. Negotiation: each session receives one message through `session.prompt`. The reply is `take-now`, `wait`, `split`, or `escalate`.
   - one `wait` → the other session gets the reservation;
   - both `split` → reservations over disjoint paths;
   - both `take-now` or `escalate` → `needs_decision`, a question for the human.
4. `release(task, note)` — drop the claim and leave a comment with the state: branch, what was done, the next step.
5. `done(task, note)` — close the task and unblock dependents.

Expired lease: the task stays `in_progress` but is marked `stale`; the next session can take it with `claim`.

## 5. HTTP contract

```text
GET    /api/board                  board: tasks, claims, threads, labels, version
GET    /api/projects               git repositories, current and local branches
GET    /api/labels                 label registry
POST   /api/labels                 create a label (name, color)
GET    /api/tasks                  list with project/status filters
POST   /api/tasks                  create (title, project, branch, priority, labels)
GET    /api/tasks/:id              task with comments and threads
PATCH  /api/tasks/:id              title, body, priority, labels, project, branch
POST   /api/tasks/:id/move         status and position (drag&drop)
POST   /api/tasks/:id/claim        claim
POST   /api/tasks/:id/touch        declare files
POST   /api/tasks/:id/release      release
POST   /api/tasks/:id/done         close
POST   /api/tasks/:id/comment      comment
GET    /api/threads                negotiation threads
POST   /api/threads/:id/reply      reply in a thread
GET    /api/events                 SSE: task and conflict changes
GET    /health                     version and status
```

Errors: `400` — invalid input, `404` — no such task, `409` — claim conflict or dependency, `423` — the lease is held by another session.

## 6. Agent interface

CLI, not MCP: the session identity comes from the shell environment (`OPENCODE_SESSION_ID`), which OpenCode sets for every session. An MCP process is shared per project and cannot tell sessions apart, so it was dropped.

```text
kanso list [--project P] [--status S]          queue
kanso new "title" [--project P] [--branch B]   create
kanso get ANI-15                               task + comments
kanso claim ANI-15 [--paths a,b]               claim with file reservation
kanso touch ANI-15 a,b                         declare files
kanso move ANI-15 in_progress                  change status
kanso comment ANI-15 "text"                    comment
kanso release ANI-15 --note "..."              release
kanso done ANI-15 --note "..."                 close
kanso threads [--state asked]                  negotiation threads
kanso reply THREAD-1 wait                      reply
kanso whoami                                   session, cwd, current task
kanso serve [--port 7777] [--db path] [--roots a,b]   board
```

Priorities are `p0` (critical) through `p4` (someday), defaulting to `p2`.

Commands print short text for the agent: what happened, who owns the task, what to do next. Errors are a line with a code (`409` — taken, `423` — someone else's lease), not a stack trace. The output language comes from `KANSO_LANG`, then `LC_ALL`, `LC_MESSAGES`, `LANG`; `ru` and `en` are supported, with `ru` as the fallback.

## 7. Web board

Navigation lives in the sidebar, not in a top bar: brand, "New task", search, projects with task counts, connection status, version, and language switch. Columns: Backlog, Todo, In Progress, Review, Done; "Canceled" appears when canceled tasks exist. Horizontal board scrolling works with the mouse wheel and `Shift` + wheel.

A card shows the ID, title, project, branch, priority `p0–p4` (changeable via a select on the card), colored labels (clicking a label sets the filter), owner, and a `T-MM:SS` lease countdown ticking every second; an expired lease gets hazard stripes. Double-clicking the title renames the task inline. The drawer shows the body, a meta grid (created, updated, branch, owner, lease, files, blockers), priority and label editing, comments, negotiation threads, status change, a "Done" button, and "Cancel task" with undo via a toast.

A toolbar above the board holds label and priority filters, a "Leased" toggle, sort (manual / priority / updated / created), COMPACT/COMFORT density, "Menu", and the shortcut help. Sort and density persist in `localStorage`. The command palette (`Ctrl/Cmd+K`) creates tasks, searches, jumps to projects, filters by label, sorts, switches density and language, and resets filters. Hotkeys: `/` search, `C`/`N` new task, `?` help, arrows move focus across cards, `Enter` opens the drawer, `1–5` set the focused card's status.

The create form holds a title, a project from the discovered git repositories or "New project…", a branch of the selected project or "Another branch…", a priority, a description, and labels. Labels are picked by clicking the shared registry; a new label can be created right there and gets a color from the palette.

Drag&drop changes `status` and order: the card follows the cursor as a separate layer, the original stays dimmed, and counters and empty states update from state. The same works from the keyboard (`Alt` + arrows) and keeps focus on the card handle.

Style: a "dispatch console" CRT terminal (industrial brutalism). Geist Mono for data and navigation, Geist Sans for task titles; no border radius, 1px borders, a single hazard-red accent, terminal green only for the lease indicator; scanlines and grain as a fixed overlay. Native `select` and `option` are forced dark. Tokens and decisions live in `docs/redesign.en.md`.

SSE events arrive on any database change. The server compares `PRAGMA data_version` and broadcasts `board.synced`, so edits from the CLI in another process show up without a reload.

## 8. Localization

Dictionaries are plain JSON files under `web/locales/<lang>.json`. The same key set is used by the web board (fetch) and by Node/CLI (`readFileSync`), so translations are not duplicated. Keys are flat and grouped by prefix: `status.*`, `priority.*`, `compose.*`, `drawer.*`, `error.*`, `cli.*`.

- Supported languages are listed in `web/i18n.js` and `src/i18n.js`; currently `ru` and `en`.
- Web: the language comes from `localStorage.kanso.lang`, then `navigator.languages`, then `ru`; the switch lives in the sidebar.
- CLI: `KANSO_LANG` → `LC_ALL` → `LC_MESSAGES` → `LANG` → `ru`.
- An unknown key is returned as is; a key missing from a language falls back to `ru`.
- Parameters are interpolated with `{name}`.
- `test/i18n.test.js` checks `ru`/`en` key parity, so a new language must cover the whole set.

To add a language: copy `web/locales/en.json` to `<lang>.json`, translate the values, add the code to the `SUPPORTED`/`SUPPORTED_LOCALES` lists and to the switch `<option>`, then run the tests.

## 9. Autostart

The plugin `~/.config/opencode/plugins/kanso/tui.tsx` is wired into `~/.config/opencode/cli.json`. In `setup(ctx)` it checks `GET /health`; if the board does not answer, it starts `node bin/kanso.js serve` as a separate process and stops it when the TUI exits. The plugin is idempotent: a second run does nothing. Paths are overridden with `KANSO_DIR`, `KANSO_URL`, `KANSO_NODE`.

## 10. Acceptance criteria

- 100 parallel `claim` calls on one task → exactly one owner.
- `kill -9` of the owner → the task is released within 15 minutes.
- File overlap: both sessions get exactly one message, the third is not sent.
- Deadlock → `needs_decision`, the card is marked, the human gets a question.
- A status changed on the board is visible to the agent on the next request and vice versa.
- A CLI change appears on the open board without a reload.
- `GET /health` returns the version from `VERSION`.
- Priority `p5` and a label longer than 32 characters are rejected.
- Moving a card updates counters, empty states, and is persisted on the server.
- `Alt` + arrows move a card and keep focus.
- Switching `ru`/`en` changes the whole UI and survives a reload.
- The `ru` and `en` key sets match, and an unknown key does not break output.

## 11. Status

1. Session identity: `OPENCODE_SESSION_ID` from the shell environment; MCP rejected, the agent interface is the CLI. Done.
2. Storage, claims, leases, dependencies, threads, tests. Done.
3. HTTP, SSE, contract tests. Done.
4. CLI commands for the agent. Done.
5. Web board: columns, drag&drop, drawer, filters, SSE. Done.
6. Negotiation and autostart through the TUI plugin. Done.
7. Sidebar, labels, priorities `p0–p4`, branches, and git projects. Done.
8. RU/EN localization with shared web and CLI dictionaries. Done.
9. Documentation, `VERSION`, `CHANGELOG`. Done for `0.2.0-alpha.1`.