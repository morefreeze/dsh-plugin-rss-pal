import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import semver from 'semver';
const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
test('DSH compatibility admits current release candidates and excludes next major minor boundary',()=>{
 for(const version of ['0.2.1-rc.5','0.2.2-rc.1','0.2.2-rc.2','0.2.2-rc.3','0.2.2'])assert.ok(semver.satisfies(version,pkg.engines.dsh,{includePrerelease:true}),version);
 for(const version of ['0.2.1-rc.4','0.3.0-rc.1','0.3.0','0.4.0'])assert.equal(semver.satisfies(version,pkg.engines.dsh,{includePrerelease:true}),false,version);
 for(const range of Object.values(pkg.peerDependencies) as string[])assert.equal(range,pkg.engines.dsh);
});
