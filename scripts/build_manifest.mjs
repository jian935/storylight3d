// 从 scripts/asset_tasks.json 的 generated 列表生成 web/assets/generated/manifest.json
// 网页 app.js 通过 getModelForEntity(manifest, 中文实体名) 按故事里的 [[名称]] 取 glb。
// 用法：node scripts/build_manifest.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const tasksPath = resolve(ROOT, 'scripts/asset_tasks.json');
const outPath = resolve(ROOT, 'web/assets/generated/manifest.json');

const tasks = JSON.parse(readFileSync(tasksPath, 'utf8'));
const assets = {};
const missing = [];
for (const g of tasks.generated) {
  const glb = `assets/generated/${g.file}`;
  if (!existsSync(resolve(ROOT, 'web', glb))) {
    missing.push(g.entity);
    continue;
  }
  assets[g.entity] = { glb, type: g.type, en: g.slug };
}
writeFileSync(outPath, JSON.stringify({ assets, generatedAt: new Date().toISOString() }, null, 2));
console.log(`manifest 写入 ${assets ? Object.keys(assets).length : 0} 个资产`);
if (missing.length) console.log('⚠️ 以下实体 GLB 文件缺失，未写入：', missing.join('、'));
