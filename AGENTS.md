# Kevin Word Quest project rules

These rules apply to every change in this repository.

1. Never commit Kevin's real learning-record exports or other personal data. Keep real `*.wordquest.json` files outside the repository; tests may only use anonymized fixtures.
2. Never invent item-level evidence for legacy summary records. A corrected final answer is not evidence of a correct independent first attempt.
3. Every persisted data-structure change must remain backward compatible with V1/V2 records and include a migration regression test.
4. Every review-scheduling or daily-planning change must include deterministic tests for its dates, ordering, and limits.
5. Change vocabulary source data through its builder/import script. Do not patch only generated files.
6. Keep semantic alternatives separate from accepted spelling variants. A synonym must not pass a target-word spelling test.
7. Never expose quiz answers through clues, ARIA labels, `data-*` attributes, hidden markup, or pre-answer feedback.
8. Backlog is safely deferred work, not a failed daily task. Rest days must not be punished.
9. Do not add FSRS, cloud synchronization, network friend battles, login, or unverified AI-generated learning content unless the user explicitly requests it.
10. After each completed change, report modified files, migrations, added tests, complete test results, and any known unfinished work.
