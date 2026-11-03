# Content destinations

中文操作说明见 [publishing.zh-CN.md](./publishing.zh-CN.md)。

BuilderHarness gates the loop **spec ↔ same-stack prototype ↔ review**.
Publishing is downstream of that gate, never the product category:

- **Review** captures feedback on the running prototype with source anchors.
- **Studio** turns the same source into downstream deliverables: manuals,
  launch notes, message cards, campaign copy, screenshots, GIFs and clips.

Studio is a content pipeline, not a CMS. It keeps the source, facts, media
recipes, review state and publishing workflow together. A **destination** is
the carrier: Feishu Docs, Tencent Docs, an internal wiki, an IM bot, a CMS, or
any other content platform.

The core owns planning, packaging, confirmation, resumable state and the review
UI. The destination adapter owns authentication, tenant/space selection,
platform rendering, resource creation/update and external ids. The bundled
`docs-cli` adapter is a reference implementation for long-form documents, not
the whole destination model. Local review, content status, screenshots and
clips work without any publishing destination.

## What gets published

One content bundle can produce more than a long document:

| Resource | Examples | Typical carrier |
| :-- | :-- | :-- |
| Long-form document | Manual, PRD, release note, announcement | Feishu/Tencent Docs, internal wiki |
| Notification | Version notice, risk alert, short update | IM, email, internal feed |
| Message card | Structured card with fields, actions, links | Feishu/Lark bot, WeCom, internal IM |
| Visual asset | Screenshot, GIF, clip, cover image | Document attachment, asset library, CDN |
| Bundle | Document + assets + facts + metadata | Any carrier that supports the combination |

A bundle carries the narrative blocks, structured card payload, assets, fact
references and metadata. The adapter renders that bundle into the carrier's
native format; cards and videos must not be forced into Markdown pages.

The current long-form adapter contract below is the first supported subset.
If a destination supports cards or asset libraries, add resource-level methods
to that adapter rather than teaching the core about Feishu/Tencent-specific
fields.

## Configure

```bash
# A path relative to the host project root, a file: URL, or a package name
BUILDERHARNESS_PUBLISH_GATEWAY=./tools/publish-gateway.mjs
# BUILDERHARNESS_PUBLISH_GATEWAY=@acme/builderharness-publish
```

When unset, publishing is disabled. To use the bundled
[`pipeline/destinations/docs-cli.mjs`](../pipeline/destinations/docs-cli.mjs)
reference adapter, set `BUILDERHARNESS_PUBLISH_GATEWAY=docs-cli`; it still reads
`BUILDERHARNESS_DOCS_CLI` for its command prefix. Setting `BUILDERHARNESS_DOCS_CLI`
alone is also accepted as the legacy opt-in.

## Connect in five steps

1. Put the adapter in the **host** project, e.g. `tools/publish-gateway.mjs`.
2. Implement the five core methods below; read `source.path` for `file` or `zip`.
3. Set `BUILDERHARNESS_PUBLISH_GATEWAY` on the process that starts Vite, then
   restart the dev server.
4. Check `GET /__builder_studio/publish-config`; it should return your
   `destination` label.
5. Run `builderharness kb-publish --dry-run` once with `--root` and `--doc-base`,
   then use the studio's publish panel to review the plan and confirm.

The adapter runs in the Vite dev-server Node process, never in the browser. Keep
credentials in server-side environment variables or a local secret store.

## Loaded interface

Bare package names are resolved from the host project's `node_modules`; relative
paths are resolved from the host project root. The adapter module may export an
object as its default export, or named exports. Every core method is required for knowledge-base publishing; the PRD
pipeline additionally needs the three PRD methods.

