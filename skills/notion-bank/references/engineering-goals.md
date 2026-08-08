# Engineering goal checklist

Use this checklist instead of health `goal-analyzer`. It is for implementation
plans and documentation goals that will land in Notion.

Silently score the request before writing. If any item fails, ask one clarifying
question (highest impact first), then proceed.

## Checklist

1. **Specific** — Service name, plan title, and scope are named (not “improve things”).
2. **Measurable done-check** — What evidence shows done? (tests green, Notion URL exists, section X updated, PR opened, etc.)
3. **Achievable in this session** — Fits one plan/upsert cycle; split oversized work.
4. **Relevant** — Belongs in the plan bank (implementation / ops / architecture docs), not unrelated chat notes.
5. **Time-bound or bounded** — Has an explicit stop: deliverable shipped, or “document current decision only”.
6. **Non-goals** — What is explicitly out of scope (avoids creep into unrelated services).
7. **Notion deliverable** — Success includes a Notion page URL under Plans → service → plan.

## Quick pass / fail

| Pass when | Fail when |
|-----------|-----------|
| Service + title known or askable in one question | Vague “document everything” |
| Done-check is observable in the transcript | “Make it better” with no check |
| Write path is upsert or update_range | Needs secrets the user must not provide |

## After checklist

Proceed to Notion write (`plan_upsert` / `plan_update_range`) and return the URL.
