# Patchplane

Patchplane records what is known and still unproven about a proposed code change. This glossary records terminology resolved during V2 design; unresolved verification guarantees are not implied by these definitions.

## Language

**Change Request**:
A pull request or merge request proposing a code change. An existing Change Request is required to start a V2 workflow.
_Avoid_: Task, prompt

**Acceptance Requirement**:
A condition that must be satisfied for a Change Request to be considered complete. Requirements come from repository defaults and maintainer-approved task-specific requirements; agents may propose changes but cannot silently weaken them.
_Avoid_: Test result, agent completion claim

**Evidence**:
A recorded observation relevant to an Acceptance Requirement. Evidence does not by itself establish that the requirement has been satisfied.
_Avoid_: Proof of correctness

**Acceptance State**:
The current account of what has been checked for a Change Request, what remains uncertain, and which verification action is required next.
_Avoid_: Agent status

**Patch Report**:
The consolidated account of a Change Request's Acceptance State and supporting Evidence. It is intended to support handoff without reconstructing multiple agent conversations.
_Avoid_: Agent handoff summary

**Acceptance Proposal**:
A versioned set of proposed Acceptance Requirements attached to a Change Request for explicit maintainer approval. Approval applies to that proposal version, not to subsequent edits.
_Avoid_: Implicit approval

**Independent Verification**:
Execution that includes checks derived independently from approved Acceptance Requirements, beyond rerunning existing repository checks. Existing passing tests do not automatically satisfy every requirement.
_Avoid_: Agent self-report, test-suite rerun

**Regression Demonstration**:
A before/after check showing the relevant failure in the previous implementation and its correction in the proposed change. It is required for bug fixes where a meaningful comparison is feasible.
_Avoid_: Passing regression test alone

**Advisory Report**:
A Patch Report that informs the maintainer without enforcing a merge restriction. Missing required evidence remains incomplete even when the report is advisory.
_Avoid_: Merge authorization

**Decision Inbox**:
A Patchplane-owned standalone web inbox of verification-related requests that need a maintainer's action, such as approving requirements, resolving a blocked check, or challenging a defective derived check. GitHub, CLI, and MCP expose the same authoritative decisions.
_Avoid_: Agent transcript, execution log, embedded host inbox

**Verification Extension**:
A versioned customization of verification. In V2, untrusted project extensions cover repository-versioned checks and agent configurations pinned by Git SHA; workflow engines, execution providers, and event listeners remain trusted platform-deployed plugins. Custom evidence renderers are deferred to V3+. Extensions operate within platform-enforced authority, approved requirements, resource ceilings, and evidence-integrity rules, and cannot grant themselves additional authority.
_Avoid_: Self-authorizing agent

**Approval Policy**:
User-defined rules governing which verification actions need an approval prompt and which can proceed without one. Such rules do not grant an extension authority to change its own permissions or erase evidence.
_Avoid_: Unrestricted agent mode

**Verification Waiver**:
A decision to waive an acceptance obligation under maintainer-controlled approval policy while preserving its limitation in the Patch Report. A waiver is not evidence that the obligation was satisfied.
_Avoid_: Passing result

**Derived Check Challenge**:
A maintainer action flagging a verifier-authored check as defective so the verifier regenerates the check without recording a Verification Waiver against the underlying Acceptance Requirement.
_Avoid_: Silent test skip, false waiver

**Verification Attempt**:
A recorded execution of verification for a particular candidate with fixed configuration, requirement, and extension versions. New configuration takes effect at the next recorded attempt; recovering an existing attempt retains its snapshot.
_Avoid_: Agent session
