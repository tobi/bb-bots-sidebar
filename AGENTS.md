# Independent Bots development

Work on `main` in the installed Bots Sidebar source checkout. Confirm its path
with `bb plugin list` before editing. Do not edit or reload older personal-workspace
worktrees. Build and reload `bots-sidebar` from this checkout; verify the installed
source before deploying. The owner requested private, ID-keyed state,
not bot-home projects or special execution directories. Explicit user-created
work projects are allowed, but never create a backing project for bot storage.
Keep all UX refinements intact.
A code-only downgrade is not a data rollback: preserve the plugin DB backup before
restoring an older metadata format.

Private state design: use the plugin SQLite database as the durable authority,
with private per-bot Markdown/JSON exports under its own data directory. Embed
identity/instructions/memory into agent context; tools infer bot ID from explicit
thread bindings. Bot chats use personal workspaces or explicit work projects;
new-chat defaults follow project ownership without changing storage location.
No new backing projects, no state files in user repositories. Preserve
existing conversation histories and track legacy home project IDs for compatibility.

## Plugin identity

- Runtime ID: `bots-sidebar`; package: `bb-plugin-bots-sidebar`; display name:
  Bots Sidebar. The sidebar heading can remain Bots.
- `bots` is another marketplace plugin's ID. Do not add a runtime alias or read
  its private directory/KV automatically. Our old local namespace was migrated
  explicitly with backups. Historical thread origin IDs remain unchanged; durable
  bindings identify our old conversations. New starts must use `bb.pluginId`.
- Keep native tool names, SQL table names, RPC names, and existing `bots:` client
  preference/composer-draft keys stable. They are not runtime plugin identities.

## Data and state contract

- A bot has its own ID/name/private state and many linked projects. Never infer identity,
  activity, visibility, or thread ownership from a linked project's ID.
- A work project may have exactly one owner, independently of its many members.
  Persist ownership in `bot_project_owners` with a unique project key. Owning
  implies membership; leaving releases ownership; releasing keeps membership.
  Never automatically promote an existing membership to ownership.
- Existing thread bindings win, then explicit server-issued bot-start tokens,
  then parent/fork context. Only otherwise default NEW project threads to its
  owner. Never reassign old history or capture threads created before a claim.
  Explicit bot starts and new inherited contexts join that bot to the work project
  without changing its owner. Personal/legacy-home projects cannot be owned.
  Unassigned conversations still belong in Chats. Preserve all main pointers.
- Preserve the first-turn dispatch binding before agent configuration; a
  fire-and-forget thread.created event alone is insufficient. Configuration
  lookups are read-only; they must not preempt an inherited binding + join.
- Legacy migration is snapshot-based and read-only for old projects. Keep old
  main pointers/history. Import v2 state from legacy homes once when available,
  preserving a cached fallback and warning if unavailable; never overwrite newer
  private state on a later retry.
- Bot state belongs to plugin storage, never a working repository. State writes
  use SQLite transactions and expected hashes/revisions. Markdown/JSON files are
  private exports, not a second write interface or runtime working directory.
- Editing a bot must not rename or relocate linked projects. Native tools act
  only on the current bot and should not expose storage paths to the agent.
- `bot_update_state` is the durable-write tool: always require target + action.
  Identity/set requires a fresh revision. Memory is at most 3000 characters on every
  write; append/forget operates on exact single-line facts. Memory overwrite requires
  content + expectedSha256 from a fresh read, and never retries whole-document bytes
  against a newer hash. Overflow errors explain read/condense/overwrite. Preserve
  older oversized memories for reading and explicit compaction; settings set/unset only changes selected top-level keys;
  project join/leave/own/release changes membership/ownership atomically, never
  project files or historical conversation bindings. Reapply semantic edits on bounded CAS
  retries, never retry stale whole-file bytes. No shared-memory scope or routines.

# Bots sidebar UX contract

Preserve the approved interaction model below. An older source snapshot once
reintroduced removed controls during development. Do not restore old snapshots
or reintroduce hover toolbars when making unrelated changes.

- Clicking a bot opens its first ordered top-level conversation without changing
  expansion. No special main UI: legacy main pointers remain compatibility data.
  A separate end chevron toggles the whole list and counts all top-level roots.
  Bots start collapsed; navigation and assignment never automatically expand them.
  Explicit expansion shows all roots, including the former main. Children retain
  independent disclosure; reveal active ancestor paths only within an expanded bot.
