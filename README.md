# @pify/cli

Front door for the [Pify](https://github.com/pifydev) suite: install and update the
[pi coding agent](https://github.com/earendil-works/pi), then manage the `@pify/*`
extension packages with short names.

## Install

```bash
npm i -g @pify/cli
```

Or bootstrap without installing anything permanently:

```bash
npx @pify/cli setup
```

## Usage

```
pify setup                 # install the pi coding agent (no-op if present)
pify list                  # show the @pify package catalog with install state
pify install goal memory   # short names resolve to @pify/goal, @pify/memory
pify install goal -l       # project scope (.pi/settings.json) instead of global
pify remove goal
pify update                # update pi + every installed @pify package
pify update pi             # update pi only
pify update goal           # update one package
pify doctor                # diagnose node / npm / pi / settings
```

## How it relates to `pi`

`pify` deliberately does **not** replace pi's package manager. Every package
operation delegates to `pi install` / `pi remove` / `pi update`, which own
`~/.pi/agent/settings.json` and the extension npm workspace. What `pify` adds:

- **Bootstrap** — `pi update --self` can't run when pi isn't installed yet;
  `pify setup` closes that gap (`npm install -g @earendil-works/pi-coding-agent`).
- **Catalog** — `@pify/*` short names, discovery, and install state at a glance.
- **One-shot update** — `pify update` chains pi's self-update with per-package
  updates of everything from this org.
- **Doctor** — environment sanity checks for support requests.

## Packages

| Package | Description |
|---|---|
| `@pify/btw` | By-the-way notes: capture asides without derailing the agent |
| `@pify/goal` | Pin a session goal and keep the agent anchored to it |
| `@pify/memory` | Persistent memory across pi sessions |
| `@pify/plan-mode` | Read-only planning mode with approve-then-execute gate |
| `@pify/pretty` | Prettier TUI rendering for tool calls, diffs, markdown |
| `@pify/subagent` | Spawn scoped subagents from within a pi session |
| `@pify/swarm` | Coordinate multiple pi agents working in parallel |
| `@pify/task` | Track tasks and progress inside pi sessions |
| `@pify/usage` | Token and cost usage reporting |
| `@pify/workflow` | Deterministic multi-step agent workflows |
| `@pify/yolo` | Auto-approve everything, with an undo trail |

The catalog ships inside the CLI and refreshes daily from
[`catalog.json` on `main`](https://github.com/pifydev/cli/blob/main/catalog.json),
so newly published packages appear without a CLI update. Set `PIFY_OFFLINE=1`
(or pi's `PI_OFFLINE=1`) to skip the refresh.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Unexpected failure |
| 2 | Usage error (bad arguments, unknown command) |
| 3 | Environment problem (pi/npm/node missing or too old) |
| 4 | Package not found / not yet published |
| 5 | A delegated `pi`/`npm` subprocess failed |

Colored output respects `NO_COLOR`, `FORCE_COLOR`, and non-TTY pipes.
Diagnostics go to stderr; data (`list`, `doctor`, `--version`) goes to stdout.

## Development

```bash
npm install
npm run build      # tsup -> dist/
npm test           # node --test (builds first: npm run build && npm test)
npm run typecheck
```

Requires Node >= 22.19.0 (same floor as the pi coding agent).

## License

MIT © [pifydev](https://github.com/pifydev)
