#!/usr/bin/env node
/**
 * dump-theme-tokens.mjs —— 把 DSH 的**真实主题令牌**抠出来，并用它核对插件的令牌用法。
 *
 *   node scripts/dump-theme-tokens.mjs                    # 人读：常用令牌的浅/深取值
 *   node scripts/dump-theme-tokens.mjs --all               # 人读：全部令牌
 *   node scripts/dump-theme-tokens.mjs --json              # 机器读（{light,dark}）
 *   node scripts/dump-theme-tokens.mjs --out tokens.json   # 落盘
 *   node scripts/dump-theme-tokens.mjs --scan <目录>       # 扫代码里的 var(--dsw-*)，标出**不存在的名字**
 *
 * 为什么要有它：**令牌名写错不会报错，只会静默走 fallback。**
 * 实测踩过三个（都写在一个真实插件的面板里，肉眼完全看不出来）：
 *   `--dsw-alias-bg-sunken`            不存在（真名 `--dsw-alias-bg-layer-1`）
 *   `--dsw-alias-brand-bg`             不存在（可选 `--dsw-alias-bg-module-platform`）
 *   `--dsw-alias-state-warning-primary` 少个 `ing`，真名 `--dsw-alias-state-warn-primary`
 * 还踩过一个更隐蔽的：`--dsw-alias-brand-primary` **不是"品牌色"** ——
 * 它浅色下是近黑 `#0f1115`、深色下是近白 `#f9fafb`（是个**对比色**）。
 * 拿它当紫底、再配写死的白字 → 深色下**白底白字**，实测对比度 1.05:1，主按钮整块看不见。
 *
 * 唯一真源：`@deepseek-ai/dsh-client-ui-theme/lib/client.js` 里的 `design_platform_css_default`
 * —— 它同时含 `body{…}`（浅色）与 `body[data-ds-dark-theme]{…}`（深色）两套。
 *
 * 退出码：--scan 时若有"不存在的令牌" → 1（可直接当门禁用）；其余 0。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/* ───────────────────────── 定位主题包 ───────────────────────── */

/** 候选路径：先全局 dsh 安装内的 node_modules，再逐级 find。 */
export function findThemeFile() {
  const cands = [];
  try {
    const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const dsh = path.join(root, '@deepseek-ai/dsh/node_modules/@deepseek-ai');
    cands.push(path.join(dsh, 'dsh-client-ui-theme/lib/client.js'));
    if (fs.existsSync(dsh)) {
      for (const d of fs.readdirSync(dsh)) {
        if (/theme/i.test(d)) cands.push(path.join(dsh, d, 'lib/client.js'));
      }
    }
  } catch { /* npm 不可用就继续找 */ }
  for (const c of cands) {
    if (fs.existsSync(c) && fs.readFileSync(c, 'utf8').includes('design_platform_css_default')) return c;
  }
  // 兜底：在几个常见根下浅找
  const roots = [process.env.DSH_HOME, path.join(process.env.HOME ?? '', '.dsh')].filter(Boolean);
  for (const r of roots) {
    const hit = shallowFind(r, 'client.js', 6);
    if (hit) return hit;
  }
  return null;
}

function shallowFind(dir, name, depth) {
  if (depth < 0 || !fs.existsSync(dir)) return null;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) {
    if (!e.isDirectory() && e.name === name) {
      const p = path.join(dir, e.name);
      try { if (fs.readFileSync(p, 'utf8').includes('design_platform_css_default')) return p; } catch { /* 忽略 */ }
    }
  }
  for (const e of entries) {
    if (e.isDirectory() && e.name !== 'node_modules') {
      const hit = shallowFind(path.join(dir, e.name), name, depth - 1);
      if (hit) return hit;
    }
  }
  return null;
}

/* ───────────────────────── 抠令牌 ───────────────────────── */

/** 把 JS 源码里的双引号字符串字面量解出来（不用 eval）。 */
function unescapeJsString(raw) {
  try { return JSON.parse('"' + raw + '"'); } catch { /* 落到手写处理 */ }
  return raw
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\n/g, '\n').replace(/\\t/g, '\t')
    .replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

/** 返回 { light, dark, source } —— 两个 map：令牌名 → 值。 */
export function loadTokens(themeFile = findThemeFile()) {
  if (!themeFile) throw new Error('找不到主题包（dsh-client-ui-theme）。确认本机装了 @deepseek-ai/dsh。');
  const src = fs.readFileSync(themeFile, 'utf8');
  const m = src.match(/var design_platform_css_default\s*=\s*"([\s\S]*?)";\s*\n/);
  if (!m) throw new Error('主题包里没有 design_platform_css_default —— 官方内部结构可能变了，请重新取证。');
  const css = unescapeJsString(m[1]);
  const pick = (selector) => {
    const out = {};
    // 同一选择器可能出现多次（静态色板一段、alias 一段），全部合并
    const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([\\s\\S]*?)\\}', 'g');
    for (const block of css.matchAll(re)) {
      for (const kv of block[1].matchAll(/(--dsw-[a-z0-9-]+)\s*:\s*([^;}]+)/g)) out[kv[1]] = kv[2].trim();
    }
    return out;
  };
  return { light: pick('body'), dark: pick('body[data-ds-dark-theme]'), source: themeFile };
}

