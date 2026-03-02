# Orchestra iOS Mobile App — UX Design

This document defines the detailed UX and interaction design for the Orchestra iOS companion app. It builds on the architecture and API contract defined in `docs/expo-app.md` and fills in the visual, interaction, and behavioral details.

## Design Decisions

- **Visual identity**: Orchestra-native — custom chrome, sharp corners, Orchestra's own design language. Not iOS-native, not hybrid.
- **Themes**: Default theme only (light/dark) for MVP.
- **Tool display**: Desktop-style expandable cards in the chat timeline.
- **Composer**: Fixed bottom bar, iMessage-style with send/interrupt toggle.
- **Permissions**: Inline approval cards in the chat timeline.
- **Session list**: Flat recency list with workspace as subtitle.
- **Connection status**: Header chip (dot + label), tappable for detail sheet.
- **Markdown**: Full parity with desktop (Shiki syntax highlighting, mermaid, LaTeX, tables, collapsible sections).
- **New session**: Quick-start with defaults, configure after via overflow menu.
- **Navigation**: Two-screen focus (Sessions List + Chat). No tabs, drawers, or bottom nav.

## Screen 1: Sessions Home

```
┌─────────────────────────────────┐
│ Sessions        [●▸]      [+]  │
├─────────────────────────────────┤
│                                 │
│ ┌─────────────────────────────┐ │
│ │ ● Fix auth bug         2m  │ │
│ │   my-app • running         │ │
│ └─────────────────────────────┘ │
│ ┌─────────────────────────────┐ │
│ │   Add dark mode         1h  │ │
│ │   my-app • idle            │ │
│ └─────────────────────────────┘ │
│ ┌─────────────────────────────┐ │
│ │   Deploy pipeline       3h  │ │
│ │   infra • waiting          │ │
│ └─────────────────────────────┘ │
│                                 │
└─────────────────────────────────┘
```

### Header

- Title "Sessions" (left).
- Connection chip (center-left) — colored dot + runtime name, tappable for detail sheet.
- Settings gear icon.
- New session "+" button (right).

### Session Cells

- Row 1: Session title (bold) + relative timestamp (right-aligned).
- Row 2: Workspace name + status badge (running/idle/waiting/error).
- Unread sessions get an accent-colored dot left of the title.
- Active/running sessions get a subtle animated indicator on the status badge.
- Sharp corners on cells, Orchestra surface colors.

### Interactions

- Tap cell: open chat.
- Swipe left: mark read/unread.
- Swipe right: delete (with confirmation).
- Long-press: action sheet (rename, status, permission mode, delete).
- Pull-to-refresh: requery sessions.

### States

- Empty: centered illustration + "Create your first session" CTA.
- Offline: cached list shown, destructive actions disabled, connection chip shows red.
- Loading: shimmer placeholders (Orchestra-style).

## Screen 2: Chat

```
┌─────────────────────────────────┐
│ ◀  Fix auth bug   [●▸]    [⋯]  │
├─────────────────────────────────┤
│                                 │
│              ┌────────────────┐ │
│              │ Fix the auth   │ │
│              │ bug in login   │ │
│              └────────────────┘ │
│                                 │
│ ┌───────────────────────────┐   │
│ │ I'll investigate the auth │   │
│ │ flow.                     │   │
│ │                           │   │
│ │ ┌───────────────────────┐ │   │
│ │ │ Read  auth.ts      ✓  │ │   │
│ │ │ ───────────────────── │ │   │
│ │ │ export async function │ │   │
│ │ │ login(credentials)... │ │   │
│ │ └───────────────────────┘ │   │
│ │ ┌───────────────────────┐ │   │
│ │ │ Edit  auth.ts      ✓  │ │   │
│ │ │ ───────────────────── │ │   │
│ │ │ - if (token.expired)  │ │   │
│ │ │ + if (token.isExpired │ │   │
│ │ └───────────────────────┘ │   │
│ │ ┌───────────────────────┐ │   │
│ │ │ ◉ Bash  running...    │ │   │
│ │ └───────────────────────┘ │   │
│ └───────────────────────────┘   │
│                                 │
├─────────────────────────────────┤
│ 📎 ┌───────────────────┐  ⏹    │
│    │ Message...         │       │
│    └───────────────────┘        │
└─────────────────────────────────┘
```

