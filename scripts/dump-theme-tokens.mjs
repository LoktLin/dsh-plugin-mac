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
 * 唯一真源：`@deepseek-ai/dsh-client-ui-theme/lib/client.js` 里的 **全部 CSS 常量表**
 * （实测 8 张，`design_platform_css_default` 只是其中一张 —— 见 `loadTokens().tables`）。
 *
 * ⚠️ 2026-10-10 修掉一个**会误导插件作业**的 bug：第一版只解析 `design_platform_css_default` 的
 * `body{}` / `body[data-ds-dark-theme]{}` 两块 → 只认识 190 个令牌，**漏 213 个**：
 *   · `--dsw-elevation-*`（投影/高度）在 `gradient_shadow_text_css_default` 的 **`body,body *{}`** 块里
 *   · `--dsw-shadow-lv*` 在同一张表的另一个 `body{}` 块里
 *   · `--dsw-font-*` / `--dsw-radius-*` 在 `base_css_default` 的 `:root{}` 里
 *   · `--dsw-focus-ring-*` 在 `focus_css_default` 里
 * 后果：`--scan` 把**真实存在**的令牌报成「❌ 不存在 → 永远走 fallback」并 exit 1 ——
 * 谁把它当门禁，就会把**正确的令牌化写法**退回**写死色值**这个错误写法。
 * 现在：并集 = 403（独立 grep 真源的定义点去重也是 403），且**反向**保持严格 ——
 * 不存在的名字仍然必须报 ❌，**绝不改成"什么都认"**（那比漏报更糟）。
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

/** 源码里所有"长成 CSS 的字符串常量"（`var X = "…";`）—— **不是**只看 design_platform 那一张。 */
export function cssStringConstants(src) {
  const out = [];
  for (const m of src.matchAll(/var\s+([A-Za-z0-9_$]+)\s*=\s*"((?:[^"\\]|\\.)*)"/g)) {
    const css = unescapeJsString(m[2]);
    if (!/\{[\s\S]*\}/.test(css)) continue; // 不是 CSS（例如普通的类名字符串）
    out.push({ name: m[1], css });
  }
  return out;
}

/** 选择器是不是"根级/body 级"（值对该主题**全局**生效）。`body *` 这类后代选择器不算（只算条件定义）。 */
const GLOBAL_SELECTOR = /^(?:html\[[^\]]*\]\s+)?body(?:\[[^\]]*\])?$|^:root$/;

/** 把一张 CSS 表拆成 [{ selector, body }]，只保留**定义了 --dsw- 令牌**的块。 */
function tokenBlocks(css) {
  const out = [];
  for (const m of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    if (!/--dsw-[a-z0-9-]+\s*:/.test(m[2])) continue;
    out.push({ selector: m[1].trim(), body: m[2] });
  }
  return out;
}

/**
 * 返回 `{ light, dark, all, scoped, tables, cssConstants, source }`
 *   · `light` / `dark` —— 令牌名 → 值（**单值** `var()` 链由 resolveToken 解析）
 *   · `all`   —— **全部**已知令牌名（各表并集，`--scan` 的判据就是它）
 *   · `scoped`—— 只在条件选择器里定义、没有全局值的令牌（如 `:focus-visible` 下的 `--dsw-focus-ring-color`）
 */
export function loadTokens(themeFile = findThemeFile()) {
  if (!themeFile) throw new Error('找不到主题包（dsh-client-ui-theme）。确认本机装了 @deepseek-ai/dsh。');
  const src = fs.readFileSync(themeFile, 'utf8');
  const consts = cssStringConstants(src);
  if (!consts.length) throw new Error('主题包里没有任何 CSS 字符串常量 —— 官方内部结构可能变了，请重新取证。');

  const light = {};
  const dark = {};
  const scoped = [];
  const all = new Set();
  const tables = [];
  for (const t of consts) {
    let defs = 0;
    for (const b of tokenBlocks(t.css)) {
      const isDark = /data-ds-dark-theme/.test(b.selector);
      const isGlobal = b.selector.split(',').some((s) => GLOBAL_SELECTOR.test(s.trim()));
      for (const d of b.body.matchAll(/(--dsw-[a-z0-9-]+)\s*:\s*([^;}]*)/g)) {
        defs += 1;
        all.add(d[1]);
        if (isGlobal) (isDark ? dark : light)[d[1]] = d[2].trim();
        else scoped.push({ name: d[1], value: d[2].trim(), dark: isDark, table: t.name, selector: b.selector });
      }
    }
    if (defs) tables.push({ name: t.name, definitions: defs });
  }
  if (!tables.length) throw new Error('CSS 常量里没有任何 --dsw- 令牌定义 —— 官方内部结构可能变了，请重新取证。');

  return {
    light, dark, scoped, tables,
    all: [...all].sort(),
    cssConstants: consts.map((c) => c.name),
    source: themeFile,
  };
}

