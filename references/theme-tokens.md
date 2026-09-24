# 主题令牌：名字要核，不要猜；取值要现抠，不要抄

面板、浮层、按钮的颜色**一律走官方令牌**（`var(--dsw-…)`），不要写死。但令牌有两个陷阱：
**名字写错不会报错**，**取值会随本体版本漂移**。这份文档给的是"怎么拿到真值"，不是"真值本身"。

---

## 一、为什么（三条都是实测代价）

### 1. 不存在的令牌名 → **静默走 fallback**，肉眼看不出来

实测一个真实插件面板里写了三个不存在的名字，`apply()` 正常、控制台无错、页面上也"看着有颜色"：

| 实际写的（不存在） | 真名 |
|---|---|
| `--dsw-alias-bg-sunken` | `--dsw-alias-bg-layer-1` |
| `--dsw-alias-brand-bg` | `--dsw-alias-bg-module-platform` |
| `--dsw-alias-state-warning-primary` | `--dsw-alias-state-warn-primary`（**少个 `ing`**） |

`var()` 引用不存在的自定义属性**不报错**，直接退回继承值或初始值 —— 与"写对了但主题刚好是那个色"无法区分。

### 2. `brand-primary` **不是品牌色**，它是"对比色"

```
--dsw-alias-brand-primary   浅色 #0f1115（近黑）   深色 #f9fafb（近白）
```

它浅色下**近黑**、深色下**近白** —— 是个跟着主题翻转的**高对比前景色**。
插件拿它当"紫底/品牌底"用，再配一个写死的白字 → 深色主题下变成**白底白字**，
实测对比度 **1.05:1**（等于看不见）。

**主按钮的正确写法**：底色 `--dsw-alias-button-primary-fill`（或 `brand-primary`），
文字色配 **`--dsw-alias-label-primary-foreground`**（浅 `#fff` / 深 `#0f1115`，与底色成对翻转）。

### 3. `bg-overlay` 不是"浮层底色"

```
--dsw-alias-bg-overlay   浅色 #e9ecf2   深色 #61666b   ← 深色下是中灰
```

深色主题里比真正的浮层色亮 **17 倍**（`#61666b` vs `#151517`）。面板/菜单/弹层要用
**`--dsw-alias-bg-layer-3`**（深色 `#353638`）或 **`--dsw-specific-menu`**。

---

## 二、唯一真源 + 怎么抠

**真源**：`@deepseek-ai/dsh-client-ui-theme/lib/client.js` 里的字符串常量 `design_platform_css_default`。
它同时含两套：`body{…}`（浅色）与 `body[data-ds-dark-theme]{…}`（深色）。

```bash
# ① 常用令牌的浅/深取值（值已沿 var() 链解析到具体色）
node scripts/dump-theme-tokens.mjs

# ② 全部令牌
node scripts/dump-theme-tokens.mjs --all

# ③ 机器读 / 落盘
node scripts/dump-theme-tokens.mjs --json
node scripts/dump-theme-tokens.mjs --out tokens.json

# ④ ★ 核对某个插件用到的令牌是否存在（**名字写错当场标出来**）
node scripts/dump-theme-tokens.mjs --scan <插件目录>
```

`--scan` 会扫目录下所有 `.js/.mjs/.ts/.tsx/.jsx/.vue/.css`，列出每个文件用到的 `var(--dsw-*)`，
并把**两个主题里都不存在的**标成 ❌；**有不存在令牌时退出码 1**，可以直接当门禁塞进 CI/自检。

> 它**只扫代码，不扫文档** —— 所以本文档里故意列出的三个错名不会被它报红（文档要能写反例）。

---

## 三、取值快照（**会漂移，别照抄**）

> ⚠️ 下面的值是 **2026-09-24 / DSH `0.1.7-rc.1`** 抠出来的快照，共 **178 个令牌**（浅 178 / 深 178）。
> **它一定会过期** —— 见第四节。要数值就跑 `node scripts/dump-theme-tokens.mjs`，**不要抄本文档**。

