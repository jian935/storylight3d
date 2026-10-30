// 纯函数：解析 [[名称:类型:描述]] 标签。不依赖 DOM / three，供浏览器(app.js)与 Node 脚本(generate_assets.mjs)共用。
export function parseStory(text) {
  const out = [];
  const TAG_RE = /\[\[([^:\]]+)(?::([^:\]]+))?(?::([^\]]+))?\]\]/g;
  let m;
  while ((m = TAG_RE.exec(text)) !== null) {
    const name = m[1].trim();
    const type = (m[2] || 'prop').trim().toLowerCase();
    const prompt = (m[3] || name).trim();
    if (name) out.push({ name, type, prompt });
  }
  return out;
}

// 把实体名转成可用于文件名的 ascii slug（保留顺序序号，避免中文文件名 / 拼音依赖）
export function slugify(base, i) {
  return `asset_${String(i + 1).padStart(4, '0')}`;
}
