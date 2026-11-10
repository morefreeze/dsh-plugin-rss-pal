import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "../src/host/application.js";
const fixture = {
  fetchFeed: async (url: string) => ({
    url,
    title: "Feed",
    articles: [
      {
        url: "https://example.com/a",
        guid: "a",
        title: "中文 article",
        contentText: "old body",
        html: "<p>old body</p>",
      },
    ],
  }),
  fetchArticle: async (url: string) => ({
    url,
    title: "Clip",
    contentText: "new body",
    html: "<p>new body</p>",
  }),
};
async function settle(app: Application, id: string) {
  for (let i = 0; i < 100; i++) {
    const j = (await app.listJobs()).find((x: any) => x.id === id);
    if (
      j &&
      ["completed", "failed", "cancelled", "interrupted"].includes(j.status)
    )
      return j;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw Error("job did not settle");
}
test("full subscription lifecycle, manual generation cache, stale body and backup roundtrip", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rss-app-"));
  let calls = 0;
  const app = new Application({
    dataDir: dir,
    fetcher: fixture,
    generate: async ({ onProgress }: any) => {
      calls++;
      onProgress("stream");
      return { brief: "brief", detail: "detail", model: "test" };
    },
  });
  await app.ready;
  const feed = await app.addFeed({
    url: "https://example.com/rss",
    group: "Tech",
  });
  const job = await app.refresh({ feedId: feed.id });
  assert.equal((await settle(app, job.jobId)).status, "completed");
  const a = (await app.listArticles({}))[0];
  assert.equal(calls, 0);
  await app.setTags({ id: a.id, tags: [" 中文 ", "中文"] });
  assert.deepEqual((await app.getArticle({ id: a.id })).tags, ["中文"]);
  const sum = await app.generateSummary({ id: a.id });
  await settle(app, sum.jobId);
  const cached = await app.generateSummary({ id: a.id });
  assert.equal(cached.cached, true);
  assert.equal(calls, 1);
  const refetch = await app.refetch({ id: a.id });
  await settle(app, refetch.jobId);
  assert.equal((await app.getArticle({ id: a.id })).summary!.status, "stale");
  assert.equal(calls, 1);
  const data = await app.backup();
  await app
    .capture({ url: "https://example.com/extra" })
    .then((j) => settle(app, j.jobId));
  await app.restore({ data });
  assert.equal((await app.listArticles({})).length, 1);
  await app.saveSettings({ refreshMinutes: 0, fontSize: 20 });
  app.dispose();
  const restored = new Application({ dataDir: dir, fetcher: fixture });
  await restored.ready;
  assert.equal((await restored.getSettings()).refreshMinutes, 0);
  restored.dispose();
  rmSync(dir, { recursive: true, force: true });
});
test('summary requests detach selection, pass immutable job snapshot, and segregate cache by model and effort',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'rss-selection-'));const received:any[]=[];
 const app=new Application({dataDir:dir,fetcher:fixture,generate:async(input:any)=>{received.push(input.selection);return {brief:'b',detail:'d'};}});
 try {
 await settle(app,(await app.capture({url:'https://example.com/a'})).jobId);const id=(await app.listArticles({}))[0].id;
 const selection={provider:'p',model:'m',reasoning:'low'};
 const first=await app.generateSummary({id,selection} as any);selection.reasoning='high';await settle(app,first.jobId);
 assert.deepEqual(received[0],{provider:'p',model:'m',reasoning:'low'});assert.ok(Object.isFrozen(received[0]));
 assert.deepEqual((await app.listJobs()).find(j=>j.id===first.jobId)!.request.selection,{provider:'p',model:'m',reasoning:'low'});
 assert.equal((await app.generateSummary({id,selection:{provider:'p',model:'m',reasoning:'low'}} as any)).cached,true);
 for(const selection of [{provider:'p',model:'m',reasoning:'high'},{provider:'p',model:'other',reasoning:'high'},{provider:'other',model:'m',reasoning:'high'}]) {const next=await app.generateSummary({id,selection} as any);assert.notEqual(next.cached,true);await settle(app,next.jobId);}
 assert.equal(received.length,4);
 } finally {app.dispose();rmSync(dir,{recursive:true,force:true});}
});
test('active summary dedup includes submitted body and template hashes',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'rss-version-dedup-'));let body='first';let release!:()=>void;
 const gate=new Promise<void>(r=>{release=r;});
 const app=new Application({dataDir:dir,fetcher:{...fixture,fetchFeed:async(url:string)=>({...await fixture.fetchFeed(url),articles:[{url:'https://example.com/a',title:'a',contentText:body}]})},generate:async()=>{await gate;return {brief:'b',detail:'d'};}});
 try{await app.addFeed({url:'https://example.com/rss'});const a=(await app.listArticles({}))[0];const selection={provider:'p',model:'m'};
 const first=await app.generateSummary({id:a.id,selection});assert.equal((await app.generateSummary({id:a.id,selection})).jobId,first.jobId);
 body='second';await app.addFeed({url:'https://example.com/rss'});const second=await app.generateSummary({id:a.id,selection});assert.notEqual(second.jobId,first.jobId);
 const template=(await app.listTemplates())[0];await app.saveTemplate({...template,prompt:'changed prompt'});const third=await app.generateSummary({id:a.id,selection});assert.notEqual(third.jobId,second.jobId);
 const jobs=await app.listJobs();assert.equal(jobs.find(j=>j.id===first.jobId)!.request.contentHash,a.contentHash);assert.equal(typeof jobs.find(j=>j.id===third.jobId)!.request.templateHash,'string');
 release();await Promise.all([first,second,third].map(j=>settle(app,j.jobId)));
 }finally{release();app.dispose();rmSync(dir,{recursive:true,force:true});}
});
test('dedicated summary preference survives settings and backup without changing general settings',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'rss-pref-'));const app=new Application({dataDir:dir,fetcher:fixture});
 try {assert.equal(typeof (app as any).getSummarySelection,'function');assert.deepEqual(await (app as any).getSummarySelection(),null);
 const selection={provider:'p',model:'m',reasoning:'high'};await (app as any).saveSummarySelection({selection});await app.saveSettings({refreshMinutes:0});
 const data=await app.backup();await (app as any).saveSummarySelection({selection:null});await app.restore({data});
 assert.deepEqual(await (app as any).getSummarySelection(),selection);assert.equal((await app.getSettings() as any).selection,undefined);
 } finally {app.dispose();rmSync(dir,{recursive:true,force:true});}
});
test("adding a feed seeds preview articles immediately without generation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rss-add-"));
  const app = new Application({ dataDir: dir, fetcher: fixture });
  await app.ready;
  await app.addFeed({ url: "https://example.com/rss" });
  assert.equal((await app.listArticles({})).length, 1);
  app.dispose();
  rmSync(dir, { recursive: true, force: true });
});
test("switching templates reuses cache for each body and prompt version", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rss-cache-"));
  let calls = 0;
  const app = new Application({
    dataDir: dir,
    fetcher: fixture,
    generate: async () => {
      calls++;
      return { brief: "brief", detail: "detail" };
    },
  });
  await app.ready;
  const clip = await app.capture({ url: "https://example.com/a" });
  await settle(app, clip.jobId);
  const id = (await app.listArticles({}))[0].id;
  const t = await app.saveTemplate({ name: "other", prompt: "other prompt" });
  await settle(app, (await app.generateSummary({ id })).jobId);
  await settle(
    app,
    (await app.generateSummary({ id, templateId: t.id })).jobId,
  );
  assert.equal((await app.generateSummary({ id })).cached, true);
  assert.equal(calls, 2);
  app.dispose();
  rmSync(dir, { recursive: true, force: true });
});
test("restart interrupts unfinished AI and does not automatically regenerate", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rss-restart-"));
  let calls = 0;
  const generate = async ({ signal }: any) => {
    calls++;
    await new Promise((_, reject) =>
      signal.addEventListener("abort", () => reject(Error("stopped")), {
        once: true,
      }),
    );
    return { brief: "", detail: "" };
  };
  const app = new Application({ dataDir: dir, fetcher: fixture, generate });
  await app.ready;
  await app.saveSettings({ refreshMinutes: 0 });
  await settle(
    app,
    (await app.capture({ url: "https://example.com/a" })).jobId,
  );
  const id = (await app.listArticles({}))[0].id;
  const j = await app.generateSummary({ id });
  await new Promise((r) => setTimeout(r, 5));
  app.dispose();
  const again = new Application({ dataDir: dir, fetcher: fixture, generate });
  await again.ready;
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(
    (await again.listJobs()).find((x) => x.id === j.jobId)!.status,
    "interrupted",
  );
  assert.equal(calls, 1);
  again.dispose();
  rmSync(dir, { recursive: true, force: true });
});
test("feed refresh preserves captured fulltext and successful summary", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rss-provenance-"));
  const app = new Application({
    dataDir: dir,
    fetcher: fixture,
    generate: async () => ({ brief: "brief", detail: "detail" }),
  });
  await app.ready;
  const f = await app.addFeed({ url: "https://example.com/rss" });
  const id = (await app.listArticles({}))[0].id;
  await settle(app, (await app.refetch({ id })).jobId);
  await settle(app, (await app.generateSummary({ id })).jobId);
  await settle(app, (await app.refresh({ feedId: f.id })).jobId);
  const a = await app.getArticle({ id });
  assert.equal(a.contentText, "new body");
  assert.equal(a.summary!.status, "ready");
  app.dispose();
  rmSync(dir, { recursive: true, force: true });
});
test("Markdown export preserves article links, headings and code blocks", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rss-md-"));
  const fetcher = {
    ...fixture,
    fetchArticle: async (url: string) => ({
      url,
      title: "Markdown",
      contentText: "Heading code",
      html: '<h2>Heading</h2><p><a href="https://example.com/link">Link</a></p><pre><code class="language-ts">const n = 1;</code></pre>',
    }),
  };
  const app = new Application({ dataDir: dir, fetcher });
  await app.ready;
  await settle(
    app,
    (await app.capture({ url: "https://example.com/a" })).jobId,
  );
  const out = await app.exportArticle({
    id: (await app.listArticles({}))[0].id,
  });
  assert.match(out.markdown, /## Heading/);
  assert.match(out.markdown, /\[Link\]\(https:\/\/example.com\/link\)/);
  assert.match(out.markdown, /```ts/);
  app.dispose();
  rmSync(dir, { recursive: true, force: true });
});
test("running summary cancellation preserves cache and explicit retry works", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rss-jobs-"));
  let attempt = 0;
  const app = new Application({
    dataDir: dir,
    fetcher: fixture,
    generate: async ({ signal }: any) => {
      attempt++;
      if (attempt === 1)
        await new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => reject(Error("aborted")), {
            once: true,
          });
        });
      return { brief: "ok", detail: "ok" };
    },
  });
  await app.ready;
  const clip = await app.capture({ url: "https://example.com/a" });
  await settle(app, clip.jobId);
  const id = (await app.listArticles({}))[0].id;
  const j = await app.generateSummary({ id });
  await new Promise((r) => setTimeout(r, 10));
  await app.cancelJob({ id: j.jobId });
  assert.equal((await settle(app, j.jobId)).status, "cancelled");
  assert.equal((await app.getArticle({ id })).summary, null);
  const retry = await app.retryJob({ id: j.jobId });
  assert.equal((await settle(app, retry.jobId)).status, "completed");
  app.dispose();
  rmSync(dir, { recursive: true, force: true });
});
