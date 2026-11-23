# Start V2 at change requests and include independent verification

Accepted during the V2 design interview on 2026-11-07. The first usable V2 must both collect existing evidence and perform independent verification, and workflows begin only after a pull request or merge request exists. An ingestion-only first release and a pre-PR local-development workflow were considered and rejected: the product must replace reconstruction of acceptance state at handoff while also checking the change itself.

The first usable version executes Linux checks and one existing native verification path from a dogfood project. The specific native project and its isolation requirements remain open; importing native observations alone does not meet this scope.

Later answers select Arbeo's Android offline calculation journey using approved synthetic entries, +05:00 at import preview and confirmation, persistence after an offline restart and verified cleanup. Q31 defines dogfood acceptance as five to ten real PRs/MRs across two projects, including that native path, exercised end to end. At every handoff the Patch Report must identify what was checked, what remains uncertain and the next action without reopening agent conversations.

Updated on 2026-11-23: Patchplane never runs untrusted verification on a user's personal device. Arbeo Android builds in an isolated Linux sandbox and executes strictly through a cloud Android device adapter (provider selected during stack proof). See [ADR 0010](0010-postgres-single-store-and-cloud-only-verification.md).
