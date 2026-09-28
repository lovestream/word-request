# Learning data safety

Kevin Word Quest is offline-first. Real learning records contain activity history, progress, rewards, exercise results, and scheduling dates. They are personal data even though they do not contain passwords.

## Storage rules

- Keep real `*.wordquest.json` exports outside the public source repository.
- Store at least one immutable copy before importing, migrating, or merging records.
- Compare the export timestamp, word count, XP, coins, and checksum before replacing an active record.
- Use anonymized, structurally representative fixtures for automated tests.
- Do not upload real records with GitHub Pages or other static deployments.

## Current protected source

The 2026-09-28 source record remains in the owner's local Downloads directory. Its SHA-256 checksum is:

```text
3bc26268369549eee53d66f230931f6d8e16ca1ade90ce565edb0273f6ed752a
```

The checksum verifies the private original without publishing its contents.

## Important Git history note

Removing a file in a later commit does not erase it from earlier Git history, existing clones, caches, or deployment artifacts. Repository visibility changes or history rewriting must be planned separately because they can disrupt other clones and links.
