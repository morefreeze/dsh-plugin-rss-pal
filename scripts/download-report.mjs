#!/usr/bin/env node
// Maintainer/CI-only public aggregate reporting. Never imported by the plugin runtime.
// No user telemetry, identifiers, credentials, or raw error messages are persisted.
import { readFile, mkdir, writeFile, rename, link, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const DAY_MS = 86_400_000;
const PACKAGE = 'rss-pal-dsh';
const REPOSITORY = 'morefreeze/dsh-plugin-rss-pal';
const DEFAULT_OUTPUT = fileURLToPath(new URL('../docs/reports/', import.meta.url));
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const utcDay = (date) => date.toISOString().slice(0, 10);
const unknown = (error) => ({ status: 'unknown', error });
const failure = (code) => Object.assign(new Error(code), { reportCode: code });

export function reportingWindow(now = new Date()) {
  const midnight = Date.parse(`${utcDay(now)}T00:00:00Z`);
  return { start: utcDay(new Date(midnight - 30 * DAY_MS)), end: utcDay(new Date(midnight - DAY_MS)), days: 30 };
}

async function requestJson(url, { fetchImpl, token, timeoutMs }) {
  const controller = new AbortController();
  const headers = { Accept: 'application/json', 'User-Agent': 'rss-pal-download-report' };
  if (url.startsWith('https://api.github.com/')) {
    headers.Accept = 'application/vnd.github+json';
    headers['X-GitHub-Api-Version'] = '2022-11-28';
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(url, { headers, signal: controller.signal, redirect: 'error' });
        if (!response.ok) throw failure(`http_${response.status}`);
        return await response.json();
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => { reject(failure('timeout')); controller.abort(); }, timeoutMs);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

async function guarded(collect) {
  try { return await collect(); }
  catch (error) {
    // Never serialize fetch exceptions: they may contain tokens or proxy credentials.
    const code = error?.reportCode;
    return unknown(typeof code === 'string' && /^(timeout|invalid_response|pagination_limit|http_\d{3})$/.test(code) ? code : 'request_failed');
  }
}

export async function collectReport({ now = new Date(), fetchImpl = globalThis.fetch, token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN, timeoutMs = 15_000 } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw failure('invalid_timeout');
  const window = reportingWindow(now);
  const request = (url) => requestJson(url, { fetchImpl, token, timeoutMs });
  const [npm, repository, releases] = await Promise.all([
    guarded(async () => {
      const data = await request(`https://api.npmjs.org/downloads/range/${window.start}:${window.end}/${encodeURIComponent(PACKAGE)}`);
      if (!Array.isArray(data?.downloads) || data.downloads.length !== 30) throw failure('invalid_response');
      const daily = data.downloads.map(({ day, downloads }) => ({ day, downloads })).sort((a, b) => String(a.day).localeCompare(String(b.day)));
      for (let i = 0; i < 30; i++) {
        const expectedDay = utcDay(new Date(Date.parse(`${window.start}T00:00:00Z`) + i * DAY_MS));
        if (daily[i].day !== expectedDay || !count(daily[i].downloads)) throw failure('invalid_response');
      }
      const totalDownloads = daily.reduce((sum, day) => sum + day.downloads, 0);
      if (!count(totalDownloads)) throw failure('invalid_response');
      return { status: 'ok', totalDownloads, daily };
    }),
    guarded(async () => {
      const data = await request(`https://api.github.com/repos/${REPOSITORY}`);
      if (![data?.stargazers_count, data?.forks_count, data?.open_issues_count].every(count)) throw failure('invalid_response');
      return { status: 'ok', stars: data.stargazers_count, forks: data.forks_count, openIssuesIncludingPullRequests: data.open_issues_count };
    }),
    guarded(async () => {
      const assets = [];
      const ids = new Set();
      // GitHub returns cumulative asset counters, NOT daily download increments.
      for (let page = 1; page <= 100; page++) {
        const data = await request(`https://api.github.com/repos/${REPOSITORY}/releases?per_page=100&page=${page}`);
        if (!Array.isArray(data)) throw failure('invalid_response');
        for (const release of data) {
          if (typeof release?.tag_name !== 'string' || !Array.isArray(release.assets)) throw failure('invalid_response');
          for (const asset of release.assets) {
            if (!count(asset?.id) || typeof asset.name !== 'string' || !count(asset.download_count) || ids.has(asset.id)) throw failure('invalid_response');
            ids.add(asset.id);
            assets.push({ id: asset.id, release: release.tag_name, name: asset.name, downloadCount: asset.download_count });
          }
        }
        if (data.length < 100) {
          const totalAssetDownloads = assets.reduce((sum, asset) => sum + asset.downloadCount, 0);
          if (!count(totalAssetDownloads)) throw failure('invalid_response');
          return { status: 'ok', totalAssetDownloads, assets };
        }
      }
      throw failure('pagination_limit');
    }),
  ]);
  return {
    schemaVersion: 1,
    snapshotDay: utcDay(now),
    collectedAt: now.toISOString(),
    package: PACKAGE,
    repository: REPOSITORY,
    window,
    interpretation: {
      downloadsAreNotUsers: true,
      channelsMustNotBeAdded: true,
      releaseCountsAreCumulative: true,
      historySnapshotsMustNotBeSummed: true,
      telemetry: 'none; public aggregate APIs queried only by maintainer script or CI',
    },
    npm,
    github: { repository, releases },
  };
}

const escapeCell = (value) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ').replaceAll('\r', ' ').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const errorText = (metric) => `unknown (error: ${metric.error})`;

export function renderMarkdown(report) {
  const lines = [
    '# RSS Pal 下载趋势报告', '',
    `UTC 快照日：${report.snapshotDay} · 采集时间：${report.collectedAt}`, '',
    '**下载不是用户**：重复安装、CI、镜像、更新和同一人多次下载均可能计入；这里没有活跃用户或独立用户统计。',
    '**npm 与 GitHub 下载不得相加**：口径与时间范围不同，渠道也可能重叠。',
    'GitHub release asset 是采集时的**累计**下载量；每日历史快照只是当时读数，勿相加或重复累加。',
    '仅维护者脚本/CI读取公开聚合 API；插件运行时不执行该脚本，用户机无遥测。失败项为 unknown/error，缺失数据不会伪造为 0。', '',
    '## npm：最近 30 个完整 UTC 日', '',
    `包：\`${report.package}\` · 窗口：${report.window.start} — ${report.window.end}（排除进行中的当日）`,
    `来源：https://api.npmjs.org/downloads/range/${report.window.start}:${report.window.end}/${report.package}`, '',
  ];
  if (report.npm.status === 'ok') {
    lines.push(`窗口内下载次数：**${report.npm.totalDownloads}**`, '', '| UTC 日期 | 下载次数 |', '| --- | ---: |');
    for (const day of report.npm.daily) lines.push(`| ${day.day} | ${day.downloads} |`);
  } else lines.push(errorText(report.npm));
  lines.push('', '## GitHub：仓库当前读数', '', `来源：https://api.github.com/repos/${report.repository}`, '');
  const repo = report.github.repository;
  if (repo.status === 'ok') lines.push('| Stars | Forks | Open issues（含 PR） |', '| ---: | ---: | ---: |', `| ${repo.stars} | ${repo.forks} | ${repo.openIssuesIncludingPullRequests} |`, '', 'GitHub REST open_issues_count 包含未关闭的 pull requests，不是纯 issue 数。');
  else lines.push(errorText(repo));
  lines.push('', '## GitHub：Release asset 累计下载', '', `来源：https://api.github.com/repos/${report.repository}/releases（分页读取）`, '');
  const releases = report.github.releases;
  if (releases.status === 'ok') {
    lines.push(`当前所有 release asset 累计下载次数：**${releases.totalAssetDownloads}**（不是最近30天下载量）`, '', '| Release | Asset | 累计下载次数 |', '| --- | --- | ---: |');
    for (const asset of releases.assets) lines.push(`| ${escapeCell(asset.release)} | ${escapeCell(asset.name)} | ${asset.downloadCount} |`);
    if (!releases.assets.length) lines.push('', 'API 成功返回且无 release asset；此时累计 0 是真实空结果。');
  } else lines.push(errorText(releases));
  lines.push('', '## UTC 历史快照', '',
    `当日不可变快照：\`history/${report.snapshotDay}.json\`。同一 UTC 日重跑复用该快照，不再次采集，不重复新增，不累加 release 累计计数。`,
    '若首次采集失败，当日 unknown 会保留；次日采集新快照。历史窗口互相重叠，npm 窗口总数也不得跨快照求和。', '');
  return lines.join('\n');
}

async function atomicWrite(path, content) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, content); await rename(temporary, path); }
  finally { await unlink(temporary).catch(() => {}); }
}

