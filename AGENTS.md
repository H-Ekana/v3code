# AGENTS.md

Read `KNOWN-ISSUES.md` before debugging anything that looks like a hung thread, a stuck spinner, or
an unresponsive stop button — that failure mode is already diagnosed and has a repair script.

## Git Remotes — push and open PRs against the fork, never upstream

This checkout has two remotes:

| Remote     | Repository         | Use                                                                   |
| ---------- | ------------------ | --------------------------------------------------------------------- |
| `origin`   | `H-Ekana/v3code`   | **This is ours.** Push branches and open every PR here.               |
| `upstream` | `pingdotgg/t3code` | Read-only. Fetch and merge from it. **Never push or open a PR here.** |

**`gh` does not default to `origin`.** With an `upstream` remote present it resolves the repo to
`pingdotgg/t3code`, so a bare `gh pr create` targets the upstream project — a public PR against
someone else's repository containing our in-progress work. Always pass the repo explicitly:

```sh
gh pr create --repo H-Ekana/v3code --base main --head <branch> --title "..." --body-file -
```

The same applies to `gh pr list`, `gh pr view`, `gh pr checks`, and `gh api` — pass
`--repo H-Ekana/v3code` (or `-R`) every time.

Symptom that you got it wrong: `gh` fails with `No commits between main and <branch>` and
`Head ref must be a branch`. That is not a problem with your branch — it means `gh` looked for your
branch in `pingdotgg/t3code`, where it does not exist. Do not "fix" it by pushing the branch
upstream. Re-run with `--repo H-Ekana/v3code`.

## Branches — never switch or create one without explicit approval

**This checkout works on `main`.** Multiple agents share this single working tree at the same time,
so the branch is shared state: switching it, or committing a snapshot to move it, yanks the tree out
from under every other agent mid-edit and can lose their uncommitted work.

Without the user explicitly asking for it in the current conversation, you must NOT run:

- `git checkout -b` / `git switch -c` / `git branch <name>` — no new branches;
- `git checkout <branch>` / `git switch <branch>` — no changing the current branch;
- `git worktree add` — no additional worktrees on this repo;
- `git reset --hard`, `git clean -fd`, `git stash` (including `git stash -u`), `git checkout -- .`,
  or `git restore --worktree` over paths you did not personally edit — these discard other agents'
  in-flight work;
- `git rebase`, `git merge`, `git cherry-pick`, or anything else that moves `HEAD` or rewrites the
  tree.

"The task would be tidier on a branch" is not approval. Ask, and wait for a yes.

### Why committing is the dangerous one: `lint-staged` runs `git reset --hard`

**A commit is not a local, additive act in this checkout.** `git commit` fires the pre-commit hook,
which runs `lint-staged`. On its error path `lint-staged` runs **`git reset --hard HEAD`**, then
tries to reapply its own backup stash, then drops it. If that sequence is interrupted — the process
is killed, another agent's git command collides with it, the reapply fails — the reset has already
landed and the reapply has not. **Every other agent's uncommitted work in this shared tree is gone.**

This is not hypothetical. It is the established root cause of the 2026-07-27 incident: an entire
night of concurrent WIP was destroyed this way, and part of it was still unrecovered a day later.
See `docs/project/nightly-motion-polish-review.md`. The `git stash list` entry named
"lint-staged automatic backup" is the fingerprint of this happening.

Consequences for you:

- Do not run `git commit` without explicit approval — not "to be safe", not "to checkpoint my work",
  not "so it isn't lost". Committing to protect work is precisely what destroys other agents' work.
- Never use `--no-verify` to dodge the hook either. Ask instead.
- If you see a `lint-staged automatic backup` stash you did not create, **stop and report it**.
  Do not drop it: it may be the only copy of another agent's work. Do not apply it either — it can
  span the whole repository, including vendored `.repos/` trees.

Committing is likewise opt-in: leave your work uncommitted in the working tree and tell the user
what you changed, unless they asked you to commit. When the user does approve a branch and a PR,
open it against the fork per the table above — `--repo H-Ekana/v3code`, never upstream.

If you find the tree in an unexpected state (files reverted, a branch you did not create, a detached
`HEAD`), **stop and report it**. Do not attempt a repair that overwrites files, because another agent
is probably mid-write in them.

## Task Completion Requirements

- When the user asks to bring in a fix that already exists upstream, prefer merging the upstream
  implementation as-is. Do not independently redesign, re-diagnose, or validate that fix unless the
  user explicitly requests it.
- Keep local verification focused on the files and packages changed. Run the smallest relevant test set; do not run the full workspace test suite as a routine completion step.
  - Use `vp test run <test-files>` for focused built-in Vite+ tests. Use `vp run test` only when the affected package specifically requires its `test` script.
  - Backend changes must include and run focused tests for the changed behavior.
  - Run targeted formatting, lint, and type checks for the affected scope when available.
