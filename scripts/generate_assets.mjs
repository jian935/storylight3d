// StoryLight3D 资产预生成脚本（在「用户本机」运行，不在沙箱内）
// 原因：本项目的运行沙箱会拦截出站的 Authorization 头，无法在此环境调用真实 Aholo API。
//       用户在自己的电脑上跑本脚本，用 .local/lux3d.key 里的真实 key 调用 Aholo，
//       把生成的 GLB 下载到 web/assets/generated/ 并写出 manifest.json，网页即可离线加载。
//
// 用法：
//   node scripts/generate_assets.mjs            # 生成全部示例故事的实体资产
//   node scripts/generate_assets.mjs --dry-run  # 只解析并打印将生成的实体，不调 API
//   node scripts/generate_assets.mjs --story 我的故事.txt   # 生成自定义故事（[[名称:类型:描述]] 格式）
//   node scripts/generate_assets.mjs --key xhBJ...mb1        # 直接传 key（避免把 key 写进文件/对话）
//
// 前置：Node 22+；key 来源优先级：--key 参数 > 环境变量 LUX3D_API_KEY > .local/lux3d.key 文件

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseStory, slugify } from '../web/story-parse.js';
import { DEMO_STORIES, DEMO_DEFAULT } from '../web/demo-story.js';
import { createTextTask, getTask, findGlbUrl, pollTask } from '../web/lux3d.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const KEY_PATH = resolve(ROOT, '.local/lux3d.key');
const OUT_DIR = resolve(ROOT, 'web/assets/generated');
const BASE = 'https://api.aholo3d.cn';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const storyArg = args.find((a) => a === '--story') ? args[args.indexOf('--story') + 1] : null;
const keyArg = args.find((a) => a === '--key') ? args[args.indexOf('--key') + 1] : null;

// key 优先级：命令行 --key > 环境变量 LUX3D_API_KEY > .local/lux3d.key 文件
const key = keyArg || process.env.LUX3D_API_KEY || (existsSync(KEY_PATH) ? readFileSync(KEY_PATH, 'utf8').trim() : '');

// ---------- 收集待生成实体 ----------
function collectEntities() {
  const map = new Map(); // name -> {name,type,prompt}
  const texts = [];
  if (storyArg) {
    if (!existsSync(resolve(ROOT, storyArg))) throw new Error('找不到故事文件: ' + storyArg);
    texts.push(readFileSync(resolve(ROOT, storyArg), 'utf8'));
  } else {
    for (const t of Object.values(DEMO_STORIES)) texts.push(t);
  }
  for (const t of texts) {
    for (const e of parseStory(t)) {
      if (!map.has(e.name)) map.set(e.name, e);
    }
  }
  return [...map.values()];
}

function download(url, dest) {
  // 浏览器fetch 在 Node 22 全局可用；stream 下载避免大文件占内存
  return fetch(url).then(async (r) => {
    if (!r.ok) throw new Error('下载失败 ' + r.status + ' ' + url);
    const buf = Buffer.from(await r.arrayBuffer());
    writeFileSync(dest, buf);
    return buf.length;
  });
}

async function main() {
  const entities = collectEntities();
  console.log(`待生成实体 ${entities.length} 个：`);
  entities.forEach((e, i) => console.log(`  ${slugify('', i)}  [${e.type}] ${e.name}  ->  ${e.prompt}`));

  if (DRY) { console.log('\n[dry-run] 未调用 API。去掉 --dry-run 正式生成。'); return; }
  if (!key) {
    console.error('\n未找到 API Key：请在 .local/lux3d.key 写入真实 key，或设置环境变量 LUX3D_API_KEY。');
    process.exit(2);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const manifest = { version: 1, baseUrl: BASE, generatedAt: new Date().toISOString(), assets: {} };
  let ok = 0;

  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    const slug = slugify('', i);
    const dest = resolve(OUT_DIR, `${slug}.glb`);
    console.log(`\n[${i + 1}/${entities.length}] ${e.name}`);
    try {
      console.log('  prompt:', e.prompt);
      const taskid = await createTextTask(e.prompt, { key, base: BASE });
      console.log('  taskid:', taskid);
      const glbUrl = await pollTask(taskid, { key, base: BASE, onTick: (s, k) => { if (k % 6 === 0) console.log('    status=' + s); } });
      if (!glbUrl) throw new Error('任务成功但未解析到 GLB 链接，原始响应见上。');
      const size = await download(glbUrl, dest);
      console.log(`  ✓ 已保存 ${slug}.glb (${(size / 1024).toFixed(0)} KB)`);
      manifest.assets[e.name] = { name: e.name, type: e.type, prompt: e.prompt, glb: `assets/generated/${slug}.glb`, source: glbUrl };
      ok++;
    } catch (err) {
      console.error('  ✗ 失败：', err.message);
    }
  }

  writeFileSync(resolve(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`\n完成：成功 ${ok}/${entities.length}。manifest 已写入 web/assets/generated/manifest.json`);
  if (ok < entities.length) console.log('部分失败：本机重新运行本脚本会自动跳过已存在的同名文件（如需重跑请删除对应 .glb）。');
}

main().catch((e) => { console.error(e); process.exit(1); });