- Drag above/below a sibling to reorder it, or use Move to top in its context menu.
  Shift-drop retains nesting. Persist threadOrder privately in the plugin DB;
  manual order wins, unplaced roots/siblings follow newest-created first. Activity,
  unread state, pinning, and navigation never reshuffle them. No bot-root overflow.
  Do not change bindings, parents, projects, environments, or historical main
  pointers to reorder. Click target, preview, activity badge, project defaults,
  and default bot-message destination use the same first visible root.
- Counts/chevrons never navigate. No Topics/Main's children labels or divider.
  No multi-action hover overlay toolbars. Conversation rows may show one inline
  archive button on hover/keyboard focus (always available on touch), immediately
  LEFT of the count/chevron. Keep it outside the navigation link and prevent
  archive clicks from navigating or toggling children. Use BB Button/Tooltip and
  the native archive action, which also archives child conversations.
- The Bots header has ONE + dropdown: Bot / Section / Project. Do not restore a
  separate + Section button or make + directly open the bot editor. Section creation
  is explicit and cancellable; standalone project creation must not create a bot.
  Portaled dropdown/context-menu Content needs `usePortalScopeProps()` so scoped
  plugin CSS applies. Highlight Radix `data-highlighted` for mouse and keyboard;
  keep disabled entries unhighlighted. Verify computed styles in the browser.
- Each bot row has ONE inline + before its list disclosure, shown on hover
  or keyboard focus and always available on touch. Reserve its width; no layout
  shift or overlay toolbar. Keep it separate from opening a conversation, disclosures, and
  bot reordering. Use BB Button/Tooltip. + and New conversation use an available
  owned project (owned first-conversation project first, then linked order), otherwise personal.
  Membership alone never chooses the default. Refresh ownership before opening;
  use the bot's configured host and preserve composer overrides after opening.
  Empty bots use the same ordinary new-conversation composer and ownership defaults.
- Bot settings (avatar, role, SOUL, section) belong in **Edit bot**. Menus are
  opened only by right-click/keyboard context-menu actions.
- Reorder bots and move them between sections by dragging; never add arrow
  controls back to the row. The null/default section is Main and has no sidebar
  heading. Preserve explicit custom sections. The Section dropdown includes
  Create New… (not a separate always-visible creation button).
- Keep Create/Edit compact: small avatar beside name/role, Setup / Instructions /
  State / Projects / Appearance tabs, one logical file editor at a time, and a fixed visible
  Save/Cancel footer. Do not bring back the tall stretching avatar panel or stack
  all settings in one long form. Preserve drafts across tabs. Storage is private
  and automatic: no home path picker or custom-working-directory control.
  Projects shows only linked projects, Member / Owner roles, and an unlink action.
  Add existing… opens a searchable picker; New project… opens an inline work-project
  form with an explicit machine and folder browser. Keep it mounted across tabs.
  A conflicting owner is shown and disabled. Save desired linked/owned IDs together;
  retain drafts on conflict. Explicitly creating a project happens immediately,
  then drafts Owner membership for the bot's Save. Cancelling a bot must not delete
  an explicitly created project or discard its files; explain this in the UI.
- Bot context contains fixed guidance + SOUL.md + MEMORY.md (full compliant memory).
  Per-bot AGENTS.md is retired; preserve historical text as inactive private data,
  never inject it or offer it as an editable state file. Workspace AGENTS.md still applies.
- Edit bot is the single editor: Instructions has SOUL.md, State has
  MEMORY.md / settings.json. Do not restore a separate View bot state action.
  Save all changed fields atomically with the original revision and per-file hashes;
  invalid JSON/conflicts keep every draft and never partially save identity/state.
- New bot drafts randomize color, shape, expression, and idle motion ONCE. Existing
  bots and rerenders never reroll. Offer Randomize appearance explicitly. Presets
  and random defaults are chromatic; no black/white/cream/gray (including migration
  fallbacks). Preserve legacy/custom hex colors. Keep the expanded Bloub-derived
  choices compact, retain original renderings, and retain MIT attribution.
- Sidebar expressions are a temporary presentation layer, never saved avatar/state
  edits. Brief idle looks last 3–5 seconds, spaced 5–12 minutes apart per bot;
  after 30 minutes idle use unimpressed, after two hours sleepy. Work anywhere in
  the bot, pending input, or unread errors restores the saved face immediately.
  Editor/picker previews always show the saved/draft expression. Pause timers when
  the page is hidden; dispose on unmount. Still/reduced-motion suppress random
  bursts but retain static long-idle poses. Do not poll or call any write RPC.