### Header

- Back arrow (left): returns to sessions list.
- Session title (center, tappable to rename inline).
- Connection chip (right of title).
- Overflow menu "⋯" (right): sheet with rename, set status, permission mode, delete session.

### Timeline

- User messages: right-aligned bubbles with 5% foreground surface color.
- Assistant messages: left-aligned, full-width block on paper surface.
- Tool cards: embedded inside assistant blocks, sharp corners, expandable.
  - Collapsed: icon + tool name + target + status checkmark/spinner.
  - Expanded: shows input/output content with syntax highlighting.
  - Tap to toggle expand/collapse.
  - Edit tools show inline diff (red/green lines).
  - Bash tools show terminal-styled output.
- Streaming text: appends character-by-character, pinned to bottom while active.
- Status/info rows: subtle inline text (e.g., "Thinking...", model info).
- Error rows: destructive-colored text with readable label.

### Scroll Behavior

- Auto-follow when user is at bottom and stream is active.
- User scrolls up: auto-follow pauses, "Jump to Live" pill appears at bottom.
- Tap "Jump to Live": scroll to bottom, re-enable auto-follow.
- On reconnect: restore position, don't drop streamed content.

### Composer (Fixed Bottom Bar)

- Attach button (left): opens picker (camera, photo library, files).
- Multiline text input (center): grows upward, max ~5 lines before scrolling.
- Send button (right, when idle): accent colored, disabled when empty.
- Interrupt button (right, when running): replaces send, destructive color, stop icon.
- Keyboard avoidance: composer pushes up with keyboard, chat scrolls to maintain position.

### Permission Cards (Inline)

```
┌───────────────────────────┐
│  ⚠ Permission Request     │
│  ─────────────────────    │
│  Tool: Bash               │
│  Command: npm test        │
│                           │
│  [  Deny  ]  [ Approve ]  │
└───────────────────────────┘
```

- Prominent card in timeline flow, accent border.
- Clear tool name and command/args.
- Two-button layout: Deny (outline) + Approve (filled accent).
- Persists across app background/foreground.
- Resolved cards collapse to a single "Approved" / "Denied" line.

### Credential Requests

Same inline pattern as permission cards, with a secure text input field instead of approve/deny buttons.

## Onboarding & Pairing

### Screen 1: Welcome

```
┌─────────────────────────────────┐
│                                 │
│         ┌───────────┐           │
│         │ Orchestra │           │
│         │   logo    │           │
│         └───────────┘           │
│                                 │
│    Orchestra for iPhone         │
│                                 │
│    Connect to your Mac to       │
│    continue conversations       │
│    and manage agent sessions    │
│    from anywhere.               │
│                                 │
│  ┌─────────────────────────┐    │
│  │      Pair Device        │    │
│  └─────────────────────────┘    │
│                                 │
│       How It Works →            │
│                                 │
└─────────────────────────────────┘
```

Single purpose: explain the remote runtime model and start pairing. "How It Works" is a secondary link (modal or scroll-to explanation).

### Screen 2: Find Runtime

```
┌─────────────────────────────────┐
│ ◀  Connect                      │
├─────────────────────────────────┤
│                                 │
│  Searching for Orchestra        │
│  runtimes on your network...    │
│                                 │
│ ┌─────────────────────────────┐ │
│ │ ◉ Hunter's MacBook Pro      │ │
│ │   192.168.1.42 • online     │ │
│ └─────────────────────────────┘ │
│                                 │
│  ─ or enter manually ────────   │
│                                 │
│  ┌─────────────────────────┐    │
│  │ hostname or IP address  │    │
│  └─────────────────────────┘    │
│  ┌─────────────────────────┐    │
│  │        Connect          │    │
│  └─────────────────────────┘    │
│                                 │
└─────────────────────────────────┘
```

