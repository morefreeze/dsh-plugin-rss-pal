import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Repository } from "../src/host/repository.js";

test('legacy summaries survive backup but never hit a selected-model cache and malformed selection restore is transactional',()=>{
 const dir=mkdtempSync(join(tmpdir(),'rss-legacy-selection-'));const r=new Repository(dir);
 try {const a=r.upsertArticle({url:'https://example.com/a',title:'a',contentText:'body'});const template=r.listTemplates()[0];
 const legacy={brief:'b',detail:'d',status:'ready' as const,contentHash:a.contentHash,templateId:template.id,templateHash:undefined,model:'old',generatedAt:new Date().toISOString()};
 // Preserve the legacy record, while selected-model cache retrieval excludes it.
 a.summary=legacy;r.saveArticle(a);r.cacheSummary(a.id,{...legacy,templateHash:'legacy'});
 assert.equal(r.getCachedSummary(a,template,{provider:'p',model:'m'}),null);assert.equal(r.requireArticle(a.id).summary!.model,'old');
 r.saveSummarySelection({provider:'p',model:'m'});const data=r.backup();const row=data.tables.settings.find((row:any)=>row.id==='summary-selection')!;
 row.data=JSON.stringify({id:'summary-selection',value:{provider:'p',model:'m',reasoning:7}});
 assert.throws(()=>r.restore(data),/summary selection/);assert.deepEqual(r.getSummarySelection(),{provider:'p',model:'m'});
 }finally{r.close();rmSync(dir,{recursive:true,force:true});}
});
test("SQLite persists articles, Chinese substring search and source associations across restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "rss-repo-"));
  let r = new Repository(dir);
  const f = r.addFeed({
    url: "https://example.com/rss",
    title: "RSS",
    group: "中文",
  });
  const a = r.upsertArticle({
    url: "https://example.com/a#frag",
    title: "学习人工智能",
    html: "<p>深度学习模型</p>",
    contentText: "深度学习模型",
    feedId: f.id,
    guid: "one",
  });
  r.upsertArticle({
    url: "https://example.com/a",
    title: "学习人工智能",
    html: "<p>深度学习模型</p>",
    contentText: "深度学习模型",
    feedId: f.id,
    guid: "two",
  });
  assert.equal(r.listArticles({ query: "人工" }).length, 1);
  assert.equal(r.listArticles({ query: "学习模型" }).length, 1);
  r.setState(a.id, { favorite: true, reaction: "like" });
  r.setState(a.id, { reaction: "like" });
  assert.equal(r.getArticle(a.id)?.reaction, null);
  assert.equal(r.getArticle(a.id)?.favorite, true);
  r.close();
  r = new Repository(dir);
  assert.equal(r.listArticles({ feedId: f.id }).length, 1);
  assert.equal(r.getArticle(a.id)?.favorite, true);
  r.close();
  rmSync(dir, { recursive: true, force: true });
});

test("cross-feed GUID and normalized URL preserve associations and user state", () => {
  const dir = mkdtempSync(join(tmpdir(), "rss-source-"));
  const r = new Repository(dir);
  const f1 = r.addFeed({ url: "https://example.com/1" }),
    f2 = r.addFeed({ url: "https://example.com/2" });
  const a = r.upsertArticle({
    url: "https://example.com/a",
    title: "A",
    feedId: f1.id,
    guid: "g",
  });
  r.setState(a.id, { favorite: true });
  r.upsertArticle({
    url: "https://example.com/a#hash",
    title: "A",
    feedId: f2.id,
    guid: "g",
  });
  assert.equal(r.listArticles({ feedId: f2.id })[0].id, a.id);
  assert.equal(r.listArticles({ feedId: f1.id })[0].favorite, true);
  r.removeFeed(f1.id);
  assert.equal(r.getArticle(a.id)!.feedId, f2.id);
  assert.equal(r.listArticles({ feedId: f2.id }).length, 1);
  r.close();
  rmSync(dir, { recursive: true, force: true });
});
test("reading sequences deduplicate overlapping clients and save latest position", () => {
  const dir = mkdtempSync(join(tmpdir(), "rss-read-"));
  const r = new Repository(dir);
  const a = r.upsertArticle({
    url: "https://example.com/a",
    title: "A",
    contentText: "body",
  });
  const event = {
    clientId: "one",
    sequence: 1,
    progress: 0.7,
    seconds: 10,
    opened: true,
  };
  r.recordReading(a.id, event);
  r.recordReading(a.id, event);
  r.recordReading(a.id, { ...event, clientId: "two" });
  r.recordReading(a.id, {
    ...event,
    sequence: 2,
    progress: 0.4,
    seconds: 5,
    opened: false,
  });
  const result = r.getArticle(a.id)!;
  assert.equal(result.openCount, 1);
  assert.equal(result.readSeconds, 15);
  assert.equal(result.progress, 0.4);
  r.close();
  rmSync(dir, { recursive: true, force: true });
});

