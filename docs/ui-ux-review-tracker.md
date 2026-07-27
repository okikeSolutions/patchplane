# Patch Report UI/UX review tracker

This document tracks the product and implementation work required to make the
Patch Report a credible human review surface for the alpha.

It is based on:

- the authenticated dev-environment audit performed on 2026-07-26,
- the PatchPlane product and trust model in [`SPEC.md`](../SPEC.md),
- the alpha acceptance matrix in [`acceptance-tests.md`](./acceptance-tests.md),
- Vercel's compact hierarchy and progressive disclosure,
- Cloudflare's resource-oriented navigation and operational density,
- the evaluated capabilities of [`@pierre/diffs`](https://diffs.com/) and
  [`@pierre/trees`](https://trees.software/).

This is a product tracker, not authorization to implement every row. Update the
status and evidence columns as design decisions, tests, and live acceptance work
land.

### Reference benchmark

The references are principles, not visual templates to copy. The linked
official surfaces were reviewed on 2026-07-26; re-check them during design
review because vendor interfaces change.

| Reference surface                                                                                    | Observed pattern                                                                                      | PatchPlane translation                                                                                                           | Non-goal                                                                        |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [Vercel projects overview](https://vercel.com/docs/projects)                                         | Bounded primary names, aligned state metadata, compact rows, and progressive disclosure               | Keep workflow rows predictable; lead with PR title, repository, execution state, trust verdict, and recency                      | Recreate Vercel branding or turn attempts into deployments                      |
| [Vercel deployment dashboard](https://vercel.com/docs/deployments#using-the-dashboard)               | A concise identity header, persistent section navigation, status hierarchy, and details on demand     | Keep candidate/attempt identity and the primary verdict visible while moving raw request/runtime detail below the first viewport | Collapse PatchPlane's separate trust dimensions into a single deployment status |
| [Cloudflare analytics navigation](https://developers.cloudflare.com/analytics/types-of-analytics/)   | Account/domain resource hierarchy, dense controls, explicit operational states, and stable navigation | Treat repository, workflow, attempt, candidate, and evidence as a navigable hierarchy with clear state labels                    | Add broad infrastructure navigation to the alpha                                |
| [Cloudflare Security Analytics](https://developers.cloudflare.com/waf/analytics/security-analytics/) | High-density inspection with filters, logs, detailed records, and explicit analysis context           | Use dense changed-file navigation, bounded filters, and truthful evidence states                                                 | Make telemetry the evidence or provenance store                                 |
| `@pierre/diffs`                                                                                      | Specialized diff parsing/rendering, syntax presentation, and unified/split review affordances         | Evaluate it only as the renderer for PatchPlane-authorized candidate diff bytes                                                  | Delegate artifact identity, authorization, trust, or telemetry policy           |
| `@pierre/trees`                                                                                      | Specialized hierarchical file navigation                                                              | Evaluate it only for a projection of candidate-changed paths                                                                     | Fetch or imply a complete repository tree                                       |

## Product direction

**Visual thesis:** a calm, dense review cockpit where the candidate, trust
verdict, and next action are obvious before implementation detail is disclosed.

**Interaction thesis:** summarize first, let reviewers move quickly between
changed files, and reveal provenance or decision controls only when they are
needed.

The first viewport of a review-ready Patch Report must answer:

1. What patch and attempt am I reviewing?
2. Is it trusted?
3. Why or why not?
4. How large is the change?
5. Where do I inspect the changed code?

## Scope decisions

| Area                         | Alpha decision      | Boundary                                                    |
| ---------------------------- | ------------------- | ----------------------------------------------------------- |
| Diff viewer                  | Include             | Exact candidate-bound diff only                             |
| Changed-file navigation      | Include             | Paths parsed from the candidate diff                        |
| Minimal file tree            | Conditional include | `@pierre/trees` only if its spike passes the gates below    |
| Complete repository tree     | Defer               | Not required to answer “what changed?”                      |
| GitHub tree retrieval        | Defer               | Reconsider only for unchanged-file context after dogfooding |
| Inline comments and threads  | Defer               | No review-conversation system in alpha                      |
| Suggested changes or editing | Defer               | PatchPlane remains a trust and decision surface             |
| Arbitrary comparisons        | Defer               | No branch, tag, or unrelated commit comparison              |
| Semantic diffing             | Defer               | Line-oriented candidate evidence remains canonical          |
| Responsive web               | Include             | Desktop and mobile viewport widths for the web app          |
| Native mobile client         | Defer               | No iOS or Android application work in alpha                 |

## GitHub source-content contract

GitHub intake content must remain separated by purpose. Concatenating these
fields destroys the review hierarchy and makes untrusted external content look
like PatchPlane-owned summary data.

| GitHub/source field                        | PatchPlane destination                     | Rendering rule                                                                      |
| ------------------------------------------ | ------------------------------------------ | ----------------------------------------------------------------------------------- |
| Pull request title                         | Workflow queue title and Patch Report `h1` | Plain text; one-line clamp in the queue and two-line clamp in the report header     |
| Pull request body                          | Summary → Requested change                 | Render as sanitized GitHub-flavored Markdown with raw HTML disabled                 |
| External review summary                    | Automated review section                   | Render separately as sanitized Markdown; never append to title or PR body           |
| External inline findings                   | Review findings/evidence                   | Structured finding rows linked to file and line when available                      |
| Repository, PR number, source SHA, attempt | Header metadata                            | Compact, copyable metadata; never concatenated into the title                       |
| Provider comment markup                    | Evidence or external-review detail         | Treat as untrusted; do not execute embedded HTML, Mermaid, scripts, or remote media |

Markdown rendering must preserve headings, lists, task lists, tables, links,
inline code, fenced code blocks, and blockquotes while maintaining the Patch
Report's heading hierarchy. Links require safe protocols and clear external-link
behavior. Raw HTML from PR bodies or provider comments must not be injected into
the DOM.

## UI component contract

The review experience must use the existing design system in
[`apps/client/src/components/ui`](../apps/client/src/components/ui). Feature
components may compose those primitives with PatchPlane domain state and
behavior, but must not recreate design-system primitives.

| Need                               | Required project primitive                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------------- |
| Actions and grouped controls       | `Button`, `ButtonGroup`, `Toggle`, or `ToggleGroup`                                           |
| Status and consequential feedback  | `Badge`, `Alert`, `Progress`, `Spinner`, or `Sonner`                                          |
| Report navigation                  | `Tabs`, `Breadcrumb`, and `Pagination` where appropriate                                      |
| Changed-file navigation            | `ScrollArea`, `Collapsible`, and desktop/mobile `Resizable`, `Sheet`, or `Drawer` composition |
| Loading and no-data states         | `Skeleton` and `Empty`                                                                        |
| Decision inputs                    | `Field`, `Input`, `Textarea`, `Checkbox`, `RadioGroup`, or `Select`                           |
| Confirmation and contextual detail | `AlertDialog`, `Dialog`, `Popover`, or `Tooltip`                                              |
| Structural separation              | `Separator`, `Table`, and ordinary grid/flex layout wrappers                                  |

Custom feature components such as `PatchReportHeader`,
`ChangedFilesNavigator`, `DiffWorkspace`, and `ReviewDecisionPanel` are
appropriate because they group primitives and own domain behavior. A bespoke
button, badge, card, tab, tooltip, dialog, drawer, empty state, loading state, or
similar reusable visual primitive is not.

Before adding custom visual markup, check the local UI directory and the
project's shadcn registry. If a primitive is genuinely missing, add it through
the existing UI-component workflow so it is themed, accessible, and reusable;
do not hide a new primitive inside a feature directory. Use built-in variants,
semantic theme tokens, and `className` for layout composition rather than
duplicating component styling or hard-coding light/dark colors.

`@pierre/diffs` and `@pierre/trees` are specialized content renderers, not
replacements for PatchPlane's UI primitives. They must sit behind feature-level
adapters whose controls, feedback, loading, empty, error, overlay, and
responsive states use the local UI system. Any exception requires a documented
reason, accessibility evidence, and an explicit design-system review.

## Diff workspace accessibility contract

This contract defines PatchPlane behavior independently of the selected diff
renderer and changed-file navigator. An adopted Pierre package must satisfy it
through a feature adapter; a flat-list or bounded unified-preview fallback must
satisfy the same outcomes. Package-specific keyboard behavior may add to this
contract, but must not replace or conflict with it.

### Landmarks, names, and navigation

- Changes exposes a `Changed files` navigation landmark and a separately named
  `Diff` region. The diff region's accessible name includes the selected path.
- The changed-file collection contains only paths derived from the selected
  candidate's diff. Its label states `Partial changed files` whenever artifact
  truncation or incomplete parsing means the projection may be incomplete.
- A flat fallback uses ordinary links or buttons in a semantic list and retains
  their native `Tab`, `Shift+Tab`, `Enter`, and `Space` behavior. It must not
  claim `tree` semantics or implement partial tree keyboard behavior.
- A hierarchical navigator uses the ARIA tree pattern completely: one roving
  tab stop; `ArrowUp` and `ArrowDown` move between visible items; `Home` and
  `End` move to the first and last visible items; `ArrowRight` expands a closed
  folder or moves to its first child; `ArrowLeft` collapses an open folder or
  moves to its parent. `Enter` selects a file. Type-ahead is desirable but is
  not an alpha requirement.
- Every file item has one accessible name containing its path, change status,
  additions and deletions when known, and binary or partial state when
  applicable. Status never relies on color, a single-letter code, or `+`/`-`
  symbols alone. The active file is exposed with selected or current semantics.

### Selection and focus restoration

- Selecting a file updates its selected state, scrolls its file section into
  view, and moves programmatic focus to that section's file heading. Selection
  never focuses an arbitrary diff line or resets the navigator's own scroll
  position.
- Each rendered file section begins with a heading and an explicit
  `Back to changed files` action. The action restores focus to the exact file
  item that initiated navigation. If that item no longer exists, focus returns
  to the `Changed files` heading or mobile trigger.
- Expanding a folder or file keeps focus on its toggle. Before collapsing a
  container that owns the focused element, focus moves to that container's
  toggle; focus is never left inside removed content.
- Reloading the same artifact preserves the selected file when it still exists.
  A candidate, attempt, or artifact identity change resets selection to the
  first available file and announces why. It must never silently retain a path
  from different evidence.
- On mobile, opening the changed-file `Sheet` or `Drawer` moves focus inside it.
  Selecting a file closes the overlay and focuses the file heading. Dismissing
  it without selection restores focus to the `Changed files` trigger.

### Diff modes, hunks, and lines

- Unified view is the alpha default. If split view passes the DIFF-004 width and
  accessibility gates, the shared `ToggleGroup` is labelled `Diff view` and its
  visible options are `Unified` and `Split`; the options are never icon-only.
- Changing mode retains the selected file and nearest hunk. Focus remains on the
  selected mode control, and a polite status message announces the new mode.
  Responsive layout may remove an unusable split option but must not silently
  change a stored preference while it is available.
- File headings and hunk headers form the diff's reading structure. Hunk headers
  announce their old and new ranges. Diff rows are readable in document order
  and are not individual tab stops.
- Each row exposes its kind (`Added`, `Deleted`, or `Unchanged`) and applicable
  old and new line numbers before its code content. Visual line-number gutters,
  `+`/`-` markers, and syntax color are supplementary and must not be announced
  as the only meaning.
- Binary, unavailable, malformed, oversized, truncated, and unsupported
  sections expose a named status and consequence in place of lines. Partial
  content announces its byte boundary and never claims that the final visible
  row or file is the end of the candidate diff.
- Optional next/previous-file or next/previous-hunk actions use shared
  `Button` controls with visible labels or tooltips and accessible names.
  Single-key global shortcuts such as `j`/`k` are outside alpha scope.

### Required acceptance evidence

UX-013 can become `Verified` only after all applicable paths below pass in the
selected renderer and its documented fallback:

| Scenario                           | Keyboard and screen-reader assertion                                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Flat navigator fallback            | Native controls have visible focus; selecting and returning restores the originating item and navigator scroll position.           |
| Hierarchical navigator             | The complete tree key map works; expansion state is announced; collapsing a focused descendant returns focus to its parent toggle. |
| Unified diff                       | File and hunk structure, row kind, and old/new line numbers are announced in reading order without adding a tab stop per line.     |
| Split diff, if shipped             | `Diff view`, `Unified`, and `Split` are named; switching mode retains file/hunk position and announces the change.                 |
| Partial or non-renderable evidence | Incomplete coverage, artifact identity, reason, and review consequence are announced without a success implication.                |
| Mobile overlay                     | Open, select, dismiss, and return-focus behavior passes at 390 × 844 without horizontal page scrolling.                            |
| Evidence replacement               | Candidate or artifact replacement resets stale selection and announces the evidence change.                                        |

Automated component tests must cover focus transitions and accessible names.
Authenticated browser acceptance must cover keyboard-only traversal, the
accessibility tree, 200% zoom, and both desktop and 390 × 844 responsive
layouts. Manual screen-reader readback must cover at least one added, deleted,
and unchanged line because DOM snapshots alone do not prove usable speech.

## Visual validation protocol

UI work requires two complementary inspection lanes. Local inspection provides
fast iteration; the deployed dev stage proves the real authenticated product
boundary.

| Lane                         | Purpose                                                                                                                                    | Required boundary                                                                                                                                                                                                                      | Command or entry point                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Local fixture inspection     | Iterate on layout, responsive behavior, states, Markdown, tree navigation, and diff rendering                                              | Use a fixture-only development entry point that does not initialize WorkOS, Convex, R2, GitHub, decision server functions, or other remote product services. It renders deterministic local data and is excluded from deployed builds. | Project-owned local UI fixture entry point; implementation required |
| Authenticated dev deployment | Validate real WorkOS session behavior, authorization, Convex data, candidate-bound evidence, artifact retrieval, navigation, and decisions | Keep every production trust boundary active. Authenticate in the inspection browser and use only the isolated `dev` stage.                                                                                                             | `bun run infra:deploy`, which invokes Alchemy with `--stage dev`    |

The local lane is a visual-development harness, not an authentication bypass.
Prefer deterministic fixtures for the workflow queue, Patch Report summary,
diff states, changed-file navigation, evidence, and disabled decision controls.
It must not expose an authenticated route, construct a fake WorkOS identity, or
call a real server function. Do not add a runtime `SKIP_AUTH`-style switch.

The harness is acceptable only when automated checks prove:

- its route and fixture modules are absent from production and deployed bundles,
- anonymous calls to every real read, mutation, decision, and artifact route
  remain rejected,
- it cannot initialize real WorkOS, Convex, R2, GitHub, or telemetry clients,
- it is served only by the local development process on a loopback interface,
  and
- fixture actions are inert simulations visibly labelled `Fixture`.

Before a UI change is handed off:

1. inspect the relevant fixture states locally at desktop and mobile widths,
2. commit or otherwise record the exact source revision being validated,
3. at an integrated review checkpoint, deploy that revision with
   `bun run infra:deploy`,
4. record the source commit SHA and Alchemy deployment output,
5. open the returned dev client URL in an authenticated browser,
6. verify the real workflow and Patch Report routes, including keyboard and
   responsive behavior, and
7. record screenshots, candidate identity, deployment URL, and observed
   limitations without capturing secrets or raw diff content in telemetry.

Local fixture evidence is sufficient for intermediate styling iterations.
Authenticated dev deployment is required before handing off an integrated
review slice, changing authentication/data/trust behavior, or claiming an
acceptance row complete. Coordinate use of the shared `dev` stage rather than
deploying every transient edit.

## Diff preview transport contract

The artifact endpoint and renderer must distinguish the complete evidence
artifact from a bounded preview of that artifact. The current client preview
limit is 200,000 bytes; candidate capture separately rejects diffs larger than
10,000,000 bytes. Keep these limits traceable to
[`artifact-storage-response.ts`](../apps/client/src/lib/artifact-storage-response.ts)
and
[`DaytonaSandboxPlugin.ts`](../packages/plugins/src/daytona/DaytonaSandboxPlugin.ts)
rather than duplicating unexplained values in UI code.

The renderer must receive raw diff bytes without PatchPlane-authored sentinel
text. Preview metadata travels separately:

```ts
type CandidateDiffPreview = {
  artifactId: string
  artifactSha256: string
  artifactSizeBytes: number
  returnedBytes: number
  truncated: boolean
  content: string
}
```

`artifactSha256` identifies the complete R2 artifact, not the bounded preview.
When `truncated` is true, the UI must state that only the first
`returnedBytes` of `artifactSizeBytes` are rendered, avoid claiming that every
changed file is visible, and provide the authorized full-artifact action.
Parser, worker, or renderer input must contain only `content`; explanatory copy
belongs outside the diff payload. Identity mismatch, invalid UTF-8, binary
content, unavailable storage, and retention expiry remain distinct fail-closed
states.

### Diff evidence state policy

Every exceptional state uses the shared `Alert` primitive and names the
candidate, affected artifact when one exists, exact reason, and review
consequence. A control is shown only when repeating the same candidate-bound
request can change the outcome.

| Evidence state                                                     | Review consequence                                                                                                                                            | Recovery                                                                          |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Missing candidate reference, metadata, or stored object            | Block the decision because patch contents or identity cannot be established.                                                                                  | Restore the exact evidence or recapture the candidate.                            |
| Artifact identity or preview-metadata mismatch                     | Block the decision and discard the returned content.                                                                                                          | Repair candidate/evidence coherence; never substitute another artifact.           |
| Authentication, metadata service, storage, or bounded-read failure | Block while unavailable.                                                                                                                                      | Reauthenticate when required, or retry the exact artifact for transient failures. |
| Invalid UTF-8, malformed, or empty textual diff                    | Block because trustworthy line and hunk boundaries cannot be established.                                                                                     | Inspect the complete artifact and recapture it in a supported form.               |
| Binary or structurally oversized diff                              | Permit only the domain's explicit, durable evidence-gap rationale after the complete artifact is inspected.                                                   | Use the authorized complete-artifact path; inline retry is not useful.            |
| Truncated bounded preview                                          | Never present the visible prefix as the complete patch; permit only the domain's explicit, durable evidence-gap rationale after complete-artifact inspection. | Show returned and complete byte counts separately from raw diff content.          |

This UI policy does not invent browser-local approval authority. Durable
decision enforcement remains derived from the candidate, evidence, policy, and
human-decision projection.

## Audit findings and improvement tracker

Status values are `Not started`, `Designing`, `In progress`, `Implemented`,
`Verified`, and `Blocked`. `Implemented` means the change has landed but its
acceptance evidence is incomplete. `Verified` requires the stated automated and
authenticated evidence. `Blocked` requires a recorded blocker and owner.

### Current progress snapshot

Updated on 2026-07-27 from the current implementation, focused
regressions, architecture checks, authenticated-dev evidence already recorded
in this tracker, and the passing full verification gate. This snapshot is the
quick status source; the detailed tables and execution ledger below remain the
acceptance source of truth.

| Workstream             | Verified                                                            | Active                                                                                | Implemented, evidence pending         | Not started                          | Next gate                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Core UI/UX             | UX-001–UX-012, UX-014, UX-017, UX-024–UX-026, UX-028–UX-029, UX-033–UX-035 | UX-013 and UX-018 (`In progress`)                                                     | UX-015, UX-021–UX-023, UX-030–UX-032  | UX-016, UX-019–UX-020, UX-027 | Resolve the remaining UX-013 focus-transfer, zoom, and spoken screen-reader evidence.                                                      |
| Diff viewer            | DIFF-001–DIFF-003, DIFF-005, DIFF-007, DIFF-009–DIFF-010            | DIFF-004 and DIFF-006 authenticated evidence; DIFF-008 manual acceptance remains open | DIFF-004, DIFF-006, DIFF-008          | DIFF-012                             | Capture the remaining authenticated screenshots/network waterfall, then complete 200% zoom and manual screen-reader readback for DIFF-008. |
| Changed-file navigator | TREE-001–TREE-003, TREE-005, TREE-007–TREE-009                      | TREE-004 and TREE-006 authenticated browser evidence remains                          | TREE-004, TREE-006, TREE-010–TREE-011 | —                                    | Complete the remaining status visual review, exact return-focus decision, genuine zoom, and spoken screen-reader acceptance.               |

Current technical baseline:

- `@pierre/diffs@1.2.12` and `@pierre/trees@1.0.0-beta.6` are pinned. The
  tree React runtime is lazy-loaded with the rendered Changes workspace. The
  diff React runtime now renders each candidate file in explicit unified mode;
  split mode remains unavailable until it passes its width and accessibility
  gates.
- Candidate diff retrieval, bounded preview metadata, candidate/artifact
  coherence, explicit non-renderable states, and deterministic statistics are
  implemented behind PatchPlane's authenticated same-origin boundary.
- `ParseUnifiedDiffStats` and `ProjectCandidateChangedFiles` are named
  Effect programs. Both use `Match`; expected statistics failures use the typed
  `UnifiedDiffStatsUnavailable` error channel.
- The Changes workspace now combines the candidate-only `@pierre/trees`
  full read-only beta navigator surface with candidate-bound `@pierre/diffs`
  unified rendering. A raw
  bounded preview remains only as the fail-closed fallback when the structured
  file projection and patch records cannot be paired safely.
- The latest full `bun run verify` passes, including 213 client tests, client
  and server production builds, and Cloudflare bundle budgets. The production
  client remains 13.05 MiB total and 2.72 MiB JavaScript gzip, with a 1.33 MiB
  largest raw JavaScript chunk. The server bundle remains 7.47 MiB against its
  7.5 MiB ceiling.

The final column records evidence that the finding exists, not evidence that it
has been closed. Closure evidence, ownership, dependencies, and acceptance
traceability are maintained in the execution ledger below.

| ID     | Priority | Surface                   | Finding                                                                                                                                                                            | Improvement                                                                                                                                                                                                                                                                                                                                                                   | Alpha acceptance criterion                                                                                                                                                                                                                                                                                                                    | Status      | Finding evidence                                                                                                                                                         |
| ------ | -------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| UX-001 | P0       | Workflow queue            | The complete PR body, checklist, and external-review payload are appended to the PR title. One workflow row consumes multiple screens.                                             | Map only the GitHub PR title to the workflow title. Store and render the PR body and external-review payloads separately. Clamp the queue title to one line, with an accessible full-title affordance.                                                                                                                                                                        | The audited workflow row displays only `feat(agent): make local runs discoverable and verifiable`; no PR body or Greptile content appears in its title or accessible name. Ten workflows remain scannable at desktop and mobile widths.                                                                                                       | Verified    | Dev audit and user screenshot, 2026-07-26; workflow `ms76g9ahz6hbsr31xbynkz5pa58b7c68`                                                                                   |
| UX-002 | P0       | Patch Report header       | The complete PR body and external-review payload are appended to the visible page heading, pushing the report tabs below the first viewport.                                       | Use only the GitHub PR title as the report `h1`. Place repository, PR, attempt, verdict, and GitHub action in compact metadata. Keep the PR body in Summary and external-review content in Automated review.                                                                                                                                                                  | The report `h1` and its accessible name contain only the PR title. Tabs and primary verdict are visible without scrolling at a common desktop viewport.                                                                                                                                                                                       | Verified    | Dev audit: summary, changes, evidence, and activity tabs                                                                                                                 |
| UX-003 | P0       | Changes                   | Loading the candidate diff returned `Artifact URL could not be created`.                                                                                                           | Repair authenticated, same-origin artifact preview retrieval before integrating a richer renderer.                                                                                                                                                                                                                                                                            | A reviewer can load the exact non-empty R2-backed diff for a real candidate and its displayed hash matches stored metadata.                                                                                                                                                                                                                   | Verified    | Authenticated dev readback, 2026-07-26; workflow `ms76g9ahz6hbsr31xbynkz5pa58b7c68`                                                                                      |
| UX-004 | P0       | Changes                   | File, addition, and deletion counts display as `Unknown`.                                                                                                                          | Parse and persist deterministic candidate statistics during capture or bounded diff parsing.                                                                                                                                                                                                                                                                                  | A captured textual diff displays accurate file, addition, and deletion counts; unavailable statistics have an explicit reason.                                                                                                                                                                                                                | Verified    | Authenticated dev readback, 2026-07-26; workflow `ms76g9ahz6hbsr31xbynkz5pa58b7c68`                                                                                      |
| UX-005 | P0       | Trust summary             | `Review ready`, `Needs review`, `manual-review`, `No blockers`, and `not configured` compete without a single hierarchy.                                                           | Present one primary trust verdict and a short ordered list of reasons. Keep execution, verification, review, policy, and human decision as separate dimensions.                                                                                                                                                                                                               | A reviewer can explain the current verdict and missing requirement after scanning the first viewport.                                                                                                                                                                                                                                         | Verified    | Dev audit; `SPEC.md` trust-dimension rules                                                                                                                               |
| UX-006 | P1       | Review rail               | The full decision form competes with evidence on every report tab and may encourage a decision before inspection.                                                                  | Show a compact sticky verdict rail. Expand the form only after `Make decision`, `Approve`, `Request changes`, or `Reject` is intentionally selected.                                                                                                                                                                                                                          | Inspection retains the majority of horizontal space; decision prerequisites remain explicit and fail closed.                                                                                                                                                                                                                                  | Verified    | Dev audit: all report tabs                                                                                                                                               |
| UX-007 | P1       | Review rail               | Raw runtime command arguments dominate the decision context.                                                                                                                       | Summarize runtime, model, duration, exit result, and candidate binding. Disclose the full redacted command under technical details.                                                                                                                                                                                                                                           | The default rail contains no long command line and still communicates execution identity.                                                                                                                                                                                                                                                     | Verified    | Dev audit: Review decision                                                                                                                                               |
| UX-008 | P1       | Summary                   | “No blockers” is visually reassuring while required verification is not configured.                                                                                                | Replace reassuring shorthand with precise coverage language such as `0 blocking review findings` and `Required verification not configured`.                                                                                                                                                                                                                                  | Missing or unconfigured verification is never visually presented as a clean patch.                                                                                                                                                                                                                                                            | Verified    | Dev audit; M9.75 acceptance language                                                                                                                                     |
| UX-009 | P1       | Information architecture  | Important inspection tabs appear after a large request payload.                                                                                                                    | Keep the report header and tab bar compact and near the top; render request detail inside Summary.                                                                                                                                                                                                                                                                            | Switching between Summary, Changes, Evidence, and Activity never requires scrolling back through source content.                                                                                                                                                                                                                              | Verified    | Dev audit                                                                                                                                                                |
| UX-010 | P1       | Workflow queue            | Repository, run identity, execution status, and trust status are repeated with weak visual hierarchy.                                                                              | Use a compact row: bounded title, repository/PR/attempt metadata, one execution state, one trust verdict, and updated time.                                                                                                                                                                                                                                                   | Rows have a predictable height and aligned comparison columns.                                                                                                                                                                                                                                                                                | Verified    | Dev audit; Vercel project and preview lists                                                                                                                              |
| UX-011 | P1       | Localization              | `/de` renders predominantly English product copy while only shell controls are localized.                                                                                          | Finish the German application messages or keep the alpha consistently English until translation is complete.                                                                                                                                                                                                                                                                  | A locale does not mix languages within the same operational workflow.                                                                                                                                                                                                                                                                         | Verified    | Dev audit                                                                                                                                                                |
| UX-012 | P1       | Accessibility             | The visible report title was not exposed as useful heading text in the browser accessibility snapshot.                                                                             | Ensure the bounded source title is the accessible `h1`; keep IDs and status badges separately labelled.                                                                                                                                                                                                                                                                       | The report has one descriptive `h1`, a logical heading order, and meaningful link names.                                                                                                                                                                                                                                                      | Verified    | External-browser accessibility snapshot                                                                                                                                  |
| UX-013 | P1       | Accessibility             | The diff viewer has no defined keyboard or screen-reader navigation model.                                                                                                         | Define file navigation, line announcements, focus restoration, expand/collapse behavior, and unified/split mode labels.                                                                                                                                                                                                                                                       | A keyboard-only reviewer can select files, traverse the diff, and return to the file navigator without losing position.                                                                                                                                                                                                                       | In progress | Authenticated keyboard, localized transcript, and mobile checks pass; exact desktop item-focus restoration, genuine 200% browser zoom, and manual spoken readback remain |
| UX-014 | P1       | Mobile                    | The shell collapses, but unbounded titles and source bodies still dominate the mobile report and workflow cards.                                                                   | Apply the same bounded-content hierarchy on mobile. Present the changed-file navigator as a drawer or sheet.                                                                                                                                                                                                                                                                  | The verdict, title, change size, and Changes action fit in the initial mobile flow without horizontal scrolling.                                                                                                                                                                                                                              | Verified    | Authenticated responsive audit at 390 × 844, 2026-07-27                                                                                                                  |
| UX-015 | P1       | Diff states               | Binary, oversized, unavailable, malformed, and truncated diff states are not designed as first-class review evidence.                                                              | Define explicit state components and whether each state blocks or permits a decision with override.                                                                                                                                                                                                                                                                           | Every non-renderable state identifies the affected file/artifact, reason, candidate identity, and decision consequence.                                                                                                                                                                                                                       | Implemented | Spec fail-closed requirements                                                                                                                                            |
| UX-016 | P1       | Diff identity             | Candidate and artifact identifiers exist but are visually disconnected from the rendered diff.                                                                                     | Place a compact evidence identity strip beside the diff controls with copy actions and a provenance link.                                                                                                                                                                                                                                                                     | The reviewer can verify candidate digest, base/head state, artifact SHA-256, and truncation status without leaving Changes.                                                                                                                                                                                                                   | Not started | Dev audit: Candidate identity                                                                                                                                            |
| UX-017 | P1       | Security/privacy          | Raw source and diff content must not enter analytics while richer UI interactions are added.                                                                                       | Emit only bounded interaction metadata: mode, file count bucket, load outcome, and timing. Never emit code, paths by default, or diff lines.                                                                                                                                                                                                                                  | Telemetry tests prove that diff content and raw paths are absent from analytics and error payloads.                                                                                                                                                                                                                                           | Verified    | Browser Sentry transport sentinels and analytics architecture boundaries, 2026-07-27                                                                                     |
| UX-018 | P2       | Surface hierarchy         | Cards and borders surround nearly every concept, giving all content equal weight.                                                                                                  | Use sections, dividers, aligned rows, and whitespace. Reserve cards for bounded interactive objects.                                                                                                                                                                                                                                                                          | Removing a decorative card does not remove semantic grouping or interaction affordance.                                                                                                                                                                                                                                                       | In progress | Semantic-region and retained-card regressions pass; authenticated desktop visual acceptance remains                                                                      |
| UX-019 | P2       | Sidebar                   | A wide persistent sidebar primarily contains one product destination.                                                                                                              | Collapse it by default on the Patch Report or adopt a compact shell until more destinations justify the width.                                                                                                                                                                                                                                                                | Desktop review gives the diff enough width for useful unified rendering and optional split rendering.                                                                                                                                                                                                                                         | Not started | Dev audit                                                                                                                                                                |
| UX-020 | P2       | Internal identity         | Workspace, user, candidate, and run IDs compete with repository and PR context.                                                                                                    | Keep copyable IDs in secondary metadata or technical details.                                                                                                                                                                                                                                                                                                                 | Internal IDs remain available without becoming primary page labels.                                                                                                                                                                                                                                                                           | Not started | Dev audit                                                                                                                                                                |
| UX-021 | P2       | Loading                   | A full report-shaped loading transition is not defined and direct tab navigation briefly exposes an empty main region.                                                             | Add stable report-header and tab-panel skeletons while preserving layout.                                                                                                                                                                                                                                                                                                     | Direct links to every report tab announce loading and do not flash an empty report.                                                                                                                                                                                                                                                           | Implemented | Four-tab loading-shell regressions and authenticated direct-tab final-state audit pass; observable transition readback remains                                           |
| UX-022 | P2       | Empty/error recovery      | Artifact errors provide a message but little recovery guidance.                                                                                                                    | Distinguish retryable access errors, missing artifacts, retention expiry, authorization failure, and integrity mismatch.                                                                                                                                                                                                                                                      | Errors offer the correct next action without implying that missing evidence passed.                                                                                                                                                                                                                                                           | Implemented | Typed route/storage contract and localized artifact-error state-matrix regressions; authenticated exceptional-state fixtures remain                                      |
| UX-023 | P2       | Interaction feedback      | Reloading, file selection, view-mode changes, and navigation position have no shared persistence model.                                                                            | Preserve selected file, unified/split preference, expanded workspace, and semantic scroll target in bounded URL or local UI state.                                                                                                                                                                                                                                            | Back/forward navigation restores the selected report tab and changed file without storing code or raw paths.                                                                                                                                                                                                                                  | Implemented | Authenticated one-file reload/back/forward acceptance passes; authenticated multi-file selection history remains                                                         |
| UX-024 | P2       | Visual language           | Amber is used for primary actions and caution/trust states, weakening semantic distinction.                                                                                        | Reserve a clear action accent and use status colors only for trust meaning; never rely on color alone.                                                                                                                                                                                                                                                                        | Primary action, warning, failure, success, and neutral states are distinguishable by text, shape, and color.                                                                                                                                                                                                                                  | Verified    | Semantic variants, contrast/non-color regressions, full gate, and authenticated light/dark queue and Patch Report acceptance, 2026-07-27                                 |
| UX-025 | P0       | Summary                   | The GitHub PR body is displayed as an unformatted text/code-like payload, exposing Markdown syntax instead of a readable request summary.                                          | Render the separately stored PR body as sanitized GitHub-flavored Markdown in Summary. Preserve lists, task lists, tables, links, blockquotes, and code while disabling raw HTML and executable embeds.                                                                                                                                                                       | The audited PR body renders with readable sections and checklist items; Markdown source markers and provider HTML are not shown as the title, and unsafe HTML cannot execute.                                                                                                                                                                 | Verified    | Sanitization/GFM regressions, full gate, and authenticated German dev-stage Summary readback, 2026-07-27                                                                 |
| UX-026 | P1       | Design system             | Feature work could introduce bespoke visual primitives and drift from the existing client UI system.                                                                               | Build review surfaces from `apps/client/src/components/ui`; allow custom feature components only when they compose those primitives with domain behavior. Treat Pierre packages as specialized renderers behind local feature adapters.                                                                                                                                       | The implementation adds no feature-local substitute for an available UI primitive. Any genuinely missing primitive is added to the shared UI system and any exception has documented rationale and accessibility evidence.                                                                                                                    | Verified    | Shared-component inventory, architecture gate, full verification, and authenticated German queue/report/evidence audit, 2026-07-27                                       |
| UX-027 | P1       | Visual validation         | The review UI lacks a documented fast local inspection path that remains distinct from authenticated integration testing.                                                          | Add a fixture-only local harness that initializes no remote product services, then validate integrated candidates through an authenticated `--stage dev` deployment. Never add or weaken an authentication path.                                                                                                                                                              | Local fixture modules are absent from deployed bundles; anonymous real routes remain rejected; integrated UI changes have local desktop/mobile evidence and authenticated dev-stage evidence tied to a recorded source revision.                                                                                                              | Not started | Product constraint; `package.json` `infra:deploy`; `alchemy.run.ts`                                                                                                      |
| UX-028 | P0       | Candidate coherence       | The diff experience does not define what happens when evidence is stale, mutated, candidate-mismatched, or superseded by a newer attempt while the report is open.                 | Pin the viewer to the selected attempt and candidate. Show a blocking coherence state and an explicit link to the newer attempt; never silently replace the reviewed candidate or reuse another candidate's evidence.                                                                                                                                                         | Stale, mutated, mismatched, and superseded fixtures fail closed; the displayed attempt, candidate digest, diff artifact, review, policy, and decision remain coherent, and navigation to a newer attempt is intentional.                                                                                                                      | Verified | Automated identity-state matrix, Convex lineage/decision regressions, full gate, and authenticated coherent-report dev readback, 2026-07-27 |
| UX-029 | P1       | Patch Report layout       | At laptop viewport heights, the tall sticky review rail ends flush against the bottom edge even though the report content declares responsive bottom padding.                      | Let the report content flex item grow to its contents so its existing bottom padding contributes to the scroll extent; keep spacing at the page-layout boundary rather than adding margin to the review component.                                                                                                                                                            | At the true scroll end, the report and review rail retain a 40px mobile or 48px desktop bottom gutter without reducing the evidence workspace or introducing nested scrolling.                                                                                                                                                                | Verified    | User screenshot and authenticated 1512 × 778 dev audit, 2026-07-26                                                                                                       |
| UX-030 | P1       | Activity                  | The vertical provenance timeline gives long event summaries and commands unbounded space, making event-to-event comparison slow.                                                   | Present activity as a compact chronological table with bounded event, stage, status, and time columns. Keep full summaries and technical metadata in independently collapsible detail rows.                                                                                                                                                                                   | Activity remains scannable with long commands, every row exposes an accessible details toggle, collapsed details are absent from navigation, and expanding a row preserves the table structure.                                                                                                                                               | Implemented | Product direction, 2026-07-26; component regression                                                                                                                      |
| UX-031 | P1       | Evidence logs/diagnostics | Runtime event JSON, stdout, stderr, and the complete normalized read model render as large raw blocks, preventing comparison and forcing reviewers to scan data they may not need. | Present runtime events and every captured stdout/stderr stream as compact, fixed-layout tables. Group normalized diagnostics by read-model collection. Reveal raw payloads only in independently collapsible rows with a copy action.                                                                                                                                         | Long commands and payloads neither determine panel width nor introduce horizontal scrolling; the disclosure control stays visible; all executions remain reachable; expanded raw data remains copyable and keyboard accessible.                                                                                                               | Implemented | Product direction and responsive-width correction, 2026-07-26; component regression                                                                                      |
| UX-032 | P1       | Application shell         | The sidebar declares icon-collapse support but desktop pages expose only its narrow resize rail, leaving the state difficult to discover and control.                              | Expose the existing `SidebarTrigger` in the desktop shell header and keep every icon-only destination identifiable through an accessible name and collapsed-state tooltip.                                                                                                                                                                                                    | The visible trigger switches the desktop sidebar between full and icon-only widths, reports its state with `aria-expanded`, preserves the provider-managed preference, and leaves mobile off-canvas navigation unchanged.                                                                                                                     | Implemented | Product direction, 2026-07-26; shadcn sidebar contract and component regression                                                                                          |
| UX-033 | P1       | Deployment freshness      | A long-lived browser tab can continue running an obsolete client after a new Worker deployment, leaving users unaware that a newer interface and code bundle are available.        | Bind each deployment to Cloudflare Version Metadata, expose the active version through a same-origin non-cacheable endpoint, and compare it with the version captured at page load. Show a persistent localized Sonner notification with an explicit reload action when they differ. Guard Vite preload failures with a one-time reload rather than permitting a reload loop. | A tab loaded on version A detects version B on window focus or within five visible minutes, displays localized English or German update copy, and reloads only after explicit user action. Reload preserves the complete route and clears the notification after version B is adopted. Version responses cannot be served from an HTTP cache. | Verified    | Automated English/German regressions and authenticated German dev-stage version transition, 2026-07-27                                                                   |
| UX-034 | P1       | Sidebar session action    | The authenticated sidebar footer labels the sign-out action as `Demo`, obscuring a destructive session boundary and rendering incorrect copy in both locales.                      | Label the existing session action with the localized sign-out message in its visible text, accessible name, and icon-collapse tooltip. Do not alter its authentication behavior.                                                                                                                                                                                              | The English sidebar displays `Logout`, the German sidebar displays `Abmelden`, and the collapsed action remains identifiable without activating the sign-out flow during acceptance.                                                                                                                                                          | Verified    | Component/localization regressions and authenticated English/German dev-stage visual acceptance without activating sign-out, 2026-07-27                                  |
| UX-035 | P2       | Theme preference          | Switching between light and dark themes briefly paints the previous palette before the selected theme takes effect, creating a visible flash.                                      | Establish one owner for the root theme class, apply the selected theme before paint, and prevent stale loader data from reconciling the previous class during server persistence. Respect `prefers-reduced-motion` and preserve persisted/system-theme behavior.                                                                                                              | Light-to-dark and dark-to-light changes never restore the previous root class between selection and persistence; reload starts in the persisted palette without a pre-hydration flash; reduced-motion users receive no animated transition.                                                                                                   | Verified    | Bidirectional authenticated class/color traces, persisted reload, bootstrap/state regressions, and full gate, 2026-07-27                                                 |

### Execution and closure ledger

Owners are accountable roles, not authorization to begin work. A row becomes
`Verified` only after its closure evidence is linked here.

| ID     | Owner                     | Depends on                                                                          | Acceptance reference                                                                                                   | Closure evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------ | ------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UX-001 | Intake + Client           | Source field separation                                                             | M9.5 component test and authenticated workflow readback                                                                | Core intake mapping, legacy fallback, visual-title, and accessible-name regression tests pass; `bun run verify` passes. Authenticated dev readback on 2026-07-26 confirmed the title-only queue and accessible name at desktop and 390 × 844 for workflow `ms76g9ahz6hbsr31xbynkz5pa58b7c68`. Deployed from HEAD `7ea35d93cc9ec9e5e307750664cfc33875342a5e` plus implementation diff SHA-256 `97f6999187829fc2fdaa7fb215e405dd91cc071f10cd24a3823559aef0ad9fd8`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| UX-002 | Intake + Client           | UX-001                                                                              | M9.5/M9.75 component test and authenticated report readback                                                            | Title-only `h1`, bounded header, source metadata, and body-separation regression pass; `bun run verify` passes. Authenticated dev readback on 2026-07-26 confirmed the title-only accessible `h1`, repository/PR/attempt context, status, trust verdict, GitHub action, tabs, and primary verdict at desktop and 390 × 844 for workflow `ms76g9ahz6hbsr31xbynkz5pa58b7c68`. Deployed from HEAD `7ea35d93cc9ec9e5e307750664cfc33875342a5e` plus tracked diff SHA-256 `c9d0c3df3d32fda9d7ffd386e702e022bcc26c02c8136ec5b68873972478d5d1`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| UX-003 | Client + Artifacts        | Artifact route merged on `main`                                                     | M9.75 R2 readback and authenticated Changes-tab hash check                                                             | Authenticated dev readback on 2026-07-26 loaded the exact non-empty 1,322-byte R2 diff for workflow `ms76g9ahz6hbsr31xbynkz5pa58b7c68`, candidate `qh7ee30m4mwqjmxzwv9tq8r0618b6d30`, and artifact `qn75ktghwvzdmecd7658ndr2wh8b7m1k`; the displayed SHA-256 was `99c65c98da25b7fed436126c485410264ba83153028ceb6eff4b10e1556110aa`. The Evidence action accepted the authenticated candidate-bound, same-origin URL and attempted the attachment navigation; Brave then blocked the download with `ERR_BLOCKED_BY_CLIENT`, outside Patchplane's URL-creation path. URL-boundary regressions and `bun run verify` pass. Deployed from HEAD `7ea35d93cc9ec9e5e307750664cfc33875342a5e` plus tracked diff SHA-256 `73532f5a30a563812190f6527d722db5df5c11208cf9a36b7aa99e1adc0b5aa7`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| UX-004 | Core + Client             | Structured diff parsing                                                             | Candidate statistics regression test and authenticated report readback                                                 | Bounded unified-diff parsing now validates complete hunk ranges and records deterministic `filesChanged`, `additions`, and `deletions` on both sandbox candidate-capture paths. The authenticated artifact preview exposes only bounded numeric statistics metadata to support historical candidates; binary, empty, malformed, oversized, truncated, missing, and retrieval-failure paths retain explicit unavailable reasons. Core/client regressions and `bun run verify` pass. Authenticated dev readback on 2026-07-26 displayed `1` file, `+2` additions, and `-2` deletions for the exact 1,322-byte diff on workflow `ms76g9ahz6hbsr31xbynkz5pa58b7c68`, candidate `qh7ee30m4mwqjmxzwv9tq8r0618b6d30`, artifact `qn75ktghwvzdmecd7658ndr2wh8b7m1k`, and SHA-256 `99c65c98da25b7fed436126c485410264ba83153028ceb6eff4b10e1556110aa`. Deployed from HEAD `7ea35d93cc9ec9e5e307750664cfc33875342a5e` with UX-004 source SHA-256 `c75fb5e968bc518d3a67fe72967306bc9ba6a00a3efadef86003f637ff6452f9`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| UX-005 | Domain + Client           | Coherent Patch Report projection                                                    | M9.75 trust-dimension component tests and dogfood explanation check                                                    | A shared trust-summary model now drives the Summary and review rail with one primary verdict, at most three ordered reasons, and separate Execution, Required verification, Automated review, Policy, and Human decision dimensions. It fails closed when verification or trust records are truncated and replaces ambiguous `Review ready`, raw `manual-review`, and reassuring `No blockers` copy with `Run complete`, `Manual review`, and exact blocking-finding coverage. Model, review-panel, and full Patch Report regressions pass; `bun run verify` passes within the existing 762 KiB client JavaScript budget. Authenticated dev readback on 2026-07-26 confirmed the audited workflow's first viewport explains `Needs review` with `Required verification is not configured`, `Policy requires human review`, and `Human decision is pending`; the identical explanation remained in the Changes-tab review rail. Deployed from HEAD `7ea35d93cc9ec9e5e307750664cfc33875342a5e` with UX-005 source SHA-256 `6eead981b76c8be549e030da2bb07b435c3d3069350d225083f2e8cf67ee5c10`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| UX-006 | Client                    | UX-005                                                                              | M10 decision component and keyboard tests                                                                              | The sticky review rail now defaults to verdict evidence and three deliberate action choices; comment and verification-override fields are absent until the reviewer selects an action. Selection moves focus into the required comment, exposes a separate disabled confirmation action, and preserves all projection, policy, verification, comment, and override gates. Cancel clears unsent input, collapses the form, and restores focus to the initiating action. Component and full Patch Report regressions cover all three decisions, fail-closed policy/truncation states, keyboard focus, cancellation, idempotent retries, and the absence of the form before intent; `bun run verify` passes with 102 client tests and within the existing 762 KiB client JavaScript budget. Authenticated dev readback on 2026-07-26 confirmed the compact Changes-tab rail retains the majority of horizontal space, Request changes opens a focused rationale form, Cancel restores the compact state and initiating-action focus, and Approve exposes both required comment and verification-override reason with confirmation disabled. No decision was submitted during verification. Deployed from HEAD `7ea35d93cc9ec9e5e307750664cfc33875342a5e` with UX-006 source SHA-256 `df0f0fb78e2f073bb2110f0ab59a12bf58e30bd9b78107e1ea5c584db331d6a4`.                                                                                                                                                                                                                                                                                                                                   |
| UX-007 | Client + Convex           | Redacted runtime summary contract                                                   | Component disclosure tests, authenticated projection redaction test, full gate, and authenticated dev readback         | The review rail now defaults to a compact execution identity with provider, actual runtime model, duration, exit result, and exact candidate binding. The raw command is absent from the default view and is available only through the shared Collapsible/Button technical-details disclosure. The authenticated Convex detail projection extracts the runtime model before returning a bounded 1,000-character command preview, redacts token, secret, password, API-key, and bearer credential shapes, and therefore does not serialize the raw command to the browser. Component tests cover default/disclosed states; Convex tests cover model extraction, credential redaction, and the preview cap. `bun run verify` passes with 110 client tests and a 728 KiB / 762 KiB client JavaScript budget. Authenticated dev readback on 2026-07-26 confirmed `Provider daytona:pi · Model gpt-5.5 · Duration 48s · Exit 0`, candidate `qh7ee30m4mwqjmxzwv9tq8r0618b6d30`, no command in the default rail, and a 267-character disclosed command with `<prompt redacted>`. Deployed to the dev Worker and Convex development deployment from HEAD `bfee74ac204661ce7e65b45c14786ae861b5e18b` with UX-007 source SHA-256 `5afcbb9021fbb1825f1de52fca86dbf5354aef2d1a027a92b3ec38dfa9e1b004`.                                                                                                                                                                                                                                                                                                                                                                                            |
| UX-008 | Domain + Client           | UX-005                                                                              | M9.75 incomplete-verification UI regression test                                                                       | The Summary now treats automated-review findings and required-verification coverage as separate facts. A completed review with zero blocking findings uses a neutral tone, while missing, incomplete, or truncated verification remains an explicit warning. The Automated verdict section renders `Automated review · Completed`, `0 blocking review findings.`, and `Required verification · Not configured` with the override consequence; it no longer renders persisted reassuring policy copy or internal reasons such as `review:clean`. Manual-review policy detail is normalized against current verification coverage throughout Summary and the review rail. The alpha policy’s verified path now names both facts precisely instead of calling a patch clean. Domain and client regressions cover the verified and unconfigured cases; `bun run verify` passes with 54 core tests, 111 client tests, and a 728 KiB / 762 KiB client JavaScript budget. Authenticated dev readback on 2026-07-26 confirmed the audited workflow shows the unconfigured-verification warning beside the exact zero-finding count and contains neither `found no blocking automated findings` nor `review:clean`. Deployed to the dev Client and Source Control Worker from HEAD `bfee74ac204661ce7e65b45c14786ae861b5e18b` with UX-008 source SHA-256 `795e2a797f1ead5107b0326ae9b5204b5de48e64c00e4ede1b48b440f9b1657b`.                                                                                                                                                                                                                                                                    |
| UX-009 | Client                    | UX-001, UX-002                                                                      | M9.5 desktop browser acceptance                                                                                        | The bounded report header now scrolls normally while the shared `TabsList` remains pinned at the top of the report viewport with an opaque, bordered backdrop. The long original request remains inside Summary after the tab list in document order. Every deliberate tab change aligns a stable zero-height anchor only after controlled URL navigation completes, so shorter destinations open at their start rather than inheriting a deep Summary offset; the compact review rail uses the same top alignment. Component regressions cover shared Tabs composition, sticky navigation, request placement, and post-navigation restoration. `bun run verify` passes with 111 client tests and a 729 KiB / 762 KiB client JavaScript budget. Authenticated dev readback on 2026-07-26 scrolled 1,400 px into the audited workflow Summary and confirmed Summary, Changes, Evidence, and Activity remained reachable; Changes opened with `Change summary`, Evidence with `Artifacts`, and Activity with `Provenance timeline` at the panel start without back-scrolling. Deployed to the dev Client from HEAD `bfee74ac204661ce7e65b45c14786ae861b5e18b` with UX-009 source SHA-256 `ef4a2f906d060f3b82ece5a90e234d4e4009b3c47d71cf69b038cab325d4433a`.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| UX-010 | Client + Convex           | UX-001                                                                              | M9.5 queue component and browser acceptance                                                                            | The workflow queue now uses four aligned comparison columns: bounded one-line title plus repository/PR/attempt context, one execution state, one trust verdict, and semantic updated time. Visible internal run IDs, the redundant trust marker, and duplicate Source and Last event columns were removed while the full row remains a keyboard-accessible link with a descriptive accessible name. The bounded Convex projection derives `updatedAt` from the latest execution, candidate, review, policy, or decision already loaded for each row, with workflow creation as its fallback. Model, component, and projection regressions pass; `bun run verify` passes with 112 client tests and a 728 KiB / 762 KiB client JavaScript budget. Authenticated dev readback on 2026-07-26 confirmed compact, consistently aligned two-line rows for all ten workflows, including `feat(agent): make local runs discoverable and verifiable`, `okikeSolutions/guerillaglass · PR #128 · Attempt 1`, `Run complete`, `Needs review`, and `gestern`; Source and Last event no longer appear as columns. Deployed to the dev Client and Convex development deployment from HEAD `bfee74ac204661ce7e65b45c14786ae861b5e18b` with UX-010 source SHA-256 `0c333eb20ad004fc8b690589744b1a5a6d07ffbf99ee67222ac576fa7ada5244`.                                                                                                                                                                                                                                                                                                                                                                   |
| UX-011 | Client                    | Stable alpha locale decision                                                        | Message-catalog parity and browser locale test                                                                         | The authenticated alpha control plane now has one explicit application language: English. A shared app-language contract pins operational Paraglide messages, relative-time labels, and absolute date formatting to English; app documents declare `lang="en"` even when reached through a previously shared `/de/app` URL. The in-app locale switcher was removed so it no longer advertises a partial German product mode, while the bilingual public landing surface and its locale control remain unchanged. App-language, signed-out, workflow model, form, and sidebar regressions pass; `bun run verify` passes with 114 client tests and a 728 KiB / 762 KiB client JavaScript budget. Authenticated dev readback on 2026-07-26 confirmed `/de/app` and the audited workflow Summary render English-only operational controls and dates, expose no locale control, contain no German shell copy, and report document language `en`. Deployed to the dev Client from HEAD `bfee74ac204661ce7e65b45c14786ae861b5e18b` with UX-011 source SHA-256 `8f3e932bbf04b19f8b079415a66bebd982536e84e356e898298b13840fa6a166`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| UX-012 | Client                    | UX-002                                                                              | Accessibility tree and heading-order test                                                                              | The bounded GitHub PR title is the Patch Report's single `h1` and now names the report banner through `aria-labelledby`. The visually secondary internal run ID and trust verdict retain their compact presentation but receive separate screen-reader context, while existing back-navigation and GitHub actions keep explicit destination names. A cross-tab component regression renders Summary, Changes, Evidence, and Activity and fails on multiple level-one headings, skipped heading levels, or unnamed links. `bun run verify` passes with 115 client tests and a 728 KiB / 762 KiB client JavaScript budget. Authenticated dev accessibility readback on 2026-07-26 confirmed the audited workflow exposes exactly one `feat(agent): make local runs discoverable and verifiable` level-one heading on every report tab; the observed outlines were `1,2,2,2,2,2` on Summary, `1,2,2,2,2` on Changes, `1,2,2` on Evidence, and `1,2,2,2` on Activity, with zero skipped levels and zero unnamed main-content links. The tree separately announced `Workflow run ID:` and `Trust status:`. Deployed to the dev Client from HEAD `bfee74ac204661ce7e65b45c14786ae861b5e18b` with UX-012 source SHA-256 `cd5b70ecb56b64be9292cf62df0f690311cccb08993f5fe4e6a406bfd3a303ce`.                                                                                                                                                                                                                                                                                                                                                                                                   |
| UX-013 | Client                    | DIFF-004, DIFF-008, TREE-003, TREE-006                                              | Keyboard and screen-reader acceptance                                                                                  | Authenticated acceptance on 2026-07-27 confirmed the complete folder/file arrow-key map, selected-state announcements, named changed-file and diff landmarks, structured hunk ranges, added/deleted/unchanged line semantics, and no per-line tab stops. At 390 × 844 the changed-file sheet moved focus inside, dismissal restored the exact trigger, and the document remained 390px wide with no horizontal overflow. A 756 × 389 CSS-viewport reflow check—the layout width corresponding to the audited 1512 × 778 viewport at 200%—also had no horizontal overflow, but it is not recorded as genuine browser zoom. The desktop `Back to changed files` action safely restores the navigator heading and preserves the selected roving tree item; exact DOM focus cannot be transferred to that item through the current public `@pierre/trees@1.0.0-beta.6` API. Reaching through Pierre's shadow root is prohibited by the architecture gate and TREE-010. UX-013 therefore remains `In progress` pending a public upstream focus-transfer API or an approved contract change, a genuine 200% browser-zoom pass, and manual spoken screen-reader readback of at least one added, deleted, and unchanged line.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| UX-014 | Client                    | UX-001, UX-002, UX-004, TREE-007                                                    | Responsive-web acceptance at 390 × 844                                                                                 | The compact report header includes a `Changes` action beside the trust verdict and exposes persisted file, addition, and deletion counts in visible and explicit screen-reader language; candidates without persisted statistics retain an honest size-unavailable fallback. The unbounded original request is collapsed behind the shared `Collapsible` and `Button` primitives by default, remains intentionally available, and wraps unbroken content safely. Component regressions cover the title, count label, disclosure semantics, request absence before expansion, and direct Changes navigation. Authenticated dev acceptance on 2026-07-27 at an exact 390 × 844 viewport confirmed: the bounded two-line title, verdict, and 44-pixel Changes/GitHub actions fit before the tab bar; the document stayed exactly 390 pixels wide with zero horizontal overflow before and after expanding the long original request; all ten workflow rows remained a consistent 93 pixels tall, including the longest source title; Summary, Changes, Evidence, and Activity plus the stacked review rail stayed within the viewport width; Changes loaded the exact `1` file, `+2` additions, and `-2` deletions; and the candidate-only changed-file sheet moved focus into the tree, occupied 293 × 844 pixels while retaining visible dismiss context, then restored focus to the exact `Browse 1 changed files` trigger. The existing TREE-007 responsive drawer evidence and component regressions cover the persisted-statistics presentation branch, while the authenticated historical candidate truthfully exercised its unavailable fallback. UX-014 is `Verified`.           |
| UX-015 | Domain + Client           | Structured preview and diff-state contracts                                         | M9.75 fail-closed state-matrix tests                                                                                   | The artifact route now returns stable error codes and identity-bound preview metadata while keeping PatchPlane explanatory copy out of raw diff bytes. The Changes UI composes the shared `Alert`, `Button`, `Card`, and `ScrollArea` primitives into explicit missing-reference, missing-metadata/object, authentication, storage, binary, invalid-text, malformed, empty, oversized, truncated, and identity-mismatch states. Each state names the candidate, artifact when available, reason, decision consequence, and only a useful recovery action; mismatched content is discarded. Focused storage and component regressions cover binary, invalid UTF-8, malformed, truncated, temporary failure, and identity-mismatch paths; `bun run verify` passes with the client at 730 KiB / 762 KiB. Authenticated dev readback on 2026-07-26 loaded the exact raw diff for workflow `ms76g9ahz6hbsr31xbynkz5pa58b7c68`, candidate `qh7ee30m4mwqjmxzwv9tq8r0618b6d30`, artifact `qn75ktghwvzdmecd7658ndr2wh8b7m1k`, and SHA-256 `99c65c98da25b7fed436126c485410264ba83153028ceb6eff4b10e1556110aa`; identity metadata passed, the old truncation sentinel was absent, and statistics remained `1`, `+2`, `-2`. Deployed from HEAD `bfee74ac204661ce7e65b45c14786ae861b5e18b` with UX-015 implementation SHA-256 `f2c0da7f21344b3a81ddf74d7e9913a2ba0453785a58d8d5ed2e4f600da65e79`. Authenticated exceptional-state fixture evidence remains pending, so this row is not yet `Verified`.                                                                                                                                                                                              |
| UX-016 | Client                    | DIFF-002, DIFF-003                                                                  | Candidate/artifact identity component and browser tests                                                                | Pending                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| UX-017 | Client + Telemetry        | DIFF-010                                                                            | Sentinel-content transport tests                                                                                       | Browser transport coverage now injects independent synthetic credentials, a standalone source excerpt, a complete unified diff body, and a repository path into breadcrumbs, allowlisted URL attributes, logs, metrics, spans, explicit events, stack frames, request URLs, event extras, and the same `captureException` route-error path used by the client router. Assertions inspect the serialized SDK envelopes and independently prove that source, diff, raw path, path segment, filename, and credential sentinels never cross the transport boundary while normalized `/:path` metadata remains. The client-instrumentation regression separately proves every browser Sentry payload hook uses the shared deny-by-default sanitizer. Architecture checks now keep PostHog and other analytics SDKs behind plugin boundaries and fail if candidate-diff source imports telemetry/analytics services or calls capture/track APIs directly. No product-analytics provider is currently installed, so the diff viewer emits no analytics event rather than fabricating a path-bearing event. The telemetry data policy explicitly classifies repository/file paths and source excerpts as prohibited content. Focused browser-transport and architecture suites pass with 25 tests. UX-017 and DIFF-010 are `Verified`.                                                                                                                                                                                                                                                                                                                                                         |
| UX-018 | Product Design + Client   | Compact report composition                                                          | Desktop visual review                                                                                                  | Summary trust dimensions, automated verdict, findings, and decision/publication records now use named semantic sections, aligned records, whitespace, and the shared `Separator` primitive instead of nested decorative cards. Changes statistics and candidate identity use the same hierarchy with responsive horizontal/vertical separators. Cards remain only around the bounded prompt disclosure, interactive diff workspace, and review decision rail. Component regressions prove the five primary read-only groups remain named regions while each audited content surface contains only its intended interactive card; the page retains a single banner landmark. Focused suites pass with 34 tests, and the full `bun run verify` gate passes with 150 client tests, 69 architecture/automation tests, production builds, and the existing 7.27 MiB server / 12.92 MiB client Cloudflare budgets. The verified source was deployed to `--stage dev` on 2026-07-27. The fresh in-app browser session redirected to WorkOS, so authenticated desktop visual acceptance remains pending and UX-018 stays `In progress`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| UX-019 | Product Design + Client   | Responsive report composition                                                       | Desktop width and diff readability review                                                                              | Pending                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| UX-020 | Product Design + Client   | UX-002, UX-016                                                                      | Metadata hierarchy component review                                                                                    | Pending                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| UX-021 | Client                    | Fixture harness                                                                     | Direct-tab loading and announcement tests                                                                              | Both the route-level authentication transition and the undefined Convex report query now render one shared Patch Report-shaped skeleton instead of the workflow-queue placeholder or generic bars. It preserves the bounded report header, line-tab strip, selected Summary/Changes/Evidence/Activity panel geometry, two-column workspace, and review rail without exposing fake interactive controls. The placeholder geometry is hidden from assistive technology while one localized polite busy region announces the report load in English or German. Five focused regressions cover every direct-tab shape, announcement and non-interactive contract, plus the undefined-query integration; the focused client selection passes 15 tests. The full `bun run verify` gate passes with 155 client tests, 69 architecture/automation tests, production builds, and the 7.29 MiB server / 12.93 MiB client Cloudflare budgets. The verified source was deployed to `--stage dev` on 2026-07-27. An authenticated browser audit then loaded direct Summary, Changes, Evidence, and Activity URLs; each selected the correct localized primary tab and produced a non-empty Patch Report main region. The transition completed too quickly to capture its intermediate skeleton reliably without artificial throttling, so observable visual-transition and spoken screen-reader acceptance remain pending and UX-021 stays `Implemented`, not yet `Verified`.                                                                                                                                                                                                                       |
| UX-022 | Client + Artifacts        | Structured artifact error contract                                                  | Artifact error state-matrix tests                                                                                      | Artifact retrieval now preserves a bounded, typed failure contract across metadata authorization and R2 storage: authentication is `401`, authorization is `403`, an unexpectedly missing object is `404`, retention expiry is `410`, integrity mismatch is `409`, and temporary metadata/read/storage failures remain retryable `502`/`503` responses. Expiry is derived from Patchplane-owned artifact `createdAt` and the durable `retentionPolicy`; a missing object before that boundary is not mislabeled as expired. The Changes surface maps every failure to fully localized English and German title, reason, consequence, and recovery guidance using the existing `Alert` and `Button` primitives. Only temporary failures expose Retry, authentication exposes Reload sign-in, and authorization, expiry, missing evidence, and integrity failures expose no misleading retry action or passed state. The route uses the browser-safe managed Effect runtime and classifies expected Convex authentication/authorization failures without exposing their raw messages. Focused storage, classifier, and component regressions pass 35 tests, and the full `bun run verify` gate passes with 168 client tests, 69 architecture/automation tests, production builds, and 7.33 MiB server / 12.94 MiB client Cloudflare bundles. Authenticated exceptional-state fixtures remain pending, so UX-022 is `Implemented`, not yet `Verified`.                                                                                                                                                                                                                                    |
| UX-023 | Client                    | File identity and navigation contract                                               | URL/history and component regressions                                                                                  | Selected file is stored only as a bounded candidate-relative index; raw paths and invalid values are rejected. Report tabs, unified/split preference, and expanded diff focus use typed TanStack Router search state and push browser history. Controlled file changes restore the semantic file section rather than a pixel offset. Split rendering is available only in the expanded desktop workspace; the report and mobile surfaces stay unified while retaining the preference. The implementation composes the existing ToggleGroup and Pierre public diffStyle surface. Focused suites pass 49 tests and the full gate passes with 179 client tests, 69 architecture/automation tests, production builds, and 7.35 MiB server / 12.95 MiB client budgets. Authenticated dev-stage acceptance on 2026-07-27 verified that reload preserves `file=0`, `diff=split`, `focus=diff`, the selected tree item, and the localized split document. Browser Back restored expanded unified mode and then the report workspace; Forward restored expanded unified and then split mode. No browser console errors were recorded. The available live candidate contains one changed file, so authenticated multi-file selection history remains pending and UX-023 stays Implemented, not Verified.                                                                                                                                                                                                                                                                                                                                                                                         |
| UX-024 | Product Design + Client   | Shared Badge and Alert variants                                                     | Contrast, non-color state, component, and authenticated visual tests                                                   | Brand orange is now reserved for primary actions. Shared success and warning tokens were added for both themes and exposed through the existing Badge and Alert primitives; destructive and neutral variants remain distinct. Workflow trust badges, report verdicts, verification warnings, partial-diff states, success feedback, and sandbox outcomes now consume semantic variants instead of feature-local primary-color overrides. Every state retains a text label and relevant icon, so meaning does not depend on color. Light and dark contrast tests cover success and warning tints, status regressions prove needs-review and changes-requested never use `bg-primary`, and 53 focused tests pass. The full gate passes with 188 client tests, 69 architecture/automation tests, production builds, and 7.35 MiB server / 12.95 MiB client budgets. The source was deployed to `--stage dev` on 2026-07-27. Authenticated dev-stage acceptance on 2026-07-27 verified the workflow queue and Patch Report in both light and dark themes. The primary New workflow/Approve actions retained the brand orange; Review required badges and verdicts used the distinct warning palette; Run completed used the success palette; Request changes remained neutral; and Reject retained the destructive palette. Every state remained identified by localized text and shape, the authenticated queue stayed scannable, and the original dark-theme queue state was restored after inspection. UX-024 is `Verified`.                                                                                                                                                            |
| UX-025 | Intake + Client           | UX-001                                                                              | Markdown security tests and authenticated Summary readback                                                             | GitHub intake now persists the PR body separately from the title through PatchPlane-owned domain, core, plugin, and Convex contracts; existing title-plus-body records retain a bounded legacy projection. Summary renders the body through the exact `markdown-to-jsx@9.9.0` React entry behind a local feature adapter, with semantic GitHub-flavored headings, lists, task lists, tables, links, blockquotes, and code. Raw HTML blocks/comments, images, executable URLs, and remote embeds are discarded without `dangerouslySetInnerHTML`; links use the library sanitizer and `noopener noreferrer`. Five focused renderer/projection regressions pass, including unsafe script/iframe/image/`javascript:` fixtures and legacy records with or without a stored title. The full `bun run verify` gate passes with 193 client tests, 69 architecture/automation tests, production builds, and 7.46 MiB server / 13.04 MiB client Cloudflare bundles. The corrected client and matching Convex development schema/functions were deployed on 2026-07-27. Authenticated German readback of workflow `ms76g9ahz6hbsr31xbynkz5pa58b7c68` confirmed the report `h1` remains only `feat(agent): make local runs discoverable and verifiable`; the expanded request begins at semantic `Summary`, exposes five section headings, six lists, and 14 task checkboxes, contains no raw heading markers or document-level horizontal overflow, and contains zero scripts, iframes, images, or unsafe links. UX-025 is `Verified`.                                                                                                                                                           |
| UX-026 | Client                    | Existing UI inventory                                                               | Component import/inventory review and browser evidence                                                                 | The audited TanStack Start client uses the shadcn `base-nova` style, Base UI, Lucide icons, and 57 shared components under `apps/client/src/components/ui`. The workflow queue filter now composes the installed controlled `ToggleGroup` instead of a feature-local button group; Evidence artifact feedback and resource rows use the shared `Alert` and `ItemGroup`/`Item` primitives instead of hand-styled alert text and content-only cards; and the review trust dimensions use the same `Item` composition. Artifact action names are localized in English and German. A new architecture gate covers the complete production `app-shell` feature boundary and rejects direct Base UI, Radix, or Sonner imports; raw interactive/form/table primitives; legacy `space-x`/`space-y` and `animate-pulse` utilities; and regression to the removed feature-local filter. Existing Pierre architecture checks continue to limit `@pierre/diffs` and `@pierre/trees` to their local feature adapters. Focused component tests pass 20 cases, the architecture suite passes 23 cases (70 architecture/automation cases in the full gate), client typechecking passes, and `bun run verify` passes with 193 client tests, production builds, and 7.46 MiB server / 13.04 MiB client Cloudflare bundles. The source was deployed to authenticated `--stage dev` on 2026-07-27. German browser acceptance confirmed one named six-choice queue toggle group with stable selected state and URL filtering, five semantic review items, two semantic artifact items with localized action names, no raw feature buttons, and no document-level horizontal overflow. UX-026 is `Verified`. |
| UX-027 | Client + Security + Infra | Fixture harness and recorded dev revision                                           | Production-bundle exclusion, anonymous-route rejection, local screenshots, and authenticated dev evidence              | Pending                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| UX-028 | Domain + Client           | DIFF-003 and coherent attempt projection                                            | M9.75/M10 stale, mutated, mismatched, and superseded state tests                                                       | The Patch Report now evaluates one explicit V1 coherence projection across the selected workflow attempt, sandbox execution, candidate digest and pinned base, diff artifact subject, verification digests, review, policy, human decision, and current publication references. Stale bases, before/after candidate mutation, cross-identity references, and superseded attempts produce a localized blocking alert and disable Approve, Request changes, and Reject. Convex returns the latest newer attempt as separate bounded lineage metadata without replacing any selected-attempt record, and the only navigation action is the explicit localized `Open attempt {n}` button. The decision mutation independently rejects new decisions against superseded attempts, so bypassing the client still fails closed. Five projection fixtures cover coherent, stale, mutated, mismatched, and superseded states; component coverage proves selected-attempt retention, intentional navigation, and disabled decisions; Convex coverage proves parent/child projection and server rejection. `bun run verify` passes with 213 client tests, 52 backend tests, 70 architecture/automation tests, production builds, and the 7.47 MiB server / 13.05 MiB client Cloudflare budgets. The Client and Convex development functions were deployed on 2026-07-27. Authenticated German dev acceptance loaded workflow `ms76g9ahz6hbsr31xbynkz5pa58b7c68`, confirmed no false coherence alert for its selected attempt, retained its run and candidate identities, and rendered the exact one-file durable diff without replacement. UX-028 is `Verified`. |
| UX-029 | Client                    | Existing Patch Report page layout                                                   | Component regression, full gate, and authenticated laptop-height browser measurement                                   | Removed the `min-h-0` shrink override from the report content flex item so the existing `pb-10` / `lg:pb-12` spacing contributes to document height. The component regression asserts the scroll-end layout contract, and `bun run verify` passes with 134 client tests and 67 architecture/automation tests. After an authenticated dev-stage deployment on 2026-07-26, the 1512 × 778 report viewport measured a 1,139px scroll extent and an exact 48px gap between the review card and viewport bottom at maximum scroll; the pre-fix deployment ended the 1,035px scroll extent flush with the card. No new UI primitive or nested scroll container was introduced.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| UX-030 | Client                    | UX-009, existing provenance projection                                              | Component regression, keyboard semantics, responsive and authenticated visual review                                   | Replaced the unbounded vertical timeline with existing local `Table`, `Collapsible`, `Button`, and `Badge` primitives. Summary rows expose bounded event, stage, status, and time columns; each accessible toggle reveals the full detail and repeats mobile-safe stage/time metadata in a valid table row. Component coverage proves details are absent while collapsed and revealed with `aria-expanded=true`. Authenticated desktop/mobile visual review remains pending.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| UX-031 | Client                    | Existing runtime, sandbox, and diagnostic projections                               | Component regression, keyboard semantics, responsive and authenticated visual review                                   | Added one PatchPlane feature-level evidence-table composition built exclusively from local `Table`, `Collapsible`, `Button`, `Badge`, `ScrollArea`, and `Empty` primitives. Runtime events are one row per normalized event; stdout and stderr retain one row per captured execution rather than only the latest stream; diagnostics are grouped by PatchPlane read-model collection with record and partial-state labels. The table now uses fixed layout, suppresses horizontal overflow, reserves a visible disclosure column, progressively hides secondary columns, and moves essential state/source metadata into the primary mobile cell. Raw payloads remain scrollable vertically and wrap rather than widening the panel. Component coverage exercises all four views and the Activity table uses the same width contract. Authenticated desktop/mobile visual review remains pending.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| UX-032 | Client                    | Existing shadcn application-shell primitives                                        | Component regression, keyboard semantics, responsive and authenticated visual review                                   | Kept `Sidebar collapsible="icon"` and exposed the local `SidebarTrigger` in a shared responsive shell header. The existing provider continues to own persistence, the trigger exposes `aria-expanded`, collapsed destinations retain accessible names and now provide tooltips, and the mobile trigger continues to control the off-canvas sheet. Focused component coverage proves the desktop state changes to `data-collapsible="icon"` and mobile navigation remains operable. Authenticated desktop/mobile visual review remains pending.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| UX-033 | Client + Infra            | Cloudflare Version Metadata and existing Sonner primitive                           | Endpoint, component, localization, preload-recovery, full-gate, and authenticated dev-stage acceptance                 | Added a branded, schema-decoded application-version contract backed by Cloudflare's `CF_VERSION_METADATA` binding, with a build-ID/local fallback for non-Worker environments. The server intercepts `GET` and `HEAD /api/version` and returns the active version with `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. A TanStack Query observer compares that value with the version captured by the root loader, checks every five visible minutes and on window focus, and shows the existing bottom-right Sonner as a persistent notification without automatically replacing a user's running UI. The localized action performs an ordinary page reload, while a separate session-scoped Vite `vite:preloadError` guard permits at most one automatic recovery reload per minute. Unit/component coverage verifies schema decoding, mismatch behavior, English and German copy, explicit reload, and loop prevention. `bun run verify:fast`, the complete 148-test client suite, and `bun run verify` pass within the production Cloudflare budgets. Authenticated dev acceptance on 2026-07-27 loaded Worker version `cf244bbc-c49e-46cd-83e2-4452ae7085b6`, deployed version `804cf8fd-f29a-475c-a7dd-a4a656f759ad`, and confirmed the persistent German `Neue Patchplane-Version verfügbar` notification with `Neu laden`. Activating it preserved `/de/app?filter=all&query=&repository=all`, adopted the new version, and cleared the notification. Tabs opened before this detector's first deployment cannot be retroactively notified; every version from this rollout forward participates in the contract.                                             |
| UX-034 | Client                    | Existing sidebar footer and localization messages                                   | Component/localization regressions and authenticated English/German visual acceptance without signing out              | The signed-in sidebar footer now consumes `app_nav_sign_out` for its visible label and icon-collapse tooltip instead of presenting the unrelated `Demo` label. English renders `Logout` and German renders `Abmelden`; the existing logout handler and authentication boundary are unchanged. Focused component tests cover both locales. The complete `bun run verify` gate passes with 201 client tests and 70 architecture/automation tests, and the corrected client was deployed to `--stage dev` on 2026-07-27. Authenticated acceptance confirmed both localized labels without activating the control, preserving the browser session. UX-034 is `Verified`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| UX-035 | Client                    | Existing ThemeProvider, root loader, theme server function, and shared color tokens | Root-class timeline, pre-hydration behavior, persistence regression, full gate, and authenticated dev-stage acceptance | Reopened on 2026-07-27 after an authenticated high-frequency trace disproved the first visual acceptance. The original light-to-dark sequence was light at `+32 ms`, dark at `+266 ms`, light again at `+594 ms`, and dark at `+993 ms`; dark-to-light likewise restored dark between the selected and final light frames. The final implementation gives the runtime provider sole ownership of the root class, uses TanStack `ScriptOnce` with the decoded HTTP-only-cookie value to initialize the correct resolved palette before hydration, updates `color-scheme` atomically, and removes the whole-document 180 ms transition. The cookie mutation no longer invalidates and remounts the root document; client state owns the current document while the cookie supplies the next server request. A regression proves stale loader props cannot restore the previous class after persistence, bootstrap tests cover server and local modes, and a source contract prevents loader-owned root classes from returning. Ten focused tests and the complete `bun run verify` gate pass. After the final dev deployment, light-to-dark changed once from light at `+37 ms` to dark at `+93 ms` and remained dark through `+2,788 ms`; dark-to-light changed once from dark at `+41 ms` to light at `+93 ms` and remained light through `+2,862 ms`. Neither trace exposed a transition marker or the previous class after selection. Reload retained the selected light cookie with the matching computed palette and `color-scheme`. UX-035 is `Verified`.                                                                                                                         |

### UX-035 theme-switch trace and closure

Authenticated dev-stage sampling recorded the root class, transition marker,
computed body background and foreground, and `color-scheme` while selecting
each explicit theme. Both directions contain the previous theme between the
first selected-theme frame and the final persisted-theme frame:

| Direction    | Recorded sequence                                                                                          | Result   |
| ------------ | ---------------------------------------------------------------------------------------------------------- | -------- |
| Light → dark | `+32 ms light` → `+266 ms dark/transitioning` → `+594 ms light` → `+993 ms dark`                           | Rollback |
| Dark → light | `+33 ms dark` → `+131 ms light/transitioning with dark computed colors` → `+344 ms dark` → `+396 ms light` | Rollback |

The trace isolates the defect to theme ownership during the asynchronous
cookie write and router invalidation. `RootDocument` reconciles the `<html>`
class from stale loader data while `ThemeProvider` independently owns the same
class through DOM mutation. The existing provider regression covers only the
imperative writer, so it could pass while the integrated root still rolled
back. The next regression must render the root/provider persistence sequence
and assert that the previous class never reappears.

The first single-owner deployment still invalidated and remounted the root
after writing the cookie, briefly discarding the provider's optimistic state.
The final implementation removes that document-wide invalidation. The
authenticated final trace recorded only one class and computed-palette change
in either direction:

| Direction    | Final recorded sequence                                    | Result      |
| ------------ | ---------------------------------------------------------- | ----------- |
| Light → dark | `+37 ms light` → `+93 ms dark` → dark through `+2,788 ms`  | No rollback |
| Dark → light | `+41 ms dark` → `+93 ms light` → light through `+2,862 ms` | No rollback |

An ordinary reload retained the selected light cookie and started with matching
`light` root class, computed colors, and `color-scheme`. No
`data-theme-transition` marker appeared during either switch or after reload.

UX-022 was deployed to `--stage dev` on 2026-07-27. An authenticated audit
confirmed the German Changes tab selected, a rendered accessible diff document,
and no error alert or retry action for the healthy artifact. Exceptional-state
browser fixtures remain pending to avoid corrupting shared evidence.

## `@pierre/diffs` adoption tracker

The library is a candidate, not a predetermined implementation choice. If
adopted, it should render PatchPlane-owned evidence; it must not become the
source of candidate identity, authorization, artifact state, or trust claims.
The spike ends with an explicit adopt or reject decision before renderer
implementation begins.

### DIFF-001 dependency review

Reviewed 2026-07-26 against the npm `latest` tag and an isolated Vite 8.1.5
production fixture. The exact package is installed in the client manifest but
is not imported into a production module yet.

| Item                        | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact version               | `@pierre/diffs@1.2.12`; npm integrity `sha512-pY/gmgWL03WnagqCyCnBi3QtRXUv4hCIY6FYqd5b1ZGaoI6a4Bsji8j+yRl2RfzPh/8Hf19rCl1GE80G6a1cLQ==`. `1.3.0-rc.1` exists but is not the stable `latest` tag.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Publication                 | Stable `1.2.12` published 2026-06-29. The package contains 669 files and reports 5,232,264 unpacked bytes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| License                     | Apache-2.0, including the distributed license and copyright notice for Pierre Computer Company. All 50 resolved non-peer runtime packages declare permissive MIT, Apache-2.0, ISC, or BSD-3-Clause licenses.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Direct runtime dependencies | `@pierre/theme@1.1.0`, `@pierre/theming@0.0.2`, `@shikijs/transformers@4.3.1`, `diff@9.0.0`, `hast-util-to-html@9.0.5`, `lru_map@0.4.1`, and `shiki@4.3.1`. Shiki ranges resolved to `4.3.1` in the spike.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Transitive graph            | 43 additional packages: `@shikijs/core@4.3.1`, `@shikijs/engine-javascript@4.3.1`, `@shikijs/engine-oniguruma@4.3.1`, `@shikijs/langs@4.3.1`, `@shikijs/primitive@4.3.1`, `@shikijs/themes@4.3.1`, `@shikijs/types@4.3.1`, `@shikijs/vscode-textmate@10.0.2`, `@types/hast@3.0.5`, `@types/mdast@4.0.4`, `@types/unist@3.0.3`, `@ungap/structured-clone@1.3.3`, `ccount@2.0.1`, `character-entities-html4@2.1.0`, `character-entities-legacy@3.0.0`, `comma-separated-tokens@2.0.3`, `dequal@2.0.3`, `devlop@1.1.0`, `hast-util-whitespace@3.0.0`, `html-void-elements@3.0.0`, `mdast-util-to-hast@13.2.1`, `micromark-util-character@2.1.1`, `micromark-util-encode@2.0.1`, `micromark-util-sanitize-uri@2.0.1`, `micromark-util-symbol@2.0.1`, `micromark-util-types@2.0.2`, `oniguruma-parser@0.12.2`, `oniguruma-to-es@4.3.6`, `property-information@7.2.0`, `regex@6.1.0`, `regex-recursion@6.0.2`, `regex-utilities@2.3.0`, `space-separated-tokens@2.0.2`, `stringify-entities@4.0.4`, `trim-lines@3.0.1`, `unist-util-is@6.0.1`, `unist-util-position@5.0.0`, `unist-util-stringify-position@4.0.0`, `unist-util-visit@5.1.0`, `unist-util-visit-parents@6.0.2`, `vfile@6.0.3`, `vfile-message@4.0.3`, and `zwitch@2.0.4`. |
| React compatibility         | Declared peers are React and React DOM `^18.3.1` or `^19.0.0`. The published package was built with React `19.2.7`; the production fixture built successfully with PatchPlane's resolved React and React DOM `19.2.8`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Package shape               | ESM-only exports exist for the core, React, SSR, worker, and portable-worker entry points. The default React entry exposes `PatchDiff`, `FileDiff`, `MultiFileDiff`, and virtualized/worker APIs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

Primary records:
[npm registry metadata](https://registry.npmjs.org/@pierre%2fdiffs),
[published source](https://github.com/pierrecomputer/pierre/tree/main/packages/diffs),
and [official documentation](https://diffs.com).

#### Production bundle measurement

The fixture compares the same React 19.2.8 application with no renderer,
an eager `PatchDiff` import, and a `React.lazy` import. All values are
minified production JavaScript compressed locally with gzip level 9.
Dynamic language and theme chunks are included in emitted totals even though a
browser would fetch only requested chunks.

| Fixture           | Initial entry gzip |                    Total emitted JS | JS files |                           Delta from baseline |
| ----------------- | -----------------: | ----------------------------------: | -------: | --------------------------------------------: |
| React baseline    |           59,245 B |       190,071 B raw / 59,245 B gzip |        1 |                                             — |
| Eager `PatchDiff` |          184,709 B | 10,352,694 B raw / 1,994,488 B gzip |      312 | +125,464 B initial; +1,935,243 B emitted gzip |
| Lazy `PatchDiff`  |           60,155 B | 10,510,316 B raw / 2,032,702 B gzip |      313 |     +910 B initial; +1,973,457 B emitted gzip |

PatchPlane's pre-renderer client ships 730 KiB of JavaScript gzip and 2.87 MiB
of client assets. Its original ceilings remain recorded as a 762 KiB
JavaScript base and 3 MiB asset base. DIFF-001 adds a dedicated
`@pierre/diffs@1.2.12` allowance of 2,048 KiB JavaScript gzip and 11 MiB client
assets, producing aggregate CI ceilings of 2,810 KiB and 14 MiB. The largest
raw JavaScript chunk remains capped at 1.75 MiB.

**Gate result:** dependency metadata, licensing, React compatibility, and the
explicit dependency allowance pass. The exact dependency may remain installed
without affecting emitted assets while unused. Renderer integration must still
be lazy under DIFF-006 so the 125,464-byte eager entry delta is not paid by
reviewers who do not open Changes. DIFF-012 must reject the package if the real
integration exceeds the raised aggregate ceilings or the unchanged
largest-chunk ceiling.

Installation validation: `@pierre/diffs` is pinned to `1.2.12` in the client
manifest and Bun lockfile. `bun run verify` passes before the first renderer
import at 2.87 MiB client assets, 730 KiB JavaScript gzip, and a 1.29 MiB
largest raw JavaScript chunk against the new 14 MiB, 2,810 KiB, and unchanged
1.75 MiB ceilings.

### DIFF-002 renderer boundary

The diff renderer is now behind
[`CandidateDiffRenderer`](../apps/client/src/components/app-shell/candidate-diff-renderer.tsx).
Its complete input contract is one `content: string` property. Authorization,
candidate/artifact lookup, native R2 access, identity verification, byte
accounting, truncation, statistics, and review consequences remain in
PatchPlane-owned route and feature code.

| Boundary         | Enforced behavior                                                                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Retrieval        | The client requests only the relative `/api/artifacts/url` route with `same-origin` credentials and `no-store` caching.                                                    |
| Authorization    | WorkOS authentication and the Convex access token remain server-side before the native R2 binding is read.                                                                 |
| Preview body     | The bounded response body contains raw UTF-8 diff content only; identity, size, returned bytes, truncation, and statistics use headers.                                    |
| Renderer input   | `CandidateDiffRenderer` receives only `diffPreview.content`; it cannot fetch artifacts or receive candidate, artifact, identity, or truncation fields.                     |
| Pierre isolation | Architecture tests permit future `@pierre/diffs` imports only inside the renderer adapter. Pierre cannot become the authorization, retrieval, identity, or trust boundary. |
| URL output       | Full-artifact URLs remain relative and same-origin; request origins and expiry parameters are not reflected into returned URLs.                                            |

Verification on 2026-07-26: focused component, artifact-storage, and
architecture tests pass (35 tests), followed by `bun run verify`. The dev-stage
deployment completed with only the client updated. Authenticated Changes-tab
readback loaded the exact candidate-bound diff for workflow
`ms76g9ahz6hbsr31xbynkz5pa58b7c68`, candidate
`qh7ee30m4mwqjmxzwv9tq8r0618b6d30`, artifact
`qn75ktghwvzdmecd7658ndr2wh8b7m1k`, and SHA-256
`99c65c98da25b7fed436126c485410264ba83153028ceb6eff4b10e1556110aa`;
the raw diff rendered, `+2`/`-2` statistics remained present, and no retrieval
or identity error appeared. Deployment used HEAD
`bfee74ac204661ce7e65b45c14786ae861b5e18b`; the adapter SHA-256 is
`ad2ebc6e2d78de35ecfe6b34fbc5aac83aacbd7e664198cf9f46739a2d93adc2`.

### DIFF-003 candidate coherence

The Changes projection now has one explicit identity key composed from the
workflow run, selected candidate, referenced diff artifact, artifact SHA-256,
and declared artifact size. Loaded previews, retrieval problems, loading state,
and calculated statistics are accepted only for that key.

| Candidate/evidence state                  | Enforced outcome                                                                                                                                                |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coherent selected candidate               | Load only the artifact named by `candidate.diffArtifactId`; bind the resulting preview and statistics to the candidate identity key.                            |
| Candidate belongs to another workflow     | Fail closed with `Diff evidence identity mismatch`; do not expose a load action.                                                                                |
| Referenced artifact belongs elsewhere     | Fail closed before retrieval when its `workflowRunId` differs or its kind is not `diff`.                                                                        |
| Candidate or artifact changes during load | Abort the prior request and discard any response whose request sequence or identity key is stale; never render the earlier candidate's bytes under the new one. |
| Missing referenced artifact metadata      | Retain the existing explicit unavailable state without substituting another diff artifact.                                                                      |

Verification on 2026-07-26: focused Changes and architecture regressions pass
(29 tests), including a deferred old-candidate response that resolves after a
new candidate has loaded and a referenced artifact from a different workflow.
`bun run verify` then passed with 125 client tests and 67
architecture/automation tests, production client and SSR builds, 730 KiB total
client JavaScript gzip against the 2,810 KiB ceiling, and a 1.29 MiB largest raw
JavaScript chunk against the 1.75 MiB ceiling.

The verified source was deployed to the `dev` stage. Authenticated readback for
workflow `ms76g9ahz6hbsr31xbynkz5pa58b7c68` loaded only candidate
`qh7ee30m4mwqjmxzwv9tq8r0618b6d30` and its referenced artifact
`qn75ktghwvzdmecd7658ndr2wh8b7m1k`, displayed SHA-256
`99c65c98da25b7fed436126c485410264ba83153028ceb6eff4b10e1556110aa`,
calculated one file with `+2`/`-2`, rendered the expected
`EngineService+Project.swift` diff, and showed neither identity nor retrieval
errors.

### DIFF-004 unified and constrained split alpha renderer

The pinned `@pierre/diffs@1.2.12` React `PatchDiff` now owns specialized
single-file diff rendering inside the existing PatchPlane workspace. Each
candidate file receives only its already-authorized patch record. PatchPlane
continues to own file navigation, headings, selection feedback, scrolling,
loading, evidence states, identity, and the surrounding layout through local UI
components. A browser-only lazy adapter excludes Pierre and Shiki from SSR;
server rendering emits the same local Skeleton fallback that hydrates before
the renderer chunk resolves.

Unified mode remains the default rather than inheriting Pierre's split default.
The alpha configuration uses classic `+`/`-` indicators, metadata hunk
separators, visible line numbers, horizontal overflow for long lines, system
light/dark themes, and the local mono/sans font tokens. Pierre's duplicate file
header is disabled because the PatchPlane file heading is the navigation and
focus target.

Split mode is exposed only in the expanded desktop workspace, where the
changed-file navigator and diff have the available width. The ordinary report
surface and mobile layout continue to render unified output. The existing
shared `ToggleGroup` controls the preference, while Pierre's public
`diffStyle` option remains the specialized rendering boundary. The selected
mode persists in bounded URL state and returns when the reviewer re-enters the
expanded workspace.

Automated verification on 2026-07-27 renders the real Pierre Shadow DOM for
candidate files in unified and split modes, confirms tree selection updates the
bounded file index and semantic scroll target, and proves that leaving and
re-entering the expanded workspace preserves the selected mode. Focused
renderer, Changes, navigation, and architecture suites pass with 49 tests. The
full `bun run verify` gate passes with 179 client tests, 69
architecture/automation tests, production builds, and 7.35 MiB server /
12.95 MiB client Cloudflare budgets. Authenticated dev-stage acceptance proves
reload and Back/Forward restore unified/split mode and expanded focus for the
available one-file candidate. Multi-file selection history remains pending, so
DIFF-004 is `Implemented`, not yet `Verified`.

### DIFF-005 local syntax highlighting

The candidate renderer explicitly selects Pierre's `shiki-js` highlighter.
Pierre infers the language from the candidate-bound patch filename and loads
the matching grammar and Pierre light/dark themes through bundled JavaScript
dynamic imports. Highlighting runs locally in the already lazy-loaded browser
adapter; PatchPlane does not submit code to a highlighting service. The worker
pool remains disabled at this checkpoint, so there is no second renderer
transport or worker lifecycle to audit.

The package review confirmed that `@pierre/diffs@1.2.12` resolves grammars from
Shiki's bundled language registry and creates the JavaScript regex engine
locally. This agrees with the
[official Diffs documentation](https://diffs.com/docs), which documents Shiki
highlighting, filename-based language inference, and lazy on-demand grammar and
theme loading.

Automated evidence covers both required boundaries:

- The real renderer produces themed TypeScript token spans for a `.ts` patch
  while an intercepted browser `fetch` records zero calls.
- The architecture suite prohibits `fetch`, `XMLHttpRequest`, `WebSocket`, and
  `navigator.sendBeacon` from both PatchPlane diff-renderer adapters and keeps
  Pierre imports isolated to the browser-only adapter.
- The browser Sentry transport test injects a synthetic raw candidate diff
  through an event payload and proves neither the diff nor its embedded
  sentinel reaches the transport envelope.

Focused renderer, browser-telemetry, and architecture suites pass with 24
tests. DIFF-005 is `Verified`; authenticated visual styling remains part of
DIFF-004 and does not reopen the local-processing or telemetry boundary.

### DIFF-006 staged loading boundary

The Patch Report now has four explicit loading stages:

| Stage             | Trigger                                | Loaded or requested                                                                                                                                                                             |
| ----------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Summary route     | Open a Patch Report on its default tab | Report shell and summary only; the Changes feature module is behind a `React.lazy` boundary.                                                                                                    |
| Changes shell     | Visit the Changes tab                  | A 23.3 KiB raw / 7.6 KiB gzip feature chunk containing candidate identity, explicit evidence states, and the load action. No diff artifact request occurs.                                      |
| Candidate preview | Activate the existing load action      | The authenticated, same-origin, capped diff bytes are requested with `no-store`; only a successful preview mounts the renderer workspace.                                                       |
| Review rendering  | Mount a successful preview             | The changed-file navigator and unified renderer load as separate 238 KiB and 434 KiB raw chunks. Pierre then dynamically selects bundled filename-inferred grammar and light/dark theme chunks. |

The worker pool remains explicitly disabled, and the production client emits
no worker-named chunk. This avoids a hidden worker lifecycle while the alpha
uses the JavaScript highlighter. The workflow route contains only a dynamic
reference to the Changes chunk; the Changes chunk contains dynamic references
to the tree and unified renderer; and the unified renderer contains the dynamic
grammar and theme map. Consequently, emitted grammar coverage contributes to
the aggregate build size without being part of the initial route request.

Automated checks prove that the Changes module is not statically imported and
candidate bytes are requested only when the lazily mounted Changes surface is
visited. The candidate-bound preview hook keys TanStack Query by workflow,
candidate, artifact, SHA-256, and byte size, keeps the authenticated HTTP
request out of the persistent browser cache, deduplicates the request in
memory, and releases inactive source after ten minutes. The architecture suite
also locks the nested renderer imports and disabled-worker configuration.

DIFF-006 is `Implemented`, not `Verified`: the remaining acceptance evidence is
an authenticated dev-browser network waterfall and timing capture proving that
the production deployment follows the measured chunk graph. That capture can
be combined with DIFF-004's authenticated screenshots and DIFF-007's
representative performance fixture.

### DIFF-007 browser performance budgets

The performance fixture runs on a loopback-only Vite server and imports the
production `CandidateDiffRenderer`, browser-safe projection runtime,
`@pierre/diffs`, and `@pierre/trees` integrations. It does not mock the
renderer, fetch artifacts, initialize provider services, or enter a production
bundle. Run it with `bun run bench:diff-viewer`.

Budgets represent an alpha review interaction on desktop Chrome:

| Interaction                 | Representative fixture          | Budget     | 2026-07-26 measurement |
| --------------------------- | ------------------------------- | ---------- | ---------------------- |
| Initial renderer readiness  | 12 files / 11,708 bytes         | ≤ 2,000 ms | 576.3 ms               |
| Candidate file switching    | Real tree selection, 12 samples | ≤ 100 ms   | 25.4 ms maximum        |
| Near-cap renderer readiness | 56 files / 187,464 bytes        | ≤ 6,000 ms | 617.1 ms               |

Readiness requires the real changed-file headings to be mounted and both lazy
loading placeholders to be absent for two animation frames. File switching
clicks real `@pierre/trees` items and waits for the production renderer's
candidate-bound `aria-label` to change. The large case remains below the
200,000-byte preview cap and exercises all 56 rendered file sections without
claiming extremely large-diff virtualization. The benchmark fails when any
budget is exceeded or the page emits a browser error.

DIFF-007 is `Verified`. These local budgets measure renderer behavior and do
not close DIFF-006's separate authenticated network-waterfall requirement.

### DIFF-008 accessible unified diff

The visual Pierre renderer remains responsible for syntax-aware presentation,
while the PatchPlane adapter now supplies the review semantics that the
renderer does not expose through a public accessibility API:

- a screen-reader-only `document` named `Accessible unified diff`;
- one level-four heading per hunk with explicit old and new ranges;
- rows in document order that announce `Added`, `Deleted`, or `Unchanged`
  before old/new line numbers and code content;
- no per-line tab stops, with the visual shadow-DOM renderer hidden from
  assistive technology when the semantic transcript is available;
- existing file-heading focus, exact changed-file return focus, complete tree
  key-map, and mobile overlay focus behavior remain covered by component tests;
- GitHub's bundled high-contrast Shiki themes replace Pierre's lower-contrast
  defaults, and the static diff surface has no transition or animation.

Authenticated dev inspection on 2026-07-27 confirmed two named hunk regions,
ordered added/deleted/unchanged announcements, zero transcript tab stops, the
visual wrapper's `aria-hidden="true"`, and zero horizontal page overflow at
1,512 × 778 and 390 × 844. The German route now announces the hunk, old/new
ranges, context, added/deleted/unchanged kinds, inapplicable line numbers,
blank lines, and missing final newline in German rather than mixing English
screen-reader copy into the localized report. Automatic loading is now owned by
`useCandidateDiffPreview`: entering Changes fetches the candidate-bound
artifact immediately, while revisiting the tab reuses the immutable
identity-keyed TanStack Query value. The browser request remains
`cache: "no-store"` so source is not persisted in the HTTP cache.

DIFF-008 is `Implemented`, not `Verified`. The remaining acceptance evidence is
manual spoken screen-reader readback of one localized added, deleted, and
unchanged line plus genuine 200% browser zoom. The authenticated 390 × 844
responsive pass now succeeds with an exact 390-pixel document width, no
horizontal overflow, deterministic sheet dismissal, and focus on the selected
file heading.

### DIFF-009 explicit parser and processor failures

The artifact route, identity checks, and browser-safe changed-file projection
already returned typed PatchPlane evidence problems. The remaining escape path
was inside the lazy Pierre adapters: a rejected renderer/tree module import or
an exception from diff parsing, highlighting, or rendering could reach the
route-level error boundary after the candidate artifact had been successfully
retrieved.

The candidate renderer now places its lazy tree and diff modules behind a
feature error boundary composed with the shared `Alert` primitive. Module and
processor initialization failures are tagged and promoted to the existing
retryable `processor-unavailable` state. An untagged exception inside the
Pierre diff boundary is promoted to the non-retryable `malformed` state because
PatchPlane can no longer establish trustworthy file and hunk boundaries. The
parent Changes surface retains the candidate and artifact identity, blocks the
renderer, and exposes only the matching recovery policy. Raw exception text,
diff content, and file paths are never rendered or logged by the boundary.

Pierre's worker pool remains disabled for alpha. The same processor-unavailable
classification is defined for a future worker-backed adapter, while the
architecture gate continues to reject `new Worker` and `workerUrl` in the
current renderer. Component regressions cover malformed parser/render errors,
tagged module/worker-style failures, safe copy, and parent failure promotion.
The focused renderer and Changes selection passes 35 tests. The full
`bun run verify` gate passes with 197 client tests, 70
architecture/automation tests, production builds, and 7.46 MiB server /
13.04 MiB client Cloudflare bundles. The source was deployed to `--stage dev`
on 2026-07-27; an authenticated German Changes view loaded the candidate-bound
tree and unified diff without entering a route-level or evidence failure state.
Exceptional states remain isolated regression fixtures rather than mutations
of durable evidence. DIFF-009 is `Verified`.

### DIFF-010 telemetry egress boundary

The browser transport regression now carries four independent prohibited-data
classes through the configured Sentry SDK: a synthetic credential, a standalone
source excerpt, a complete candidate diff, and a raw repository path. It places
them in breadcrumbs, logs, metrics, spans, explicit events, exception messages
and stacks, stack-frame source context, request URLs, and event extras before
inspecting the serialized transport envelopes. Each complete value and its
unique sentinel must be absent, while the safe normalized `/:path` value must
remain.

The test uses the same event, transaction, breadcrumb, log, metric, and span
hooks as client instrumentation. The architecture suite separately prevents
candidate diff surfaces from importing Sentry, telemetry, analytics, or
PostHog entry points and from calling capture or tracking APIs directly. No
product-analytics SDK is installed in the client, so candidate diff content has
no analytics transport path. The focused transport, instrumentation, and
architecture selection passes 25 tests. DIFF-010 remains `Verified`.

### DIFF-011 and TREE-011 review-workspace composition

The first integrated renderer exposed a visual-boundary defect rather than a
missing renderer capability. The tree and every rendered file were presented
as separate cards inside the Changes card, Pierre followed the operating-system
color scheme instead of PatchPlane's active theme, and a full-width text action
competed with the filename in each diff header. The fixed-height panes also
left the compact one-file case looking unfinished.

The Changes surface is now one coordinated review workspace:

- the existing PatchPlane `Card` remains the single outer evidence boundary;
- the changed-file navigator is a quiet navigation rail separated from the
  primary diff canvas by one border, rather than a second card;
- both Pierre adapters receive PatchPlane's active light/dark scheme, and the
  tree maps its public override variables to the existing semantic color,
  typography, focus, border, and scrollbar tokens;
- selected-file feedback uses the existing muted surface instead of an orange
  card ring;
- return navigation uses the existing icon-sized `Button` with an accessible
  name, while status remains in the existing `Badge`;
- the desktop pane height uses a viewport-aware bounded clamp and the compact
  layout stacks the same two regions without introducing a custom UI primitive.

A component regression switches the root theme at runtime and proves that the
real tree and diff adapters follow it. The focused renderer suite, typecheck,
lint, performance fixture, and full `bun run verify` gate pass. Authenticated
dev readback on 2026-07-26 confirmed a 1,971 × 1,399 dark-theme workspace with
the real tree and unified diff: both adapters used the dark scheme, the review
workspace was 546 pixels tall, no selected-file card ring remained, and the
document had zero horizontal overflow. A 390 × 844 screenshot remains required
before either composition gate can be marked `Verified`, so DIFF-011 and
TREE-011 are `Implemented`.

### Browser Effect runtime and Effect Atom evaluation

The authenticated Changes readback exposed a client-runtime boundary error:
artifact metadata existed, the R2 object read back with the recorded SHA-256,
and the preview route returned `200`, but changed-file projection initialized
the full application runtime. That runtime composes server-oriented WorkOS,
Convex, and telemetry layers even though `ProjectCandidateChangedFiles`
requires no services.

Changed-file projection now uses a dedicated browser-safe `ManagedRuntime`
backed by `Layer.empty`. The artifact request, module loading, and projection
stages have distinct failure states, so a client processor failure is no longer
described as missing artifact storage.

Authenticated dev acceptance on 2026-07-26 used workflow
`ms76g9ahz6hbsr31xbynkz5pa58b7c68` and the previously failing artifact. The
deployed Changes view loaded the identity-checked diff, calculated 1 file,
2 additions, and 2 deletions, mounted the changed-file navigator and unified
diff, and emitted no browser errors. No storage, processor-loading, or
projection failure state was present.

`effect-atom` was evaluated from the vendored Effect
`effect/unstable/reactivity` implementation and the `@effect/atom-react`
bindings. Its runtime atoms, registry lifetime, React subscription, Suspense,
and cancellation model are useful when shared reactive resources must be
cached or coordinated across multiple components. They are not adopted for
this fix:

- diff loading is an explicit, candidate-bound user action with existing abort
  and stale-request protection rather than a shared reactive query;
- adopting atoms would add `@effect/atom-react`, a registry provider, and a
  second client state model without removing the same-origin retrieval or
  identity checks;
- the API is currently under Effect's `unstable/reactivity` namespace;
- a small browser-safe managed runtime fixes the actual layer-construction
  defect while preserving the existing client runtime rule and avoiding
  standalone `Effect.runPromise`.

Revisit Effect Atom only if diff state becomes shared across tabs/components,
needs registry-level caching or invalidation, or is composed with other
reactive Effect resources.

| ID       | Gate           | Requirement                                                                                                                                                                                                                                                                             | Acceptance evidence                                         | Status      |
| -------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------- |
| DIFF-001 | Dependency     | Record the exact package version, license, transitive dependencies, bundle delta, and React compatibility.                                                                                                                                                                              | Dependency review and production bundle-budget result       | Verified    |
| DIFF-002 | Boundary       | Keep artifact authorization and same-origin retrieval in PatchPlane. Pass only the structured preview's raw `content` to the renderer and keep full-artifact identity and truncation metadata outside parser input.                                                                     | Architecture test and artifact-route tests                  | Verified    |
| DIFF-003 | Identity       | Render only the diff referenced by the selected candidate's evidence record.                                                                                                                                                                                                            | Candidate-mismatch regression test                          | Verified    |
| DIFF-004 | Rendering      | Support unified rendering for alpha; enable split mode only if it remains usable at the available width.                                                                                                                                                                                | Component and browser screenshots                           | Implemented |
| DIFF-005 | Syntax         | Use syntax-aware highlighting without remote code submission.                                                                                                                                                                                                                           | Network inspection and telemetry tests                      | Verified    |
| DIFF-006 | Loading        | Lazy-load renderer, grammars, workers, and diff bytes only when Changes is visited or intentionally prefetched.                                                                                                                                                                         | Bundle analysis and browser timing                          | Implemented |
| DIFF-007 | Performance    | Establish budgets for initial render, file switching, and a representative large capped diff.                                                                                                                                                                                           | Browser performance fixture                                 | Verified    |
| DIFF-008 | Accessibility  | Verify line-number semantics, added/deleted announcements, focus behavior, zoom, contrast, and reduced motion.                                                                                                                                                                          | Keyboard and screen-reader acceptance checklist             | Implemented |
| DIFF-009 | Failure states | Wrap parser and worker failures in PatchPlane's unavailable/malformed evidence states.                                                                                                                                                                                                  | Component regression tests                                  | Verified    |
| DIFF-010 | Telemetry      | Prevent raw code, raw diff lines, and sensitive artifact content from reaching Sentry or PostHog.                                                                                                                                                                                       | Sentinel-content transport tests                            | Verified    |
| DIFF-011 | UI composition | Keep Pierre responsible for specialized diff rendering only. Build its toolbar, mode controls, loading, errors, identity strip, and responsive shell from the existing local UI primitives.                                                                                             | Component inventory review and browser screenshots          | Implemented |
| DIFF-012 | Decision       | Record one outcome: adopt `@pierre/diffs`; reject it and retain/improve the current bounded unified preview; or reject it and authorize a narrowly scoped internal renderer. Compare accessibility, security, compatibility, performance, bundle size, maintenance, and alpha schedule. | Recorded spike decision with evidence and selected fallback | Not started |

## `@pierre/trees` candidate changed-file navigator

The tree is an access and orientation aid for the candidate diff. It is not a
repository explorer.

### TREE-001 dependency review

Reviewed 2026-07-26 against npm registry metadata, the published package, and
an isolated Vite 8.1.5 production fixture. The exact beta is installed and
isolated behind the PatchPlane-owned changed-file adapter.

| Item                          | Finding                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact version and stability   | `@pierre/trees@1.0.0-beta.6`; npm integrity `sha512-zxeuSFM9TveM7b5XofweJALCtm/tGYV9HZzdbf7Uf+kBxIlUyz24/EHaGRjB0dsmmfDQl2ETz7AWwJ15lhSnpw==`. Both `latest` and `beta` point to this prerelease. No stable version has been published. The official documentation warns that refinements and small API changes are expected between beta releases.                               |
| Publication                   | Beta 6 was published 2026-07-25. The package contains 244 files and reports 1,456,269 unpacked bytes.                                                                                                                                                                                                                                                                             |
| License                       | Apache-2.0 with a distributed `NOTICE.md`. The notice attributes code and ideas derived from MIT-licensed `@headless-tree/core`. All resolved runtime dependencies are Apache-2.0 or MIT. Distribution must retain the Pierre license and NOTICE attribution.                                                                                                                     |
| Runtime dependencies          | Three direct packages and no additional non-peer transitive packages in the fixture: `@pierre/theming@1.0.0`, `preact@11.0.0-beta.0`, and `preact-render-to-string@6.6.5`.                                                                                                                                                                                                        |
| React compatibility           | Declared React and React DOM peers are `^18.3.1` or `^19.0.0`. The package was built with React `19.2.7`; the React entry production-builds successfully with PatchPlane's resolved React and React DOM `19.2.8`. The wrapper uses React hooks and JSX directly while the underlying shadow-root renderer brings a separate Preact runtime. No React-to-Preact alias is required. |
| Preact compatibility and risk | Preact is a pinned runtime dependency, not a peer, so consumers receive the expected implementation. However, it is `preact@11.0.0-beta.0`; both the tree package and its rendering runtime are prerelease dependencies.                                                                                                                                                          |
| Package shape                 | ESM-only exports exist for vanilla, React, SSR, and side-effectful web-component entry points. Pierre identifies the public React, vanilla, and SSR entry points as the supported starting surfaces. The React entry exports `FileTree`, `useFileTree`, search, selection, and selector hooks. Rendering occurs in a shadow root keyed by canonical path strings.                 |

Primary records:
[npm registry metadata](https://registry.npmjs.org/@pierre%2ftrees),
[published source](https://github.com/pierrecomputer/pierre/tree/main/packages/trees),
and [official documentation](https://trees.software).

#### Production bundle measurement

The fixture compares the same React 19.2.8 application with no tree, an eager
`FileTree` plus `useFileTree` import, and a lazy tree component. Values are
minified production JavaScript compressed locally with gzip level 9.

| Fixture        | Initial entry gzip |               Total emitted JS | JS files |                                     Delta from baseline |
| -------------- | -----------------: | -----------------------------: | -------: | ------------------------------------------------------: |
| React baseline |           59,245 B |  190,071 B raw / 59,245 B gzip |        1 |                                                       — |
| Eager tree     |          127,738 B | 433,364 B raw / 127,738 B gzip |        1 |                         +243,293 B raw / +68,493 B gzip |
| Lazy tree      |           59,769 B | 434,245 B raw / 128,542 B gzip |        2 | +524 B initial; +244,174 B raw / +69,297 B emitted gzip |

**Gate result:** the package passes licensing, declared React compatibility,
and the raised aggregate production bundle ceiling. It remains a conditional
beta dependency because both `@pierre/trees` and its pinned Preact runtime are
prereleases and small API changes are explicitly expected. Keep every Pierre
type and component behind a PatchPlane-owned adapter rather than exposing them
through report or domain contracts. An eager import would push PatchPlane's 730 KiB pre-tree
JavaScript above its original 762 KiB base. Any adoption must therefore load
the navigator with the Changes workspace, preserve the 1.75 MiB largest-chunk
ceiling, and pass TREE-006 accessibility testing.

Installation validation: `@pierre/trees` is pinned to `1.0.0-beta.6` in the
client manifest and Bun lockfile. The public React entry remains available at
`@pierre/trees/react`, while the vanilla class remains available from
`@pierre/trees`. The React runtime is now isolated behind the
PatchPlane-owned changed-files navigator adapter and loaded only with the
rendered Changes workspace. TREE-002 established the changed-path data
boundary before that integration.
`bun run verify` passes after installation at 2.87 MiB client assets, 730 KiB
JavaScript gzip, and a 1.29 MiB largest raw JavaScript chunk.

### Data contract

The navigator receives only paths and statistics derived from the exact
candidate-bound diff:

```ts
type CandidateChangedFile = {
  path: CandidateFilePath
  previousPath?: CandidateFilePath
  changeKind:
    | 'added'
    | 'modified'
    | 'deleted'
    | 'renamed'
    | 'copied'
    | 'type-changed'
    | 'unmerged'
  contentKind: 'text' | 'binary' | 'submodule' | 'unknown'
  additions?: number
  deletions?: number
  oldMode?: string
  newMode?: string
}

type CandidateChangedFilesProjection = {
  files: CandidateChangedFile[]
  artifactTruncated: boolean
  parseComplete: boolean
  unsupportedRecords: number
}
```

Folders are a client-side projection of these changed paths. They do not assert
that PatchPlane captured or inspected the complete repository tree. Binary is a
content property rather than a mutually exclusive change status. Preview
truncation belongs to the artifact projection, not an individual file: when
`artifactTruncated` or `parseComplete === false`, totals and navigation must be
labelled partial and the UI must not claim that every changed file is listed.
Mode-only, copied, type-changed, submodule, and unmerged records require
truthful representations even when no textual hunk can be rendered.

### TREE-002 changed-path boundary

PatchPlane now owns a provider-neutral
[`ProjectCandidateChangedFiles`](../packages/core/src/diff/project-candidate-changed-files.ts)
Effect projection. Its only source is the authorized candidate diff content
and the artifact-level truncation flag. Candidate paths are decoded into the
domain-owned `CandidateFilePath` brand before they can reach the client
adapter. The TanStack Query boundary interprets the projection through the
browser-safe managed Effect runtime; reusable React code does not call
standalone Effect runners or import server plugin layers.

The projection reads file records, not arbitrary path-like strings in changed
code. Tests prove that an unchanged path mentioned inside a hunk is excluded,
unsupported diff records are excluded and make `parseComplete` false, and
artifact truncation remains separate from parser completeness. Architecture
tests prohibit GitHub repository-tree request markers throughout the client,
network or GitHub access in the core projection, and premature
`@pierre/trees` runtime imports.

Both diff utilities use named `Effect.fn` boundaries. Statistics parsing
represents empty, binary, malformed, and oversized evidence in the typed
`UnifiedDiffStatsUnavailable` error channel; changed-file parsing keeps partial
and unsupported records as explicit successful projection state. The
statistics parser uses ordered Effect `Match` cases for UTF-8 sizing, file and
hunk state transitions, line kinds, and terminal validation instead of nested
conditional parsing branches. The changed-file projection uses the same
approach for Git path decoding, record boundaries, metadata classification,
content kinds, and supported/unsupported outcomes. Core workflows compose
these programs with `yield*`; the artifact response interprets statistics
asynchronously through the same managed runtime. Diff content is never added
to span attributes.

Verification on 2026-07-26: 44 focused diff, projection, hook, workflow, and
architecture tests pass, followed by `bun run verify` with 59 core tests, 125
client tests, and 67 architecture/automation tests. At this boundary-only
checkpoint the unused runtime entries added no production bundle output; the
client remained 2.87 MiB total, 730 KiB JavaScript gzip, and 1.29 MiB for its
largest raw JavaScript chunk. No UI was added under TREE-002; TREE-003 owns file
selection, scrolling, and focus.

### TREE-003 changed-file navigation

The Changes workspace now lazy-loads `@pierre/trees/react` behind
`CandidateChangedFilesNavigator`. The tree receives only the ordered paths
from `ProjectCandidateChangedFiles`; it receives no artifact identity, raw diff
content, repository API, or trust state. Selecting a Pierre file updates the
selected section, scrolls that section into view, and transfers focus to its
file heading. The diff region's accessible name follows the selected path.

The adapter adopts the complete public beta surface that is applicable to a
read-only candidate review: prepared path input, path-first model handles,
React rendering, built-in search plus search state, selection state, built-in
Git status, compact density, flattened empty directories, sticky folders,
overscanned virtualization, public scrolling, and row decoration. It does not
enable mutation, rename, drag/drop, or authoring context menus. The
side-effectful web-component entry is unnecessary in React, and SSR preloading
cannot be truthful because candidate paths are available only after the
authenticated artifact query resolves in the browser.

PatchPlane keeps all candidate file sections rendered so selection does not
trigger another artifact request or discard reviewer position. Candidate or
artifact identity changes remount the workspace through its identity key,
resetting selection to the first file rather than retaining a path from stale
evidence. The core projection is interpreted through the client-managed Effect
runtime; reusable UI code does not call `Effect.runPromise`.

Focused component and integration regressions cover the real Pierre shadow-root
selection event, selected state, section scrolling, heading focus, changed-file
navigation landmark, and managed-runtime projection boundary. The adapter also
handles activation of an already-selected file through composed light-DOM host
events, without querying Pierre's shadow root. This closes the one-file mobile
edge case where selecting the only changed file previously left the sheet open.

Authenticated dev-browser acceptance on 2026-07-27 confirmed selection updates
the tree state, scrolls the selected section, moves focus to its heading, and
updates the named diff region. At 390 × 844, activating the already-selected
file closed the sheet, focused that heading after the close transition, kept
the document exactly 390 pixels wide, and produced no browser error. TREE-003
is `Verified`.

`bun run verify` passes with 59 core tests, 126 client tests, and 67
architecture/automation tests. Lazy integration emits the tree navigator as a
separate 237 KiB raw client chunk; total client output is 3.11 MiB and 801 KiB
JavaScript gzip, while the largest raw JavaScript chunk remains 1.29 MiB against
the 1.75 MiB ceiling.

### TREE-004 truthful file status

The changed-file tree now uses `@pierre/trees`' built-in Git-status lane for
supported Git states and its public `renderRowDecoration` lane to show precise
textual markers for added, modified,
deleted, renamed, copied, type-changed, and unmerged files. Binary, submodule,
and unknown-content states are appended as text rather than communicated only
through color. Each rendered diff heading repeats the full change and
non-textual content labels with the existing local `Badge` primitive, giving
reviewers an unambiguous status outside the tree's shadow root. Truncated
artifacts and incomplete projections show an explicit `Partial` badge and
`Partial changed files` heading.

The provider-neutral core projection now recognizes Git combined-diff records
(`diff --cc` and `diff --combined`) as unmerged files. It does not invent line
counts for combined hunks; content remains `unknown` unless durable metadata
proves another content kind. Unsupported diff formats still make the projection
partial and fall back to the raw candidate diff.

Focused core and client component tests cover every change kind, every content
kind, textual Pierre row decorations, full diff-heading status labels, and the
partial-projection treatment. Authenticated desktop and mobile visual review
remains pending, so TREE-004 is `Implemented`, not yet `Verified`.
`bun run verify` passes; the complete core and client suites contain 60 and 128
passing tests respectively.

### TREE-005 candidate-only folder aggregation

Pierre folder rows now show the number of candidate-changed descendant files
through the package's public row-decoration lane. Counts are calculated once
from the exact `CandidateChangedFile[]` projection already supplied to the
navigator; no repository contents, GitHub tree request, raw diff, or additional
network input participates in aggregation. Nested files contribute once to
each ancestor folder, so reviewers can understand the distribution of the
candidate without mistaking the navigator for a repository browser.

The navigator header visibly states `Candidate diff only—not the full
repository.` Folder-decoration titles repeat that the count comes from the
candidate diff and that full repository contents are not shown. Component
coverage proves `src` reports three changed descendants while
`src/components` reports two for a four-file candidate fixture containing an
unrelated root file.

The focused renderer suite passes with four tests, including the real Pierre
folder rows and canonical trailing-slash directory paths. The complete
`bun run verify` gate passes. TREE-005 is `Verified`.

### TREE-006 keyboard and screen-reader navigation

The Pierre adapter now completes the PatchPlane accessibility contract around
the package's built-in ARIA tree behavior:

- Pierre retains the single roving tab stop and owns `ArrowUp`, `ArrowDown`,
  `Home`, `End`, `ArrowRight`, and `ArrowLeft` navigation. Folder rows expose
  `aria-expanded`, and collapsing a folder while it owns focus keeps focus on
  that still-mounted folder row.
- Each mounted file row is labelled with its full candidate path, spelled-out
  change and content status, additions and deletions when known, and partial
  projection context when applicable. Folder names announce candidate-changed
  descendant counts and explicitly say that the navigator is not the full
  repository.
- The adapter raises Pierre's shadow-root focus ring to two pixels using the
  inherited PatchPlane `--ring` token. It does not introduce a feature-local
  focus style or custom UI primitive.
- Every rendered file section includes the local `Button` primitive labelled
  `Back to changed files`. Activating it reveals the selected path through
  Pierre's public `scrollToPath` API and restores focus to the stable
  `Changed files` heading without reaching into the package's shadow root.

The real Pierre shadow-DOM regression covers search filtering and result
announcements, built-in Git status, the full key map, one roving tab
stop, expanded/collapsed announcements, deterministic collapse focus, complete
file/folder accessible names, selection-to-heading focus, and deterministic
heading-to-navigator return focus. The focused renderer suite passes with five
tests. The complete `bun run verify` gate passes with 130 client tests, 60 core
tests, and 67 architecture/automation tests; production output remains within
the 12.81 MiB client-assets, 2.65 MiB JavaScript-gzip, and 1.29 MiB
largest-chunk ceilings.

Authenticated dev acceptance on 2026-07-27 loaded workflow
`ms76g9ahz6hbsr31xbynkz5pa58b7c68` and exercised the deployed Pierre tree.
`ArrowRight`, `ArrowLeft`, `Home`, and `End` preserved its single roving tab
stop; folder expansion/collapse and child traversal remained deterministic;
Enter selected the file and focused its diff heading. The 390 × 844 sheet moved
focus inside, Escape restored the trigger, and activating the already-selected
one-file candidate closed the sheet and focused the file heading with no page
overflow. The accessible diff transcript exposed German added, deleted, and
unchanged line semantics in document order.

The desktop return action still restores the stable `Changed files` heading
while preserving the selected Pierre row and its roving `tabindex`. Pierre's
public `focusPath`/`scrollToPath({ focus: true })` updates its focus model but
does not transfer DOM focus through the React shadow host, and reaching into
that shadow root remains prohibited by TREE-010. Genuine 200% browser zoom and
manual spoken screen-reader readback also remain open. TREE-006 is
`Implemented`, not `Verified`.

### TREE-007 responsive changed-file sheet

At widths below the desktop breakpoint, the changed-file rail no longer
occupies permanent workspace height. The diff instead begins with a compact
mobile toolbar built from the existing local `Button` and `Badge` primitives.
It keeps the complete selected path in a truncated, titled monospace label and
retains the selected change status beside it.

The toolbar's `Browse N changed files` action opens the existing local `Sheet`
from the left. The sheet has a required title and description, keeps the
candidate-only scope visible, provides a 44-pixel close target, and mounts the
same lazy Pierre tree adapter used on desktop. Selecting a file closes the
sheet, scrolls its already-rendered diff into view, transfers focus to the file
heading, and updates the retained toolbar path. The desktop back-navigation
button remains hidden on mobile because the persistent toolbar owns the return
path into file navigation.

The renderer regression uses the real Pierre shadow DOM and proves sheet open,
file selection, sheet close, toolbar-path update, scroll, and heading focus.
The browser performance fixture now explicitly scans the application source so
its Tailwind responsive utilities match production rather than producing a
false desktop rail at mobile widths.

Browser acceptance at 390 × 844 with the 12-file standard fixture confirmed:

- the desktop rail computed to `display: none` and the mobile toolbar to
  `display: flex`;
- the document had zero horizontal overflow;
- the sheet occupied 352 × 844 pixels, leaving visible dismiss context;
- the complete 745-pixel-high tree viewport remained independently scrollable;
- focus entered the changed-file tree, and selecting
  `src/features/feature-003/module-003.ts` closed the sheet and retained that
  path in the toolbar.

The exact implementation was also deployed successfully to the authenticated
`dev` stage. The focused renderer and architecture suites pass with 27 tests,
the complete client suite passes with 134 tests, and the production bundle
remains within all Cloudflare budgets. TREE-007 is `Verified`.

### TREE-008 empty and error state matrix

The changed-file workspace now distinguishes evidence absence from evidence
that exists but cannot be rendered as textual hunks:

| State                          | Reviewer-facing representation                                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| No textual changes             | Blocking `Diff contains no textual changes` evidence state; no empty tree is presented as a complete patch.            |
| Binary-only candidate          | The candidate path remains navigable with an explicit binary status and `No textual hunk for this file` consequence.   |
| Unavailable diff               | Retrieval state remains separate and offers an identity-bound retry only when the failure is retryable.                |
| Malformed path                 | Unsafe absolute, traversal, empty-segment, and trailing-separator paths are excluded before reaching Pierre.           |
| Unsupported record             | The excluded-record count is shown explicitly; raw bounded evidence remains available without a fabricated tree.       |
| Incomplete parsing             | Safely parsed paths remain navigable beneath a `Changed-file list is partial` warning and cannot imply completeness.   |
| Artifact-level truncation      | The artifact warning and changed-file warning both identify truncation as preview-level, not an individual-file state. |
| Metadata-only/submodule change | The path remains navigable, while the file panel explains that no supported textual hunk exists.                       |

The core projector fails closed for paths that could escape or distort the
path-first tree hierarchy. The client does not pass excluded paths or
unsupported records to Pierre. It uses the existing local `Alert`, `Badge`,
`Button`, `ScrollArea`, and `Sheet` primitives around the specialized tree and
diff runtimes.

The state-matrix regressions cover all listed states, including the distinction
between a binary artifact response and a textual Git diff containing binary
records. Focused client coverage passes with 24 tests, and focused core
projection coverage passes with 10 tests. The full verification gate passes
with 141 client tests and 65 core tests, all architecture checks, the
production build, and Cloudflare bundle budgets. A client-only `dev` deployment
and authenticated Changes-tab readback confirmed the ordinary textual path
still exposes the candidate-only tree, selected file state, and accessible
unified diff without a partial-state warning. TREE-008 is `Verified`.

### TREE-009 bounded-tree performance

The browser fixture exercises the production Pierre adapters with the standard
12-file candidate and a near-cap 56-file, 187,464-byte candidate. The full
read-only beta configuration uses prepared input, compact density, flattened
directories, search and selection subscriptions, built-in Git status, sticky
folders, and overscanned virtualization.

Measured on 2026-07-26, standard initial rendering completed in 628.0 ms
against a 2,000 ms budget, the slowest of 12 file switches completed in 40.6
ms against a 100 ms budget, and near-cap initial rendering completed in 668.2
ms against a 6,000 ms budget. The benchmark now tolerates the one-time Vite
dependency-optimization navigation and still fails on any subsequent reload,
browser error, or budget breach. The production build and bundle budgets are
part of the full repository gate. TREE-009 is `Verified`.

| ID       | Gate           | Requirement                                                                                                                                                                                                                                  | Acceptance evidence                                       | Status      |
| -------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------- |
| TREE-001 | Dependency     | Record exact version, beta/stability status, license, React/Preact compatibility, transitive dependencies, and bundle delta.                                                                                                                 | Dependency review and production build                    | Verified    |
| TREE-002 | Scope          | Supply only candidate-changed paths; do not call GitHub's repository tree API for alpha.                                                                                                                                                     | Architecture/component test with unchanged paths excluded | Verified    |
| TREE-003 | Navigation     | Selecting a file scrolls or focuses its rendered diff and updates selected state.                                                                                                                                                            | Browser interaction test                                  | Verified    |
| TREE-004 | Status         | Show added, modified, deleted, renamed, copied, type-changed, unmerged, binary, submodule, unknown-content, and partial-projection states without relying only on color.                                                                     | Component tests and visual review                         | Implemented |
| TREE-005 | Aggregation    | Folder rows may show changed-file totals but must not imply complete repository contents.                                                                                                                                                    | Copy review and component test                            | Verified    |
| TREE-006 | Accessibility  | Support expected tree keyboard behavior, visible focus, expansion announcements, and deterministic focus after collapse.                                                                                                                     | Keyboard and screen-reader acceptance checklist           | Implemented |
| TREE-007 | Responsive web | Present navigation in a drawer/sheet with the selected filename retained in the diff toolbar.                                                                                                                                                | 390 × 844 browser acceptance                              | Verified    |
| TREE-008 | Empty/error    | Represent no textual changes, binary-only candidates, unavailable diff, malformed paths, unsupported records, incomplete parsing, and artifact-level truncation.                                                                             | State-matrix component tests                              | Verified    |
| TREE-009 | Performance    | Avoid full repository loading; validate interaction with the maximum capped changed-file count.                                                                                                                                              | Performance fixture and bundle budget                     | Verified    |
| TREE-010 | Beta boundary  | Keep the prerelease package pinned behind one adapter, use public APIs only, and fail to an explicit unavailable/partial state if the adapter cannot safely render. Do not maintain a parallel flat-list renderer.                           | Architecture and state-matrix tests                       | Implemented |
| TREE-011 | UI composition | Keep Pierre responsible for specialized tree behavior, including its search, selection, Git-status, and virtualization surfaces. Build surrounding status, empty states, loading, and mobile sheet/drawer from existing local UI primitives. | Component inventory review and desktop/mobile screenshots | Implemented |

## Proposed desktop composition

| Region            | Responsibility                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------- |
| Header            | Repository / PR / attempt breadcrumb, bounded title, primary trust verdict, GitHub action |
| Trust strip       | Candidate captured, verification coverage, review findings, evidence completeness         |
| Tabs              | Summary, Changes, Evidence, Activity                                                      |
| Changes navigator | Candidate-only tree using the applicable public Pierre beta surface                       |
| Diff workspace    | Candidate-bound unified/split rendering and explicit artifact states                      |
| Review rail       | Compact verdict and blockers; expands into decision mode intentionally                    |
| Technical details | Candidate digest, artifact SHA, full request, runtime command, and provenance             |

Suggested Changes layout:

```text
┌──────────────────────────────────────────────────────────────────────┐
│ repo / PR #128 / attempt 2                    Needs review  GitHub ↗ │
│ feat(agent): make local runs discoverable and verifiable             │
├──────────────────────────────────────────────────────────────────────┤
│ Summary     Changes     Evidence     Activity                         │
├───────────────────┬──────────────────────────────────┬───────────────┤
│ Changed files     │ Diff toolbar                     │ Trust verdict │
│ ▾ engines         ├──────────────────────────────────┤ blockers      │
│   M Service.swift │ Candidate-bound diff             │ evidence gap  │
│ ▾ packages        │                                  │ Make decision │
│   A agent.ts      │                                  │               │
└───────────────────┴──────────────────────────────────┴───────────────┘
```

On mobile, the changed-file navigator becomes a drawer and the review rail
becomes a summary block followed by an explicit decision sheet.

## Delivery order

| Order | Work                                                                  | Current status | Exit condition                                                                                 |
| ----- | --------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------- |
| 1     | Verify the artifact retrieval implementation merged on `main`         | Verified       | A real authenticated candidate diff loads with matching full-artifact SHA-256                  |
| 2     | Separate and bound PR title, PR body, and external-review payloads    | Verified       | Queue and report `h1` contain only the GitHub PR title                                         |
| 3     | Render the PR body as sanitized GitHub-flavored Markdown              | Verified       | Summary is readable and unsafe provider markup cannot execute                                  |
| 4     | Establish compact report header and verdict hierarchy                 | Verified       | Tabs and trust explanation appear in the first viewport                                        |
| 5     | Build the fixture-only local visual harness and exclusion checks      | Not started    | Deterministic states render locally and fixture code is absent from deployed bundles           |
| 6     | Implement the structured diff preview transport                       | Verified       | Renderer input contains raw diff content only; full-artifact identity and truncation are clear |
| 7     | Run the `@pierre/diffs` decision spike                                | In progress    | Adopt/reject/fallback decision and gate evidence are recorded                                  |
| 8     | Implement the selected candidate-bound renderer and coherence states  | In progress    | Unified diff is readable, accessible, and fails closed for incoherent or partial evidence      |
| 9     | Validate the full read-only `@pierre/trees` beta surface              | In progress    | Applicable public APIs pass accessibility, performance, and bundle gates                       |
| 10    | Integrate truthful changed-file navigation                            | In progress    | Search, status, selection, and keyboard flow work on desktop and responsive web                |
| 11    | Refactor review rail and decision mode                                | Verified       | Inspection is primary; decisions retain all existing safety gates                              |
| 12    | Complete responsive-web, localization, and accessibility acceptance   | In progress    | Browser and component evidence closes applicable tracker rows                                  |
| 13    | Run authenticated dev and live dogfood acceptance on recorded commits | In progress    | M9.5 review ergonomics and relevant M9.75/M10 live rows have evidence                          |

## Completion rule

The alpha review experience is ready when:

1. a reviewer can identify the candidate and primary trust verdict immediately,
2. the exact candidate-bound artifact loads as a complete diff or a clearly
   bounded preview whose full-artifact identity and size are visible,
3. every changed file is reachable by keyboard and pointer when parsing is
   complete; incomplete projections never claim complete coverage,
4. unavailable, binary, oversized, malformed, truncated, stale, mutated,
   mismatched, and superseded evidence is represented truthfully,
5. no raw code or diff content is sent to analytics,
6. responsive-web review remains usable at mobile viewport widths without a
   complete repository tree or native mobile client,
7. approval, rejection, and request-changes actions retain their durable comment,
   verification override, provenance, and publication safeguards,
8. feature surfaces compose the existing local UI primitives without adding
   bespoke feature-local design-system substitutes,
9. the selected diff renderer has an explicit, evidence-backed adoption decision,
10. each integrated review slice has deterministic local fixture evidence and
    authenticated dev-stage evidence tied to a recorded source commit and
    deployment output, and
11. the live dogfood run closes the corresponding acceptance-matrix gaps.
