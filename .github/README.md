# pstack for Claude Code

[pstack](https://github.com/cursor/plugins/tree/main/pstack) is Lauren Tan's ([@poteto](https://github.com/poteto)) set of rigorous engineering skills for coding agents: poteto-mode, how/why, architect, arena, verification skills and a library of principles. It ships as a Cursor plugin. This repo packages it as a Claude Code plugin and keeps it in sync with upstream.

Upstream files are kept byte-identical. Everything Claude Code specific lives in new files (`.claude-plugin/`, `hooks/`, `.github/`, `scripts/`). A small mod adapts Cursor-isms (the `Task` tool, `AskQuestion`, Grok model slugs, Cursor agent names) to Claude Code at runtime.

## Install

```bash
/plugin marketplace add PickleBoxer/claude-plugins
/plugin install pstack@pickleboxer
```

Skills only, without the agents and the mod:

```bash
npx skills add PickleBoxer/pstack --skill poteto-mode
```

## Use

Every skill is typed-only, so pstack costs no context until you call one.

| Command | What it does |
|---|---|
| `/pstack:poteto-mode` | Start a task in poteto mode |
| `/pstack:poteto-help` | Pick the right skill for what you are doing |
| `/poteto` | Pin poteto mode on or off for this project |
| `/pstack` | Browse, run and hide pstack skills in a pane |

Skills that use other skills read them from the plugin directly, so the dependency chain works even though every skill is hidden from the model.

| Skill | Uses | Uses in some cases |
|---|---|---|
| poteto-mode | all principles, how, why, architect, arena, swarm, interrogate, figure-it-out, unslop, technical-writing, no-comments, benchmark-checklist, show-me-your-work, reflect, tdd, poteto-agent | |
| architect | how, arena | why, interrogate |
| teach | how, why, unslop | |
| figure-it-out | poteto-mode, show-me-your-work | architect |
| no-comments | Comment Sicko agent | how, why, architect |
| automate-me | unslop, poteto-mode | skill-creator |
| blast-radius | unslop | how, why, arena |
| recall | unslop | why |
| show-me-your-work, technical-writing | unslop | |
| maintain-verification-skill | a skill made by create-verification-skill | |

## Models

Upstream pairs Grok (code) with Opus (judgment). Here the models are plugin options, prompted on install and editable from `/plugin`:

| Option | Default | Used for |
|---|---|---|
| `search_model` | `haiku` | read-only searches and the recall fan-out |
| `code_model` | `sonnet` | explorers, investigators, swarm workers and code delegates, where upstream uses Grok |
| `judgment_model` | `opus` | judgment, prose and the hardest changes |
| `poteto_default` | `false` | start new projects with `/poteto` pinned |

`inherit` uses the session model.

## Not ported

- `make-bot-ui` (Grok Bot only) and `setup-pstack` (writes Cursor rules; replaced by the options above).
- cursor-team-kit skills (`deslop`, `control-ui`, `control-cli`). poteto-mode skips those steps and says so.
- `automations/` is left in the tree but not loaded.
- Arena, architect and interrogate were designed around disagreement between two model families. Two Claude models disagree less.

## Syncing with upstream

`main` is the Claude Code version. `upstream-pstack` is a read-only mirror of the `pstack/` folder of [cursor/plugins](https://github.com/cursor/plugins), produced with `git subtree split`.

```
upstream/main     cursor/plugins monorepo (git fetch)
upstream-pstack   pstack/ split out of upstream/main
main              this plugin, merges upstream-pstack in
sync/upstream     short-lived branch for testing a merge
```

```bash
scripts/sync-upstream.sh                 # refresh upstream-pstack, list unmerged commits
git switch -c sync/upstream main
git merge upstream-pstack
claude plugin validate . && claude plugin test .
git switch main
git merge --ff-only sync/upstream
git branch -d sync/upstream
```

Skip an upstream commit with `git merge -s ours <hash>`. After a sync, bump `version` in `.claude-plugin/plugin.json` to `<upstream version>+claude.<n>`. New upstream skills are hidden automatically.

## Credits

pstack is by [Lauren Tan](https://github.com/poteto), published by Cursor in [cursor/plugins](https://github.com/cursor/plugins) under the MIT license. The Claude Code port is by [PickleBoxer](https://github.com/PickleBoxer), also MIT.
