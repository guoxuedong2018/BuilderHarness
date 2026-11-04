# Agent evals

`builderharness eval` measures an agent harness on a project's own tasks. The same
tasks run under different harness variants (instructions, skills, hooks, model,
effort), several times each, and two runs can be compared task by task. It follows
the approach of improving a harness from traces: change one thing, rerun, and keep
the change only when the numbers move.

The runner is generic. Tasks, defect patches, hidden tests and traces belong to the
host project; traces contain the project's code, so they stay local.

```bash
builderharness eval list
builderharness eval validate                      # check every task, no model calls
builderharness eval run --variant current --dry-run
builderharness eval run --variant current --repeat 1 --max-total-usd 20 --max-quota 0.85
builderharness eval run --resume <runId> --repeat 3   # the remaining rounds, later
builderharness eval compare <runA> <runB>
```

Every command takes `--root <project>`, `--evals <dir>` (default `evals`) and
`--out <dir>` (default `.builderharness/evals`, which must be ignored by git).

## Layout

```text
evals/
├── suite.json                 # defaults for every task
├── tasks/<id>/
│   ├── task.json
│   ├── inject.patch           # optional: the defect, applied to the snapshot
│   └── hidden/                # optional: files copied in before grading
└── variants/<name>/
    ├── variant.json
    └── files/                 # optional: laid over the workspace (CLAUDE.md, .claude/**)
```

### suite.json

| Field | Meaning |
| --- | --- |
| `base` | Commit every task starts from (a task may override it) |
| `exclude` | Paths left out of the snapshot; always include the evals directory itself |
| `clone` | Untracked directories copied from the project into each workspace (copy-on-write where the file system allows), e.g. `node_modules` |
| `workDir` | Where workspaces are created, relative to the project; must be outside the project and have no agent instruction files above it. Default: the system temp directory |
| `env` | Extra environment for the agent and the grader; `${NAME}` expands from the caller's environment |
| `setup` | Shell commands run once before the first `run` grade item, e.g. resetting a test database |
| `serve` | `{ run, url, timeoutSec }`: a service started before the first grade item with `serve: true` and stopped after grading. Grading refuses to start when `url` already answers |
| `untouched` | Globs no task may change; added to every task as the `untouched` grade item |
| `agent` | `permissionMode`, `allowedTools`, `disallowedTools`, `budgetUsd` and `timeoutMin` per attempt |
| `verifyCommands` | Regexes for shell commands that count as verification |
| `successClaims` | Regexes for a final answer that claims success |
| `loopThreshold` | Edits to one file above which an attempt counts as looping (default 8) |

### task.json

```json
{
  "type": "injected-defect",
  "split": "dev",
  "origin": "where the defect came from",
  "inject": "inject.patch",
  "restore": ["tests/orders.test.ts"],
  "scope": ["src/orders/**", "tests/**"],
  "prompt": "A user report, written from the user's side, without naming files.",
  "grade": [
    { "id": "target", "target": true, "run": "npx vitest run tests/orders.test.ts" },
    { "id": "unit", "run": "npx vitest run" },
    { "id": "no-schema-change", "unchanged": ["db/**"] }
  ],
  "budgetUsd": 3,
  "timeoutMin": 20
}
```

- `split` is `dev` or `holdout`. Develop the harness against `dev`; run `holdout`
  only at milestones so changes do not overfit the tasks.
- `inject` usually breaks the source and removes the tests that would reveal the
  defect; `restore` puts files or whole directories back to their base content
  before grading (files the agent added stay), and `hidden/` then adds files that
  never existed at base. Restoring the whole test directory also means edits the
  agent made to existing tests cannot change the grade.
- `scope` is optional; changes outside it are reported as `outOfScope`.

Grade items, exactly one kind each:

| Kind | Passes when |
| --- | --- |
| `run` | the shell command exits 0; `serve: true` starts the suite service first; `timeoutSec` defaults to 900 |
| `unchanged` | the agent changed no path matching the globs |
| `changedWithin` | every change matches the globs; `requireChange: true` also needs at least one change |
| `answer` / `answerNot` | the final answer matches every `answer` pattern and no `answerNot` pattern (case-insensitive) |
| `signal` | the process signal holds, e.g. `verifiedAfterEdit` |

An attempt is solved when every item passes. An infrastructure failure (setup,
a service address already in use, workspace) is recorded as an error and counts
as neither solved nor unsolved. A service that exits or never answers after an
agent ran is usually a build the agent broke, so the items that need it fail. Globs support `*`, `**` and `?`; a pattern without wildcards also covers
everything below it.

### variant.json

```json
{ "host": "claude", "model": "claude-opus-5-5", "effort": null, "appendSystemPrompt": null, "remove": [] }
```

`files/` is copied over the workspace and `remove` deletes paths, so a variant can
change project instructions, skills or hook settings. `host: "command"` with a
`command` array runs any executable that prints a stream-json trace; the prompt is
its last argument and `BH_EVAL_PROMPT`. `${VARIANT_DIR}` expands in the command.

## What validate checks

`validate` runs no agent. For each task it checks the structure, then builds the
problem state (base plus `inject`, with grading files in place) and runs the `run`
items: every target must fail and every other item must pass, so the defect breaks
exactly what the task is about. With an `inject`, it also builds the reference state
(base without the defect), where every item must pass. Tasks without a `run` target
are checked for structure only. Results go to `validated.json`; `run` refuses tasks
whose validation is missing, failed or stale (task files or base changed).

