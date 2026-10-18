# Goose On The Go

Mobile companion for your Pond -- the on-device AI assistant that keeps your data at home. Built with React Native and Expo, designed with the Jarida Design System.

Inspired by Alexa, Google Home, and Claude Mobile -- combining smart home control, AI chat, and device management in one fluid experience.

## Screens

**4 Tab Screens:**
- **Home** -- personalized greeting, "Ask Goose" bar, device grid, shortcuts, now playing, recent chats
- **Chat** -- AI conversation with Goose, suggested prompts, voice input, streaming responses
- **Devices** -- room-grouped smart home grid with color-coded toggles and room filters
- **You** -- profile hub with stats, settings, integrations, media, household management

**15 Sub-Screens:**
- AI Models, Memories, Activity Logs, Schedule
- App Integrations (MCP), MCP Servers
- Photos & Videos, Photo Upload/Analysis
- Users, Home Management
- Backup, Restore to Pond, Privacy & Licenses
- Pond Device Pairing wizard

**Listening Overlay** -- full-screen ambient mode with pulsing rings and waveform

## Architecture

**MVVM** with React hooks:
```
Views (Screens)      -> app/(tabs)/, app/(stack)/
ViewModels (Hooks)   -> view-models/
Models (Types)       -> models/
```

## Design System

**Jarida Design System** -- purple `#8C4BFF` brand, Quicksand + Comfortaa typography, 4pt spacing grid. All components built in-house.

## Getting Started

```bash
npm install
npx expo run:android   # build and install a development build, once
npx expo start         # then serve the JavaScript to it
```

`expo-dev-client` is a dependency, so `npx expo start` serves a development build,
not Expo Go: install one first with `npx expo run:android`, and rebuild it only when
native code or a config plugin changes. To work in Expo Go instead, or to reach
Metro over Wi-Fi rather than USB, see [Development](docs/development.md).

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Component Guide](docs/COMPONENT-GUIDE.md)
- [Development](docs/development.md)
- [Design System](docs/DESIGN-SYSTEM.md)
- [Navigation](docs/NAVIGATION.md)
- [Testing](docs/TESTING.md)
- [Phone context](docs/PHONE-CONTEXT.md) — proposal: what the phone could share with its Pond

## Tech Stack

- Expo SDK 57 + Expo Router
- React Native 0.86 with New Architecture
- React 19 + React Compiler
- react-native-reanimated, react-native-svg
- TypeScript strict mode