test("reading progress from duplicate foreground client is ignored", () => {
  const dir = mkdtempSync(join(tmpdir(), "rss-owner-"));
  const r = new Repository(dir);
  const a = r.upsertArticle({ url: "https://example.com/a", title: "A" });
  r.recordReading(a.id, {
    clientId: "a",
    sequence: 1,
    progress: 0.2,
    seconds: 3,
    opened: true,
  });
  r.recordReading(a.id, {
    clientId: "b",
    sequence: 1,
    progress: 1,
    seconds: 100,
    opened: true,
  });
  assert.equal(r.getArticle(a.id)!.progress, 0.2);
  assert.equal(r.getArticle(a.id)!.read, false);
  r.close();
  rmSync(dir, { recursive: true, force: true });
});
test("restore validates required article fields before any modification", () => {
  const dir = mkdtempSync(join(tmpdir(), "rss-invalid-"));
  const r = new Repository(dir);
  r.upsertArticle({
    url: "https://example.com/a",
    title: "A",
    contentText: "body",
  });
  const data = r.backup();
  const v = JSON.parse(data.tables.articles[0].data);
  delete v.readSeconds;
  data.tables.articles[0].data = JSON.stringify(v);
  assert.throws(() => r.restore(data), /Invalid/);
  assert.equal(r.listArticles({})[0].readSeconds, 0);
  r.close();
  rmSync(dir, { recursive: true, force: true });
});
test("mark unread persists after prior completion and later partial activity", () => {
  const dir = mkdtempSync(join(tmpdir(), "rss-unread-"));
  const r = new Repository(dir);
  const a = r.upsertArticle({ url: "https://example.com/a", title: "A" });
  r.recordReading(a.id, {
    clientId: "a",
    sequence: 1,
    progress: 1,
    seconds: 1,
  });
  r.setState(a.id, { read: false });
  r.recordReading(a.id, {
    clientId: "a",
    sequence: 2,
    progress: 0.2,
    seconds: 1,
  });
  assert.equal(r.getArticle(a.id)!.read, false);
  r.close();
  rmSync(dir, { recursive: true, force: true });
});
test("GUID collision merges state and associations instead of losing source state", () => {
  const dir = mkdtempSync(join(tmpdir(), "rss-merge-"));
  const r = new Repository(dir);
  const f1 = r.addFeed({ url: "https://example.com/1" }),
    f2 = r.addFeed({ url: "https://example.com/2" });
  const a = r.upsertArticle({
    url: "https://example.com/a",
    title: "A",
    feedId: f1.id,
    guid: "g",
  });
  r.setState(a.id, { favorite: true, read: true });
  const b = r.upsertArticle({
    url: "https://example.com/b",
    title: "B",
    feedId: f2.id,
    guid: "h",
  });
  const merged = r.upsertArticle({
    url: b.url,
    title: "New",
    feedId: f1.id,
    guid: "g",
  });
  assert.equal(merged.favorite, true);
  assert.equal(merged.read, true);
  assert.equal(r.listArticles({}).length, 1);
  assert.equal(r.listArticles({ feedId: f2.id })[0].id, merged.id);
  r.close();
  rmSync(dir, { recursive: true, force: true });
});
test("restore rejects malformed template and settings payloads", () => {
  const dir = mkdtempSync(join(tmpdir(), "rss-schema-"));
  const r = new Repository(dir);
  let data = r.backup();
  data.tables.templates[0].data = JSON.stringify({
    id: "default",
    name: "bad",
    prompt: 42,
  });
  assert.throws(() => r.restore(data), /Invalid/);
  data = r.backup();
  data.tables.settings.push({
    id: "preferences",
    data: JSON.stringify({ id: "preferences", value: { refreshMinutes: -4 } }),
  });
  assert.throws(() => r.restore(data), /Invalid/);
  r.close();
  rmSync(dir, { recursive: true, force: true });
});
test("inactive zero-time client releases lease to foreground client", () => {
  const dir = mkdtempSync(join(tmpdir(), "rss-lease-"));
  const r = new Repository(dir);
  const a = r.upsertArticle({ url: "https://example.com/a", title: "A" });
  r.recordReading(a.id, {
    clientId: "a",
    sequence: 1,
    progress: 0.2,
    seconds: 1,
    opened: true,
  });
  r.recordReading(a.id, {
    clientId: "a",
    sequence: 2,
    progress: 0.2,
    seconds: 0,
  });
  r.recordReading(a.id, {
    clientId: "b",
    sequence: 1,
    progress: 0.4,
    seconds: 2,
    opened: true,
  });
  assert.equal(r.getArticle(a.id)!.readSeconds, 3);
  r.close();
  rmSync(dir, { recursive: true, force: true });
});
test("reopening explicitly unread article preserves unread and latest backward position across restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "rss-latest-"));
  let r = new Repository(dir);
  const a = r.upsertArticle({ url: "https://example.com/a", title: "A" });
  r.recordReading(a.id, {
    clientId: "a",
    sequence: 1,
    progress: 1,
    seconds: 1,
  });
  r.setState(a.id, { read: false });
  r.recordReading(a.id, {
    clientId: "a",
    sequence: 2,
    progress: 1,
    seconds: 0,
    opened: true,
  });
  assert.equal(r.getArticle(a.id)!.read, false);
  r.recordReading(a.id, {
    clientId: "a",
    sequence: 3,
    progress: 0.2,
    seconds: 1,
  });
  r.close();
  r = new Repository(dir);
  assert.equal(r.getArticle(a.id)!.progress, 0.2);
  assert.equal(r.getArticle(a.id)!.read, false);
  r.close();
  rmSync(dir, { recursive: true, force: true });
});
test("restore strictly validates embedded summaries and cache summaries", () => {
  const dir = mkdtempSync(join(tmpdir(), "rss-summary-schema-"));
  const r = new Repository(dir);
  r.upsertArticle({ url: "https://example.com/a", title: "A" });
  let data = r.backup();
  const a = JSON.parse(data.tables.articles[0].data);
  a.summary = { brief: 42, detail: { bad: true }, status: "ready" };
  data.tables.articles[0].data = JSON.stringify(a);
  assert.throws(() => r.restore(data), /Invalid/);
  data = r.backup();
  data.tables.summary_cache.push({
    id: "bad",
    data: JSON.stringify({
      id: "bad",
      brief: "b",
      detail: "d",
      contentHash: "h",
      templateId: "default",
      templateHash: "t",
      status: "invalid",
      model: 42,
      generatedAt: "oops",
    }),
  });
  assert.throws(() => r.restore(data), /Invalid/);
  r.close();
  rmSync(dir, { recursive: true, force: true });
});
test("backup restore is transactional and preserves originals on invalid input", () => {
  const dir = mkdtempSync(join(tmpdir(), "rss-backup-"));
  const r = new Repository(dir);
  r.upsertArticle({
    url: "https://example.com/a",
    title: "A",
    contentText: "body",
  });
  const data = r.backup();
  r.upsertArticle({ url: "https://example.com/b", title: "B" });
  r.restore(data);
  assert.equal(r.listArticles({}).length, 1);
  assert.throws(() => r.restore({ schemaVersion: 999 }));
  assert.equal(r.listArticles({}).length, 1);
  r.close();
  rmSync(dir, { recursive: true, force: true });
});
