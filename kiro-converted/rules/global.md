<!-- converted from Claude CLAUDE.md -->

# graphify
- **graphify** (`~/.claude/skills/graphify/SKILL.md`) - any input to knowledge graph. Trigger: `/graphify`
When the user types `/graphify`, invoke the Skill tool with `skill: "graphify"` before doing anything else.

# Live database
- Investigating against a live DB is **always read-only**: SELECT and read-only profiling only. No INSERT/UPDATE/DELETE/DDL, no sproc that writes.
- Any write to a live DB requires my explicit confirmation first — show me the exact statement and wait. This holds even in auto/bypass permission modes; never treat prior approval as standing permission.
