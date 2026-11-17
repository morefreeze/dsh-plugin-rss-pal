# Native SQLite installation / 原生 SQLite 安装

RSS Pal currently uses `better-sqlite3`, a required native dependency. The plugin's prebuilt JavaScript does **not** include a cross-platform `.node` binding. A package appearing in the plugin manager is not proof that its native dependency built successfully.

## DSH marketplace build approval

When DSH reports `build-blocked` or `ERR_PNPM_IGNORED_BUILDS`, use its build-review prompt and approve **better-sqlite3 only**. Do not approve unrelated package scripts. Retry/complete the install through the same manager after approval, then reload RSS Pal or restart the host and refresh the page. On older managers with no review prompt, use the manual repair below. The plugin does not edit your profile's build policy automatically.

## Manual repair in the actual profile directory

Locate the **profile package/workspace directory used by this installation** in DSH's plugin-manager diagnostics. Do not run these commands in the plugin source checkout or guess a profile path. Use the same Node and pnpm binaries as the host.

```sh
# Replace /absolute/path/to/profile with the actual profile directory.
pnpm --dir /absolute/path/to/profile approve-builds better-sqlite3
pnpm --dir /absolute/path/to/profile rebuild better-sqlite3
```

The named-approval form is available in pnpm 11.2.2. If your pnpm only supports the interactive approval UI, run `pnpm --dir /absolute/path/to/profile approve-builds` and select only `better-sqlite3`. Inspect the resulting workspace policy rather than adding a blanket allow-all setting.

If a compatible prebuilt binary is unavailable, better-sqlite3 falls back to node-gyp compilation: Python and a C/C++ build toolchain are required (Xcode Command Line Tools on macOS, a compiler/make on Linux, Visual Studio C++ Build Tools on Windows). Follow the actual build error. Changing the host Node major version may require rebuilding the binding.

## Verify from the profile

Use a terminal in the profile directory and the host Node binary:

```sh
node --input-type=module -e "import { createRequire } from 'node:module'; const require=createRequire(import.meta.url); const pluginRequire=createRequire(require.resolve('rss-pal-dsh')); const Database=pluginRequire('better-sqlite3'); const db=new Database(':memory:'); db.exec('CREATE VIRTUAL TABLE check_fts USING fts5(text)'); db.prepare('INSERT INTO check_fts VALUES (?)').run('RSS Pal'); console.log(db.prepare(\"SELECT text FROM check_fts WHERE check_fts MATCH 'RSS'\").all()); db.close();"
```

Expected output contains `RSS Pal`. This is a disposable in-memory database and does not read or change your library. An error here means native installation is not complete; preserve the build log and report your OS, Node, pnpm and DSH versions, without private profile data.

## 开发与验收

当前方案保留 `better-sqlite3`，通过商店构建审批或上述手动步骤完成原生安装；没有承诺所有平台提供预编译 binding，也没有迁移已有用户数据库。公开 CI 会正常执行依赖构建并测试 SQLite/FTS5 行为，但它不代替 DSH profile 内的构建审批。源码开发直接运行 `npm ci --include=dev --registry=https://registry.npmjs.org`，不要使用 `--ignore-scripts` 后将结果当成完整安装。
