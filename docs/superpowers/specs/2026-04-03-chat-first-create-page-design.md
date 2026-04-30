# Chat-First Create Page Redesign

**Date:** 2026-04-03
**Status:** Approved

## Problem

The Create page has a two-column layout on desktop (AI chat left 55%, song details form right 45%) and stacked on mobile (chat on top, collapsible form below). The form feels disconnected from the chat — users describe their song in chat, the AI fills in form fields, then they look at a separate panel. The chat should BE the interface.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Core pattern | Sliding Canvas | Chat is primary; canvas slides in when AI builds a song |
| Mobile adaptation | Flip View | Chat/Song toggle pill, full screen for each view |
| Canvas editor | Tabbed (Sound/Lyrics/Settings) | Each tab gets full height; lyrics get dedicated space |
| Empty state | Chat full-width, no canvas | Reinforces chat-first; canvas appearing is a reward |

## Desktop Layout

### Before AI responds

- Chat fills the full content width (minus queue panel if active)
- Welcome state with prompt suggestions ("Write a sad ballad", "Help me plan a duet", etc.)
- LoRA selector as a compact pill above the chat input
- Song/Auto Album toggle above the chat area

### After first AI song response

- Canvas slides in from the right (~45% width) with a CSS transition
- Chat narrows to ~55%
- Green left-border (`#1ed760`) on the canvas

**Canvas structure:**

```
┌─────────────────────────────────────┐
│ [Title input, editable]        [✕]  │  ← Header
├─────────────────────────────────────┤
│  Sound  │  Lyrics  │  Settings      │  ← Tab bar
├─────────────────────────────────────┤
│                                     │
│  (Active tab content fills this     │  ← Tab content (flex: 1)
│   space, scrollable)                │
│                                     │
├─────────────────────────────────────┤
│ [clapton-mix badge]     [Generate]  │  ← Footer
└─────────────────────────────────────┘
```

**Sound tab:** Caption textarea, BPM/Key/Duration in a row
**Lyrics tab:** Full-height monospace editor with section tags highlighted in green
**Settings tab:** LoRA selector dropdown, strength slider, any future advanced options

### Subsequent AI responses

- Canvas updates live — the tab containing changes gets a subtle green dot indicator on its tab label
- Chat shows a conversational summary ("Updated — dropped to 72 BPM, added harmonica")

### Queue panel

- Stays as-is: 280px on the far left when active
- No changes to `QueueSection.jsx`

## Mobile Layout

### Toggle bar

Chat/Song toggle pill at the top of the page (reuses the visual style of the current Song/Auto Album toggle). Defaults to Chat view.

### Chat view

- Full-screen chat, same as current mobile chat
- When AI builds a song, a **sticky summary bar** appears below the toggle (only visible in Chat view):
  - Shows: song title, key params ("72 BPM · Am"), and a Generate button
  - Tapping the bar switches to Song view
- LoRA selector as a compact pill above the chat input (same as current)
- Note: The LoRA selector appears in two places — as a quick-pick pill above the chat input (for selecting before the first prompt) and in the Settings tab once the canvas/song view is open (for adjusting strength and switching models mid-session). Both control the same state.

### Song view

- Full-screen tabbed editor: Sound / Lyrics / Settings (identical layout to desktop canvas)
- Generate button in footer
- Badge/dot on Chat tab label when there are unread AI messages

## Interaction Flow

1. User opens Create page → full-width chat with welcome state (prompt suggestions)
2. User types "Write a melancholy acoustic ballad about leaving home"
3. AI responds with conversational message; on desktop, canvas slides in with all fields populated; on mobile, sticky bar appears
4. User types "Make it darker, drop the BPM" → canvas/song view updates, chat shows summary
5. User can directly edit any field in the canvas tabs (both chat and manual edits coexist)
6. User hits Generate → song queued, toast notification, canvas stays open for reference
7. "New chat" button clears everything — canvas slides away on desktop, sticky bar disappears on mobile

## Component Changes

### `BuildForm.jsx` — Rewrite

The main component managing both chat and canvas. Key changes:

- **State:** Add `canvasOpen` (boolean, driven by whether AI has generated song data), `activeTab` ('sound' | 'lyrics' | 'settings'), `tabDirty` (tracks which tabs have unseen AI changes)
- **Desktop render:** Flex row — chat panel (flex: 1) + canvas panel (flex: 0 0 45%, conditional on `canvasOpen`) with CSS transition on width
- **Mobile render:** Single view controlled by `mobileView` state ('chat' | 'song'). Toggle pill at top.
- **Canvas close:** Sets `canvasOpen = false` on desktop, does not clear song data (canvas can be reopened)
- Chat input area: LoRA selector pill positioned above the input bar

### `Generate.jsx` — Minor updates

- Remove the Song/Auto Album toggle from Generate.jsx into BuildForm (or keep in Generate but pass down)
- Desktop layout simplifies: queue panel + BuildForm (BuildForm handles its own two-column layout internally)

### What stays unchanged

- `QueueSection.jsx` — no changes
- `PlaylistBuilder.jsx` — no changes (Auto Album mode)
- `ReviewPanel.jsx` — no changes
- All API calls (`aiBuild`, `startGenerate`, `getLoras`) — no changes
- Session storage reuse flow ("Back to Edit" from ReviewPanel)
- Chat history saved with generations
- Welcome state prompt suggestions (same content, same style)

## Animations

- Canvas slide-in: `transform: translateX(100%)` → `translateX(0)` with `transition: transform 0.3s ease`
- Canvas width transition: chat panel width animates smoothly as canvas appears
- Tab change indicator: green dot fades in on tab label, fades out when tab is selected
- Mobile view switch: simple opacity/transform transition between Chat and Song views

## Edge Cases

- **No AI key configured:** Chat shows error as it does today; canvas never appears
- **Session restore ("Back to Edit"):** Canvas opens immediately with restored data, no slide animation
- **Manual-only workflow:** Canvas only appears after the first AI song response. There is no manual "open canvas" button — the chat is the entry point. Users who want to skip chat should type a minimal prompt like "folk ballad" to trigger canvas creation, then edit fields directly.
- **Long lyrics:** Lyrics tab scrolls independently; monospace editor grows to content height within scrollable container
- **Very narrow desktop (769–1024px):** Canvas takes 40% instead of 45% to give chat more room