```ts
type Source =
  | { kind: "file"; path: string }  // rendered Markdown or destination-native text
  | { kind: "zip"; path: string };  // Markdown plus relative image assets

interface PublishGateway {
  /** Shown in the studio. All fields are optional. */
  destination?: {
    id?: string;
    label?: string;
    description?: string;
    capabilities?: Array<"document" | "notification" | "message-card" | "image" | "gif" | "video">;
  };

  /** Create a page. Must not be retried by the adapter; the core treats it as non-idempotent. */
  createDoc(input: {
    title: string;
    source: Source;
    parentViewId?: string | null;
  }): Promise<{ docId: string; viewId: string; url?: string }>;

  /** Replace a page. The core already decided that overwriting is intentional. */
  writeDoc(input: {
    docId: string;
    source: Source;
    position?: "REPLACE_ALL" | string;
  }): Promise<unknown>;

  /** Return `[{ id, text, type? }]` for the page outline/headings. */
  fetchOutline(docId: string): Promise<Array<{ id: string; text: string; type?: string }>>;

  /** Apply the core's structured operations to a page. */
  updateJsonml(input: {
    docId: string;
    opsFile: string;
    dryRun?: boolean;
  }): Promise<unknown>;

  /** Turn opaque page ids into the URL stored in `_published.json` and rendered links. */
  buildPageUrl(input: {
    base: string;
    viewId: string;
    docId: string;
  }): string;

  /** Optional: tells the adapter that the user confirmed the outbound action. */
  setIntent?(text: string): void;

  /**
   * PRD pipeline only. `folderId` comes from `prd --folder <id>`; adapters
   * without folders may ignore it. Patches to an existing PRD arrive in
   * batches of at most 50 operations (adjacent deletes merged), each one
   * dry-run first.
   */
  createBlankDoc(input: { title: string; folderId?: string }): Promise<{ docId: string; url?: string }>;
  appendImages(input: { docId: string; files: string[] }): Promise<string[]>;
  fetchJsonml(docId: string): Promise<{ body: unknown[]; version: number | string }>;

  /** Not used by the core workflow today; keep it for custom content tooling. */
  uploadSource?(input: { docId: string; file: string; type?: string }): Promise<string>;
  listWiki?(viewId: string): Promise<Array<{ id: string; text?: string }>>;
}
```

### Content source

`packSource()` in [`pipeline/kb-publish.mjs`](../pipeline/kb-publish.mjs)
produces a `Source` descriptor. The adapter decides how to send it:

- `file`: a rendered Markdown/temp file;
- `zip`: Markdown plus relative images, with the original directory layout.

Do not put CLI flags, shell quoting, or destination authentication into the
core workflow. Those belong to the adapter.

### State

`docs/kb/_published.json` stores opaque ids, the destination base URL, content
fingerprints and outline anchors. The core uses those ids only for follow-up
calls and link rendering. A destination can use any id format, as long as it
returns the same ids from `createDoc` and accepts them in later methods.

## Minimal custom adapter

```js
// tools/publish-gateway.mjs
import { readFile } from "node:fs/promises";

export const destination = {
  id: "internal-wiki",
  label: "内部 Wiki",
  description: "通过内部 API 发布到团队 Wiki。",
};

let token = process.env.WIKI_TOKEN;

async function request(pathname, body) {
  const res = await fetch(`${process.env.WIKI_BASE}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Wiki ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function createDoc({ title, source, parentViewId }) {
  const content = await readFile(source.path, "utf8");
  const page = await request("/pages", { title, page: parentViewId, content });
  return { docId: page.id, viewId: page.id, url: page.url };
}

export async function writeDoc({ docId, source }) {
  const content = await readFile(source.path, "utf8");
  await request(`/pages/${docId}`, { content });
}

export async function fetchOutline(docId) {
  const page = await request(`/pages/${docId}/outline`, {});
  return page.items;
}

export async function updateJsonml({ docId, opsFile, dryRun }) {
  const ops = JSON.parse(await readFile(opsFile, "utf8"));
  return request(`/pages/${docId}/ops`, { ops, dryRun: !!dryRun });
}

export function buildPageUrl({ base, docId }) {
  return `${base.replace(/\/+$/, "")}/${docId}`;
}
```

The custom adapter can ignore `opsFile` and interpret the operations in its own
way, or expose a different authoring API behind the same method names.

## Retry boundary

Only idempotent operations are retried by the core. Creating a page is not
idempotent: a timeout can mean the page was created. The core persists each
page's ids as it goes, so a later run updates instead of creating duplicates.
Adapters should surface ambiguous failures rather than retrying a create.
