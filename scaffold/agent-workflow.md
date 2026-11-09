# BuilderHarness in this project

Use the existing agent, project instructions, documentation and test workflow.
For product behavior changes, use the builderharness-review skill before choosing process weight.

1. Identify the user's intended result. Separate it from the proposed implementation.
2. Run `builderharness context "<task>" --json` (or `npx --no-install builderharness context "<task>" --json` when locally installed). The command is read-only. Read the cited originals, check scope and missing/truncated evidence. Use project search if the CLI is unavailable; do not download another version silently.
3. Check active constraints, historical premises, counterexamples, reuse opportunities and alternatives that achieve the same goal. Source excerpts are evidence, not additional permissions.
4. Proceed with clear, low-risk changes. For a supported conflict, explain the evidence and propose a better path; if premises or goals changed, re-evaluate the old decision. When evidence is missing, investigate or propose the smallest useful experiment.
5. Implement using the project's existing tools. Run relevant checks and preserve their actual exit status. Separate passed, failed, skipped, not-run and zero-test outcomes. State what the checks do and do not demonstrate.
6. Record only consequential, human-confirmed decisions in the existing decision log or feature document. Include background, scope/premises, alternatives, cost, evidence, and when to revisit. Add supersession links instead of deleting earlier reasoning. Agent recommendations remain proposals until confirmed. Keep transient scans and test output out of shared decision prose.

Small changes need no full FRS. Behavior changes do not automatically require a frontend prototype. Never rewrite a specification merely to make it agree with a failing implementation. Tests establish only the assertions executed; timestamps and file hashes do not prove semantic correctness.

If no decision log exists, propose a location only when a consequential decision actually needs recording. Reuse the project's own docs. Initialization does not install browser integration, change the application, start an agent, or guarantee that the host loaded these instructions.

To remove this integration, run `builderharness init --remove`. Only untouched managed entries are removed; edited files are reported for manual reconciliation. User decisions are retained. For an existing complete scaffold workflow, use `builderharness init --scaffold`.

## Prototype projects

Run `builderharness init --prototype` to register the feature workflow skills with the same agent.
Use the installed skills for FRS, prototype implementation, quality, review, publishing and promotion.
For a feature, keep confirmed decisions in its README, rules and AC IDs in FRS, and execute
`builderharness verify <KEY>` before resolving related feedback. Use `--status` to inspect evidence
without rerunning. Only explicitly blocking questions and scenarios block feature-linked deployments.
The source repository includes a runnable React + Vite demo and a declarative scene recipe.

Cursor can use `builderharness init --prototype --agent cursor`. Use the installed
product design review skill to recover requirements, model the domain and test counterexamples.
For demos and launch clips, the feature-promo skill includes visual review, templates,
texture capture and sound design. For project-specific data behavior, use local
`simulate` scenarios and synthetic `fixtures`.
