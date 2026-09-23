# Bots Sidebar

Bots are identities, not projects or working directories. A bot has a name,
avatar, operating instructions, memory, and linked projects. Its state stays
private in BB and follows its conversations through embedded instructions and
bot-scoped tools.

New conversations default to a project the bot owns, or to a personal workspace
when it owns none. Explicit project/worktree starts can choose any available work
project and join the selected bot to it. Creating a bot never creates a
backing BB project or writes `SOUL.md` into a repository.

## Preview

[Open the screenshot gallery](docs/screenshots/index.html). All illustrations use
synthetic data; private-session captures do not belong in published assets.

Demo data only: [Sidebar](docs/screenshots/sidebar.png) ·
[Activity badge](docs/screenshots/bot-activity.png) ·
[Bot new-conversation action](docs/screenshots/bot-new-chat-hover.png) ·
[Hover archive](docs/screenshots/conversation-hover.png) ·
[Drag to assign](docs/screenshots/conversation-drop.png) ·
[Create bot](docs/screenshots/bot-create.png) ·
[Edit bot](docs/screenshots/bot-editor.png) ·
[Project roles](docs/screenshots/bot-projects.png) ·
[Create menu](docs/screenshots/create-menu.png) ·
[Project during bot creation](docs/screenshots/bot-new-project.png) ·
[State in Edit bot](docs/screenshots/bot-state.png) ·
[Appearance choices](docs/screenshots/bot-appearance.png)

## Private state

The plugin's SQLite database is the durable authority. Generated Markdown/JSON
exports live under the plugin's own BB data directory at `state/<bot-id>/`, with
private directory/file permissions. They are keyed by stable bot IDs, not names,
and are not execution workspaces. Agents do not need their physical locations.

| Logical file | Purpose |
| --- | --- |
| `SOUL.md` | Identity and personality; up to 4,096 characters |
| `MEMORY.md` | Durable facts and preferences; at most 3,000 characters |
| `settings.json` | Structured bot preferences; a JSON object up to 16,384 characters |

**Edit bot** is the single editor: **Instructions** contains SOUL.md;
**State** contains MEMORY.md / settings.json. Its explicit Save commits changes
together with revision/hash checks; invalid JSON or conflicts never partially save
other fields. Use this editor or the state tools—not direct edits to exports.
Export failures do not lose committed state or prevent conversations.
The working machine can be offline while state is still readable/editable in BB.

Sessions receive fixed tool/storage guidance, a bounded SOUL excerpt, and the full
current memory (up to 3,000 characters). There is no per-bot AGENTS instruction
layer. Old bot AGENTS text remains archived in private storage and is not injected,
editable, or newly exported. Existing oversized memories remain readable without
truncating stored data; condense them before writing memory again. Existing provider sessions pick up changed system
instructions when they are reconstructed; tool reads always see current state.
The current project's own `AGENTS.md` continues to apply. Bot state is never
copied into that project's directory.

## Project roles

**Edit bot → Projects** shows only the bot's linked projects. Use **Add existing…**
to search for a project, **New project…** to create one, or **×** to unlink.
Each linked project has a **Member / Owner** selector.
Projects may have many members but only one owner. Claiming an already-owned
project is rejected; release its current ownership before assigning another bot.

- **Owner:** new ordinary project conversations default to this bot.
- **Member:** an explicitly selected bot, or inherited parent/fork bot context,
  overrides that default. Starting under a bot joins it to the selected project
  if needed, without changing the project's owner.
- Existing conversations and main pointers never move. Ownership does not capture
  older unassigned conversations, including ones still waiting for their first send.
- Releasing ownership keeps membership. Leaving also releases ownership, without
  changing existing conversation bindings. Projectless chats stay projectless;
  personal and legacy bot-home projects cannot be owned.

Ownership is conversation routing, not filesystem ownership or an access-control
change. Existing memberships are **not** promoted automatically; choose Owner to
opt in. Role changes are atomic and survive reloads.

