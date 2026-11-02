---
name: grilling
description: Interview the developer about a new feature, bug fix or change before writing any code, until both sides agree on what to build. Use at the start of every new feature or non-trivial change, and when the developer says "grill me".
---

Interview the developer relentlessly until you reach a shared understanding. Map it as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round, then wait for the answers before the next round.

Each answer reshapes the tree. Settled decisions push the frontier outward and unblock the questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round.

## Asking a round

Ask with the AskUserQuestion tool, always. Never write the questions as a list or a paragraph in chat. One question per decision, 2 to 4 options each, your recommended option first with "(Recommended)" at the end of its label. Each option's description says what happens if the developer picks it. The tool takes at most 4 questions per call, so split a larger frontier across several calls in the same round.

Read each answer before the next call. The developer may pick "Other", ask you something back, or change the plan. Answer that first, then continue the round.

Only when the tool is missing, ask one question per message, written like this:

```
**Q1. <question title>**: <question body, with the choices>

Recommended: <your answer and why>
```

## Facts and decisions

Finding _facts_ is your job, never the developer's. When a frontier question needs a fact from the code, git history, Jira or the database, send a sub-agent to find it. Don't ask the developer anything you could look up. Don't block on it either: only the questions downstream of a running lookup wait for it. Ask the rest of the frontier now.

The _decisions_ are the developer's. Put each one to them and wait.

## Done

The session is done when the frontier is empty: every branch visited, nothing silently assumed. Then write a short plan with what will change, what is out of scope, and how the result will be checked. Do not write code until the developer confirms the plan.

---

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT, see LICENSE).
