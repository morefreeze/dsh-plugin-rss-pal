import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const moduleUrl = new URL('../scripts/download-report.mjs', import.meta.url);
const load = () => import(moduleUrl.href);
const now = new Date('2026-01-31T18:30:00Z');
const ok = (data) => ({ ok: true, status: 200, json: async () => data });
const days = Array.from({ length: 30 }, (_, i) => ({ day: `2026-01-${String(i + 1).padStart(2, '0')}`, downloads: i + 1 }));
const mockSuccess = (seen = []) => async (url, options) => {
  seen.push({ url: String(url), options });
  if (String(url).includes('api.npmjs.org')) return ok({ start: '2026-01-01', end: '2026-01-30', downloads: days });
  if (String(url).includes('/releases?')) return ok([{ tag_name: 'v1', assets: [{ id: 1, name: 'plugin.tgz', download_count: 12 }] }]);
  return ok({ stargazers_count: 8, forks_count: 2, open_issues_count: 3 });
};

test('report module exists and exposes its standalone API', async () => {
  const m = await load().catch(() => null);
  assert.ok(m, 'standalone report module must exist');
  assert.equal(typeof m.runReport, 'function');
});

test('window uses exactly 30 completed UTC days across month/year boundaries', async () => {
  const { reportingWindow } = await load();
  assert.deepEqual(reportingWindow(now), { start: '2026-01-01', end: '2026-01-30', days: 30 });
  assert.deepEqual(reportingWindow(new Date('2026-01-01T00:01:00Z')), { start: '2025-12-02', end: '2025-12-31', days: 30 });
});

test('mock success separates npm daily totals, cumulative assets and repository metrics', async () => {
  const { collectReport, renderMarkdown } = await load();
  const seen = [];
  const report = await collectReport({ now, fetchImpl: mockSuccess(seen), token: 'secret-test-value' });
  assert.equal(report.npm.status, 'ok');
  assert.equal(report.npm.totalDownloads, 465);
  assert.equal(report.npm.daily.length, 30);
  assert.equal(report.github.releases.totalAssetDownloads, 12);
  assert.equal(report.github.repository.stars, 8);
  assert.equal(report.github.repository.forks, 2);
  assert.equal(report.github.repository.openIssuesIncludingPullRequests, 3);
  assert.match(seen[0].url, /2026-01-01:2026-01-30\/rss-pal-dsh/);
  assert.ok(seen.filter(x => x.url.includes('api.github.com')).every(x => x.options.headers.Authorization === 'Bearer secret-test-value'));
  assert.ok(seen.filter(x => x.url.includes('api.npmjs.org')).every(x => !x.options.headers.Authorization));
  assert.ok(!JSON.stringify(report).includes('secret-test-value'));
  const md = renderMarkdown(report);
  assert.match(md, /下载不是用户/);
  assert.match(md, /不得相加/);
  assert.match(md, /累计/);
});

