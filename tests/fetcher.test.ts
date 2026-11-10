import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  Fetcher,
  parseFeed,
  parseOpml,
  exportOpml,
  sanitizeHtml,
  assertPublicUrl,
} from "../src/host/fetcher.js";

test("native HTTP null-body responses 204 205 304 reject normally without crashing process", () => {
  const script = `import http from 'node:http';import {Fetcher} from './src/host/fetcher.ts';const server=http.createServer((req,res)=>{res.writeHead(Number(req.url.slice(1)));res.end();});await new Promise(r=>server.listen(0,'127.0.0.1',r));const original=http.request;http.request=(url,options,callback)=>original(new URL('http://127.0.0.1:'+server.address().port+url.pathname),options,callback);const fetcher=new Fetcher({resolver:async()=>[{address:'93.184.216.34',family:4}]});try{for(const status of [204,205,304]){try{await fetcher.fetchFeed('http://fixture.example/'+status);throw Error('unexpected successful empty feed');}catch(error){if(error.message==='unexpected successful empty feed')throw error;console.log('handled',status);}}}finally{server.close();}`;
  const child = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    { cwd: process.cwd(), encoding: "utf8", timeout: 10000 },
  );
  assert.equal(child.status, 0, child.stderr);
  for (const status of [204, 205, 304])
    assert.match(child.stdout, new RegExp("handled " + status));
});
test("RSS and Atom parse content, relative links and Chinese titles", () => {
  const rss = parseFeed(
    "<rss><channel><title>中文源</title><item><guid>x</guid><title>文章</title><link>/a</link><description><![CDATA[<p>正文</p>]]></description></item></channel></rss>",
    "https://example.com/rss",
  );
  assert.equal(rss.title, "中文源");
  assert.equal(rss.articles[0].url, "https://example.com/a");
  const atom = parseFeed(
    '<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title><entry><id>y</id><title>B</title><link href="https://example.com/b"/><content type="html">&lt;p&gt;body&lt;/p&gt;</content></entry></feed>',
    "https://example.com/feed",
  );
  assert.equal(atom.articles[0].contentText, "body");
  assert.throws(() =>
    parseFeed("<html><body>not RSS</body></html>", "https://example.com"),
  );
});
test("Atom XHTML preserves mixed content order and nested formatting", () => {
  const feed = parseFeed(
    '<feed xmlns="http://www.w3.org/2005/Atom"><title>XHTML</title><entry><id>x</id><title>Rich</title><link href="https://example.com/a"/><content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>Before <strong>bold</strong> after <em>emphasis</em> tail</p><pre><code>let x = 1;</code></pre><script>evil()</script></div></content></entry></feed>',
    "https://example.com/feed",
  );
  assert.match(
    feed.articles[0].contentText!,
    /Before bold after emphasis tail/,
  );
  assert.match(feed.articles[0].html!, /<strong>bold<\/strong>/);
  assert.match(feed.articles[0].html!, /<code>let x = 1;<\/code>/);
  assert.doesNotMatch(feed.articles[0].html!, /script|evil/);
});
test("DOM cleaner removes script handlers but preserves following text, images and code", () => {
  const html = sanitizeHtml(
    '<script>alert(1)</script><p>keep<script>evil</script>after</p><img src="/a.png" onerror="evil()"><pre><code>x()</code></pre>',
    "https://example.com",
  );
  assert.match(html, /keep/);
  assert.match(html, /after/);
  assert.match(html, /code/);
  assert.doesNotMatch(html, /script|onerror/);
  assert.match(html, /https:\/\/example.com\/a.png/);
});
test("public HTTP rejects private IPv4, mapped IPv6, credentials and non HTTP", async () => {
  for (const url of [
    "http://127.0.0.1",
    "http://10.0.0.1",
    "http://[::1]",
    "http://[::ffff:127.0.0.1]",
    "file:///etc/passwd",
    "https://a:b@example.com",
  ])
    await assert.rejects(() => assertPublicUrl(url));
  await assert.rejects(() =>
    assertPublicUrl("https://example.test", async () => [
      { address: "192.168.1.2", family: 4 },
    ]),
  );
  await assert.doesNotReject(() =>
    assertPublicUrl("https://example.test", async () => [
      { address: "93.184.216.34", family: 4 },
    ]),
  );
});
test("injected transport respects response size limit and extracts clean readable text", async () => {
  const f = new Fetcher({
    maxBytes: 100,
    transport: async () => new Response("x".repeat(101)),
  });
  await assert.rejects(
    () => f.fetchFeed("https://example.com/rss"),
    /size|large|limit/i,
  );
  const clean = new Fetcher({
    transport: async () =>
      new Response(
        "<html><head><title>Article</title></head><body><article><p>" +
          "Useful article text ".repeat(80) +
          "</p><script>evil()</script></article></body></html>",
        { headers: { "content-type": "text/html" } },
      ),
  });
  const a = await clean.fetchArticle("https://example.com/a");
  assert.match(a.contentText!, /Useful/);
  assert.doesNotMatch(a.html!, /script/);
});
test("transport request is bounded even when fixture ignores abort", { timeout: 1000 }, async () => {
  const f = new Fetcher({
    timeoutMs: 10,
    // Never settles: only the fetcher's deadline can end this request.
    transport: async () => new Promise<Response>(() => {}),
  });
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(() => f.fetchFeed("https://example.com/rss"), /timeout/i);
  } finally {
    clearTimeout(keepAlive);
  }
});
test("OPML roundtrips groups and escapes XML", () => {
  const feeds = [
    { url: "https://example.com/rss?a=1&b=2", title: "A & B", group: "科技" },
  ];
  assert.deepEqual(parseOpml(exportOpml(feeds)), feeds);
});
