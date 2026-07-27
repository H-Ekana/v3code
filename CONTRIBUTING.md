# Contributing

> **V3 Code fork — this section is ours, everything below it is inherited from upstream.**
>
> This checkout is `H-Ekana/v3code`, a fork of `pingdotgg/t3code`. The guidance from
> "Read This First" onward is upstream's text about contributing to **T3 Code**, and it does not
> describe how we work here. Keep this block when merging upstream; take their edits for the rest.

## Where Work Lands (fork-specific)

| Remote     | Repository         | Use                                                                   |
| ---------- | ------------------ | --------------------------------------------------------------------- |
| `origin`   | `H-Ekana/v3code`   | **Ours.** Push branches and open every PR here.                       |
| `upstream` | `pingdotgg/t3code` | Read-only. Fetch and merge from it. **Never push or open a PR here.** |

Branch off `main`, land through a PR on `origin`, and let CI run — local verification is
deliberately limited to focused tests, so the PR is the first full check. Do not commit to `main`
directly.

**`gh` does not default to `origin`.** With an `upstream` remote present it resolves the repo to
`pingdotgg/t3code`, so a bare `gh pr create` opens a public pull request against the upstream
project containing our in-progress work. Pass the repo explicitly on every `gh` call — `pr create`,
`pr list`, `pr view`, `pr checks`, `api`:

```sh
gh pr create --repo H-Ekana/v3code --base main --head <branch> --title "..." --body-file -
```

If `gh` reports `No commits between main and <branch>` or `Head ref must be a branch`, nothing is
wrong with your branch — `gh` looked for it in `pingdotgg/t3code`, where it does not exist. Re-run
with `--repo H-Ekana/v3code`. Do **not** push the branch upstream to make the error go away.

Agents: the same rules are in `AGENTS.md` under "Git Remotes".

---

## Read This First

_Everything from here down is upstream's guidance about contributing to T3 Code itself._

We are not actively accepting contributions right now.

You can still open an issue or PR, but please do so knowing there is a high chance we close it, defer it forever, or never look at it.

If that sounds annoying, that is because it is. This project is still early and we are trying to keep scope, quality, and direction under control.

PRs are automatically labeled with a `vouch:*` trust status and a `size:*` diff size based on changed lines.

If you are an external contributor, expect `vouch:unvouched` until we explicitly add you to [.github/VOUCHED.td](.github/VOUCHED.td).

## What We Are Most Likely To Accept

Small, focused bug fixes.

Small reliability fixes.

Small performance improvements.

Tightly scoped maintenance work that clearly improves the project without changing its direction.

## What We Are Least Likely To Accept

Large PRs.

Drive-by feature work.

Opinionated rewrites.

Anything that expands product scope without us asking for it first.

If you open a 1,000+ line PR full of new features, we will probably close it quickly and remember that you ignored the clearly written instructions.

## If You Still Want To Open A PR

Keep it small.

Explain exactly what changed.

Explain exactly why the change should exist.

Do not mix unrelated fixes together.

If the PR makes anything resembling a UI change, include clear before/after images.

If the change depends on motion, timing, transitions, or interaction details, include a short video.

If we have to guess what changed, we are much less likely to review it.

## Issues First

If you are thinking about a non-trivial change, open an issue first.

That still does not mean we will want the PR, but it gives you a chance to avoid wasting your time.

## Be Realistic

Opening a PR does not create an obligation on our side.

We may close it. We may ignore it. We may ask you to shrink it. We may reimplement the idea ourselves later.

If you are fine with that, proceed.
