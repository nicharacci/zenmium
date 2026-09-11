# Zenmium agent ergonomics

Zenmium is built so an agent can read one situation dump, address named objects, drive named
controls, and leave proof on the same objects. The browser and the agent share one sidebar, so the
same ids the agent uses are the ids the operator sees.

## The tower

| Layer | What the agent uses | Authority |
| --- | --- | --- |
| Situation | `zen.situation()` snapshot | Live: spaces, tabs, bookmarks, folders, files, agent state, last reason |
| Objects | Reference ids | Stable: same id in UI, IPC, tools, and logs |
| Providers | Model rows | OpenRouter gateway; default `deepseek/deepseek-v4.1-flash` |
| Execution | OpenCode session kernel | The only writer of turns |
| Surfaces | Sidebar, tab strip, agent rail, filetree, command bar | The operator's controls and the agent's controls are the same controls |
| Proof | Reference-bound receipts | Every action writes status back to the object it touched |

Do not add a second agent loop, a second object store, or a second secret path. If a seam is down,
return `{ ok: false, seam, reason }` with a human-readable reason. Never invent success.

## Situation dump

The first agent turn receives a compact JSON snapshot so it does not guess:

```
{
  "app": { "version": "...", "profile": "default" },
  "spaces": [{ "id": "space:work", "name": "Work", "pinned": 6, "today": 3 }],
  "activeTab": { "id": "tab:abc", "url": "https://...", "title": "...", "reference": "ref:url/..." },
  "bookmarks": [{ "id": "ref:bookmark/gh", "title": "GitHub", "url": "https://github.com" }],
  "folders": [{ "id": "folder:infra", "name": "Infra", "refs": ["ref:bookmark/gh"] }],
  "files": [{ "id": "ref:file/src/index.ts", "path": "src/index.ts" }],
  "agent": { "session": "ses_...", "state": "idle", "pendingApprovals": 0 },
  "lastReason": null
}
```

## Reference registry

One addressable object type covers bookmarks, links, files, docs, and canvas nodes. This is how the
agent is "pointed" at things by tagging them.

| Scheme | Meaning | Backed by |
| --- | --- | --- |
| `ref:bookmark/<slug>` | A saved bookmark | Product bookmark store |
| `ref:folder/<slug>` | A bookmark or tab folder | Product folder store |
| `ref:url/<hash>` | Any live or historical URL | Tab or history store |
| `ref:file/<path>` | A local file or repo path | Local filetree or repo tree |
| `ref:doc/<slug>` | A document | Product doc store |
| `ref:node/<id>` | A canvas or map node | Canvas store |

Rules:

- Every reference resolves to a resolver that returns `{ id, kind, title, target, exists }`.
- The same id string appears in the UI, IPC, tools, and receipts. No translation layer.
- The agent may read any reference on the allowlist. It may act on a reference only after approval
  for navigation or file access.
- Missing references fail closed; the registry never fabricates a target.

## `@` tags in the composer

Typing `@` in the composer opens a grouped picker:

- `@bookmark` and `@folder` for saved sites and groups.
- `@file` and `@folder` for the local filetree and repo tree.
- `@doc` for documents.
- `@node` for canvas nodes.
- `@persona` for named agent teammates.

Selecting an entry inserts the reference id into the message. The agent receives the id, resolves
it through the registry, and can read or act on it. Drag-and-drop of a bookmark, folder, or file
onto the composer does the same thing.

## Named controls

Every visible control maps to a named seam that fails closed:

| Control | Seam |
| --- | --- |
| Pin or unpin a tab | `zen.tab.pin` |
| Move a tab to another space | `zen.tab.move` |
| Delete a space | `zen.space.delete` |
| Save a bookmark | `zen.bookmark.save` |
| Tag a file for the agent | `zen.reference.add` |
| Send a prompt | `zen.agent.prompt` |
| Approve a page action | `zen.agent.approve` |

## Error contract

Every seam returns `{ ok, seam, reason }`. `reason` is a human sentence. Missing credentials,
missing ids, and engine downtime stay `ok: false`. Adapters never convert a remote fault into a
fake local success.

## Proof rule

Every agent action writes its result back to the reference it touched, so the operator can see what
changed on the same object the agent saw. A turn without a reference-bound proof is incomplete.