test('GitHub token is accepted from environment and never enters persisted report', async () => {
  const { collectReport } = await load();
  const saved = process.env.GITHUB_TOKEN;
  try {
    process.env.GITHUB_TOKEN = 'mock-environment-token';
    const seen = [];
    const report = await collectReport({ now, fetchImpl: mockSuccess(seen) });
    assert.ok(seen.filter(x => x.url.includes('api.github.com')).every(x => x.options.headers.Authorization === 'Bearer mock-environment-token'));
    assert.ok(!JSON.stringify(report).includes('mock-environment-token'));
  } finally {
    if (saved === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = saved;
  }
});

test('HTTP failure and thrown secret never fabricate zero or expose messages', async () => {
  const { collectReport, renderMarkdown } = await load();
  const report = await collectReport({ now, fetchImpl: async (url) => {
    if (String(url).includes('npmjs')) return { ok: false, status: 503 };
    throw new Error('Bearer private-credential');
  } });
  assert.deepEqual(report.npm, { status: 'unknown', error: 'http_503' });
  assert.deepEqual(report.github.releases, { status: 'unknown', error: 'request_failed' });
  assert.ok(!JSON.stringify(report).includes('private-credential'));
  assert.ok(!('totalDownloads' in report.npm));
  assert.match(renderMarkdown(report), /unknown.*http_503/);
});

test('missing, duplicate, outside-window or invalid npm days mark entire aggregate unknown', async () => {
  const { collectReport } = await load();
  for (const downloads of [days.slice(1), [...days.slice(1), days[1]], [...days.slice(1), { day: '2026-01-31', downloads: 1 }], days.map((d, i) => i ? d : { ...d, downloads: -1 })]) {
    const report = await collectReport({ now, fetchImpl: async (url, opts) => String(url).includes('npmjs') ? ok({ downloads }) : mockSuccess()(url, opts) });
    assert.deepEqual(report.npm, { status: 'unknown', error: 'invalid_response' });
  }
});

test('release pagination retains cumulative asset count once and failure stays unknown', async () => {
  const { collectReport } = await load();
  const page1 = Array.from({ length: 100 }, (_, i) => ({ tag_name: `v${i}`, assets: [{ id: i, name: `${i}.tgz`, download_count: 1 }] }));
  const report = await collectReport({ now, fetchImpl: async (url, opts) => {
    if (String(url).includes('/releases?')) return ok(String(url).includes('page=2') ? [{ tag_name: 'last', assets: [{ id: 101, name: 'last', download_count: 4 }] }] : page1);
    return mockSuccess()(url, opts);
  } });
  assert.equal(report.github.releases.totalAssetDownloads, 104);
  assert.equal(report.github.releases.assets.length, 101);
  const failed = await collectReport({ now, fetchImpl: async (url, opts) => {
    if (String(url).includes('/releases?')) return String(url).includes('page=2') ? { ok: false, status: 403 } : ok(page1);
    return mockSuccess()(url, opts);
  } });
  assert.deepEqual(failed.github.releases, { status: 'unknown', error: 'http_403' });
});

test('valid zero counts and empty releases remain measured zero, not unknown', async () => {
  const { collectReport } = await load();
  const report = await collectReport({ now, fetchImpl: async (url) => {
    if (String(url).includes('npmjs')) return ok({ downloads: days.map(d => ({ ...d, downloads: 0 })) });
    if (String(url).includes('/releases?')) return ok([]);
    return ok({ stargazers_count: 0, forks_count: 0, open_issues_count: 0 });
  } });
  assert.equal(report.npm.totalDownloads, 0);
  assert.deepEqual(report.github.releases, { status: 'ok', totalAssetDownloads: 0, assets: [] });
});

test('workflow is cron/manual only, grants only contents write and stages report allowlist', async () => {
  const workflow = await readFile(new URL('../.github/workflows/download-report.yml', import.meta.url), 'utf8');
  assert.match(workflow, /cron: '23 7 \* \* \*'/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s+(push|pull_request|workflow_run):/m);
  assert.match(workflow, /permissions:\n  contents: write\n\n/);
  assert.match(workflow, /node --test tests\/download-report\.test\.mjs/);
  assert.match(workflow, /node scripts\/download-report\.mjs/);
  assert.match(workflow, /git add -- docs\/reports\/downloads\.json docs\/reports\/downloads\.md ':\(glob\)docs\/reports\/history\/\*\.json'/);
  assert.doesNotMatch(workflow, /git add (\.|-A|--all)/);
});

test('requests time out even when fetch ignores the abort signal', async () => {
  const { collectReport } = await load();
  const report = await collectReport({ now, timeoutMs: 10, fetchImpl: async () => new Promise(() => {}) });
  assert.deepEqual(report.npm, { status: 'unknown', error: 'timeout' });
  assert.deepEqual(report.github.repository, { status: 'unknown', error: 'timeout' });
});

test('UTC snapshot is immutable and same-day reruns do not fetch or double-count releases', async () => {
  const { runReport } = await load();
  const outputDir = await mkdtemp(join(tmpdir(), 'rss-download-report-'));
  try {
    await runReport({ now, outputDir, fetchImpl: mockSuccess() });
    const snapshot = await readFile(join(outputDir, 'history/2026-01-31.json'), 'utf8');
    const rerun = await runReport({ now: new Date('2026-01-31T23:59:00Z'), outputDir, fetchImpl: async () => { throw new Error('must not fetch'); } });
    assert.equal(rerun.reusedSnapshot, true);
    assert.equal(await readFile(join(outputDir, 'history/2026-01-31.json'), 'utf8'), snapshot);
    assert.equal(await readFile(join(outputDir, 'downloads.json'), 'utf8'), snapshot);
    await runReport({ now: new Date('2026-02-01T00:00:00Z'), outputDir, fetchImpl: mockSuccess() });
    assert.equal((await readdir(join(outputDir, 'history'))).length, 2);
    const latest = JSON.parse(await readFile(join(outputDir, 'downloads.json'), 'utf8'));
    assert.equal(latest.github.releases.totalAssetDownloads, 12);
  } finally { await rm(outputDir, { recursive: true, force: true }); }
});
