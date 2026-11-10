import { lookup } from "node:dns/promises";
import { isIP, BlockList } from "node:net";
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import { XMLParser, XMLValidator, XMLBuilder } from "fast-xml-parser";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import createDOMPurify from "dompurify";
import { normalizeUrl, type ArticleInput } from "./repository.js";
export interface ParsedFeed {
  url: string;
  title: string;
  articles: ArticleInput[];
}
export interface FetchOptions {
  signal?: AbortSignal;
}
export interface FeedFetcher {
  fetchFeed(url: string, options?: FetchOptions): Promise<ParsedFeed>;
  fetchArticle(url: string, options?: FetchOptions): Promise<ArticleInput>;
}
type Resolver = (
  hostname: string,
) => Promise<{ address: string; family: number }[]>;
const denied = new BlockList();
for (const [address, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  denied.addSubnet(address, bits, "ipv4");
const global6 = new BlockList();
global6.addSubnet("2000::", 3, "ipv6");
const denied6 = new BlockList();
denied6.addSubnet("2001:db8::", 32, "ipv6");
denied6.addSubnet("2001::", 32, "ipv6");
denied6.addSubnet("2002::", 16, "ipv6");
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) return !denied.check(address, "ipv4");
  if (isIP(address) === 6)
    return global6.check(address, "ipv6") && !denied6.check(address, "ipv6");
  return false;
}
export async function assertPublicUrl(
  input: string,
  resolver: Resolver = (hostname) => lookup(hostname, { all: true }),
): Promise<{ address: string; family: number }[]> {
  const url = new URL(normalizeUrl(input));
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  )
    throw Error("Private hostname denied");
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await resolver(host);
  if (!addresses.length || addresses.some((x) => !isPublicAddress(x.address)))
    throw Error("Private or reserved network address denied");
  return addresses;
}
const window = new JSDOM("").window;
const purify = createDOMPurify(window as any);
export function sanitizeHtml(html: string, base: string): string {
  const clean = purify.sanitize(html, {
    USE_PROFILES: { html: true, mathMl: true },
    FORBID_TAGS: [
      "style",
      "iframe",
      "object",
      "embed",
      "form",
      "input",
      "button",
    ],
    FORBID_ATTR: ["style", "srcset"],
  });
  const dom = new JSDOM(clean, { url: base });
  for (const el of dom.window.document.querySelectorAll("[href],[src]")) {
    for (const attr of ["href", "src"]) {
      const value = el.getAttribute(attr);
      if (!value) continue;
      try {
        const u = new URL(value, base);
        if (
          ["http:", "https:"].includes(u.protocol) &&
          !u.username &&
          !u.password
        )
          el.setAttribute(attr, u.href);
        else el.removeAttribute(attr);
      } catch {
        el.removeAttribute(attr);
      }
    }
    if (el.tagName === "A") {
      el.setAttribute("rel", "noopener noreferrer");
      el.setAttribute("target", "_blank");
    }
  }
  const result = dom.window.document.body.innerHTML;
  dom.window.close();
  return result;
}
function textOf(html: string): string {
  const dom = new JSDOM(html);
  const value =
    dom.window.document.body.textContent?.replace(/\s+/g, " ").trim() || "";
  dom.window.close();
  return value;
}
export function htmlToMarkdown(html: string): string {
  const dom = new JSDOM(html);
  const escape = (text: string) => text.replace(/([\\`*_\[\]])/g, "\\$1");
  function render(node: Node): string {
    if (node.nodeType === 3) return escape(node.textContent || "");
    if (node.nodeType !== 1) return "";
    const el = node as Element,
      tag = el.tagName.toLowerCase();
    const content = () => [...el.childNodes].map(render).join("");
    if (/^h[1-6]$/.test(tag))
      return "\n\n" + "#".repeat(Number(tag[1])) + " " + content() + "\n\n";
    if (tag === "pre") {
      const code = el.querySelector("code"),
        body = el.textContent || "",
        language = code?.className.match(/language-([\w-]+)/)?.[1] || "";
      const fence = "`".repeat(
        Math.max(3, ...[...body.matchAll(/`+/g)].map((m) => m[0].length + 1)),
      );
      return "\n\n" + fence + language + "\n" + body + "\n" + fence + "\n\n";
    }
    if (tag === "code")
      return "`" + (el.textContent || "").replaceAll("`", "\\`") + "`";
    if (tag === "a")
      return "[" + content() + "](" + el.getAttribute("href") + ")";
    if (tag === "img")
      return (
        "![" +
        escape(el.getAttribute("alt") || "") +
        "](" +
        el.getAttribute("src") +
        ")"
      );
    if (tag === "strong" || tag === "b") return "**" + content() + "**";
    if (tag === "em" || tag === "i") return "*" + content() + "*";
    if (tag === "li") return "\n- " + content();
    if (tag === "blockquote")
      return (
        "\n\n" +
        content()
          .trim()
          .split("\n")
          .map((l) => "> " + l)
          .join("\n") +
        "\n\n"
      );
    if (tag === "br") return "\n";
    if (
      ["p", "div", "section", "article", "ul", "ol", "table", "tr"].includes(
        tag,
      )
    )
      return "\n\n" + content() + "\n\n";
    return content();
  }
  const output = render(dom.window.document.body)
    .trim()
    .replace(/\n{3,}/g, "\n\n");
  dom.window.close();
  return output;
}
const array = (x: any): any[] =>
  x === undefined || x === null ? [] : Array.isArray(x) ? x : [x];
const text = (x: any): string =>
  typeof x === "object" ? String(x?.["#text"] || "") : String(x ?? "");
function xml(xml: string): any {
  if (Buffer.byteLength(xml) > 5_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml))
    throw Error("Unsupported XML declaration or size");
  const validation = XMLValidator.validate(xml);
  if (validation !== true) throw Error("Invalid XML");
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: false,
    trimValues: true,
  }).parse(xml);
}
export function parseFeed(source: string, url: string): ParsedFeed {
  const data = xml(source);
  const channel = data.rss?.channel || data["rdf:RDF"]?.channel;
  const atom = data.feed;
  if (!channel && !atom) throw Error("Document is not RSS or Atom");
  const root = channel || atom;
  const items = array(
    channel ? channel.item || data["rdf:RDF"]?.item : atom.entry,
  );
  const articles: ArticleInput[] = [];
  // A separate ordered tree preserves mixed XHTML text around inline elements.
  const ordered = atom
    ? new XMLParser({
        preserveOrder: true,
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        parseTagValue: false,
        trimValues: false,
      }).parse(source)
    : null;
  const orderedEntries =
    ordered
      ?.find((node: any) => node.feed)
      ?.feed.filter((node: any) => node.entry) || [];
  const builder = new XMLBuilder({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
  });
  for (const [itemIndex, item] of items.entries()) {
    const links = array(item.link);
    const link = channel
      ? text(item.link)
      : text(
          links.find((x) => !x["@_rel"] || x["@_rel"] === "alternate")?.[
            "@_href"
          ],
        );
    let articleUrl;
    try {
      articleUrl = normalizeUrl(
        new URL(link || text(item.guid || item.id), url).href,
      );
    } catch {
      continue;
    }
    const content =
      item["content:encoded"] ||
      item.content ||
      item.description ||
      item.summary;
    const contentNode = orderedEntries[itemIndex]?.entry.find(
      (node: any) => node.content || node.summary,
    );
    const isXhtml = contentNode?.[":@"]?.["@_type"] === "xhtml";
    const rich = isXhtml
      ? builder.build(contentNode.content || contentNode.summary)
      : text(content);
    const html = sanitizeHtml(rich, articleUrl);
    const contentText = textOf(html);
    const date = text(
      item.pubDate || item.published || item.updated || item["dc:date"],
    );
    articles.push({
      url: articleUrl,
      title: text(item.title) || articleUrl,
      guid: text(item.guid || item.id) || articleUrl,
      publishedAt:
        date && !Number.isNaN(Date.parse(date))
          ? new Date(date).toISOString()
          : null,
      html,
      contentText,
      excerpt: contentText.slice(0, 240),
    });
  }
  return { url: normalizeUrl(url), title: text(root.title) || url, articles };
}
export function parseOpml(
  source: string,
): { url: string; title: string; group: string }[] {
  const data = xml(source);
  if (!data.opml?.body) throw Error("Document is not OPML");
  const feeds: { url: string; title: string; group: string }[] = [];
  function visit(nodes: any, group = "") {
    for (const n of array(nodes)) {
      if (n["@_xmlUrl"])
        feeds.push({
          url: normalizeUrl(n["@_xmlUrl"]),
          title: n["@_title"] || n["@_text"] || n["@_xmlUrl"],
          group,
        });
      visit(
        n.outline,
        n["@_xmlUrl"] ? group : n["@_text"] || n["@_title"] || group,
      );
    }
  }
  visit(data.opml.body.outline);
  return feeds;
}
export function exportOpml(
  feeds: { url: string; title: string; group?: string }[],
): string {
  const escape = (s: string) =>
    s
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  const groups = new Map<string, typeof feeds>();
  for (const f of feeds) {
    const key = f.group || "";
    groups.set(key, [...(groups.get(key) || []), f]);
  }
  return (
    '<?xml version="1.0" encoding="UTF-8"?><opml version="2.0"><head><title>RSS Pal</title></head><body>' +
    [...groups]
      .map(
        ([group, items]) =>
          (group ? `<outline text="${escape(group)}">` : "") +
          items
            .map(
              (f) =>
                `<outline type="rss" text="${escape(f.title)}" title="${escape(f.title)}" xmlUrl="${escape(f.url)}"/>`,
            )
            .join("") +
          (group ? "</outline>" : ""),
      )
      .join("") +
    "</body></opml>"
  );
}
export interface FetcherOptions {
  transport?: (url: string, init: RequestInit) => Promise<Response>;
  resolver?: Resolver;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
}
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) {
          if (value instanceof Response) void value.body?.cancel();
          reject(signal.reason);
        } else resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}
export class Fetcher implements FeedFetcher {
  private readonly options: FetcherOptions;
  constructor(options: FetcherOptions = {}) {
    this.options = options;
  }
  private async defaultTransport(
    url: string,
    signal: AbortSignal,
  ): Promise<Response> {
    const addresses = await assertPublicUrl(url, this.options.resolver);
    const u = new URL(url);
    return new Promise((resolve, reject) => {
      const req = (u.protocol === "https:" ? https : http).request(
        u,
        {
          method: "GET",
          signal,
          headers: {
            "User-Agent": "RSS-Pal-DSH/1.0",
            Accept:
              "application/rss+xml, application/atom+xml, text/html, application/xml;q=0.9, */*;q=0.5",
            "Accept-Encoding": "identity",
          },
          lookup: ((_host: any, opts: any, cb: any) => {
            if (opts.all) cb(null, addresses);
            else cb(null, addresses[0].address, addresses[0].family);
          }) as any,
        },
        (res) => {
          try {
            const headers = new Headers();
            for (const [k, v] of Object.entries(res.headers))
              if (v !== undefined)
                headers.set(k, Array.isArray(v) ? v.join(",") : v);
            const status = res.statusCode || 500;
            const noBody = [204, 205, 304].includes(status);
            if (noBody) res.resume();
            resolve(
              new Response(noBody ? null : (Readable.toWeb(res) as any), {
                status,
                headers,
              }),
            );
          } catch (error) {
            res.destroy();
            reject(error);
          }
        },
      );
      req.on("error", reject);
      req.end();
    });
  }
  private async read(
    input: string,
    options: FetchOptions = {},
  ): Promise<{ body: string; url: string }> {
    let url = normalizeUrl(input);
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 15000),
      signal = options.signal
        ? AbortSignal.any([options.signal, timeout])
        : timeout;
    for (
      let redirects = 0;
      redirects <= (this.options.maxRedirects ?? 5);
      redirects++
    ) {
      signal.throwIfAborted();
      const response = await abortable(
        this.options.transport
          ? this.options.transport(url, { signal, redirect: "manual" })
          : this.defaultTransport(url, signal),
        signal,
      );
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (!location) throw Error("Redirect without location");
        url = normalizeUrl(new URL(location, url).href);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw Error(`HTTP ${response.status}`);
      }
      const max = this.options.maxBytes ?? 5_000_000;
      if (Number(response.headers.get("content-length")) > max) {
        await response.body?.cancel();
        throw Error("Response size limit exceeded");
      }
      const reader = response.body?.getReader();
      if (!reader) return { body: "", url };
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      const abort = () => {
        void reader.cancel(signal.reason);
      };
      signal.addEventListener("abort", abort, { once: true });
      try {
        while (true) {
          signal.throwIfAborted();
          const { value, done } = await reader.read();
          signal.throwIfAborted();
          if (done) break;
          bytes += value.length;
          if (bytes > max) {
            await reader.cancel();
            throw Error("Response size limit exceeded");
          }
          chunks.push(value);
        }
        return { body: Buffer.concat(chunks).toString("utf8"), url };
      } finally {
        signal.removeEventListener("abort", abort);
        reader.releaseLock();
      }
    }
    throw Error("Redirect limit exceeded");
  }
  async fetchFeed(
    url: string,
    options: FetchOptions = {},
  ): Promise<ParsedFeed> {
    const result = await this.read(url, options);
    return parseFeed(result.body, result.url);
  }
  async fetchArticle(
    url: string,
    options: FetchOptions = {},
  ): Promise<ArticleInput> {
    const result = await this.read(url, options);
    const dom = new JSDOM(result.body, { url: result.url });
    let parsed;
    try {
      parsed = new Readability(dom.window.document).parse();
      const html = sanitizeHtml(
        parsed?.content ||
          dom.window.document.querySelector("article,main")?.innerHTML ||
          dom.window.document.body.innerHTML,
        result.url,
      );
      const contentText = textOf(html);
      if (!contentText) throw Error("No readable article content");
      return {
        url: result.url,
        title: parsed?.title || dom.window.document.title || result.url,
        html,
        contentText,
        excerpt: parsed?.excerpt || contentText.slice(0, 240),
      };
    } finally {
      dom.window.close();
    }
  }
}