## Creating bots, sections, and projects

The **+** in the Bots header opens **Bot / Section / Project**. Standalone project
creation opens that work project without creating a bot.

You can also create a work project directly inside a new or existing bot's
**Projects** tab. Choose a machine and folder (or use **Browse…**). Missing folders
are created; existing files are not changed. The new project is selected as
**Owner** in the bot draft; click **Create bot / Save bot** to save that link.

**Create project** is an explicit, immediate action. Cancelling the bot afterwards
does not delete that project or its files. Unsaved project forms create nothing.
Retries retain the same request ID to avoid duplicate projects. Existing folder
registrations are rejected rather than silently reused. Bot state stays private
in BB; a bot still needs no project or special working directory.

## State tools

- `bot_read_state({ target })` reads identity, memory, settings, or project roles.
- `bot_update_state({ target, action, ... })` is the durable-write gateway.

| Target | Action | Inputs / behavior |
| --- | --- | --- |
| `identity` | `set` | Fresh `expectedRevision`, plus name, role, and/or soul |
| `memory` | `append`, `forget` | One exact single-line `fact`; append deduplicates; resulting memory must fit 3,000 characters |
| `memory` | `overwrite` | Full replacement `content` (max 3,000 characters) and fresh `expectedSha256` from a memory read; no retry on conflict |
| `settings` | `set` | `values` merges selected top-level keys |
| `settings` | `unset` | `keys` removes only those keys |
| `project` | `join`, `leave` | Existing `projectId`; leave also releases ownership |
| `project` | `own`, `release` | Claim an unowned project (also joins), or release ownership while remaining a member |

For example:

```json
{"target":"memory","action":"append","fact":"The user prefers concise progress updates."}
```

All operations are scoped to the current bot. Tools cannot choose another bot or
an arbitrary path. Writes use SQLite transactions and expected hashes/revisions;
semantic memory/settings changes retry bounded conflicts against current state.
Memory reads include full content, sha256, characters, and maxCharacters. If memory
is full, read it, condense it, then overwrite with that hash. Whole-memory overwrites
never retry against a newer document; read and merge again after a conflict.
Fixed guidance uses BB’s static tool-instructions field. Dynamic identity/memory
stays within BB’s 4,096-character limit, retaining full compliant memory and
shortening the SOUL excerpt as needed.
Unused optional tool fields may be omitted or null. Shared memory, routines,
channels, and scheduled skills are deliberately out of scope. Never store secrets
in bot state.

## Sidebar interactions

- Click a bot to open the **first conversation in its list**, without expanding
  or collapsing it. The end chevron independently toggles the full list and
  counts top-level conversations. There is no special main conversation.
  Double-click the bot name/avatar to fold or unfold the list as well.
  The subtitle keeps the bot's role, followed by its owned project names—not
  the first conversation's title. Long labels truncate with full hover text.
- Drag above or below a sibling to reorder conversations; **Move to top** in
  the context menu is the keyboard/touch alternative. Shift-drop nests a thread.
  Order is stored privately and shared across clients. Unordered conversations
  appear newest-created first after manually placed ones; activity never reshuffles
  them. Archiving the first conversation makes the next one the click target.
- Hover a bot row to reveal **+** (also available on keyboard focus and touch).
  It opens the native composer without opening a conversation or expanding the bot.
  **+** and **New conversation…** default to an owned project on the bot's configured
  machine. With multiple owned projects, prefer the first conversation's project if owned, then
  the first owned project in link order. Mere membership does not change the
  personal-workspace default. The project and machine remain editable.
- Drag an unassigned conversation from **Chats** onto a bot, or use **Assign to
  bot…** from its menu. Any bot can be chosen; it joins the conversation's work
  project as a member if needed. Projectless chats need no project link. History,
  project, environment and existing child assignments stay unchanged. A drop does
  not navigate away; use the confirmation's **View** action to open it.
  Dropping on a bot's face makes the conversation first; the rest of the row
  appends it. Both unfold the list immediately after assignment and scroll the
  added conversation into view. Hold Shift anywhere on the row to
  put it first instead (also unfolding the list). Drop an
  existing top-level conversation on its own bot row to move it to the top.
