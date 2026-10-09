#!/usr/bin/env node
/**
 * review-release-doc.mjs —— **发布文档内检（无意义说明）的机械层**
 *
 * 解决的问题：README / CHANGELOG / release notes 里混进"对读者没有动作价值"的内容
 * （迁移史、日期、内部路径、自测项数、复盘叙事、作者心路）。人肉过一遍有两个毛病：
 *   ① 每发一版都要重来，累；② 靠印象，容易漏——而漏的恰恰是最像"我在认真记录"的那类句子。
 * 所以把**可机械判定的部分**做成规则扫描，输出「候选清单 + 处置建议」，人只需做取舍判断。
 * 判据与处置口径见 `references/release-doc-review.md`。
 *
 * 用法：
 *   node review-release-doc.mjs <文件.md> [...更多文件]     # 扫并报告
 *   node review-release-doc.mjs <文件.md> --json           # 机器可读（CI 用）
 *   node review-release-doc.mjs <文件.md> --only D1,D3     # 只跑这几条规则
 *   node review-release-doc.mjs <文件.md> --ignore D1      # 跳过这几条
 *   node review-release-doc.mjs <文件.md> --include-code   # 连代码块内也扫（默认跳过：样例与命令里的日期是技术事实）
 *   node review-release-doc.mjs <文件.md> --root <目录>    # 校验相对链接存在性时的根目录（默认文档所在目录）
 *   node review-release-doc.mjs --list-rules               # 列出全部规则
 *   node review-release-doc.mjs --selftest                 # 规则自证（每条都必须能命中，且干净文本不得命中）
 *
 * 退出码：0 = 无命中；1 = 有命中（CI 可据此卡口）；2 = 用法错误 / 文件读不到
 *
 * ⚠️ 两条自我约束（沿用本技能 probe-contracts.mjs 的教训）：
 *   ① **每条规则必须先自证能命中一次**（`--selftest` 里带正例），否则它只是"永远报警的噪音"；
 *      同时必须验证**干净文本不命中**（负例），否则假警报会训练人忽略这个脚本。
 *   ② 报告里给的是**候选与处置建议，不是判决**——"压缩成一句"和"移到维护者文档"要人来定，
 *      所以脚本**从不改文件**（没有 --fix），只输出。
 */
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const has = (f) => argv.includes('--' + f);
const valueOf = (f) => {
  const i = argv.indexOf('--' + f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const AS_JSON = has('json');
const INCLUDE_CODE = has('include-code');
const ONLY = (valueOf('only') || '').split(',').map((s) => s.trim()).filter(Boolean);
const IGNORE = (valueOf('ignore') || '').split(',').map((s) => s.trim()).filter(Boolean);

/** 处置口径：与 references/release-doc-review.md §五 的四种处理一一对应 */
const DISPOSITION = {
  delete: '删除',
  compress: '压缩成一句',
  maintainer: '移到维护者文档',
  reader: '改成读者动作',
};

/**
 * 规则表。每条 = { id, name, disposition, hint, skipCode, re }
 * - `skipCode: true` 表示**代码块内不扫**（样例输出、命令里的日期/路径是技术事实，不是噪音）
 * - 正则会用 `g` 逐行匹配；命中片段会在报告里截断显示
 */
const RULES = [
  {
    id: 'D1', name: '日期（发布/落地时间）', disposition: 'delete', skipCode: true,
    hint: '对读者没有动作价值。版本标题里连日期一并去掉；若要当发布存档，需在待确认里说明。',
    re: /\b20\d{2}-\d{2}-\d{2}\b|\b20\d{2}\s*年\s*\d{1,2}\s*月|(Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*\d{1,2}\s+[A-Z][a-z]{2}\s+20\d{2}/g,
  },
  {
    id: 'D2', name: '迁移史 / 来源交代', disposition: 'delete', skipCode: true,
    hint: '从哪个目录挪到哪、为什么不在包里、谁帮了谁——读者不关心，也不构成动作。',
    re: /挪(到|去|移)|迁移(到|自|史)|搬到|_ref\/|只读克隆|上游源码索引|不在本包|工作区文档|原是独立技能/g,
  },
  {
    id: 'D3', name: '内部路径 / 内部文档引用', disposition: 'delete', skipCode: false,
    hint: '读者到不了、也用不上（审计产物、本机绝对路径、内部排查记录编号）。',
    re: /\/tmp\/[\w.-]+|\/Users\/[\w.-]+\/|内部排查记录|参考-源码\/|audit-\d{8}/g,
  },
  {
    id: 'D4', name: '自测项数 / 覆盖率统计', disposition: 'delete', skipCode: true,
    hint: '使用者不可观测。删掉项数，必要时把"守什么"写进开发文档而不是发布文档。',
    re: /自检\s*\d+\s*(项|→)|绊线\s*\d+\s*项|变异测试|\d+\s*→\s*\d+\s*项|\d+\s*项(全绿|✅)|桩测|黄金输出对比/g,
  },
  {
    id: 'D5', name: '复盘叙事 / 教训', disposition: 'maintainer', skipCode: true,
    hint: '工程史与教训属开发文档或 pitfalls，发布会话里只留结论。',
    re: /起因(是|：)|复盘|教训：|踩坑记|回放|第一版|当时我|事后才|根因是/g,
  },
  {
    id: 'D6', name: '作者心路 / 自我解释', disposition: 'delete', skipCode: true,
    hint: '"我为什么这么写""目标是让它更体面"——读者要的是行为与边界，不是动机。',
    re: /我(们)?(决定|选择|选了|定的|写得|踩|绕)|没凭感觉|如实记录|目标：让|不是"|而不是/g,
  },
  {
    id: 'D7', name: '空泛评价', disposition: 'delete', skipCode: true,
    hint: '无判据的褒义词。要留就换成可验证的数值或行为差异。',
    re: /更好用|更可靠|不会过时|优化了(体验|流程)|体验更好|更体面|更优雅|更清爽/g,
  },
  {
    id: 'D8', name: '嵌套括号 / 破折号补充来源', disposition: 'compress', skipCode: true,
    hint: '括号套括号、破折号里塞来源与出处，压缩成一句平铺。',
    re: /（[^）]{0,60}（|——[^。；\n]{0,40}(来源|出自|同 §|见 ?§)/g,
  },
  {
    id: 'D9', name: '内部验证史 / 未验证项', disposition: 'maintainer', skipCode: true,
    hint: '只在"影响使用"时保留（如某场景返回 null）；纯内部回归覆盖度移开发文档。',
    re: /未(跑满|闭环|做真机|验证过)|验证方式|真机实测|故障注入|夹具|断言 \d+ 条/g,
  },
  {
    id: 'D10', name: '维护者内务', disposition: 'maintainer', skipCode: true,
    hint: 'git 历史/tag/SHA/发布清单/CONTRIBUTING 属仓库管理，不属用户文档。',
    re: /git (历史|tag|SHA)|tag 一并前移|发布清单|CONTRIBUTING|commit|提交信息/g,
  },
  {
    id: 'D11', name: '重复的"详见 docs/xxx"', disposition: 'compress', skipCode: false,
    hint: '同一份文档被反复指向；留一处，其余删除。',
    re: /详见\s*`?([^\s`（）()｜]+\.md)`?/g, repeatWarn: 2,
  },
  {
    id: 'D12', name: '相对链接可能不可达', disposition: 'delete', skipCode: false,
    hint: 'npm 页面上的相对链接会 404（docs/ 不在包内时）。改用 GitHub 绝对地址，或删掉。',
    re: /\[[^\]]+\]\((?!https?:|#|mailto:)([^)\s]+\.md)\)/g, linkCheck: true,
  },
];

const RULE_BY_ID = new Map(RULES.map((r) => [r.id, r]));

/* ============ 文件解析：带"是否在代码块内"标记 ============ */
function readLines(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const out = [];
  let inFence = false;
  let fenceMark = '';
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fence = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence && !inFence) { inFence = true; fenceMark = fence[1][0]; }
    else if (fence && inFence && fence[1][0] === fenceMark) { inFence = false; fenceMark = ''; }
    out.push({ n: i + 1, text: line, code: inFence || Boolean(fence) });
  }
  return out;
}

const trim = (s, max = 120) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max - 1) + '…' : one;
};

/* ============ 规则执行管线（扫描与自证共用同一条路径） ============ */
/** 第一步：按正则收集原始命中 */
function collectHits(rule, lines) {
  const hits = [];
  for (const { n, text, code } of lines) {
    if (code && rule.skipCode && !INCLUDE_CODE) continue;
    if (!text.trim()) continue;
    const re = new RegExp(rule.re.source, 'g');
    let m;
    while ((m = re.exec(text)) !== null) {
      hits.push({ line: n, match: m[0], snippet: trim(text), ctx: code ? 'code' : 'text', link: rule.linkCheck ? m[1] : undefined });
    }
  }
  return hits;
}

/** 第二步：按规则的附加语义过滤（链接可达性 / 重复计数） */
function applyFilters(rule, hits, root) {
  let kept = hits;
  if (rule.linkCheck) {
    // 只有"目标不存在"才算命中；存在的可达链接按规则 3 应保留
    kept = kept.filter((h) => h.link && !fs.existsSync(path.resolve(root, h.link)));
  }
  if (rule.repeatWarn) {
    const byTarget = new Map();
    for (const h of hits) byTarget.set(h.link ?? h.match, (byTarget.get(h.link ?? h.match) || 0) + 1);
    kept = kept.filter((h) => (byTarget.get(h.link ?? h.match) || 0) > rule.repeatWarn);
  }
  return kept;
}

/* ============ 扫描一个文件 ============ */
function scanFile(file, root) {
  const lines = readLines(file);
  const findings = [];
  const active = RULES.filter((r) => (ONLY.length ? ONLY.includes(r.id) : true) && !IGNORE.includes(r.id));

  for (const rule of active) {
    const hits = applyFilters(rule, collectHits(rule, lines), root);
    if (keptIsEmpty(hits)) continue;
    findings.push({ rule, hits });
  }
  return { file, findings, lineCount: lines.length };
}
const keptIsEmpty = (hits) => !hits.length;

/* ============ 报告 ============ */
function summarize(results) {
  const perRule = new Map();
  let total = 0;
  for (const r of results) {
    for (const f of r.findings) {
      perRule.set(f.rule.id, (perRule.get(f.rule.id) || 0) + f.hits.length);
      total += f.hits.length;
    }
  }
  return { total, perRule: [...perRule.entries()].map(([id, n]) => ({ id, name: RULE_BY_ID.get(id).name, count: n })) };
}

function printHuman(results) {
  for (const r of results) {
    console.log(`\n=== ${r.file} （${r.lineCount} 行）===`);
    if (!r.findings.length) { console.log('✅ 无命中'); continue; }
    for (const f of r.findings) {
      const d = DISPOSITION[f.rule.disposition];
      console.log(`\n[${f.rule.id}] ${f.rule.name} —— 建议：${d}（${f.hits.length} 处）`);
      console.log(`     判据：${f.rule.hint}`);
      for (const h of f.hits.slice(0, 12)) {
        const tag = h.ctx === 'code' ? ' [代码块]' : '';
        console.log(`     L${h.line}${tag}  ${h.snippet}`);
      }
      if (f.hits.length > 12) console.log(`     …另有 ${f.hits.length - 12} 处`);
    }
  }
  const { total, perRule } = summarize(results);
  console.log('\n===== 汇总 =====');
  if (!total) console.log('✅ 全部干净（本脚本只判机械项；"压缩/搬运"的取舍仍需人过一遍）');
  else {
    for (const p of perRule) console.log(`  ${p.id} ${p.name}: ${p.count} 处`);
    console.log(`  合计 ${total} 处候选`);
    console.log('  处置：按上方每条规则的建议处理；脚本不自动改文件。');
  }
}

/* ============ 规则自证：正例必须命中、负例必须不命中 ============ */
const FIXTURES = {
  D1: { pos: '## 0.5.3 —— 收口（2026-10-08）', neg: '## 0.5.3 —— 收口' },
  D2: { pos: '> 这部分原是独立技能 dsh-core-update，2026-09-12 并入本技能', neg: '> 用法见 README' },
  D3: { pos: '审计页在 /tmp/lanhu-audit/，截图在 ~/audit-20260921/', neg: 'Cookie 明文保存在本机 ~/.dsh/lanhu/cookies/<别名>（ln -s <plugin-dir> ~/.dsh/profiles/web/node_modules/x）' },
  D4: { pos: '自检 663 → 676 项；变异测试 4 组全红', neg: '新增 13 条断言' },
  D5: { pos: '> 起因是一次弹窗一比一还原的实战复盘', neg: '> 本版把返回统一收口' },
  D6: { pos: '> 复盘结论：我决定不再逐个补字段', neg: '> 所有工具的成功返回统一带 ok' },
  D7: { pos: 'README 首屏加上目标是让 AI 更好用', neg: '匹配率 11/13（84.6%）' },
  D8: { pos: '（已用"格式合法但不存在"的 id 逐字节核实（见 §3））', neg: '（实测 187.5 ↔ 750）—— 详见 [docs/读稿.md](https://github.com/x/y/blob/main/docs/a.md)' },
  D9: { pos: '未在全部 1437 张稿上回归；验证方式：黄金输出对比', neg: '已验证：真机 11/13 匹配' },
  D10: { pos: '受影响提交的信息与每个提交的 tree 都做了替换，tag 一并前移', neg: '安装：dsh plugin --profile web add dsh-lanhu' },
  D11: { pos: '详见 docs/读稿.md\n详见 docs/读稿.md\n详见 docs/读稿.md', neg: '详见 docs/读稿.md' },
  D12: { pos: '见 [读稿](docs/不存在的读稿.md)', neg: '见 [读稿](https://github.com/x/y/blob/main/docs/a.md)' },
};

function selftest() {
  console.log('规则自证（每条：正例必须命中 ≥1；负例必须 0 命中）\n');
  let fail = 0;
  for (const rule of RULES) {
    const fx = FIXTURES[rule.id];
    if (!fx) { console.log(`⚪ ${rule.id} ${rule.name}: 无夹具，跳过`); fail += 1; continue; }
    const lineFor = (s, n) => ({ n, text: s, code: false });
    const hitPos = scanText(rule, [lineFor(fx.pos, 1)]);
    const hitNeg = scanText(rule, [lineFor(fx.neg, 1)]);
    let note = '';
    if (rule.linkCheck) {
      // 链接规则要按"目标不存在"判定，这里用不存在的路径保证正例成立
      note = '（链接规则：按目标不存在命中）';
    }
    const ok = hitPos.length > 0 && hitNeg.length === 0;
    if (!ok) fail += 1;
    console.log(`${ok ? '✅' : '❌'} ${rule.id} ${rule.name}: 正例=${hitPos.length} 命中, 负例=${hitNeg.length} 命中 ${note}`);
    if (!ok) {
      console.log(`     正例：${fx.pos}`);
      console.log(`     负例：${fx.neg}`);
    }
  }
  console.log(`\n合计：${RULES.length - fail} 通过 / ${fail} 失败`);
  return fail === 0 ? 0 : 1;
}

/** 单条规则跑一批行（供自证使用；与实际扫描共用 collect → applyFilters 管线） */
function scanText(rule, lines) {
  return applyFilters(rule, collectHits(rule, lines), '/__selftest_root__');
}

/* ============ 入口 ============ */
if (has('list-rules')) {
  for (const r of RULES) {
    console.log(`${r.id}  ${r.name}`);
    console.log(`     处置建议：${DISPOSITION[r.disposition]}${r.skipCode ? '（代码块内不扫）' : ''}`);
    console.log(`     判据：${r.hint}`);
  }
  process.exit(0);
}
if (has('selftest')) process.exit(selftest());

const files = argv.filter((a) => !a.startsWith('--') && a !== valueOf('only') && a !== valueOf('ignore') && a !== valueOf('root'));
if (!files.length) {
  console.error('用法：node review-release-doc.mjs <文件.md> [...] [--json] [--only D1,D3] [--ignore D2] [--include-code] [--root <目录>]\n');
  console.error('      node review-release-doc.mjs --list-rules | --selftest');
  process.exit(2);
}
const results = [];
for (const f of files) {
  if (!fs.existsSync(f)) { console.error(`读不到文件：${f}`); process.exit(2); }
  results.push(scanFile(f, valueOf('root') || path.dirname(path.resolve(f))));
}
const { total, perRule } = summarize(results);

if (AS_JSON) {
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    files: results.map((r) => ({
      file: r.file, lineCount: r.lineCount,
      findings: r.findings.map((f) => ({
        rule: f.rule.id, name: f.rule.name, disposition: DISPOSITION[f.rule.disposition], count: f.hits.length,
        hits: f.hits.map((h) => ({ line: h.line, snippet: h.snippet, ctx: h.ctx })),
      })),
    })),
    total, perRule, exitCode: total ? 1 : 0,
  }, null, 2));
} else {
  printHuman(results);
}
process.exit(total ? 1 : 0);