| 令牌 | 浅色 | 深色 | 用途 |
|---|---|---|---|
| `--dsw-alias-label-primary` | `#0f1115` | `#f9fafb` | 主文本 |
| `--dsw-alias-label-secondary` | `#61666b` | `#cfd3d6` | 次级文本 |
| `--dsw-alias-label-tertiary` | `#81858c` | `#adb2b8` | 三级文本 |
| `--dsw-alias-label-caption` | `#adb2b8` | `#81858c` | 说明文字 |
| `--dsw-alias-label-primary-foreground` | `#fff` | `#0f1115` | **配 brand/button 底色的文字色** |
| `--dsw-alias-label-primary-inverted` | `#fff` | `#353638` | 反色文字 |
| `--dsw-alias-bg-base` | `#fff` | `#151517` | 页面底 |
| `--dsw-alias-bg-layer-1` | `#fff` | `#232324` | 卡片/下沉面 |
| `--dsw-alias-bg-layer-2` | `#fff` | `#2c2c2e` | 二级面 |
| `--dsw-alias-bg-layer-3` | `#fff` | `#353638` | **浮层/菜单用这个** |
| `--dsw-alias-bg-overlay` | `#e9ecf2` | `#61666b` | ⚠️ 深色是中灰，**别当浮层底色** |
| `--dsw-alias-bg-module-platform` | `#f5f6f7` | `#353638` | 模块/平台底（`brand-bg` 的真名） |
| `--dsw-alias-border-l1` | `#0000000a` | `#ffffff0f` | 最弱分隔 |
| `--dsw-alias-border-l2` | `#0000001a` | `#ffffff1f` | 分隔线 |
| `--dsw-alias-border-l3` | `#0000001f` | `#ffffff29` | 描边 |
| `--dsw-alias-border-l4` | `#00000029` | `#fff3` | 强描边 |
| `--dsw-alias-interactive-bg-hover` | `#2631480f` | `#ffffff14` | hover 底 |
| `--dsw-alias-interactive-bg-hover-accent` | `#26314824` | `#ffffff3d` | 强调 hover |
| `--dsw-alias-brand-primary` | `#0f1115` | `#f9fafb` | ⚠️ **对比色，不是品牌色** |
| `--dsw-alias-button-primary-fill` | `#0f1115` | `#f9fafb` | 主按钮底 |
| `--dsw-alias-state-success-primary` | `#22c55e` | `#22c55e` | 成功 |
| `--dsw-alias-state-warn-primary` | `#f59e0b` | `#f59e0b` | 警告 |
| `--dsw-alias-state-error-primary` | `#ec1313` | `#f25a5a` | 错误 |
| `--dsw-alias-state-business-primary` | `#4176e6` | `#7aaaff` | 业务蓝 |
| `--dsw-alias-scrollbar-bg-l1` | `#e5e5e5` | `#3c3c3d` | 滚动条 |
| `--dsw-alias-scrollbar-hover-l1` | `#d4d4d4` | `#545557` | 滚动条 hover |
| `--dsw-specific-menu` | `#f8f9fa94` | `#30313680` | 菜单/浮层（**带 alpha**） |
| `--dsw-specific-sidebar-fill` | `#f9fafb` | `#1b1b1c` | 侧栏底 |

边框那几行的值是 **8 位十六进制 = 带 alpha**（`#0000001a` = 黑 10%），不是拼错的颜色。

---

## 四、它会漂移（本次会话里就撞到一次）

同一次会话内，`--dsw-specific-menu` 从 `#fff` / `#353638` 变成了 `#f8f9fa94` / `#30313680`，
令牌总数从 **163 变成 178** —— 原因是主题包被更新了（`client.js` 的 mtime 直接跳到当天）。

**所以**：

- 本文档第三节的表**只能当"大概长什么样"**，**取值一律现抠**；
- 写兼容代码时，**别按数值判断主题**（比如"底色等于 `#fff` 就是浅色"），要用 `[data-ds-dark-theme]` 之类的**结构判据**；
- 值从"纯色"变成"带 alpha"这种事**不会有任何报错**，只会让不透明度叠加算错 —— 该用令牌的地方别去读它的数值。

---

## 五、三条硬规矩

1. **名字要核，不要猜** —— 收尾前跑 `node scripts/dump-theme-tokens.mjs --scan <插件目录>`，**退出码非 0 就是有问题**。
2. **主按钮/彩底上的文字色，配 `--dsw-alias-label-primary-foreground`**（成对翻转），
   **不要**在 `brand-primary` 上配写死的白字。
3. **浮层/菜单用 `bg-layer-3` 或 `--dsw-specific-menu`**，**不要**用 `bg-overlay`。

## 六、和"看着对"的分工

令牌保证的是**换主题/换皮肤后仍然可读**；对比度、尺寸、间距这些"到底好不好看"属于设计判断，
`--scan` 不管。所以用令牌**不代表**面板就对了 —— 真机审计那一步仍然要做（见 `pitfalls.md` 里"离线渲染审计"那条）。
