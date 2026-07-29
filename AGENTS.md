# T3 Code

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

## Creating an installer

When asked to create, build, or package an installer or updater for V3 Code, follow
`docs/project/new-installer-instructions.md`. It defines the required version naming scheme
(`<upstream nightly version>.v3.X.Y.Z` — the fork suffix controls app identity, branding, and
disables upstream auto-update) and the exact build command. Do not invent a version number:
derive it per those instructions and increment the fork suffix.

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

## What makes T3 Code special?

We have over 100,000 users who love T3 Code. It's important we maintain the things they love as we continue to iterate on the product. Here's a brief list of the things we can never compromise on.

### 1. Open at the core

T3 Code is truly open. We share our roadmap, we share how we think about things, and of course we share all our code. A large number of our users run forks. We work in the open, and should strive to stay that way.

### 2. Performance without compromise

Lots of apps have gotten bogged down with bad tech decisions and "slop". We have not, and we're proud of the performance of T3 Code. We regularly audit for performance regressions, often caused by sending too much data over websockets, css animations causing gpu spikes, lists being hard to render, and more. Make sure all changes are considerate of performance impact.

### 3. Remote ready

The architecture of T3 Code's websocket layer (npx t3) enables a lot of awesome remote features. These have become core to the product. Whether users are connecting directly over their local network, using Tailscale, or leaning in fully with T3 Connect (our tunnel solution, also in this repo), we need to make sure new features are properly supported.

### 4. Multi-surface

T3 Code has 3 key app surfaces: **web**, **desktop**, and **mobile**.

**Web** is kind of two surfaces, as we have the public facing "app.t3.codes" as well as locally hosting the web app through the `npx t3` command. Both need to be supported by all new features where reasonable.

**Desktop** is the main surface most users install first. It's a full Electron app that bundles the server runner as well. The desktop app can also be used as the host server, allowing remote connections from app.t3.codes or the mobile app.

**Mobile** is a React native app for both iOS and Android. The mobile app allows for connecting to any T3 Code server to control work remotely. It is still in early access (Testflight), but it is pretty close to shipping globally.

## Searching — `ChatComposer.tsx` is invisible to ripgrep past line 2058

`apps/web/src/components/chat/ChatComposer.tsx` contains **6 genuine NUL bytes**, at lines 2058,
2069, and 2175. They are deliberate: separators inside template literals used to build dedup keys.
They are not corruption and should not be "cleaned up" without checking what reads those keys.

The consequence is a silent search failure. Ripgrep applies binary detection to files reached by
**directory traversal** and stops at the first NUL — with no warning, no stderr, and **exit code 0**:

```sh
rg -n "activeProviderIconClassName" apps/web/src/components/chat/
# → ProviderModelPicker.tsx only. ChatComposer.tsx:3210 is silently absent.

rg --text -n "activeProviderIconClassName" apps/web/src/components/chat/
# → also finds ChatComposer.tsx:3210
```

Passing the file as an **explicit path** searches it fully, which is why this hides so well: a
targeted `rg pattern path/to/ChatComposer.tsx` works, and only the directory-wide audit lies.

So: any repo-wide or directory-scoped search silently misses roughly a third of the largest composer
file. When auditing, either pass `--text`, name the file explicitly, or use `Read`. Treat a
directory-scoped grep that returns nothing from `ChatComposer.tsx` as _unverified_, not as _clean_ —
this has already produced false negatives during review.

Confirmed 2026-07-28 while reviewing the interaction-motion-polish work. If someone wants to make
the file greppable again, replacing `\x00` with `` (ASCII unit separator) would preserve the
separator semantics without tripping binary detection — but verify every consumer of those dedup
keys first.

## Package Roles

T3 Code is truly open. We share our roadmap, we share how we think about things, and of course we share all our code. A large number of our users run forks. We work in the open, and should strive to stay that way.

## Claude Sub-agents — Fable orchestrates, Opus 5 implements

User-directed standing rules (2026-07-28) for Claude Code sessions in this repo:

- If you are Claude Fable and you delegate work to sub-agents, write **precise task specs**: exact
  scope and file ownership, the root causes or docs the agent must read first, explicit
  deliverables, and end goals stated as user-observable checks. Vague prompts produce unverifiable
  work; every sub-agent report must come back as raw data the orchestrator can verify.
- As Fable, **never spawn Fable sub-agents**. Spawn **Claude Opus 5** sub-agents only, at high
  thinking/reasoning levels. Fable is the orchestrator and verifier; Opus 5 is the implementer.

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

Lots of apps have gotten bogged down with bad tech decisions and "slop". We have not, and we're proud of the performance of T3 Code. We regularly audit for performance regressions, often caused by sending too much data over websockets, css animations causing gpu spikes, lists being hard to render, and more. Make sure all changes are considerate of performance impact.

