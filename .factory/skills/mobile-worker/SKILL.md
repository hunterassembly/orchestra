---
name: mobile-worker
description: Builds the Expo iOS mobile app, tokens package, and mobile UI components
---

# Mobile Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features that involve:
- `apps/mobile` (Expo React Native app — routing, screens, components, stores)
- `packages/mobile-tokens` (design tokens for React Native)
- Mobile UI components and primitives
- Zustand stores, event processor, connection state machine
- Screen implementations (onboarding, sessions, chat, settings)
- Cross-cutting mobile behaviors (haptics, animations, keyboard, accessibility)

## Work Procedure

### 1. Understand the Feature

Read the feature description, preconditions, expectedBehavior, and verificationSteps carefully. Check `{missionDir}/AGENTS.md` for conventions and boundaries. Check `.factory/library/` for architecture decisions and patterns.

Reference the UX design spec at `docs/plans/2026-03-01-mobile-ux-design.md` for visual and interaction details. Reference the implementation plan at `docs/expo-app.md` for technical architecture.

### 2. Check Preconditions

Verify all preconditions are met:
- Required packages/app structure exists
- Dependencies are installed
- Any prerequisite stores, API clients, or components exist

If preconditions are NOT met, return to orchestrator.

### 3. Write Tests First (RED)

Before implementing, write failing tests:

**For stores/reducers/utilities:**
- Test state transitions and derived state
- Test event processing produces correct output
- Test edge cases (empty state, malformed events, concurrent updates)
- Use Jest with `jest-expo` preset

**For components:**
- Test rendering (correct elements appear)
- Test interactions (tap, swipe handlers called correctly)
- Test conditional rendering (loading, empty, error, offline states)
- Use `@testing-library/react-native`

**For tokens:**
- Test token values match expected desktop defaults
- Test light/dark resolution

Tests go in `__tests__/` directories. Run with `npx jest` from `apps/mobile` or `bun test` for tokens package.

Run tests to confirm they FAIL (red phase).

### 4. Implement (GREEN)

Implement to make tests pass:

**Expo/React Native patterns:**
- Routes in `src/app/` using expo-router conventions
- `_layout.tsx` for navigation structure (Stack, groups)
- Zustand stores with typed state and actions
- Components use tokens from `@craft-agent/mobile-tokens`
- No hardcoded colors/spacing — always use token references
- Orchestra design language: sharp corners, custom chrome, NOT iOS-native styling

**Component patterns:**
- Functional components with TypeScript props interfaces
- Use React Native core components (View, Text, Pressable, TextInput, ScrollView, FlatList)
- Animations via react-native-reanimated where needed
- Gesture handling via react-native-gesture-handler
- Safe area handling via react-native-safe-area-context

### 5. Run All Tests (GREEN)

```bash
cd apps/mobile && npx jest
# or for tokens:
cd packages/mobile-tokens && bun test
```

ALL tests must pass.

### 6. TypeScript Check

```bash
cd apps/mobile && npx tsc --noEmit
# or for tokens:
cd packages/mobile-tokens && bun run tsc --noEmit
```

Must pass with zero errors.

### 7. Manual Verification

Since no iOS simulator is available, verify via:
- Component tests pass and test the right things
- TypeScript compiles without errors
- Review component code for correctness against UX spec
- Check that all expected UI elements are rendered in tests

For each verified behavior, record in `interactiveChecks` what you checked and how.

### 8. Verify Adjacent Features

Run tests for related packages to ensure no regressions:
```bash
cd packages/mobile-tokens && bun test  # if tokens changed
cd apps/mobile && npx jest             # full mobile test suite
```

## Example Handoff

```json
{
  "salientSummary": "Built Sessions Home screen with list cells, swipe actions, pull-to-refresh, and long-press action sheet. Wrote 15 Jest tests covering rendering, interactions, empty state, and offline behavior. All pass. TypeScript clean.",
  "whatWasImplemented": "SessionsHome screen at apps/mobile/src/app/(main)/sessions/index.tsx with SessionListItem, SessionActionSheet components. Connected to sessions Zustand store. Implements tap-to-open, swipe-left read/unread, swipe-right delete with confirmation, long-press action sheet, pull-to-refresh, empty state CTA, offline disabled actions.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "cd apps/mobile && npx jest --testPathPattern sessions", "exitCode": 0, "observation": "15 tests passed" },
      { "command": "cd apps/mobile && npx tsc --noEmit", "exitCode": 0, "observation": "No type errors" }
    ],
    "interactiveChecks": [
      { "action": "Reviewed SessionListItem render test", "observed": "Test verifies title, timestamp, workspace name, status badge, unread dot all render correctly" },
      { "action": "Reviewed swipe action tests", "observed": "Tests verify swipe-left toggles read/unread store state, swipe-right shows confirmation then calls delete" },
      { "action": "Reviewed empty state test", "observed": "Test verifies illustration and Create CTA render when sessions array is empty" },
      { "action": "Reviewed offline state test", "observed": "Test verifies delete swipe action is disabled when connection state is offline" }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "apps/mobile/src/app/(main)/sessions/__tests__/index.test.tsx",
        "cases": [
          { "name": "renders session list with correct cell content", "verifies": "Session cells show title, time, workspace, status" },
          { "name": "tap cell navigates to chat", "verifies": "Navigation called with correct sessionId" },
          { "name": "swipe left toggles read/unread", "verifies": "Store markRead/markUnread called" },
          { "name": "empty state shows CTA", "verifies": "Create session CTA visible when no sessions" },
          { "name": "offline disables destructive actions", "verifies": "Delete swipe disabled when offline" }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Required API client methods or types from mobile-contracts don't exist yet
- Token values need clarification from desktop theme that's ambiguous
- A screen requires data from a gateway endpoint not yet implemented
- Expo/RN library compatibility issue that needs architectural decision
