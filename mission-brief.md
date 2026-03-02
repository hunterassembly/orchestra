# Orchestra Mobile — What We're Building

Orchestra is a mobile client for Craft Agents — a direct port of the Electron desktop app to an Expo (React Native) app, built to run on iPhone with the same styles, components, and functionality, adapted for a mobile form factor.

The backend is Craft Agents running on your Mac. Orchestra connects to it over Tailscale. No cloud, no separate server, no new infrastructure — just your existing setup with a phone-native front door.

## UX Goals

The experience should feel like the desktop app shrank to fit your phone — not a stripped-down companion, not a "monitor only" view. Everything that works on desktop works on mobile. Same session sidebar, same chat interface, same streaming agent output, same document rendering. The visual language is identical: same typography, same spacing, same component styles.

The mobile-specific considerations are purely about form factor:
- Session sidebar becomes a slide-in drawer or bottom sheet
- Chat input gets a proper mobile keyboard treatment with voice input as a first-class option
- Streaming output is readable without horizontal scrolling
- Documents and code blocks are tap-to-expand when they need more space
- Tailscale handles the connection — you open the app and you're in, same as sitting at your desk

## The Goal in One Sentence

Pick up your phone and continue exactly where you left off on the desktop, with no degradation in what you can do.
