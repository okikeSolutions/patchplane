# WorkOS alpha completion checklist

PatchPlane's first alpha treats WorkOS and Convex as separate plugins that are composed in the client and server entrypoints:

- WorkOS provides identity, organization, membership, role, and permission context.
- Convex provides authenticated data access and workflow persistence.
- The client composes them with `AuthKitProvider` and `ConvexProviderWithAuthKit` so Convex requests use WorkOS AuthKit access tokens.

## What is covered by automated tests

Run:

```sh
bun run --cwd packages/plugins test
bun run --cwd packages/plugins typecheck
bun run --cwd packages/backend test
bun run --cwd packages/backend typecheck
```

Covered today:

- WorkOS user, organization, membership, role, and permission mapping.
- Anonymous requests are rejected by `AuthService.requirePermission`.
- Requests without an active organization are rejected.
- Authenticated workflow starts require `prompt:create`.
- WorkOS organization and membership API calls are wrapped as `AuthError` on failure.
- Explicit WorkOS permission claims are only honored when the actor has an active membership in the active organization.
- Convex viewer and request-list queries require authenticated `ctx.auth` identity.
- User-facing Convex workflow creation uses public `workflowStarts:create` with WorkOS JWT validation, active mirrored membership, actor/workspace anti-spoofing, and `prompt:create` authorization.
- Convex recent workflow reads require WorkOS auth and mirrored active WorkOS membership with `workspace:view` for the requested organization workspace.
- WorkOS user create/update/delete events sync an app-level `users` table, reactivation clears soft-delete state, and `auth:backfillUsers` is exported for existing WorkOS tenants.
- WorkOS organization membership create/update/delete events sync an app-level `memberships` table for Convex-side authorization.
- TanStack server workflow starts still perform live WorkOS membership/permission checks before calling the authenticated Convex write mutation; Convex repeats the app-level authorization as the storage boundary.

## Manual smoke required before calling the plugin alpha-complete

These checks require real WorkOS and Convex deployments and are not covered by local unit tests.

### Environment

Client / TanStack Start:

- `WORKOS_API_KEY`
- `WORKOS_CLIENT_ID`
- `WORKOS_COOKIE_PASSWORD`
- `VITE_CONVEX_URL`
- `CONVEX_URL` if the server runtime cannot read `VITE_CONVEX_URL`

Convex deployment:

- `WORKOS_CLIENT_ID`
- `WORKOS_WEBHOOK_SECRET`
- `WORKOS_ACTION_SECRET` if WorkOS Actions are enabled
- `WORKOS_API_KEY` if running WorkOS AuthKit component backfill/actions that call WorkOS

### AuthKit sign-in smoke

1. Start client and backend dev servers.
2. Visit `/app`.
3. Click sign in.
4. Complete WorkOS AuthKit sign-in with an organization selected.
5. Confirm redirect returns to `/app`.
6. Confirm the UI shows the signed-in WorkOS user.

### Convex token smoke

1. While signed in, confirm the authenticated panel loads `viewer:current`.
2. Confirm `ctx.auth.getUserIdentity()` exposes the expected WorkOS subject.
3. Confirm unauthenticated browser sessions cannot call `viewer:current` or `requests:list`.

### Authenticated workflow smoke

1. Sign in as a user with an active organization membership and `operator` or stronger role.
2. Start a workflow from the app prompt form.
3. Confirm `workflowStarts:create` writes a prompt request and workflow run to Convex.
4. Confirm the stored `actorId` is `workos:<user id>` and `workspaceId` is `workos:<organization id>`.
5. Repeat with a viewer-only role and confirm workflow start is rejected.
6. Repeat with no active organization and confirm workflow start is rejected.

### WorkOS AuthKit component smoke

PatchPlane now syncs WorkOS user events into the app-level `users` table. Existing tenants can be backfilled with:

```sh
npx convex run auth:backfillUsers
```

1. Configure WorkOS webhook endpoint:
   - `https://<convex-deployment>.convex.site/workos/webhook`
2. Subscribe to:
   - `user.created`
   - `user.updated`
   - `user.deleted`
   - `organization_membership.created`
   - `organization_membership.updated`
   - `organization_membership.deleted`
3. Trigger a test webhook from WorkOS.
4. Confirm Convex accepts the signed event.
5. Confirm create/update/delete handlers sync the app-level `users` table.

## Remaining product decisions

- Whether WorkOS action handlers should always allow during alpha or enforce product-specific registration rules.
- Whether to add WorkOS Authorization API resource checks for repository/project-level permissions beyond organization-level membership roles.