### 3. Remote ready

The architecture of T3 Code's websocket layer (npx t3) enables a lot of awesome remote features. These have become core to the product. Whether users are connecting directly over their local network, using Tailscale, or leaning in fully with T3 Connect (our tunnel solution, also in this repo), we need to make sure new features are properly supported.

### 4. Multi-surface

T3 Code has 3 key app surfaces: **web**, **desktop**, and **mobile**.

**Web** is kind of two surfaces, as we have the public facing "app.t3.codes" as well as locally hosting the web app through the `npx t3` command. Both need to be supported by all new features where reasonable.

**Desktop** is the main surface most users install first. It's a full Electron app that bundles the server runner as well. The desktop app can also be used as the host server, allowing remote connections from app.t3.codes or the mobile app.

**Mobile** is a React native app for both iOS and Android. The mobile app allows for connecting to any T3 Code server to control work remotely. It is still in early access (Testflight), but it is pretty close to shipping globally.

## A note from Theo

I like ambitious ideas, simple systems, and software that feels obvious. Do not preserve complexity just because it already exists. Do not introduce machinery because it looks architecturally impressive. Understand the real constraint, then fight for the smallest model that makes the correct behavior unsurprising.

Channel both "measure twice, cut once" and "yagni". Fight scope creep. Try to honor the dev's intent in both a minimal and realistic fashion.

The rest of this document is meant to help you navigate the codebase and make changes effectively. Think of these instructions less as "hard rules", more as "good defaults". The developer's preferences should be able to override anything here.

Of note: Most T3 Code contributions will come from T3 Code itself, often controlled remotely. This means you should be careful about accessing data, killing dev servers, and other things that may damage the T3 Code instance that the contributor is using.

## A small glossary

We need to be on the same page with terminology. When communicating, use this language:

- **you** means the agent reading this file and changing T3 Code.
- **we, us, and maintainers** mean Theo, Julius and the people building T3 Code. These are who you are talking to now.
- **user** means the person using T3 Code to direct coding agents.
- **agent** means the coding agent a user runs inside T3 Code. Depending on context, that may also include you.
- **provider** means the agent runtime or harness T3 Code talks to, such as Codex, Claude, Cursor, or OpenCode.
- **client** means the web, desktop, or mobile UI.
- **environment** means one running T3 server and the machine, filesystem, provider credentials, and state it owns.
- **project** means an environment-local workspace record rooted at a directory.
- **thread** means the durable conversation and work history for a project.
- **turn** means one user-to-agent cycle, including follow-up work such as checkpointing.
- **T3 home** means the base data directory. Runtime state normally lives below its userdata directory.

## The three ways to hurt yourself

1. **Killing by pattern.** Never `pkill -f`, `pgrep | kill`, or `kill` a PID you found by matching a name, path, or worktree string. Your own agent process has this worktree's path in its argv, and this machine runs several other dev servers at once. Kill only a PID you captured at spawn, or the owner of your port from `ss -H -ltnp` after confirming `/proc/<pid>/cwd` is your worktree.
2. **Touching the live install.** `~/.t3/userdata` is the developer's real T3 Code database, in use while you work. Read-only inspection is fine. Never start a server against it, never open it read-write, never clean it up.
3. **Baking in origins.** Never set `VITE_HTTP_URL` or `VITE_WS_URL` for dev. Dev is single-origin and Vite proxies `/api`, `/ws`, `/oauth`, and `/.well-known`. Setting them bakes localhost into the bundle and silently breaks every remote browser.

## Hit every surface

The most common defect in this repo is a change that works on the path you tested and is missing everywhere else. Before calling frontend work done, walk this list and say which entries applied:

- **Entry points.** A behavior reachable from the chat view is usually also reachable from Settings, the command palette, and a keybinding. Fixing one is not fixing the feature.
- **Clients.** Web, desktop (wraps web, adds Electron shell/IPC), and mobile (React Native, separate navigation). Shared logic lives in `packages/client-runtime`
- **Providers.** Codex, Claude, Cursor, Grok, and OpenCode each have an adapter. Provider-shaped features need a decision per adapter, even if the decision is "not supported here".
- **Contracts.** Anything crossing the wire is typed in `packages/contracts`. Change the schema and the server, web, mobile, and desktop all follow.
- **Reverse states.** If you added a way in, add the way out and the way to see it. Snooze needs unsnooze. Close needs reopen. A one-way door is a bug.
- **Connection modes.** Local, remote/relay, and tunnel behave differently. Multi-device and multi-environment cases are real.
- **Docs.** `docs/` mirrors this structure. Behavior changes that a user would notice belong in `docs/user/`; architecture changes in `docs/architecture/`; new vocabulary in `docs/reference/encyclopedia.md`.