- Auto-discovers local/Tailscale hosts via mDNS/Bonjour.
- Manual entry always visible below the discovered list.
- Preserves typed host across retries.
- Tapping a discovered host goes straight to pairing.

### Screen 3: Confirm Pair

```
┌─────────────────────────────────┐
│ ◀  Pair Device                  │
├─────────────────────────────────┤
│                                 │
│  Enter the code shown on        │
│  your Mac                       │
│                                 │
│   ┌───┐ ┌───┐ ┌───┐            │
│   │ 4 │ │ 7 │ │ 2 │  —         │
│   └───┘ └───┘ └───┘            │
│   ┌───┐ ┌───┐ ┌───┐            │
│   │   │ │   │ │   │            │
│   └───┘ └───┘ └───┘            │
│                                 │
│   Expires in 4:32               │
│                                 │
│   Code not showing?             │
│   Open Orchestra on your Mac    │
│   and check the pairing menu.   │
│                                 │
└─────────────────────────────────┘
```

- 6-digit segmented code input.
- Auto-advance focus per digit, paste support, auto-submit when all 6 entered.
- Countdown timer. On expiry: clear fields, show retry guidance.

### Screen 4: Pair Success

```
┌─────────────────────────────────┐
│                                 │
│           ┌─────┐               │
│           │  ✓  │               │
│           └─────┘               │
│                                 │
│        Connected to             │
│    Hunter's MacBook Pro         │
│                                 │
│  ┌─────────────────────────┐    │
│  │     Open Sessions       │    │
│  └─────────────────────────┘    │
│                                 │
└─────────────────────────────────┘
```

Confirmation with connected host name. Haptic success feedback.

### Edge Cases

- No runtimes found: empty state with troubleshooting copy + manual entry still available.
- Wrong code: shake animation on fields, clear last 3 digits, keep focus.
- Network error during pairing: toast with retry, don't lose entered host selection.

## Attachments

### Source Picker

Bottom sheet with three options: Camera, Photos, Files.

- Camera: launches native camera, captured image goes directly to upload staging.
- Photos: iOS photo picker (PHPicker).
- Files: iOS document picker for PDFs, text files, etc.

### Upload Staging

- Selected files appear as a row above the composer input.
- Each file shows: thumbnail/icon + filename + progress bar + cancel (✕).
- Multiple files can be staged before sending.
- MIME/size validation before upload begins.
- Tap staged image for full-screen preview before sending.

### Upload Behavior

- Uploads start immediately on selection.
- Cancel removes file from staging and aborts upload.
- On failure: row turns destructive color, shows "Failed — Tap to retry".
- Transient network failure vs unsupported file type get distinct error copy.

### In Timeline After Send

- Images: inline preview thumbnail (tappable for full-screen).
- Non-image files: file chip (icon + filename).
- Attached to the user message bubble.

## Settings

```
┌─────────────────────────────────┐
│ ◀  Settings                     │
├─────────────────────────────────┤
│                                 │
│  CONNECTED RUNTIME              │
│ ┌─────────────────────────────┐ │
│ │  Hunter's MacBook Pro       │ │
│ │  192.168.1.42               │ │
│ │  Last sync: just now        │ │
│ │                             │ │
│ │  [  Unpair This Device  ]   │ │
│ └─────────────────────────────┘ │
│                                 │
│  APPEARANCE                     │
│ ┌─────────────────────────────┐ │
│ │  Color mode                 │ │
│ │  ┌────────┬────────┬──────┐ │ │
│ │  │ Light  │ Dark   │System│ │ │
│ │  └────────┴────────┴──────┘ │ │
│ └─────────────────────────────┘ │
│                                 │
│  DIAGNOSTICS                    │
│ ┌─────────────────────────────┐ │
│ │  SSE Status      Connected  │ │
│ │  App Version         0.1.0  │ │
│ │  Runtime Version     0.5.1  │ │
│ │                             │ │
│ │  [ Copy Diagnostic Bundle ] │ │
│ └─────────────────────────────┘ │
│                                 │
└─────────────────────────────────┘
```

### Access

Gear icon on sessions list header.

### Connected Runtime

