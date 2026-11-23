# Security by design for delegated configuration

Q27 requires security by design, similar to Cloudflare's approach. This note translates that direction into proposed mechanisms for Patchplane; it does not select a Cloudflare authentication SDK or replace the native Effect and Alchemy requirements.

Cloudflare's MCP authorization documentation distinguishes user authentication from authorization of a client's limited resource access. It separates authorization-server issuance from resource-server token validation and supports permission-based tool access. [MCP authorization](https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/).

Cloudflare's Code Mode documentation runs generated code in an isolated worker, blocks direct outbound networking by default and requires the upstream tool or host request handler to enforce permissions before side effects. It explicitly treats sandbox execution and tool authorization as separate responsibilities. Code Mode itself is experimental; selecting these principles does not select that runtime for Patchplane. [Code Mode security boundary](https://developers.cloudflare.com/agents/model-context-protocol/guides/build-codemode-mcp-server/).

## Proposed application to Patchplane

- Deny undelegated operations by default. Identify the human principal, agent client, target repository, permitted configuration fields and operation before accepting a change.
- Validate delegation and resource access in the platform service for every command. Hiding a tool or asking a frontend question is not the authorization boundary.
- Keep configuration-write permission separate from permission to issue grants. An agent cannot broaden or renew its own authority through a configuration update.
- Record the grant, agent actor, human delegator and before/after configuration versions. Policy-authorized decisions remain distinguishable from direct human actions.
- Keep secrets and authorization enforcement outside extension-controlled code. Grant only needed tools and network routes to an execution environment; verify native-runner containment separately from hosted-worker containment.
- Apply configuration changes at the next recorded attempt, as accepted in Q28. Notify active attempts and their human owner. An explicit Stop command can cancel the current attempt. A snapshot does not preserve externally revoked credentials.
- Reject malformed input, replayed commands and version conflicts at typed, authenticated service boundaries. A valid TypeScript type alone grants no authority.

These mechanisms still need implementation and negative acceptance tests. Grant duration defaults and authentication-provider selection remain technical design work. No live security test or deployment was performed.