## What a run records

Each attempt gets a fresh workspace: the base snapshot (`git archive`), the defect,
the variant's files, committed as the only commit of a new repository, plus the
cloned directories. The agent can use git but cannot see what was injected. Under
`.builderharness/evals/<runId>/<task>/<n>/`:

- `trace.jsonl`: the agent's full stream-json output; `agent.stderr.log`
- `answer.md`, `diff.patch`: the final answer and the agent's changes
- `grade/`: one log per grade item, setup and service
- `result.json`: solved, grade items, cost, turns, duration, tokens, stop reason,
  the host's init summary (model, tools, skills, MCP servers) and process signals
- `memory/`: automatic memories the agent wrote during the attempt, if any

`summary.json` and `summary.md` aggregate per task: solve rate over attempts,
unstable tasks (some attempts solved, some not), median cost, time and turns, and
signal counts. `--max-total-usd` stops starting new attempts once this invocation
has spent that much, and `--max-quota <share>` once the fuller subscription window
(five-hour or seven-day) reported by the last attempt reaches that share. Repeats
are interleaved, so an early stop still covers every task.

`--resume <runId>` continues a run: the same variant and tasks, with `--repeat`
raised to add rounds. Attempts that ended in an infrastructure or host error run
again; the others are kept. Resuming is refused when a task or the variant changed
since the run started, so one run never mixes two versions of the harness.

Process signals, read from the trace (heuristics; check the trace before acting):

| Signal | Meaning |
| --- | --- |
| `verifiedAfterEdit` | a verification command ran after the last edit; `null` if the agent made no tool edits |
| `falseClaim` | the answer claims success but the attempt is not solved |
| `looping` | one file was edited more than `loopThreshold` times |
| `outOfScope`, `outsideEdits` | changes outside the task scope or outside the workspace |
| `denials` | tool calls refused by the permission settings |

Edits made through shell commands appear in `diff.patch` but not in the edit counts.

## Claude Code host

The runner calls Claude Code in print mode:

```bash
claude -p "<prompt>" --output-format stream-json --verbose \
  --setting-sources project --strict-mcp-config --no-session-persistence \
  --permission-mode <agent.permissionMode> [--model] [--effort] \
  --max-budget-usd <budget> [--append-system-prompt] --allowedTools <list>
```

- Only project settings load, so user-level settings, plugins and MCP servers stay
  out and the variant's files decide the harness. The workspace path is new, so
  automatic memory starts empty.
- Environment variables of an enclosing Claude Code session (`CLAUDE*`) are removed;
  `ANTHROPIC_API_KEY` passes through.
- Tools outside `allowedTools` are refused, not prompted, and appear as `denials`.
- Before a run the host must be logged in (`claude auth status`) or have an API key;
  otherwise the run stops with `host-authentication-required` before any attempt.

Edits are limited to the workspace by the permission mode, but allowed shell
commands run with the caller's user rights. Keep `allowedTools` to what the tasks
need, and run evals on a machine where that is acceptable.

Workspace trust and permission behaviour in print mode can differ from interactive
sessions. Run a single pilot attempt with `--keep`, read its trace and `init`
summary, and record what you find for your project before sizing a baseline.

Observed with Claude Code 2.1.220 in print mode (first pilot, 2026-11-04):

- No workspace-trust prompt: the session starts in the new directory at once.
- `init` lists every built-in tool (scheduling, workflows, web fetch and search
  among them); only `allowedTools` run without a prompt, everything else is refused
  and shows up as a denial. With `--setting-sources project --strict-mcp-config`
  there were no MCP servers and no plugins; skills were the project's own plus the
  built-in ones.
- A model the CLI version does not support fails at once with an API 400 ("version
  … or newer is required"). The `result` event still has `subtype: "success"`, with
  `is_error: true`, `terminal_reason: "api_error"` and `api_error_status`. The
  runner treats this, and a host that exits without any result, as a host error:
  the attempt is not graded, counts as an infrastructure error and stops the run.
  Update the CLI (`claude update`) and run again.
- Even with `--no-session-persistence`, the CLI creates
  `~/.claude/projects/<workspace path>/memory/` for each new workspace. The runner
  copies any memories the agent wrote into the attempt's `memory/` folder and
  removes that project directory when its name carries the run id.
- With a claude.ai login (`apiKeySource: "none"`), `total_cost_usd` is an
  API-equivalent figure. What a run really consumes is subscription quota, which the
  user's own sessions share. The stream's `rate_limit_event` lines carry the
  five-hour and seven-day utilization; the runner records them per attempt
  (`metrics.quota`) and per run (`summary.md`). Size a baseline against that window,
  not only against `--max-total-usd`.

Observed with Claude Code 2.1.318 (second pilot, same day): an easy injected defect
was solved in 22 turns and about two minutes. The agent ran the project's own gates
after its last edit and checked that its new test fails without the fix. It cost
$0.47 API-equivalent and about 1% of the five-hour window. No denials, and the
memory folder stayed empty and was removed.

Not part of `npm run check`: real host runs cost money and need a login. The
runner's own tests (`npm run test:eval`) use fake agents.
