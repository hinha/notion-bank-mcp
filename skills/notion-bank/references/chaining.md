# Skill chaining for `/notion-bank`

Chaining is **conditional**. Do not run a fixed pipeline every time.

## superpowers

When the user wants new work designed or the request is ambiguous:

1. Read and follow `superpowers:brainstorming` (explore, clarify, design, get approval).
2. Then follow `superpowers:writing-plans` to produce an implementation plan.
3. Persist that plan with notion-bank MCP (`plan_upsert` / migrate).
4. Return the Notion URL.

When the user already has a clear, approved plan or only wants a surgical Notion edit, skip brainstorming.

## optimize-goal

When a `goal.md` file exists (Claude Code `/goal` directive):

1. Read and follow `optimize-goal` to tighten the file (checklist, one question at a time, approval before overwrite).
2. After the goal file is solid, document the resulting plan/decision in Notion via this skill’s write path.
3. Return the Notion URL.

If there is no `goal.md`, skip `optimize-goal`.

## goal-analyzer (health)

**Do not chain** the community health `goal-analyzer` skill. It is for fitness/nutrition goals and is out of scope for the plan bank.

Use [engineering-goals.md](engineering-goals.md) instead.

## Order (when multiple apply)

```text
brainstorming → writing-plans → engineering checklist → optimize-goal (if goal.md) → Notion write → URL
```

Omit any step that does not apply.
