# Save a draft experiment

The demo stores newly created experiments locally so the list can be verified across reloads.

## Confirmed facts

1. Drafts are stored in the prototype browser using synthetic data.
2. An empty title can be corrected without leaving the dialog.

## Pending decisions

### A · Product choice

| ID | Question | Recommendation | Alternatives | Why | Blocking | Conclusion |
| --- | --- | --- | --- | --- | --- | --- |
| D1 | Should description be optional when saving a draft? | **Keep it optional.** See Fact 1. | ① Require a description at creation. ② Require it when sharing. | Make the first save reversible. See B1. | no | |

### B · Engineering input

| ID | Question | Why | Blocking | Conclusion |
| --- | --- | --- | --- | --- |
| B1 | When could the prototype need shared storage? | Fact 1 describes the current browser-only behavior. | no | |

Use the review toolbar to open this practice decision list.
