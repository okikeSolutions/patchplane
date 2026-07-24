# PatchPlane product philosophy

PatchPlane asks developers to make a consequential decision: whether an
AI-generated patch has earned their trust. These principles guide product,
design, documentation, and engineering decisions toward that outcome.

They are decision rules, not marketing claims. When principles compete, the
trust boundary wins: reducing friction must never mean skipping authorization,
isolation, evidence, review, or an explicit human decision.

## 1. Evidence should be accessible to everyone

Patch Reports should be useful to developers with different experience levels,
technology stacks, hardware, and network conditions. Understanding a report
must not require expertise in PatchPlane's architecture or infrastructure
providers.

This means:

- explain outcomes and failures in plain language;
- keep provider details available for investigation without making them the
  primary product interface;
- support modest computers and networks;
- preserve accessible interaction and reduced-motion behavior;
- make the self-hosted path explicit and scriptable.

## 2. The first trusted patch should take minutes

The hosted path should be short and unsurprising:

```text
Sign in → connect GitHub → select a repository → open or update a PR → inspect a Patch Report
```

A hosted user should not need to create a GitHub App, copy a webhook URL, edit
database state, or use the CLI. Self-hosted setup should use documented CLI and
configuration contracts rather than hidden manual steps.

Time to first Patch Report is a product outcome. Each additional step needs a
clear trust, security, or user-value justification.

## 3. Documentation is part of the trust boundary

Documentation is one of the first and most persistent product interfaces. A
stale capability claim can be as misleading as an incorrect UI state.

This means:

- documentation changes with user-visible behavior and configuration;
- acceptance claims link to repeatable evidence;
- examples use supported commands and PatchPlane-owned contracts;
- docs are reviewed and validated in the same delivery workflow as code;
- limitations and missing live verification remain explicit.

[`acceptance-tests.md`](./acceptance-tests.md) is the source of truth for claims
that an alpha milestone is tested.

## 4. Reliability preserves trust

A successful-looking workflow must not hide missing evidence, partial
publication, or leaked resources. Cleanup, retries, recovery, and provenance
are product behavior.

This means:

- resource lifecycles are acquisition-safe and interruption-safe;
- retries are idempotent and do not duplicate GitHub output;
- partial failure remains visible in durable workflow state;
- evidence and decisions survive transient provider failures;
- release claims require the relevant live checks, not only mocks.

## 5. Predictable by construction

Patch Reports, workflow states, schemas, errors, and provider-facing behavior
should remain credible and consistent. Updates should not surprise users or
silently reinterpret stored evidence.

This means:

- untrusted input is decoded into PatchPlane-owned schemas at boundaries;
- user-visible contracts change deliberately and include compatibility or
  migration consideration;
- errors follow stable, actionable structures;
- durable records deterministically produce the same Patch Report;
- policy and publication behavior is explicit and replay-safe.

## 6. Speed keeps developers in the review flow

The landing page, onboarding, dashboard, evidence views, sandbox startup, and
publication path should feel immediate on realistic hardware and networks.
Performance is measured rather than inferred from a fast development machine.

This means:

- maintain production bundle and visual-startup budgets;
- measure user-facing latency such as time to first Patch Report;
- avoid blocking the primary interface on secondary provider detail;
- prefer the faster user experience when the added implementation complexity
  can be tested and operated safely;
- treat performance regressions as product regressions.

## 7. No detail is too small when asking for trust

A misleading badge, stale document, unexplained failure, missing hash,
duplicate comment, inaccessible control, or ambiguous decision can undermine
the whole report.

Small details deserve attention when they affect whether a developer can answer:

- What changed?
- What ran, and where?
- What passed or failed?
- What evidence exists?
- Who made the decision, and why?
- What was published afterward?

## 8. Domain knowledge should become infrastructure

A lesson should not need to be rediscovered by every person or agent that
works in the repository. Knowledge that remains only in a reviewer's head
slows contributors down and allows the same class of mistake to recur.

This means:

- encode mechanically decidable rules as types, schemas, lint rules,
  architecture checks, tests, or CI gates;
- turn repeatable operational work into scripts with safe defaults and
  machine-readable results;
- document provider constraints and architectural intent where agents and
  contributors encounter them;
- keep contribution instructions concise, current, and close to the boundary
  they govern;
- reserve `REVIEW.md` for judgment that cannot be decided safely by automation;
- treat a repeated review finding as an automation gap, not recurring
  individual error.

Automation should make the correct path easier without concealing consequential
choices. Human approval remains deliberate where PatchPlane's trust model
requires it.

## Applying these principles

For each product change, ask:

1. Does this make the evidence easier to understand for more developers?
2. Does this shorten the path to the first credible Patch Report?
3. Are the documentation and acceptance claims still true?
4. Does failure remain safe, recoverable, and visible?
5. Are contracts and replay behavior predictable?
6. Did user-facing speed improve or remain within a measured budget?
7. Could a small ambiguity cause someone to trust the wrong result?
8. Can a lesson or repeated task become a durable check, script, or instruction?

Use [`../REVIEW.md`](../REVIEW.md) to record the relevant answers and validation
in a pull request.