- Hover a conversation row to reveal its archive button, also available on
  keyboard focus and touch. It sits inline before the child count, never covering
  the title or disclosure. This uses BB's normal archive action, including children.
- Each conversation's right-edge count/chevron reveals only its own children,
  collapsed by default. Once a bot is explicitly expanded, navigation reveals
  the viewed ancestor path. Navigation never expands a collapsed bot.
  Chats retains its separate overflow.
- The avatar's bottom-right spinner shows its **first conversation** working. Small pulsing dots
  to the left show other working conversations—even when collapsed. Three slots
  keep it compact; a **+** indicates overflow and the tooltip gives the exact count.
  Other work never makes an idle first conversation look busy. Waiting/errors remain distinct.
- Working conversation rows spin; completed ones are green dots while unviewed,
  then smaller gray dots. Reduced motion disables all activity animations.
- **Main** is the invisible default section. Explicit custom sections retain their
  headings. Drag bots to reorder/move; the Section picker includes **Create New…**.
- Create/Edit stays compact: small avatar, name/role, Setup / Instructions / State /
  Projects / Appearance tabs, one file editor, and an always-visible footer.
  New bots get a random appearance once per draft; existing bots stay unchanged.
  Appearance offers **8 shapes, 16 expressions, 3 idle motions, and 14 coloured
  presets**, with no black/white/neutral presets. **Randomize appearance** rerolls
  explicitly. Existing/custom hex colours remain supported.
- Sidebar faces occasionally show a brief idle expression (3–5 seconds, spaced
  5–12 minutes apart). After 30 minutes without activity they look bored; after
  two hours, sleepy. Work, pending input, and unread errors restore the chosen face.
  These are display-only changes: saved appearance and editor previews stay intact.
  Random bursts pause in hidden windows and are disabled by Still/reduced motion.
  Machine is an execution default, never the state storage location.
- All **New conversation** actions open the same native composer popup immediately,
  without a separate project-selection step. **+** / **New conversation…** use
  ownership-aware defaults; **in project** selects a checkout; **in worktree**
  selects a fresh worktree. For explicit project/worktree actions, the current
  work context or a linked project is preselected, and you can change
  the project, machine, and harness inside the popup before sending.
- **New conversation in worktree…** selects a fresh managed worktree on the
  originating conversation's machine (or the bot's first-conversation/default machine), never
  reuses the existing worktree. The picker remains editable; if that machine lacks
  a project source, BB may fall back to an available source.
- Save is explicit; Enter never submits text fields. Drafts survive tab changes.
  No sidebar overlay toolbars or activity dates; the hidden toggle stays at bottom.
- Chats contains unassigned conversations and is collapsible/resizable. Several
  bots may share a project without sharing identity or conversation ownership.

## Plugin identity

The runtime ID is **`bots-sidebar`**, derived from package **`bb-plugin-bots-sidebar`**.
Use `bb plugin reload bots-sidebar` for this plugin. The community plugin named
`bots` is a different plugin; this one does not read its storage automatically.

The earlier private build used `bots`. Its local migration must preserve the entire
plugin database, private exports, and legacy KV records while the old plugin is
stopped. Pending startup tokens must be resolved before switching. Keep a backup,
retire the old namespace, and install the new ID; do not change bot IDs, main pointers,
thread bindings, or historical thread origin IDs. Client layout and compose-draft
keys intentionally remain stable. If a device explicitly pinned the old sidebar,
select **Bots Sidebar** again in Settings → Sidebar; Automatic needs no change.

## Migration and cleanup

