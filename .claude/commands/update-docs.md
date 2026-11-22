---
description: Sync the docs/ folder with recent code changes (only where it matters)
---

Review what changed in the code since the docs were last updated, and update `docs/` only where needed.

1. Read the latest entries in `docs/CHANGELOG.md` to find the last doc update date.
2. Look at changes since then (`git log --since=<date> --stat` and `git diff`, or the files changed in this session if git history is not available).
3. For each change, apply the "Keeping the docs current" rules in `CLAUDE.md`. Skip bug fixes, refactors, styling, tests and dev-dependency bumps.
4. Check for drift:
   - Drizzle schema in `packages/db` vs `docs/08-data-model.md`
   - Registered Fastify routes vs the endpoint map in `docs/09-api-conventions.md`
   - `package.json` runtime dependencies vs `docs/06-tech-stack.md`
   - Built features vs the Status column in `docs/04-functional-requirements.md`
   - `.env.example` vs the env var list in `docs/06-tech-stack.md`
5. Edit only the affected sections. Keep the structure and tone.
6. Add one line per change to `docs/CHANGELOG.md`.
7. If code and docs disagree in a way that looks like a bug, list it and ask the user instead of editing.
8. Finish with a short list: files updated, and anything that needs the user's decision.

$ARGUMENTS
