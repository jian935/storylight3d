// Lux3D 客户端（按 Aholo 官方文档实现，国内环境）
// 文档：https://lux3d.aholo3d.cn/lux3d/doc
// 鉴权：裸 Authorization: <key>（不要 Bearer 前缀）
// 国内 Host：https://api.aholo3d.cn （无路径前缀）
// 文生 3D：POST /lux3d/v1/generate/text-to-3d/task/create  -> 返回 d=taskid
// 查询任务：GET  /lux3d/v1/generate/task/get?taskid=<id>  -> d.status(3=成功) / d.outputs[].content
// 状态：0 初始化 / 1 运行中 / 3 成功 / 4 失败 / 6 已取消

export const LUX_BASE = 'https://api.aholo3d.cn';

export function isConfigured(cfg) {
  return !!(cfg && cfg.key);
}

// ---------- 真实 API ----------
export async function createTextTask(prompt, { key, base = LUX_BASE, version = 'G1-Turbo' } = {}) {
  const res = await fetch(`${base}/lux3d/v1/generate/text-to-3d/task/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: key },
    body: JSON.stringify({ prompt, version, outputFormat: ['glb'] }),
  });
  const j = await res.json().catch(() => ({}));
  if (j.c !== '0' && j.c !== 0) throw new Error('Lux3D 创建任务失败: ' + JSON.stringify(j).slice(0, 200));
  return j.d; // taskid（数字）
}

export async function getTask(taskid, { key, base = LUX_BASE } = {}) {
  const res = await fetch(`${base}/lux3d/v1/generate/task/get?taskid=${encodeURIComponent(taskid)}`, {
    headers: { Authorization: key },
  });
  return res.json().catch(() => ({}));
}

// 在任意深度的响应对象里找第一个 .glb 链接（兼容 content 为字符串 / 对象 / 数组等多种形态）
export function findGlbUrl(obj, depth = 0) {
  if (!obj || depth > 7) return null;
  if (typeof obj === 'string') return /\.glb(\?|$)/i.test(obj) ? obj : null;
  if (Array.isArray(obj)) {
    for (const it of obj) { const r = findGlbUrl(it, depth + 1); if (r) return r; }
  } else if (typeof obj === 'object') {
    for (const k of ['glb', 'glb_url', 'url', 'model', 'content', 'src', 'file']) {
      if (obj[k] != null) { const r = findGlbUrl(obj[k], depth + 1); if (r) return r; }
    }
    for (const v of Object.values(obj)) { const r = findGlbUrl(v, depth + 1); if (r) return r; }
  }
  return null;
}

export async function pollTask(taskid, { key, base = LUX_BASE, onTick, timeoutMs = 600000 } = {}) {
  const start = Date.now();
  let i = 0;
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 5000));
    const j = await getTask(taskid, { key, base });
    const d = j.d || j;
    const status = d.status ?? d.state ?? j.status;
    if (onTick) onTick(status, i);
    if (status === 3) return findGlbUrl(d) || findGlbUrl(j);
    if (status === 4 || status === 6) throw new Error('Lux3D 任务失败: ' + JSON.stringify(j).slice(0, 200));
    if (i % 3 === 0) console.log(`  [poll ${i}] status=${status}`);
    i++;
  }
  throw new Error('Lux3D 生成超时（' + (timeoutMs / 1000) + 's）');
}

// 浏览器可选「实时模式」：直接调 Aholo（需 Aholo 允许跨域且用户在配置里填了 key）
export async function generateTextToGlbUrl(prompt, { key, base = LUX_BASE, onTick } = {}) {
  const taskid = await createTextTask(prompt, { key, base });
  return pollTask(taskid, { key, base, onTick });
}

// ---------- 预生成 manifest（主路径，避免浏览器直连 / 密钥暴露） ----------
// manifest 由 scripts/generate_assets.mjs 在用户本机生成，网页只加载本地 GLB。
export async function loadManifest(url = 'assets/generated/manifest.json') {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export function getModelForEntity(manifest, name) {
  if (!manifest || !manifest.assets) return null;
  const a = manifest.assets[name];
  return a && a.glb ? a.glb : null;
}
