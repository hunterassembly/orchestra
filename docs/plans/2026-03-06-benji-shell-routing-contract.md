# Benji Wave 1 Shell and Routing Contract

## Purpose

This document defines the Wave 1 shell contract for Benji on top of the current Craft Agents renderer architecture.

It exists to answer one implementation question clearly:

How do we move from the current session/source/settings-oriented shell to Benji's `Agent` and `Project Canvas` model without breaking the existing runtime substrate?

This contract is the execution companion to:

- `/Users/hunter/Documents/GitHub/orchestra/docs/prds/master.md`
- `/Users/hunter/Documents/GitHub/orchestra/docs/plans/2026-03-06-benji-wave-1.md`

## User Narrative

Wave 1 should change the user's orientation immediately.

When the user opens Benji:

- they land on `Agent`, not a session list
- they can see what moved, what needs review, and what deserves attention next
- opening a project takes them into a `Project Canvas`, not into disconnected session/detail surfaces
- `Tasks`, `Threads`, and `Queue` are visible as Benji concepts, even if some of their backing data still comes from Craft session state

The shell should teach the product model before deeper orchestration exists.

## Current Architecture Snapshot

Wave 1 is constrained by the current renderer structure:

- Route builders live in `/Users/hunter/Documents/GitHub/orchestra/apps/electron/src/shared/routes.ts`
- Navigation state parsing and URL restoration live in `/Users/hunter/Documents/GitHub/orchestra/apps/electron/src/renderer/contexts/NavigationContext.tsx`
- Navigator type definitions live in `/Users/hunter/Documents/GitHub/orchestra/apps/electron/src/renderer/lib/navigation-registry.ts`
- Main panel routing lives in `/Users/hunter/Documents/GitHub/orchestra/apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx`
- Top bar shell chrome lives in `/Users/hunter/Documents/GitHub/orchestra/apps/electron/src/renderer/components/app-shell/TopBar.tsx`
- Current left navigation composition lives in `/Users/hunter/Documents/GitHub/orchestra/apps/electron/src/renderer/components/app-shell/AppShell.tsx`

Current user-facing shell truth:

- top-level shell is still largely built around `All Sessions`, `Flagged`, `Status`, `Labels`, `Sources`, `Skills`, `Automations`, `Tasks`, `Settings`, and `What's New`
- `NavigationRegistry` still only models `sessions`, `sources`, and `settings`
- `routes.ts` still uses `allSessions`, `flagged`, `archived`, `sources`, `skills`, `automations`, `notes`, and `settings` as primary top-level route builders
- `MainContentPanel` still routes primarily by Craft-era navigators, with notes added as a newer layer

## Wave 1 Target Shell

Wave 1 top-level navigation becomes:

- `Agent`
- `Projects`
- `Tasks`
- `Notes`
- `Threads`
- `Queue`
- `Settings`

Supporting rule:

- Craft-native surfaces such as `sessions`, `sources`, `skills`, and `automations` may continue to exist internally or as advanced/debug surfaces, but they are no longer the default user-facing ontology.

## Default Landing Contract

- App boot should resolve to `Agent`
- `Agent` is the default home surface for review, momentum, and next actions
- The shell should no longer default to an `allSessions` route for the main product experience

## Project Canvas Contract

Project opening behavior for Wave 1:

- opening a project lands in `Project Canvas`
- `Project Canvas` is the default project surface
- the canvas must include:
  - center living document region
  - project pulse/activity strip
  - right-side context panel container
  - visible contextual tasks, threads, and runs as supporting context

Project Canvas is not:

- a folder browser
- a session detail page
- a set of disconnected tabs with no primary working surface

## Route Contract

### New primary route family

Wave 1 should introduce explicit Benji route builders:

- `routes.view.agent()`
- `routes.view.projects()`
- `routes.view.project(projectId, section?)`
- `routes.view.tasks()`
- `routes.view.notes(notePath?)`
- `routes.view.threads(threadId?)`
- `routes.view.queue()`
- `routes.view.settings(subpage?)`

Suggested project route shape:

- `projects`
- `projects/project/{projectId}`
- `projects/project/{projectId}/{section}`

Suggested project sections:

- `canvas`
- `notes`
- `tasks`
- `threads`
- `artifacts`
- `repos`
- `activity`

### Legacy route handling

Wave 1 should keep existing route builders functioning during migration:

- `allSessions`
- `flagged`
- `archived`
- `state/{id}`
- `label/{id}`
- `view/{id}`
- `sources*`
- `skills*`
- `automations*`

But these routes should be treated as:

- internal
- legacy
- advanced/debug
- or adapter-backed entry points

They should not remain the main shell contract.

## Navigation State Contract

### Current limitation

Current `NavigationRegistry` only models:

- `sessions`
- `sources`
- `settings`

Current `NavigationContext` has additional special-case support for:

- notes
- skills
- automations

This is already beyond the original registry shape and is one reason the current shell feels partially layered rather than coherent.

### Wave 1 target

Navigation state should explicitly model Benji navigators:

- `agent`
- `projects`
- `tasks`
- `notes`
- `threads`
- `queue`
- `settings`

Recommended approach:

- evolve the navigation state with new Benji navigator variants rather than trying to shoehorn Benji into `sessions`
- preserve legacy route parsing during migration
- keep right-sidebar behavior orthogonal to the top-level navigator state

### Project details state

Wave 1 should add an explicit project-scoped navigation shape, for example:

- `navigator: 'projects'`
- `details: { type: 'project', projectId: string, section: 'canvas' | 'notes' | 'tasks' | 'threads' | 'artifacts' | 'repos' | 'activity' }`

This is the foundation for `Project Canvas` as a first-class default.

## Main Content Routing Contract

`MainContentPanel` should become the place where the Benji shell becomes real.

Wave 1 target destinations:

- `Agent` → `AgentHomePage`
- `Projects` list → `ProjectsPage`
- `Project Canvas` → `ProjectCanvasPage`
- `Tasks` → `TasksPage`
- `Notes` → existing vault note surfaces, wrapped in Benji framing
- `Threads` → `ThreadsPage`
- `Queue` → `QueuePage`
- `Settings` → existing settings surface

Migration rule:

- reuse existing page implementations where they already fit
- wrap or adapt Craft-native pages when they are structurally useful
- do not expose Craft-first page names as the primary product truth

## Sidebar Contract

### Current sidebar

The current left sidebar in `AppShell.tsx` is a mixed ontology:

- sessions and filters
- notes/tasks
- sources
- skills
- automations
- settings
- what's new

### Wave 1 sidebar

The left sidebar should become a clean Benji shell:

- `Agent`
- `Projects`
- `Tasks`
- `Notes`
- `Threads`
- `Queue`
- `Settings`

Wave 1 rule:

- do not expose `Sources`, `Skills`, and `Automations` as primary shell navigation
- if these remain reachable, they should move behind settings, advanced menus, or project-context actions

## Top Bar Contract

Wave 1 top bar changes should be minimal but intentional.

Required shifts:

- remove obvious Craft-first branding cues where practical
- make the top bar neutral to Benji's new navigators
- avoid top bar copy or menus that re-center the product on Craft concepts

Non-goal for Wave 1:

- do not redesign the entire top bar information architecture unless it blocks shell clarity

## Adapter and Data Rules

Wave 1 should not require a full persistence rewrite.

Allowed strategy:

- derive Benji-facing `Project`, `Task`, `Run`, `Thread`, and `ReviewItem` models from existing session/runtime/note data
- present Benji concepts in the shell even when the backing data still comes from Craft-era stores

Not allowed:

- exposing Craft session internals directly as the default user-facing model

## Migration Strategy

1. Add Benji route builders alongside legacy route builders.
User benefit: shell implementation can move forward without breaking existing navigation entry points.

2. Add Benji navigator variants to navigation state and parsing.
User benefit: the app can reason in the product's real concepts instead of hiding them inside session-era abstractions.

3. Replace the left sidebar with the Wave 1 Benji shell.
User benefit: the product becomes legible immediately when the app opens.

4. Add `AgentHomePage` and make it the default landing surface.
User benefit: the user opens into momentum and next actions instead of a session list.

5. Add `ProjectsPage` and `ProjectCanvasPage`.
User benefit: projects become obvious workbenches instead of secondary wrappers around older runtime views.

6. Move notes/tasks/thread/run visibility into project context via adapters.
User benefit: work becomes visible where it matters instead of living across disconnected panels.

7. Demote legacy shell destinations from the primary navigation.
User benefit: Benji feels like a coherent product instead of a mixed-mode internal tool.

## Non-Goals

Wave 1 shell work does not need to:

- finalize the permanent backend data model
- ship the full artifact/variant system
- complete embedded coding panel depth
- delete all legacy routes and views immediately

## File Touchpoints

Primary implementation files for the shell migration:

- `/Users/hunter/Documents/GitHub/orchestra/apps/electron/src/shared/routes.ts`
- `/Users/hunter/Documents/GitHub/orchestra/apps/electron/src/renderer/lib/navigation-registry.ts`
- `/Users/hunter/Documents/GitHub/orchestra/apps/electron/src/renderer/contexts/NavigationContext.tsx`
- `/Users/hunter/Documents/GitHub/orchestra/apps/electron/src/renderer/components/app-shell/AppShell.tsx`
- `/Users/hunter/Documents/GitHub/orchestra/apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx`
- `/Users/hunter/Documents/GitHub/orchestra/apps/electron/src/renderer/components/app-shell/TopBar.tsx`

Likely new page/component additions:

- `AgentHomePage`
- `ProjectsPage`
- `ProjectCanvasPage`
- `TasksPage`
- `ThreadsPage`
- `QueuePage`
- Benji adapter/view-model modules

## Acceptance for This Contract

This contract is complete when:

- implementation can name the target top-level navigators unambiguously
- project opening behavior is defined clearly as `Project Canvas`
- route and navigation-state migration can proceed without inventing structure mid-flight
- the current Craft shell seams to be changed are explicitly identified