- All three New conversation actions open the SAME native composer popup directly.
  Never restore a separate project pre-select/Continue screen. Use ownership-aware
  defaults for the generic new-chat action, the selected host's checkout for
  explicit project chat, and a fresh
  managed worktree for worktree chat. Use row context or the first conversation's still-linked
  project, then linked-first available fallback. The native project picker stays
  editable; hold seeds stable after opening so refreshes cannot reset user choices.
- New conversation in worktree ALWAYS seeds a fresh managed worktree with an
  explicit hostId (clicked conversation host, or first-conversation/default machine for bot menu).
  Do not reuse the clicked worktree or omit hostId: the host composer ignores a
  host environment seed without it. Keep draft keys distinct by worktree host and
  verify actual picker state. Preserve user overrides; unavailable hosts/sources
  may be reconciled by the host composer, never silently claim same-host success.
- Editors require an explicit Save click. Enter in text inputs must not submit;
  SOUL.md must accept normal newlines. The bot editor can create a section.
- Do not restore Move main or Make main. Keep existing histories and legacy pointers.
- Keep the later additions: worktree composer, conversation/Chats menus and
  rename/archive, older unassigned Chats grouped under N Other, and status icons.
- Highlight the actual current chat with `[aria-current="page"]` styles (the
  Tailwind `aria-current:` variant only matches `true`). Child branches default
  closed. Put the child count and disclosure chevron at the RIGHT end (`6 ›`),
  not on the left; no disclosure spacers for leaf rows and never overlay toolbars. Selected
  rows use background highlighting only, without a left stripe.
  Reveal the current chat's ancestor path on navigation.
- The avatar's bottom-right activity badge reflects its FIRST conversation, not
  aggregate bot work. Small pulsing dots to its left count other working threads,
  including collapsed descendants; three slots maximum, with + and an exact-count
  tooltip on overflow. Keep an idle first conversation visually distinct from busy others.
  Waiting takes precedence over working; preserve unread errors, ignore archived
  activity, and disable all animation under reduced motion. Counts never navigate.
- Completed conversation status is a green dot when unviewed, then a smaller gray
  dot after viewing—not a checkmark. Preserve working/waiting/error indicators.
- Unassigned Chats may be assigned through the dialog or dragged onto a bot row.
  Offer all bots, not only existing project members. Join a valid work project as
  Member atomically with the new binding; do not move the thread's project,
  environment, history or main pointers, and never steal existing associations.
  Personal chats need no membership. Keep legacy-home recovery rules.
  Conversation dragging is pointer-based within the sidebar: keep BB's split
  pointer handler, cancel on Escape/blur/unmount, and let drag-to-split take over
  outside the sidebar. Show a drop target/ghost, suppress click-through, preserve
  bot reorder dragging, and keep the assignment dialog for keyboard/touch.
- Chats is a collapsible, vertically resizable bottom section. Keep its size and
  collapsed state per client; the hidden-bot toggle belongs below the bot list,
  not in the Bots heading. Do not reintroduce the per-row activity dates.
- Before reloading, run `npm run typecheck`, `npm test`, and `bb plugin build`.
  `tests/sidebar-ux.test.tsx` protects the approved interactions, not just markup.
  For visual changes also check the live UI on hover, menu open, and edit open.

## Screenshot privacy

- Tracked screenshots must use synthetic bots, projects, machines, and conversations.
  Never capture live private sidebars, chat content, identity, memory, or host labels.
  Crop to the component being illustrated and verify every image before committing.
- Keep original private audit evidence outside the repository. Replacing a tracked
  screenshot does not remove its earlier versions from Git history; inspect history
  separately before public publication.

## Bot coordination

- Use the public mention-provider API for @ completion. Search all bots by name,
  role, or stable ID without project/visibility filtering; @bots is discovery.
  Bound results and resolve IDs against current metadata at send time. A mention
  is a reference only: never send, create a main, reassign, join/own projects, or
  disclose private SOUL/memory/settings as a side effect.

- Agent context states its relationship to the current project (owner/member/unjoined),
  naming the owner when present. Personal and legacy-home chats are explicit exceptions.
  Configuration stays read-only; project state reads refresh the relationship.
- `bb bots list` exposes paginated public metadata, never private bot documents.
  `bb bots message` uses native `threads.send` with `queue-if-active` and the invoking
  `senderThreadId`. Default to the first visible ordered root; explicit reply threads must resolve
  to the recipient bot. Resolve sender identity from bindings/inheritance, not project ownership.
  Never forge a sender, auto-create a conversation, or change permissions/bindings to send.
- Frame messages as asynchronous agent coordination, not user approval. Include an exact
  sender-conversation reply command and discourage acknowledgement-only loops.
  Test delivery with the SDK fake host; never send unsolicited live test messages.