Existing IDs, sections, avatars, linked projects, main pointers, and conversation
bindings are preserved. Version-2 home state is imported once after verifying its
ownership marker. Missing/offline/corrupt sources fall back to that bot's own cached
state with a warning; later source changes never overwrite newer private state.
Version-1 project-backed records are still imported from a one-time snapshot,
including reconciled live/archived history. Ordinary/new projects never become
bots automatically.

Migration never deletes or modifies legacy source files, project folders, or
conversations. Old home projects are retained for existing history but are not
used for new bot launches. Start an ordinary new conversation and reorder the
list to choose what opens when clicking the bot; old history remains accessible.

Cleanup of old generated project `SOUL.md` / `bot.json` files is a separate,
owner-approved operation: compare against saved migration hashes, keep tracked or
independently changed files, and move eligible files into private backups. Never
remove a project's `AGENTS.md`. Keep a consistent plugin database backup before
switching storage versions; the prior code checkpoint is
`checkpoint/home-project-bots`.

## Develop

Use BB 0.42 or newer and Node.js 24. No BB-core change is required for this model.

```sh
git clone --branch main https://github.com/tobi/bb-bots-sidebar.git
cd bb-bots-sidebar
npm ci
npm run typecheck
npm test
bb plugin build
bb plugin install . --yes
```

The source began with BB's standard scaffold, not another sidebar plugin. Avatar
appearance options are adapted from [bloub](https://github.com/jeremy-prt/bloub).
See [third-party notices](THIRD_PARTY_NOTICES.md) for its MIT attribution.
Dependencies are installed independently; no other BB plugin is required.

### Bot coordination

Type **@** followed by a bot name, role, or ID in a composer. Results appear under
**Bots**; **@bots** lists the available bots, including ones hidden from the sidebar.
Mentions use stable bot IDs, so duplicate names and later renames do not redirect
an existing reference. Selecting a bot inserts a mention—not a message or an
assignment. At send time it supplies only public name/role/ID and messaging guidance,
never that bot's private SOUL, memory, or settings.

Bot context states the current project relationship: owner, joined member (with the owner's name and ID), or not joined. Personal chats have no work-project role. `bot_read_state({"target":"project"})` refreshes this relationship alongside linked and available projects. Ownership routes new project conversations; it does not grant authority over other agents or the user.

```sh
bb bots list
bb bots list --json --limit 50 --offset 0
bb bots message <bot-id-or-exact-name> "Please review the changes"
bb bots message <bot-id> "My reply" --thread <sender-conversation-id>
```

Messages use BB's native queue: idle conversations start a turn, busy conversations receive the message later. The default destination is the recipient's first visible ordered conversation; `--thread` must belong to that bot. Messages identify the invoking conversation and its bound bot, clearly distinguish agent coordination from user instructions, and include an asynchronous reply command. FYI messages need no acknowledgement. Unbound conversations and external CLI callers are labeled accurately. The CLI does not create conversations or change membership, bindings, permissions, or private state.

Listing exposes public bot metadata only and paginates at 100 bots maximum. Names must match exactly; use IDs for duplicate names. Quote messages (maximum 12,000 characters). Delivery receipts confirm acceptance, not task completion or a reply.

`bb bots list` also shows **STATUS**, **VISIBILITY**, **OWNED PROJECTS**, and
**JOINED PROJECTS** by name. Joined projects are memberships without ownership;
JSON includes both project IDs and names. The first column is the stable bot ID
accepted by `bb bots message`. Activity aggregates all non-archived bot conversations,
including inherited children and hidden conversations: waiting takes precedence over
working, then error, then idle. Visibility separately reflects the bot's hidden setting.

Incoming bot messages use BB's native attributed, expandable agent-message row
and sender-conversation link. Inside it, a **🤖 Bot message · Name** heading and
the original message come first; delivery context and the exact reply command follow
under a separator. This keeps the content easy to scan while preserving the agent's
attribution and asynchronous handling instructions. No custom timeline renderer is used.