- Do not run repo-wide `vp check`, `vp run typecheck`, `vp run test`, or equivalent full-suite commands locally unless the user explicitly requests them. CI is responsible for the full verification suite.
- Do not start a development server or launch the web app, Electron app, installed desktop app, mobile
  app, simulator, or emulator as part of implementation or verification. Do not use browser automation
  to run the app. Building packages and installers is allowed, but do not launch them.
- For user-visible changes, finish the relevant focused automated checks and then ask the user to verify
  the result in the actual installed app. Describe the exact flow or surfaces the user should check.
- If an app, dev server, watcher, simulator, or emulator is started accidentally, stop it immediately.

## Dev Servers

- In a linked git worktree, dev state defaults to that worktree's gitignored `.t3`. This deliberately outranks an ambient `T3CODE_HOME`, which could otherwise select the installed app's live `~/.t3/userdata` database. An explicit `--home-dir` still wins.
- Start the web stack with `vp run dev`. Add `--share` when someone needs to open it from another device on the tailnet.
- Browser dev is single-origin: Vite proxies `/api`, `/ws`, `/oauth`, and `/.well-known` to the backend. Do not set `VITE_HTTP_URL` or `VITE_WS_URL` for `dev`/`dev:web`.
- Worktree paths supply stable preferred port offsets. Read the actual server and web ports from the `[dev-runner]` line because occupied ports can still shift them.
- Before handing off a `--share` URL, open its origin in a controlled browser and confirm the app loads. A successful curl is insufficient because browsers reject some otherwise reachable ports.

## Package Roles

- `apps/server`: Node.js WebSocket server. Wraps Codex app-server (JSON-RPC over stdio), serves the React web app, and manages provider sessions.
- `apps/web`: React/Vite UI. Owns session UX, conversation/event rendering, and client-side state. Connects to the server via WebSocket.
- `packages/contracts`: Shared effect/Schema schemas and TypeScript contracts for provider events, WebSocket protocol, and model/session types. Keep this package schema-only — no runtime logic.
- `packages/shared`: Shared runtime utilities consumed by both server and client applications. Uses explicit subpath exports (e.g. `@t3tools/shared/git`) — no barrel index.
- `packages/client-runtime`: Shared runtime package for sharing client code across web and mobile.

## Codex Rescue Subagents

- When invoking `/codex:rescue` or the `codex:codex-rescue` subagent, always pass
  `--model gpt-5.6-sol --effort high`. This overrides the plugin skill's "leave model and effort
  unset" default; the user has standing preference for GPT-5.6 Sol at high reasoning effort.
- `~/.codex/config.toml` already sets `model = "gpt-5.6-sol"` and `model_reasoning_effort = "high"`
  as the global Codex default, so the flags are belt-and-braces — pass them anyway so the choice
  survives a config change and is visible in the transcript.
- `--effort` accepts `none | minimal | low | medium | high | xhigh`.
- A `codex:codex-rescue` subagent is a thin forwarder: it launches a detached background Codex job
  and completes in ~30s. Never report a rescue subagent's completion as the work being done — the
  job it started is still running.
- The server now tails that detached job and replays its progress onto the forwarder's own card
  (`apps/server/src/provider/codexCompanionJobs.ts`), so the Agents panel reflects the real work
  rather than a lone `Bash` row. The card is re-pinned to `running` after the forwarder settles and
  only settles again when the job itself does.
- When the job finishes, its final output is delivered back into the thread as turn input prefixed
  with `[automated]`. That contract is documented to agents by the app itself, in
  `apps/server/src/provider/ClaudeDeveloperInstructions.ts`, which is appended to every Claude
  session's system prompt. Put harness behaviour there rather than here so it ships with the
  installer; keep this file for repo conventions and never put user preferences in the shipped
  prompt.
- To check what a Codex job is actually doing, see the "Where to find out what agents are actually
  doing" section of `docs/project/ideal-agents-sidebar.md` — job registry (`codex-companion.mjs
status --json`), per-job progress log, and the full session JSONL transcript. Check these
  proactively rather than waiting to be asked.

## Reference Repos

- Open-source Codex repo: https://github.com/openai/codex

Use these as implementation references when designing protocol handling, UX flows, and operational safeguards.

## Vendored Repositories

This project vendors external repositories under `.repos/` as read-only reference material for coding
agents.

- Prefer examples and patterns from the vendored source code over generated guesses or web search results.
- Do not edit files under `.repos/` unless explicitly asked.
- Do not import from `.repos/`; application code must continue importing from normal package dependencies.
- Manage vendored subtrees with `vpr sync:repos`; use `vpr sync:repos --repo <id>` to sync one configured repository.
- When updating a dependency with a configured vendored subtree, sync that subtree in the same change so
  `.repos/` matches the installed dependency version.
- When writing Effect code, read `.repos/effect-smol/LLMS.md` first and inspect `.repos/effect-smol/` for
  examples of idiomatic usage, tests, module structure, and API design.
- When writing relay infrastructure code with Alchemy, inspect `.repos/alchemy-effect/` for examples of
  idiomatic usage, tests, module structure, and API design.
