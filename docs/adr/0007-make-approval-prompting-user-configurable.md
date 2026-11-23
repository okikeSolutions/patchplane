# Make approval prompting user-configurable

Accepted during the V2 design interview on 2026-11-22, Q12: users determine which actions always need their approval and which never require an approval prompt, while evidence remains available. This replaces a fixed prompt policy with user-controlled automation, subject to the previously accepted platform enforcement of authorization, approved requirement versions, resource ceilings and evidence integrity. An extension cannot authorize itself by changing the policy that governs it.

Q23 resolves the relationship to earlier mandatory approvals: each action category is configurable, including requirement approval, extension activation and waivers. Those three categories default to manual approval during dogfooding. Automatic decisions must record the exact policy rule, policy version and affected proposal, and must never be represented as a human click. Earlier requirements for renewed approval still require a new decision on the affected version, but the configured policy determines whether that decision requires a fresh human action.

A human may authorize an agent to make configuration changes through MCP. This is delegated human authority, not permission for an agent to grant itself authority. The scope and duration of such delegation, and policy precedence across installation, repository and task, remain open.

Q24 rejects immediate application of configuration changes to an active run. A run keeps its configuration snapshot; changes apply to the next run. Both the agent and the human must receive notice when configuration changes during execution, explaining that subsequent runs may produce different results. This favors stable run semantics over applying new policy during execution. The exact lifecycle boundary of a run and treatment of external credential revocation still need specification; a frozen configuration is not a promise that external access remains available.

Q27 prioritizes security by design, using Cloudflare's approach as a reference. Grant design must preserve the previously accepted separation of human delegation and agent self-authorization. Concrete mechanisms must be justified by capability boundaries and authoritative enforcement rather than UI prompts alone; exact grant lifetime defaults have not been selected.

Q28 defines the configuration boundary as the next recorded attempt. Recovery of an existing attempt retains its snapshot; a newly recorded attempt captures the current configuration and its applicable authorization decisions. Recording a retry as a new attempt must not reset the previously accepted shared retry budget. External credentials can still become unavailable; the platform must report that failure rather than claim a frozen snapshot guarantees access.

Updated on 2026-11-23: delegated MCP configuration grants are session-scoped by default and end automatically when the MCP session terminates or when revoked by the user.
