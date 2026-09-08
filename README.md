# @pify/cli

Front door for the [Pify](https://github.com/pifydev) suite: install and update the [pi coding agent](https://github.com/earendil-works/pi), manage the `@pify/*` extension packages with short names, and scaffold new Pi Packages.

> Not to be confused with the unscoped npm package `pify` (sindresorhus's promisify library) — unrelated.

## Install

```bash
npm install -g @pify/cli
```

Or bootstrap without installing anything permanently:

```bash
npx @pify/cli setup
```

## Usage

```
pify setup                 # install the pi coding agent (safe to re-run)
pify setup --pi-version 0.85.1   # pin the version your team has tested
pify setup --installer     # run pi's official interactive installer (ps1/sh)
pify list                  # show the @pify catalog with install state
pify install goal task     # short names resolve to @pify/goal, @pify/task
pify install suite         # the whole suite in one go (also: core, agents)
pify install goal -l -a    # project scope, pre-approved (CI-friendly)
pify remove goal
pify update --check        # what is out of date, changing nothing
pify update                # update pi + every installed @pify package
pify profile save          # write the installed suite + versions to a file
pify profile apply f.json  # diff it against this machine; --yes to apply
pify update pi             # agent only
pify doctor                # diagnose node / npm / pi / settings
pify init my-extension     # scaffold a new Pi Package
```

Every command supports `--help`; `install`/`remove`/`update` support `--dry-run`; `list`/`doctor` support `--json`.

**Tab completion** — generated from the live command registry (commands, aliases, flags, and package names all complete):

```bash
eval "$(pify completions bash)"        # bash — add to ~/.bashrc
eval "$(pify completions zsh)"         # zsh — add to ~/.zshrc
pify completions fish > ~/.config/fish/completions/pify.fish
pify completions powershell | Out-String | Invoke-Expression   # add to $PROFILE
```

## How it relates to `pi`

`pify` deliberately does **not** replace pi's package manager. Every package operation delegates to `pi install` / `pi remove` / `pi update`, which own `~/.pi/agent/settings.json` and the extension npm workspace — pify never edits pi's settings. What `pify` adds:

- **Bootstrap** — `pi update` can't run when pi isn't installed yet; `pify setup` closes that gap with the same invocation as pi's official installers (`npm install -g --ignore-scripts --min-release-age=0 --no-fund --no-audit`), falling back to `bun add -g --ignore-scripts` when npm is absent and to `--prefix ~/.local` on POSIX when npm's global prefix is not writable (never sudo). `pify setup --installer` hands off to the official interactive installer (`install.ps1` on Windows, `install.sh` on Unix), which can bootstrap Node and Git Bash too.
- **Catalog** — `@pify/*` short names, discovery (including packages that are planned but not yet published), and install state at a glance.
- **One-pass update** — `pify update` chains pi's self-update with per-package updates of everything from this org, without touching non-Pify packages you manage separately.
- **Doctor** — environment sanity checks for support requests.
- **Scaffolding** — `pify init` emits a correctly-shaped Pi Package: raw TypeScript entry (no build step; pi loads `.ts` via jiti), host packages as optional `peerDependencies`, `files` allowlist that actually ships the sources, and a lifecycle-correct extension factory.

## Packages

| Package | Description |
|---|---|
| `@pify/ask-question` | Structured questions on built-in dialogs: 1-4 questions, multi-select, Other free-text |
| `@pify/btw` | By-the-way side conversations: a read-only, codebase-aware side agent |
| `@pify/goal` | Pin a session goal and keep the agent anchored to it |
| `@pify/memory` | Persistent memory across pi sessions |
| `@pify/plan-mode` | Read-only planning mode with approve-then-execute gate |
| `@pify/pretty` | Compact, theme-aware rendering for pi's built-in tools |
| `@pify/skills` | See what skills are loaded, what they cost per request, and which ones ever fire |
| `@pify/subagent` | Spawn scoped subagents, including by `@agent` mention |
| `@pify/swarm` | Coordinate multiple pi agents working in parallel |
| `@pify/task` | Task tracking: dependency graph, evidence-gated completion, reminders |
| `@pify/todo` | Agent working-memory checklist with next-item surfacing |
| `@pify/usage` | Token and cost reporting, plus what is filling the context window |
| `@pify/workflow` | Deterministic agent orchestration through JavaScript workflow scripts |
| `@pify/worktree` | Safe git-worktree management, with `/worktree enter` to take the session along |
| `@pify/yolo` | A safety gradient from auto-approve to ask-about-anything, with an undo trail |

The catalog ships inside the CLI and refreshes (at most daily) from [`catalog.json` on `main`](https://github.com/pifydev/cli/blob/main/catalog.json), so newly published packages appear without a CLI update. A fetched catalog is validated before use — every entry must stay inside the `@pify` scope — and any invalid document is discarded entirely. Overrides: `PIFY_CATALOG_URL` (remote URL), `PIFY_OFFLINE=1` or `PI_OFFLINE=1` (skip all network lookups).

Explicit `@pify/<name>` arguments bypass the catalog's published/planned gate (with a warning), so a freshly published package is installable before the catalog propagates.

## Environment

| Variable | Effect |
|---|---|
| `PIFY_CATALOG_URL` | Fetch the catalog from somewhere other than the org's `main` |
| `PIFY_OFFLINE=1` / `PI_OFFLINE=1` | Skip every network lookup |
| `PIFY_TRUST_PROJECT=1` | Approve project-supplied config for the suite's extensions in a headless run |
| `NO_COLOR` / `FORCE_COLOR` | Colour, as usual |

`PIFY_TRUST_PROJECT` is read by the extensions rather than by this CLI, and it matters in CI. Several packages load files a repository ships — `@pify/memory`'s `.pi/memory/MEMORY.md`, `@pify/subagent`'s `.pi/agents/*.md`, `@pify/yolo`'s `.pi/yolo.json` — and each asks once before doing so, because pi's own trust prompt does not cover files pi itself does not load. With no UI to ask through, the answer is no. Set this to `1` where you have decided the checkout is trustworthy. It is an environment variable rather than a config file precisely because the repository being read cannot set one for itself.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success (including warned no-ops such as offline update) |
| 1 | Unexpected failure; doctor found problems; init target not empty |
| 2 | Usage error (unknown command/flag, non-@pify source, range pin) |
| 3 | Environment problem (Node too old; npm/pi missing; managed-install conflict) |
| 4 | Not found (unknown catalog name; not yet published; not installed) |
| 5 | A delegated `pi`/`npm` subprocess exited non-zero |

Colored output respects `NO_COLOR`, `FORCE_COLOR`, `--no-color`, and non-TTY pipes. Results go to stdout; warnings and errors go to stderr. No interactive prompts anywhere — behavior is identical in TTY and CI except color.

## Profiles

The suite you actually run, written down — which packages, at which versions, in which scope — so a second machine can reproduce it:

```bash
pify profile save                  # → pify-profile.json
pify profile apply pify-profile.json          # prints the plan, changes nothing
pify profile apply pify-profile.json --yes    # applies it
```

Applying always shows the difference first:

```
  change  goal          0.5.0 → 0.4.0
  extra   todo          installed here, not in the profile (left alone)
  install swarm         (latest)
```

A package installed here but absent from the profile is reported as `extra` and **never removed**: a profile says what must be present, not what must be deleted. Every name still goes through the same catalog resolution as a typed install, so a profile file cannot reach outside the `@pify` scope. A CLI's review is a diff and an explicit flag rather than an interactive screen, so the same command works the same way in a script.

## Conflict detection

Some extensions cannot run beside each other: they register the same command, tool, or flag, so pi loads both and one silently wins — and which one is not something you chose. `pify doctor` now reads pi's whole package list and says so:

```
  warn  conflicts   @pify/memory + pi-memory; @pify/pretty + pi-pretty-tui register the same commands or tools - remove one
```

The pairs come from the catalog, where each is taken from the package's own README. Detecting this properly would mean asking a running pi which commands are registered, which a CLI outside pi cannot do — so this is the static equivalent, and it is only as complete as the catalog.

## Development

```bash
npm install
npm run build      # tsup -> dist/
npm test           # builds first, then node --test
npm run typecheck
```

Requires Node >= 22.19.0 — the same floor as the pi coding agent.

## License

MIT © [Pify maintainers](https://github.com/pifydev)