- Shows paired host name and IP/hostname.
- Last successful sync timestamp.
- "Unpair This Device" — destructive action with confirmation alert. After unpairing, returns to Welcome screen.

### Appearance

- Segmented control for Light / Dark / System.
- Immediate preview, no save button.

### Diagnostics

- SSE connection status (Connected / Reconnecting / Offline).
- App version (mobile build) and runtime version (from `/api/health`).
- "Copy Diagnostic Bundle" — copies text block to clipboard with: app version, runtime version, SSE state, device model, OS version, network type, last error. Toast confirms copy.

### Connection Detail Sheet

Tapping the header chip on any screen:

```
┌─────────────────────────────────┐
│  Connection                     │
│  ───────────────────────────    │
│                                 │
│  ● Connected                    │
│  Hunter's MacBook Pro           │
│  192.168.1.42:7842              │
│                                 │
│  Latency: 12ms                  │
│  Uptime: 2h 14m                 │
│  Events received: 1,247         │
│                                 │
│  ┌─────────────────────────┐    │
│  │      Reconnect          │    │
│  └─────────────────────────┘    │
│                                 │
└─────────────────────────────────┘
```

- Live connection stats.
- Reconnect button forces a fresh SSE connection.
- Auto-dismisses after 5 seconds of inactivity, or swipe down.

## Cross-Cutting Behaviors

### Connection State Machine

```
  connected ──network loss──▶ reconnecting
      ▲                           │
      │                     exponential backoff
      │                     (1s, 2s, 4s, 8s, max 30s)
      │                           │
      └───── SSE re-established ──┘
                                  │
                            after 60s fails
                                  │
                                  ▼
                              offline
                          (manual retry only)
```

- Connected: green chip, all actions enabled.
- Reconnecting: yellow chip, reads from cache, writes queued.
- Offline: red chip, cached data shown, destructive actions disabled, send queues messages with "Will send when reconnected" label.

### Queued-Send Behavior

- If user sends while reconnecting/offline, message appears in timeline with a "pending" indicator (clock icon).
- On reconnect: queued messages send in order automatically.
- If reconnect fails permanently: pending messages stay with "Failed — Tap to retry".

### Haptics

- Message sent: light impact.
- Interrupt acknowledged: medium impact.
- Permission approved/denied: light impact.
- Error received: notification error pattern.
- Pull-to-refresh threshold: selection tick.
- Swipe action trigger: selection tick.
- Pair success: success notification.

### Animations

Orchestra-native, not iOS spring defaults:

- Tool cards expand/collapse: 200ms ease-out height transition.
- Streaming text: no animation, direct append.
- Permission card appearance: 150ms fade-in + subtle scale from 0.97.
- "Jump to Live" pill: fade in/out 150ms.
- Screen transitions: horizontal slide, 250ms, ease-in-out.
- Session list cell swipe: follows finger, snaps at threshold.
- Composer height change: 100ms ease-out.
- Connection banner state changes: 200ms crossfade.

### Keyboard Handling

- Composer pushes up with keyboard.
- Chat content insets adjust so last message stays visible.
- Tapping outside composer dismisses keyboard.
- Hardware keyboard: Enter sends, Shift+Enter newline.

### Accessibility

- All touch targets minimum 44x44pt.
- Dynamic Type support for all text.
- VoiceOver labels on all interactive elements.
- Tool card status announced on change.
- Permission cards marked as alerts for VoiceOver priority.
- Reduce Motion: disable all animations except essential state changes.

### Error Handling

- Network errors: inline toast, auto-dismiss 4s, tappable for details.
- API errors (4xx/5xx): inline in timeline as error row with readable message.
- Typed errors from agent: destructive-colored card with error type label + description.
- Token expired: full-screen re-pair prompt, no silent failure.
- Runtime unreachable on launch: go to Find Runtime screen with last-used host pre-filled.

### Background/Foreground Transitions

- App backgrounded: SSE connection held for ~30 seconds, then dropped.
- App foregrounded: immediate reconnect + catch-up from last event cursor.
- Pending permission requests survive background/foreground cycle.
- No data loss — last-known state cached locally.