/** 把 `var(--x, var(--y, #fff))` 一路解析到具体值（能解就解，解不出就返回链尾 fallback）。 */
export function resolveToken(tokens, name) {
  for (const theme of ['light', 'dark']) {
    let cur = tokens[theme][name];
    if (cur === undefined) continue;
    for (let i = 0; i < 10; i += 1) {
      const m = String(cur).match(/^var\(\s*(--dsw-[a-z0-9-]+)/);
      if (!m) break;
      const next = tokens[theme][m[1]];
      if (next === undefined) break;
      cur = next;
    }
    tokens[theme][name] = cur;
  }
  return { light: tokens.light[name], dark: tokens.dark[name] };
}

/* ───────────────────────── 扫描用法 ───────────────────────── */

const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.vue', '.css', '.scss']);

function walk(dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (CODE_EXT.has(path.extname(e.name))) out.push(p);
  }
  return out;
}

/** 扫描目录 → [{ file, tokens:Set }]，并标出两个库里都不存在的令牌。 */
export function scanDir(dir, tokens) {
  const known = new Set([...Object.keys(tokens.light), ...Object.keys(tokens.dark)]);
  const perFile = [];
  for (const f of walk(dir)) {
    let text = '';
    try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const used = new Set([...text.matchAll(/var\(\s*(--dsw-[a-z0-9-]+)/g)].map((m) => m[1]));
    if (used.size === 0) continue;
    perFile.push({
      file: path.relative(dir, f),
      used: [...used].sort(),
      missing: [...used].filter((t) => !known.has(t)).sort(),
    });
  }
  return perFile;
}

/* ───────────────────────── CLI ───────────────────────── */

const COMMON = [
  '--dsw-alias-label-primary', '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary',
  '--dsw-alias-label-caption', '--dsw-alias-label-primary-foreground', '--dsw-alias-label-primary-inverted',
  '--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-layer-3',
  '--dsw-alias-bg-overlay', '--dsw-alias-bg-module-platform', '--dsw-alias-bg-sunken',
  '--dsw-alias-border-l1', '--dsw-alias-border-l2', '--dsw-alias-border-l3', '--dsw-alias-border-l4',
  '--dsw-alias-interactive-bg-hover', '--dsw-alias-interactive-bg-hover-accent',
  '--dsw-alias-brand-primary', '--dsw-alias-brand-primary-invert', '--dsw-alias-brand-text',
  '--dsw-alias-brand-bg', '--dsw-alias-button-primary-fill',
  '--dsw-alias-state-success-primary', '--dsw-alias-state-warn-primary',
  '--dsw-alias-state-warning-primary', '--dsw-alias-state-error-primary', '--dsw-alias-state-business-primary',
  '--dsw-alias-scrollbar-bg-l1', '--dsw-alias-scrollbar-hover-l1',
  '--dsw-specific-menu', '--dsw-specific-sidebar-fill',
];

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  let tokens;
  try {
    tokens = loadTokens();
  } catch (e) {
    console.error('❌ ' + (e.message ?? e));
    process.exit(2);
  }
  for (const t of Object.keys(tokens.light)) resolveToken(tokens, t);

  if (has('--scan')) {
    const dir = val('--scan') ?? '.';
    const rows = scanDir(dir, tokens);
    let bad = 0;
    console.log(`主题包：${tokens.source}`);
    console.log(`真实令牌：浅色 ${Object.keys(tokens.light).length} 个 / 深色 ${Object.keys(tokens.dark).length} 个\n`);
    for (const r of rows) {
      const mark = r.missing.length ? '❌' : '✅';
      console.log(`${mark} ${r.file}  （用到 ${r.used.length} 个令牌）`);
      if (r.missing.length) {
        bad += r.missing.length;
        for (const t of r.missing) console.log(`      **不存在**：${t}  → 永远走 fallback`);
      }
    }
    console.log(bad
      ? `\n❌ 共 ${bad} 个不存在的令牌 —— 它们不会报错，只会静默用 fallback。`
      : '\n✅ 用到的令牌全部存在。');
    process.exit(bad ? 1 : 0);
  }

  if (has('--json') || has('--out')) {
    const json = JSON.stringify({ source: tokens.source, light: tokens.light, dark: tokens.dark }, null, 1);
    const out = val('--out');
    if (out) { fs.writeFileSync(out, json); console.log(`✅ 已落盘 ${out}（${json.length} 字节）`); }
    else process.stdout.write(json + '\n');
    process.exit(0);
  }

  const list = has('--all') ? [...new Set([...Object.keys(tokens.light), ...Object.keys(tokens.dark)])].sort() : COMMON;
  console.log(`主题包：${tokens.source}`);
  console.log(`真实令牌：浅色 ${Object.keys(tokens.light).length} 个 / 深色 ${Object.keys(tokens.dark).length} 个（下面的值已沿 var() 链解析到具体色）\n`);
  console.log('令牌'.padEnd(48) + '浅色'.padEnd(26) + '深色');
  console.log('-'.repeat(96));
  for (const t of list) {
    if (tokens.light[t] === undefined && tokens.dark[t] === undefined) {
      console.log(t.padEnd(48) + '—（不存在）');
      continue;
    }
    console.log(t.padEnd(48) + String(tokens.light[t] ?? '—').padEnd(26) + String(tokens.dark[t] ?? '—'));
  }
  if (!has('--all')) console.log('\n（--all 看全部；--scan <目录> 核对某个插件用到的令牌）');
}
