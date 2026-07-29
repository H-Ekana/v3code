# Research task (READ-ONLY): How should V3 Code manage a user's pre-installed codex plugin once the app bundles its own patched copy?

You are a research agent. Make NO file modifications anywhere. Produce findings with concrete
file:line evidence for every claim.

## Context

V3 Code (repo `C:\Users\Hritwik\Documents\GitHub\v3code`) runs Claude sessions via
`@anthropic-ai/claude-agent-sdk` `query()` in `apps/server/src/provider/Layers/ClaudeAdapter.ts`.
The SDK's session `Options` supports `plugins?: SdkPluginConfig[]` (local plugins by path — see
the SDK's `sdk.d.ts` around line 1723). The plan: bundle a patched fork of the Codex companion
plugin (currently installed user-level as `codex@openai-codex`, v1.0.6, at
`~/.claude/plugins/cache/openai-codex/codex/1.0.6/`) into the V3 Code installer and load it
per-session via that `plugins` option.

The open problem: many machines (including this one) ALREADY have `codex@openai-codex` installed
user-level via `~/.claude/plugins/installed_plugins.json`. If V3 Code sessions load BOTH the
bundled copy and the user-level copy, hooks (notably the SessionEnd hook in
`hooks/hooks.json` → `session-lifecycle-hook.mjs`) and `/codex:*` skills could double-register.
We need the exact semantics and the best management strategy.

## Research questions (answer each with evidence)

1. **Do SDK `query()` sessions load user-installed plugins at all?** Inspect the SDK package in
   the repo's node_modules (`node_modules/.pnpm/@anthropic-ai+claude-agent-sdk@0.3.170*/…` —
   `sdk.d.ts`, `cli.js` bundle, or other shipped sources) for how plugin discovery works:
   does it read `~/.claude/plugins/installed_plugins.json`? Is it gated by `settingSources` or
   another option? Then check what `ClaudeAdapter.ts` actually passes (search for
   `settingSources`, `options` construction near the `query({` call ~line 1506) and determine:
   in TODAY'S V3 Code sessions, does the user-level codex plugin load? (Empirical hint: codex
   plugin skills DO appear in V3 Code sessions on this machine — explain the mechanism.)
2. **What exactly happens on double-load?** If both a `plugins:[{type:'local',…}]` entry and a
   user-installed copy of the same plugin load: do both hooks fire? Both skills register (name
   collision behavior)? Is there dedup by plugin name? Evidence from the SDK bundle's plugin
   loading/merging code.
3. **Can a user-level plugin be disabled per-session/per-project without uninstalling?** Look for
   `enabledPlugins` semantics in the SDK/CLI (settings schema, precedence project vs user), and
   whether the SDK `Options` can override plugin enablement. Could V3 Code disable
   `codex@openai-codex` for its sessions while leaving the user's terminal usage untouched?
4. **Plugin identity and state-store keying.** The companion plugin keys its job state store as
   `~/.claude/plugins/data/<plugin-id>/state/<workspace-hash>/`. Where does `<plugin-id>` come
   from (marketplace+name? path?) — check the plugin's own scripts
   (`~/.claude/plugins/cache/openai-codex/codex/1.0.6/scripts/lib/state.mjs` and friends) AND how
   the plugin learns its own data dir (env var from the harness? `CLAUDE_PLUGIN_ROOT`?). If the
   bundled copy gets a different id, what breaks (job visibility, watchers in
   `apps/server/src/provider/codexCompanionJobs.ts` which reads
   `~/.claude/plugins/data/codex-openai-codex/state/...` — check its hardcoded assumptions)?
5. **Interaction with V3 Code's own server-side watchers.** `codexCompanionJobs.ts` and
   `ClaudeAdapter.ts` in this repo tail the plugin's state store. If the bundled plugin writes to
   a different data dir, do those watchers still find jobs? What would need to change?

## Deliverable

A ranked recommendation for managing the pre-installed-plugin case, chosen from (or beyond):
(a) detect + warn the user to uninstall; (b) programmatically disable the user copy for V3 Code
sessions via enabledPlugins/equivalent; (c) skip bundling when a user copy is detected and use
it instead (with version/patch detection); (d) always bundle and tolerate double-load (only if
evidence shows it is actually safe). For each: what the user experiences, failure modes, and the
exact code/config touchpoints. State clearly which claims are proven by evidence vs inferred.

## Constraints

- READ-ONLY: no edits, no installs, no uninstalls, no process kills, no state mutations.
- Do not launch apps or dev servers.
