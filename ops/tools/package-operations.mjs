import { createCipheriv, randomBytes } from 'node:crypto';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const assets = resolve(root, 'ops/assets');
const keyPath = process.argv[2] && resolve(process.argv[2]);
if (!keyPath || keyPath === root || keyPath.startsWith(root + sep)) throw new Error('请指定网站目录以外的本机口令文件。');

const snapshot = JSON.parse(await readFile(resolve(assets, 'beijing-occupancy-health.json')));
const directory = JSON.parse(await readFile(resolve(assets, 'local-home-directory.json')));
snapshot.improvementPlan = JSON.parse(await readFile(resolve(assets, 'local-health-improvement.json')));
if (!snapshot.date || directory.date !== snapshot.date) throw new Error('快照日期与房源明细不一致');
for (const [cohort, scope] of [['vacant', 'rental'], ['occupied', 'occupied']]) {
  if (!snapshot[cohort].rows.length || snapshot[cohort].rows.some(row => !directory[scope][row.operationsKey])) {
    throw new Error('健康快照与房源目录未能完整关联');
  }
}

// Only public listing references and community geography belong in the unauthenticated map.
const geographicFields = ['name','district','business','communityId','coordinate','parentName','precision','referenceUrl','evidence'];
const publicMapRows = snapshot.vacant.rows.filter(row => row.mapId).map(row => {
  if (!row.communityRef) return {mapId:row.mapId};
  return {mapId:row.mapId, communityRef:Object.fromEntries(geographicFields
    .filter(key => Object.hasOwn(row.communityRef,key)).map(key => [key,row.communityRef[key]]))};
});
const safetyHomes = new Set([ ...snapshot.vacant.rows, ...snapshot.occupied.rows ].filter(row =>
  row.safety?.trim() || row.events > 0 || snapshot.levels[row.level]?.includes('安全隐患')).map(row => row.homeKey));
const aggregate = (group,rows) => ({unique:group.unique,counts:group.counts,rows});
const summary = {publicOverview:true,date:snapshot.date,levels:snapshot.levels,healthTargets:snapshot.healthTargets,
  safetyTotal:safetyHomes.size,overlapHomes:snapshot.overlapHomes,
  vacant:aggregate(snapshot.vacant,publicMapRows),occupied:aggregate(snapshot.occupied,[])};

let secret;
try { secret = (await readFile(keyPath,'utf8')).trim(); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  secret = randomBytes(32).toString('base64url');
  await writeFile(keyPath, secret+'\n', {flag:'wx',mode:0o600});
}
if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new Error('口令文件格式不正确');
await chmod(keyPath,0o600);
const iv = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm',Buffer.from(secret,'base64url'),iv);
const compressed = gzipSync(JSON.stringify({snapshot,directory}));
const envelope = Buffer.concat([iv,cipher.update(compressed),cipher.final(),cipher.getAuthTag()]);
await writeFile(resolve(assets,'operations-private.bin'),envelope);
await writeFile(resolve(assets,'operations-summary.json'),JSON.stringify(summary)+'\n');
// The public first paint contains aggregates only. The local preview replaces the same slot.
const cards = [['可立即入住（待租中）',summary.vacant],['已入住',summary.occupied]].map(([label,g]) =>
  '<section class="health-block"><header><h2>'+label+'</h2></header><p class="health-total">'+g.unique.toLocaleString('zh-CN')+'<small> 套房源</small></p></section>');
const indexPath = resolve(root,'index.html');
const index = await readFile(indexPath,'utf8');
const slot = /<!--snapshot:occupancy-overview-->[\s\S]*?<!--\/snapshot-->/;
if (!slot.test(index)) throw new Error('找不到公开总览位置');
await writeFile(indexPath,index.replace(slot,'<!--snapshot:occupancy-overview--><div class="health-overview">'+cards.join('')+'</div><!--/snapshot-->'));
console.log('发布包已生成',snapshot.date,'待租',summary.vacant.unique,'已入住',summary.occupied.unique,'安全监控',summary.safetyTotal);