/** 把 `var(--x)` / `var(--x, #fff)` 这种**整值就是一次引用**的一路解析到具体值。 */
/* ⚠️ 只认"整值就是一次引用"：`var(--a), 0 3px 8px …` 这种**复合值必须原样保留** ——
 *    旧实现用 `^var\((--dsw-…)` 去匹配，会把 `--dsw-elevation-panel` 解析成只有第一段
 *    `0 0 0 .5px var(--dsw-elevation-stroke-color)`，**投影被吃掉一半**还看不出来。 */
const PURE_VAR_REF = /^var\(\s*(--dsw-[a-z0-9-]+)\s*(?:,\s*[^()]*)?\)$/;

export function resolveToken(tokens, name) {
  for (const theme of ['light', 'dark']) {
    let cur = tokens[theme][name];
    if (cur === undefined) continue;
    for (let i = 0; i < 10; i += 1) {
      const m = String(cur).match(PURE_VAR_REF);
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

/** 全部已知令牌（各表并集）—— `--scan` 的唯一判据。 */
export function knownTokens(tokens) {
  return new Set(tokens.all ?? [...Object.keys(tokens.light ?? {}), ...Object.keys(tokens.dark ?? {})]);
}

/** 扫描目录 → [{ file, tokens:Set }]，并标出**任何一张表里都没有**的令牌。 */
export function scanDir(dir, tokens) {
  const known = knownTokens(tokens);
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
  for (const t of Object.keys(tokens.dark)) resolveToken(tokens, t);

  /** 统一的一行小结：**并集**才是"已知令牌"，别只看浅色。 */
  const summary = () => {
    const scopedOnly = tokens.all.filter((t) => tokens.light[t] === undefined && tokens.dark[t] === undefined);
    return `真实令牌（全部常量表并集）：**${tokens.all.length} 个** ｜ 浅色全局 ${Object.keys(tokens.light).length}`
      + ` ｜ 深色覆写 ${Object.keys(tokens.dark).length}`
      + (scopedOnly.length ? ` ｜ 仅条件选择器内定义 ${scopedOnly.length}（${scopedOnly.join('、')}）` : '');
  };
  const tableLine = () => `CSS 常量表 ${tokens.cssConstants.length} 张，其中定义 --dsw- 令牌的 ${tokens.tables.length} 张：`
    + tokens.tables.map((t) => `${t.name}(${t.definitions})`).join('、');

  if (has('--scan')) {
    const dir = val('--scan') ?? '.';
    const rows = scanDir(dir, tokens);
    let bad = 0;
    console.log(`主题包：${tokens.source}`);
    console.log(tableLine());
    console.log(summary() + '\n');
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
    const json = JSON.stringify({
      source: tokens.source,
      cssConstants: tokens.cssConstants,
      tables: tokens.tables,
      light: tokens.light,
      dark: tokens.dark,
      all: tokens.all,
      scoped: tokens.scoped,
    }, null, 1);
    const out = val('--out');
    if (out) { fs.writeFileSync(out, json); console.log(`✅ 已落盘 ${out}（${json.length} 字节）`); }
    else process.stdout.write(json + '\n');
    process.exit(0);
  }

  const list = has('--all') ? tokens.all : COMMON;
  console.log(`主题包：${tokens.source}`);
  console.log(summary());
  console.log('（`light`/`dark` 列是**全局生效**的值：单值 var() 链已解析到具体色，复合值如投影原样保留；\n'
    + '  「—」= 该主题下没有全局定义）\n');
  console.log('令牌'.padEnd(48) + '浅色'.padEnd(26) + '深色');
  console.log('-'.repeat(96));
  for (const t of list) {
    if (tokens.light[t] === undefined && tokens.dark[t] === undefined) {
      const sc = tokens.scoped.find((s) => s.name === t);
      console.log(t.padEnd(48) + (sc ? `—（仅条件选择器内定义：${sc.selector.slice(0, 24)}…）` : '—（不存在）'));
      continue;
    }
    const lv = tokens.light[t] === undefined ? '—' : String(tokens.light[t]);
    const dv = tokens.dark[t] === undefined ? '—' : String(tokens.dark[t]);
    // 长值（字体栈 / 多段投影）**分行带标签**输出：挤在两列里会让人把浅色值当成深色值抄走
    if (lv.length > 24 || dv.length > 24) {
      console.log(t);
      console.log('      浅色: ' + lv);
      console.log('      深色: ' + dv);
      continue;
    }
    console.log(t.padEnd(48) + lv.padEnd(26) + dv);
  }
  if (!has('--all')) console.log('\n（--all 看全部；--scan <目录> 核对某个插件用到的令牌）');
}
