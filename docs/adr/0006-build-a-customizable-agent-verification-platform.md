# Build a customizable agent verification platform with an actionable inbox

Accepted during the V2 design interview on 2026-11-22. V2 is a customizable agent verification platform, and its first usable version includes an actionable approval inbox with all presentation integrations in scope. The earlier suggestion to restrict the inbox to one initial presentation integration was rejected. This accepts the cost of multiple interaction surfaces to make verification decisions accessible in the user's existing workflows.

Answers Q18 through Q21 resolve the scope further. V2 uses agents to independently verify proposed software changes; evaluating agents themselves across tasks belongs to V3. First-version presentation integrations are GitHub, GitLab, a standalone web Decision Inbox, a CLI, and embedded agent-host applications. Specific embedded hosts and their supported capabilities remain open; this does not promise compatibility with every host.

Maintainers may approve from any authenticated interface. Approval still applies to the exact Acceptance Proposal version and requires the user's authority for that action; authentication alone does not confer approval rights. Proposals remain attached to the PR/MR. This refines ADR 0003's approval mechanism without changing its ownership rule.

Versioned extensions may customize verification workflows and independently derived checks, agent configurations and tool capabilities, execution providers and event integrations, and evidence renderers and project-specific review interfaces. Authorization, approved requirement versions, resource ceilings and evidence integrity remain platform-enforced. Extensions may request additional authority but cannot grant it to themselves. This accepts a constrained extension model to keep customized verification accountable to the maintainer.

The PR/MR entry requirement and earlier unresolved execution-policy questions remain in force. V3 agent evaluation is a future scope decision, not a claim that V2 will implement its evaluation model.

The next answer, numbered 16 by the user in response to Q22, selects T3 as the first embedded host. Its embedding and authenticated-action capabilities must be verified before committing to the integration design. No other embedded host is currently required. Displaying HTML alone does not establish a secure approval integration.

Read-only upstream inspection found that MCP Apps has session-lifetime and host-confirmation constraints, with local-version compatibility and a trustworthy human-approval round trip unverified.

Q26 exposed an ambiguity in the interview framing. Patchplane owns the Decision Inbox, its pending decisions and their authoritative state. T3 is a selected presentation integration that may display a Patchplane interface; selecting it does not make it the owner of the inbox or a dependency for the standalone inbox. The supplied agent-platform ideas motivate an actionable inbox but do not prescribe T3 as its owner. The proposed T3 confirmation-page fallback has not been accepted and does not define Patchplane's primary approval experience.

Amended on 2026-11-23 after architecture re-review:

- **Interfaces in V2:** standalone Web Decision Inbox, GitHub, CLI, and MCP from day one. Drop T3 embedding completely; the standalone Web Decision Inbox is the sole GUI inbox.
- **Forge scope:** keep core forge contracts provider-neutral with explicit capabilities, but ship only GitHub in V2. Drop the live GitLab implementation requirement for V2.
- **Extensions and renderers:** defer custom project-specific evidence renderers to V3+. Split V2 extensions into two tiers: untrusted repository-versioned checks and agent configurations pinned by Git SHA, versus trusted platform-deployed plugins for workflow engines, execution providers, and event listeners.