export async function runReport(options = {}) {
  const now = options.now ?? new Date();
  const outputDir = options.outputDir ?? DEFAULT_OUTPUT;
  const snapshotPath = join(outputDir, 'history', `${utcDay(now)}.json`);
  await mkdir(dirname(snapshotPath), { recursive: true });
  let report;
  let reusedSnapshot = false;
  try { report = JSON.parse(await readFile(snapshotPath, 'utf8')); reusedSnapshot = true; }
  catch (error) {
    if (error.code !== 'ENOENT') throw failure('snapshot_read_failed');
    report = await collectReport({ ...options, now });
    // Publish complete snapshot using an exclusive hard link; concurrent runs cannot overwrite it.
    const temporary = `${snapshotPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`);
      try { await link(temporary, snapshotPath); }
      catch (publishError) {
        if (publishError.code !== 'EEXIST') throw publishError;
        report = JSON.parse(await readFile(snapshotPath, 'utf8'));
        reusedSnapshot = true;
      }
    } finally { await unlink(temporary).catch(() => {}); }
  }
  if (report.snapshotDay !== utcDay(now) || report.schemaVersion !== 1) throw failure('snapshot_invalid');
  await atomicWrite(join(outputDir, 'downloads.json'), `${JSON.stringify(report, null, 2)}\n`);
  await atomicWrite(join(outputDir, 'downloads.md'), renderMarkdown(report));
  return { report, reusedSnapshot, outputDir, snapshotPath };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runReport().then(({ report, reusedSnapshot }) => {
    console.log(`Download report ${report.snapshotDay}: npm=${report.npm.status}, repository=${report.github.repository.status}, releases=${report.github.releases.status}, snapshot=${reusedSnapshot ? 'reused' : 'created'}`);
  }).catch(() => {
    console.error('Download report error: report_generation_failed');
    process.exitCode = 1;
  });
}