## Dev servers

- `vp i` installs. Worktrees get this from the t3.json setup script; if module resolution looks broken, it probably did not run.
- `vp run dev` starts server and web. In a worktree, state defaults to that worktree's gitignored `.t3`, which deliberately outranks an ambient `T3CODE_HOME` so you cannot land on shared state by accident. An explicit `--home-dir` still wins.
- Ports derive from the worktree path and are stable across restarts, but read the real ones from the `[dev-runner]` line since occupied ports shift.
- `--share` publishes over the tailnet. Do not open the URL when you use this, just send it to the user with the pairing code included in url
- The web app requires pairing. Hand over the pairing URL, not the bare origin. A URL without its token is useless to whoever you gave it to.
- Stop what you started, by the PID you tracked. See rule 1.

## Test data

An empty database is a bad test. Seed your worktree's `.t3` instead of pointing at live state:

- Copy from `~/.t3/dev`, never from `~/.t3/userdata`.
- Copy `state.sqlite` together with its `-wal` and `-shm` siblings, and only while no server has the source open. A live copy is a corrupt copy.
- Bring `secrets` and `settings.json` only if the flow under test needs them.
- Copy in, never symlink. Data flows one way: into your sandbox, never back out.

## Verifying

- Smallest proof that the change works. `vp test run <files>` for the tests you touched, targeted lint and typecheck for the scope you changed.
- **Do not run repo-wide checks.** No `vp check`, no `vp run -r test`, no `vp run -r typecheck` unless I ask. CI owns the full suite.
- Backend behavior changes ship with focused tests for that behavior.
- The server is event-sourced and its async flows emit typed receipts. Wait on receipts and worker drains, never on sleeps or polling. A test that needs a timeout to pass is wrong.
- Upon request, user-visible frontend changes should get one integrated pass in a real client: `test-t3-app` for web, `test-t3-mobile` for mobile. The primary agent does this once after integrating. Subagents do not launch their own dev servers. Ask permission before doing computer use or spinning up browsers.

## Pull requests

- Never make a PR unless the developer explicitly asks you to do so.
- Conventional commit titles, plain language: `fix(web): new threads no longer spike CPU`.
- Body: the problem in a sentence or two, then how you fixed it. End with the model and harness that did the work.
- **Rebase onto latest main before opening.** Stale branches conflict and burn a review round.
- UI changes need before/after images. Motion or timing needs a short video.
- One concern per PR. If the description says "also", split it.
- When babysitting: poll checks and comments newer than the last push, verify each bot finding against the source, fix real ones, dismiss false positives with a written reason. Stay quiet when nothing is new. Stop when the bots are green on the latest commit.

## How it works

Clients send typed WebSocket requests. The server turns them into _commands_, a pure _decider_ turns commands into persisted _events_, and a _projector_ derives the read model the UI renders. Provider CLIs run as subprocesses; per-provider _adapters_ translate their native protocols into orchestration events. Side effects run in queue-backed _reactors_ that emit _receipts_ when milestones land. Each turn ends with a _checkpoint_, a hidden git ref, so the app can diff and restore.

Full glossary with file links: `docs/reference/encyclopedia.md`

## Where code lives

- `apps/server` - WebSocket, orchestration, providers, checkpointing. Effect-heavy: read `.repos/effect-smol/LLMS.md` and `docs/operations/effect-fn-checklist.md` before writing Effect code.
- `apps/web` - React/Vite UI. `apps/desktop` wraps it, `apps/mobile` is React Native, `apps/marketing` is the site.
- `packages/contracts` - Effect/Schema contracts. Schema only, no runtime logic.
- `packages/shared` - shared runtime utils, subpath exports, no barrel.
- `packages/client-runtime` - client code shared by web and mobile.
- `.repos/` - vendored read-only references. Prefer their patterns over invented ones. Never edit or import from them. Sync with `vpr sync:repos` when bumping the matching dependency.

## Taste

- Complexity belongs at the adapter boundary. Orchestration stays pure, UI stays dumb.
- Inferred types over annotations. `any` is the enemy.
- Comments describe how a thing is used, and move when the code moves. To be used mostly to describe functions, not to annotate every line of behavior.
- Our users drive agents all day and notice a dropped frame, a lying spinner, and a stale label. No continuously repainting animations; they peg the GPU on high-refresh displays.
- If a rule here fights the task in front of you, say so loudly and get a human sign-off before breaking it.

## Additional tips

- Don't verify with browsers or computer use unless the user explicitly agrees or requests it.
- Security is important, but should not be over-indexed on, especially for dev mode/maintainer-only features.
