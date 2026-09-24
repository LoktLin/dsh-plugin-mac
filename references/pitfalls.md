# 实测坑清单（每条都带"怎么提前发现"）

> 这些坑的共同特征：**不报语法错、不报异常，只是"没生效"**；或者反过来——**一处小错让整个 profile 起不来**。
> 所以每条都配了"提前发现"的办法。

## 0 类：装配期（症状出现时**最先查这里**）

### 0.1 把包放进 `node_modules` ≠ 插件被装配

**现象**：文件都在、软链也在，重启后**什么都没发生**，而且**不报任何错**、日志一行都没有。
**根因**：启动期**不会扫描 `node_modules` 去找插件**。真正的装配来源只有两条：
① 包名出现在 profile 的 **`dsh.profile.bundles`** 列表里（于是它自带的 `cordis.patch.yml` 作为一层被应用，把插件行 insert 进来）；
② profile / home 层的 `cordis.patch.yml` 里**显式 insert 一行**且 `name` 能解析到它。
只把包塞进 `node_modules`（`ln -s` 或拷贝）而两者都没做 = 包在盘上、`apply()` 从未执行。
**本机(macOS)实证对照**：`dsh-skill-manager` 出现在 `bundles` 里；`dsh-better-sidebar` 只在 `node_modules`、不在 `bundles`。
**修法**：把包名加进 `~/.dsh/profiles/<名>/package.json` 的 `dsh.profile.bundles`（或走 `dsh plugin add`）。
**提前发现**：`dsh --profile web --dump-config | grep "<包名>"` —— **不启动就能查，装完立刻跑一次**。

### 0.2 `insert` 带 `id` 和不带 `id` 语义不同

**现象**：patch 写了但没生效，或者"看起来写对了"却什么都没加。
**根因**：`insert` **不带 `id`** 才是"新增一行插件"；**带 `id`** 是"往已有行/组里追加"，目标不存在时**只 warn 然后跳过**（不报错）。
同理 `name` 匹配不到会让整条 patch `skipping`。
**提前发现**：`--dump-config` 的 stderr 里会有 patch 匹配失败的 warn；别只看 stdout。

### 0.3 `dsh plugin add` 对没声明 `dsh.bundle` 的包只装成普通依赖

**现象**：pnpm 装成功了，但插件层根本没进配置树。
**根因**：只有在包**声明了 `dsh.bundle.patch`** 时，`dsh plugin add` 才会把它补进 `dsh.profile.bundles`；否则只打一行 warning。
**修法**：给包补上 `dsh.bundle.patch` 指向自己的 `cordis.patch.yml`。
**提前发现**：同 0.1 的 `--dump-config`。

### 0.4 工具注册的"抛错式"契约与可见性

**现象**：注册成功但模型看不到；或者启动期直接抛错。
**根因（本机 `dsh-tools/lib/types/index.d.ts` 取证）**：`ctx.tools.register()` 是**抛错式**的——
必须给完整的 `output: { schema, render }`；`parameters` 会被 `assertSupportedJsonSchema` 校验；
**同层重名**、或占用**保留的 PTC 传输名 `run_code`**（`RUN_CODE_NAME`）都会抛。
可见性另有两层：注册挂在**调用者的 scope**（host 级=全局可见，`agent.ctx` 级=只对该 agent 且遮蔽全局）；
再加 **`ToolRestriction`**（"per-scope filter over global tools"，按 agent 作用域过滤全局工具，**不影响** scoped 注册与保留的 PTC 传输）。
PTC 模式下模型**只看得到 `run_code`**。
**提前发现**：用 Cordis Host 的 `Tool.listTools` 直接问"当前 agent 真实可调用的工具"，这是**ground truth**——
比在源码里猜作用域快得多。（本机实测：profile 级软链插件 `dsh-eggy` 的 `eggy_*` 工具确实在列。）

## A 类：写错了会静默失效

### A1. 工具返回值不是 lossless JSON

**现象**：工具调用报 `returned invalid output: value is not lossless JSON`，或者工具"看着成功但结果没了"。
**根因**：`undefined`、`NaN`、`Infinity`、`-0` 都不是合法 JSON。实测三种都踩过：hub `/health` 缺字段得到 `undefined`；Lua 的 `p.z` 为 nil 得到 `NaN`；`-Math.round(0)` 得到 `-0`。
**修法（两层，缺一不可）**：
1. **源头**：可选字段一律 `?? null`（`inset: layer.inset ?? null`、`lineHeight: round2(x?.value) ?? null`）；
2. **出口**：`tool()` 构造点统一过一层 `toLossless()` 递归清洗 —— **所有工具一处受益、防再犯**。

**⚠️ 为什么桩测试常常抓不住（实测踩过）**：`selftest.mjs` 那项 lossless 检查是拿**一个假参数**（如 `{text:'x'}`）
去调每个工具的 —— 参数不对时工具往往在**参数校验或早期分支**就返回了，
**根本走不到那条真正产出 `undefined` 的路径**，于是桩全绿、真宿主一调就被拒收。
**结论：lossless 不能指望"测出来"，必须靠出口清洗兜住。**

**`undefined` 的典型来源**——几乎都是"可选字段"直接塞进返回对象：

- `inset: layer.inset` —— 顶层元素没有父层，`flatten` 时留了 `undefined`；
- `lineHeight: round2(font.lineHeight?.value)` —— `round2` 对非数字**原样返回**，于是把 `undefined` 传了出去；
- 任何 `x?.y` / `obj[可能不存在的键]` 直接进返回值的写法。

**定位手法**：递归遍历返回值找 `undefined`（`selftest` 已有实现，可直接抄）。
只看报错猜不出来 —— 宿主只告诉你"整个结果非法"，**不告诉你是哪个字段**。

### A2. `parameters` 的 JSON Schema 写错

**现象**：注册期抛错，**严重时连"发消息"都失败**（不是只有这个工具不能用）。
**根因**：宿主在注册期校验 schema。实测过一次把 `description` 写成了 `properties` 字段，宿主 `assertObjectJsonSchema` 直接抛。
**修法**：`parameters` 用合法 JSON Schema；`description` 是字符串、`properties` 是对象。
**提前发现**：`selftest.mjs` 的"工具形状合法"一项会检查这两个字段的类型；也可以 `JSON.stringify(def.parameters)` 加一次独立解析。

### A3. patch 的 `id` 对不上 → 插件"装上了但没进配置树"

**现象**：`node_modules` 里有这个包，但什么效果都没有。
**根因**：`cordis.patch.yml` 里 `- insert:` 的 `id` 与 profile 层引用的 `id` 不一致；或者包没有 `dsh.bundle`（那就只是普通依赖，**不会自动成为 profile 层**）。
**提前发现**：`dsh --profile web --dump-config | grep "<包名>"` —— **不启动就能查，养成装完先跑这个的习惯**。

### A4. 以为 `config` 是深合并

**现象**：按 `id` 覆盖某行配置后，原来那些键全没了。
**根因**：**`config` 是整段替换，不是深合并**。
**修法**：覆盖时把需要的键全部重述一遍。

### A5. 路由 path 带尾斜杠 / 重复注册

**现象**：客户端 404，或者启动期抛错。
**根因**：`path` 必须是**绝对路径且无尾斜杠**；`(kind, path)` 重复会抛错（路由模式是组合期契约）。
**提前发现**：`curl http://127.0.0.1:3080/<path>/status` 直接打一遍。

### A6. 忘记 dispose 槽位注册 → 幽灵条目

**现象**：反复加载插件后，同一个入口出现好几个。
**根因**：`ctx.slots.register()` 的返回值没被回收。
**修法**：串进 `ctx.effect(() => unregister, label)`，或直接用 `ctx.slots.inject` 回调的返回值（它随声明塌陷自动回收）。
**提前发现**：写一个"dispose 之后 registry / DOM / style 全部清空"的断言（`selftest.mjs` 里客户端那三项就是照这个写的）。

### A7. 工具参数"声明了但没传"（schema 有、描述提了、实现没往下传）

**现象**：模型把参数传给工具，工具"成功"返回，但那个参数**完全没生效** —— 无报错、无警告，返回值看着也合理。
实测：`lanhu_read_design` 的 `limit` / `mapBox` / `toBox` 在 schema 与描述里都写着，但 `execute` 里**没往下传** ——
调用方以为"按我给的 limit 截断了"，其实一直是默认值。

**根因**：工具是「声明 → 校验 → 实现」三段式，中间那段最容易被包装器吃掉。
⚠️ **别用 `TOOLS[i].execute.toString()` 查透传**：`tool()` 会把 `rawExecute` 包一层**参数校验**，
`toString()` 拿到的是包装函数，里面**看不到 `args.xxx`** —— 那样查会**全部误报成"没传"**（实测：13 个工具全报 0 引用）。

**修法（两层）**：
1. **出口**：实现里直接用 `args.xxx`，别经过中间层转发；
2. **守卫**（关键）：按**源码区间**静态检查 —— 从 `name: '<tool>'` 切到下一个工具定义为止，
   逐个断言该区间里出现过 `args.<每个声明参数>`。**全部工具 × 全部声明参数**都查（实测 15 工具 / 83 参数）。
   "注入但确实不适用"的参数要写**显式白名单**并注明为什么不是漏传。

**⚠️ 只查"新加的几个参数"是假绿**：实测旧守卫只覆盖新参数，把 `limit: args.limit` 改成 `undefined` **照样全绿**。
要**做变异测试**证明守卫有效（改任一处 `args.x` → 必须变红）。

## B 类：写错了会让整个壳起不来

### B1. 客户端 `apply` 抛错

**现象**：整个 Web GUI 起不来，或页面白屏。
**根因**：Client 半边的 `apply` 在壳的启动路径上，抛错会**拖垮整个 Web 壳**。
**修法**：所有 DOM 操作包 `try/catch`，失败只 `console.warn` 并 `return`。**绝不 throw**。
**提前发现**：`selftest.mjs` 会断言 `apply(ctx)` 不抛错、且返回 cleanup 函数。

### B2. `dsh.client` 声明坏 / `exports["./client"]` 指向不存在的文件

**现象**：启动期**聚合抛错**（FAILED fiber），shell 可能完全起不来。
**根因**：客户端 bundle 扫描是**激活期同步**跑的，一个坏声明会把整批聚合错误抛出。
**修法**：`dsh.client.platform: "web"` 与真实存在的 `exports["./client"]` **两个都要有**。
**提前发现**：装之前先 `node -e "JSON.parse(require('fs').readFileSync('package.json'))"` 确认 exports 指向的文件存在。

### B3. 往 `root` 槽位注册

**现象**：页面只剩你的组件，侧边栏/对话区/浮层**全没了**。
**根因**：`root` 是 `kind: 'single'`，`ui-layout` 的 AppFrame 占着它并声明了其它所有座位。往它注册 = **遮蔽整个框架**（而且动态注册的条目优先级更低反而会赢）。
**修法**：要全局浮层用 `shell.overlay`；要改导航栏先想清楚是不是真的要**替换**它。

### B4. 注册到未声明的槽位 / 声明已被声明的子槽

**现象**：加载期抛错。
**根因**：**声明即认领**。往未声明槽位注册、声明已声明的 child、同一个 store handle 挂两个 scope、`chain` 少了 `select` —— 都会在 load 时抛。
**修法**：先用 `ctx.slots.inject(key, cb)` 等声明；`chain` 别忘 `select`。

## C 类：改了不生效（不是 bug，是边界）

### C1. Host 改了没重启

**现象**：工具行为没变。
**根因**：Host 代码是 `dsh web` **启动时**加载的快照。
**修法**：重启。**这条占了"改了没反应"的一大半。**

### C2. Client 改了没刷新 / 只 build 没 watcher

**现象**：面板没变。
**根因**：客户端 bundle 在**激活时**被读进内存（`initialBundleSnapshot`）。只有 bundle **内容**变化能走 HMR，而且需要构建 watcher 持续重写 `lib/client.js`。
**修法**：没 watcher 就刷新页面；改了 `package.json` / `exports` / 插件集合 / host 代码 → 必须重启（HMR 管不到组合期的东西）。

### C3. 用独立 Vite/静态服务"预览"插件

**现象**：页面起不来，或者起来了但什么都没有。
**根因**：Web 壳依赖 Host 注入的 `window.__DSH_BOOT__`；独立服务没有这个，客户端模块系统压根不存在。
**修法**：**别这么干**。插件只能在 DSH GUI 里验证。

### C4. 把「重启」当调试手段（patch 文件其实是热加载的）

**现象**：出问题就重启 `dsh web`，重启完没好，就以为"不是重启的事"，然后卡住。
**根因**：**patch 文件（`cordis.patch.yml`）是否热加载取决于 profile 的 `patchReload`**：
`live` → 监听 profile 与 home 级 patch 文件，**改完不用重启**；`startup` → 只应用一次。
本机 **未显式声明** `dsh.profile.patchReload` —— 官方规定 custom profile 省略该字段时**默认 `live`**（随产品交付的 `web` 模板同样是 live），所以本机实际就是 `live`。
而 `dsh.profile.bundles` / `package.json` / `exports` 这些是**启动时快照**，改了才必须重启。
**修法**：先分清你改的是哪一类。**「我重启了还是没工具」在 `live` 机器上什么也证明不了**——
patch 改动本来就不需要重启。先查装配（0.1），再谈重启。
**提前发现**：`cat ~/.dsh/profiles/web/package.json`，看 `dsh.profile.patchReload`。

### C5. 手搓软链会被下一次 `dsh plugin install` 清掉

**现象**：开发态用 `ln -s` 装的插件，某次 `dsh plugin add/install` 之后突然消失了。
**根因**：本机 pnpm 是 `nodeLinker: hoisted`，手搓的软链**不在 profile 的 `dependencies` 里**，
下一次 install 会把它当"多余的目录"清掉。
**修法**：把软链当**开发态手段**，别当交付方式；要长期存在就走 `dsh plugin add` 或写进 `bundles`。
**提前发现**：`cat ~/.dsh/profiles/web/pnpm-workspace.yaml` 看 `nodeLinker`；import 失败时先确认软链还在。

### C6. CLI 入口守卫在**符号链接**下静默失败（零输出、exit 0）

**症状**：`node <symlink 路径>/插件.mjs <任意命令>` → **零输出、退出码 0**，连帮助文本都不打。
比报错更糟 —— 看起来"跑成功了但什么都没干"。

**根因**：入口守卫写成

```js
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
```

Node ESM 的 `import.meta.url` 是 **realpath 之后**的，而 `process.argv[1]` **保留调用时写的路径** ——
经 symlink 调用时两边**永不相等**，`main()` 一次都不执行。

**影响面**：npm 全局 bin、pnpm、手搓软链……**一切 symlink 安装形态必挂，且完全静默**。
（`cd` 进目录后用相对路径反而正常，所以本地开发很容易一直没发现。）

**修法**：两边都 realpath 后比较，并且**未命中时打一行 stderr**：

```js
let entry = process.argv[1], self = import.meta.url;
try { entry = fs.realpathSync(entry); } catch {}
try { self = pathToFileURL(fs.realpathSync(fileURLToPath(import.meta.url))).href; } catch {}
if (self === pathToFileURL(entry).href) main();
else if (path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url))) {
  console.error('[插件名] 入口守卫未命中：本文件被直接调用却没有执行任何命令。');
}
```

> ⚠️ 警告条件必须用**文件名**判（`argv[1]` 的 basename == 本文件名），
> 别写成"`argv[1]` 是 `.mjs` 就警告" —— 后者会让任何 `node 别的脚本.mjs`（它 import 本模块）**误报噪音**（实测踩过）。

**姊妹坑：把"打了一屏帮助"当成功。** 同一个入口的 `default` 分支若只是 `console.log(帮助)` 然后结束，
`node 插件.mjs 拼错的命令` 会**打印帮助 + 退出码 0** —— 脚本和 CI 一律把它当执行成功。

退出码语义必须分三种，**别拿"有输出"当成功判据**：

| 情形 | 退出码 |
|---|---|
| 给了命令但没人接（拼错/未实现） | **1** + stderr 提示 |
| 没给命令、或 `--help`（只是看帮助） | 0 |
| 正常执行但业务失败（参数不合法、接口报错） | **1** |

**提前发现**：`selftest` 里可以用 `fs.symlinkSync` 自建一个链接跑真实子进程，断言"输出非空且与真实路径逐字节一致"；
顺便用 `execFileSync` 的 `e.status` 断言上面三种退出码（假命令 ⇒ 1、无参数 ⇒ 0、缺参数 ⇒ 非 0）。

## D 类：DOM 注入路线特有的坑（A 路线）

### D1. 侧边栏选择器随壳版本失效

**现象**：侧边栏里看不到入口，控制台也没有报错。
**根因**：壳的结构会变（当前是 `column > wrapper > 根`，旧壳是 `column` 第一个子元素）。
**修法**：选择器写**多重兼容**（`[data-pane="sidebar"], [class*="sidebarCol"]`），并且**先试官方槽位**（`sidebar.footer.action`）；同时留一个控制台兜底入口（如 `window.__mytoolPanel.open()`），万一选择器全失效还能用。

### D2. React 重渲染把注入的节点挤掉

**现象**：入口出现一下又消失，或者切换会话后就没了。
**根因**：DOM 是别人的地盘。
**修法**：双层 `MutationObserver`（等出现 + 被改动时当帧插回），配合幂等属性 + `isConnected` 检查。代码见 `lightweight-path.md` §3.2。

### D3. 写死颜色，用户换皮肤后看不清

**现象**：某些皮肤下面板对比度崩了。
**根因**：皮肤令牌常常是**半透明**的（`bg-overlay` 实测 55%~92% 不透明），直接当底色会透出壁纸。
**修法**：能用 `--dsw-alias-*` 就用；需要实底时**自己从主题色合成不透明实色**，并跟着主题变化重算。

## E 类：开发流程里的坑（我踩过，值得单独说）

### E1. 用"看着对"代替"跑一遍"

**现象**：脚手架生成的客户端代码里 `window.__<插件名>Panel` 拼出了 `window.__dsh-selftest-probePanel` —— **不是合法 JS 标识符**，一挂载就死。
**根因**：插件名里的连字符被直接拼进了标识符。**肉眼扫不出来。**
**修法**：**任何生成代码都要跑一次真验证**。这条是被 `selftest.mjs` 当场抓到的——它值得你为每个新插件跑一次。

### E2. 测试桩不忠实，测了个寂寞

**现象**：客户端挂载测试一直失败，查半天发现是**桩的问题**：真实的 `document.querySelector` 找不到时返回 **`null`**，桩返回了 `undefined`，于是插件里 `el !== null` 的幂等守卫被误触发。
**根因**：桩与真实环境语义不一致时，测试只会制造假信号。
**修法**：写桩时**逐条对齐真实语义**（`querySelector` 返回 `null`、`removeChild` 存在、`parentNode` 能从 `parentElement` 取…)；桩一旦发现不一致，**改桩而不是改被测代码**。

### E3. 把"通过"当成"验证过"

**现象**：`selftest` 绿了，但真装上去还是不生效。
**根因**：桩测试覆盖的是**契约**（形状、回收、守卫），不覆盖**组合**（profile 挂载、真实槽位存在、真实 DOM 结构）。
**修法**：按 `SKILL.md` §4 的矩阵走完——桩测试 + `--dump-config` + 路由 curl + GUI 实际看一眼，**缺一项就把结论标成"未验证"，别写"完成"**。

### E4. 把手写插件塞进 `selftest`，被一堆"脚手架约定"判红

**现象**：把一个真实手写插件（入口在 `lib/index.js`、路由是业务语义的）丢给 `selftest`，报一堆 ❌：
`缺 index.js`、`/status 缺 version/tools`、`POST /<base>/tool` 不通、`apply 没返回 cleanup`、`非本机 Host 头未 403`。

**根因**：这些**大半是脚手架的自定义约定，不是官方契约**：

- 入口必须在根 `index.js` —— 真实插件常由 `package.json.main` 指到 `lib/`；
- `/status` 带 `version`/`tools` 自述字段 —— 业务路由没必要叫这个名、也没必要有这些字段；
- `POST /<base>/tool` 通用调试端点 —— 脚手架送的，官方没要求；
- `apply` **返回** cleanup —— 官方推荐的是 `ctx.effect(fn, label)`，`apply` 不必有返回值；
- 本机守卫只看 Host 头 —— 更稳的是看 `socket.remoteAddress`，两者都算数。

**修法**：这些地方 `selftest` 现在都做了兼容（见 `SKILL.md` §2 第 2 步）——**认 `main`/`exports`、认 `ctx.effect`、
守卫认 `remoteAddress`、脚手架专属项缺失时标 `➖ 跳过` 而不判红**。
反过来，如果你在**自己写测试**时遇到同样的误报，先分清"官方契约"和"某个脚手架的约定"，别为了过测去改插件。

> 这个坑是 2026-09-19 拿 `dsh-lanhu`（本机第一个真实手写插件）跑 `selftest` 时暴露的。
> 另外桩 `req` 当时没有 `socket.remoteAddress`，导致**任何带本机守卫的插件都被一律 403**——桩不忠实，测了个寂寞（见 E2）。

### E5. `link:` 安装下自实现 `defineTool` 替身，漏掉了「参数校验」那一半

**现象**：工具跑起来没问题，但模型把 `limit` 传成 `"abc"` 时，错误要从业务代码深处才冒出来，
而且是一句语焉不详的异常，而不是「哪个字段类型不对」。

**根因**：官方 `defineTool` 其实做**两件事**（见 `dsh-tools/lib/index.js`）：

```js
const parameters = parameterSchemaSpecToJsonSchema(options.parameters);
const validate = (args) => validateJsonSchemaValue(parameters, args, "");
async execute(args, exec) {
  const violations = validate(args);
  if (violations.length > 0) throw new ToolArgsError(violations);   // ← 这一半
  return userExecute(args, exec);
}
```

而 `link:` 安装的插件**不能 import `@deepseek-ai/dsh-tools`**（真实路径在 profile 之外，解析不到；
import 它会让整棵插件树加载失败、GUI 起不来）。于是只能自己写替身——
而替身往往只做了「DSL → JSON Schema 编译」，**把校验那一半丢了**。

**修法**：替身要补齐校验，并注意两个细节：

1. **校验必须用编译后的标准 JSON Schema**。原始 DSL 里必填是每个属性上的 `required: true`，
   标准 schema 里是根部 `required: [...]` 数组——**拿 DSL 去校验会静默全过，一个字段都拦不住**（实测就是这样漏掉的）。
   编译一次、注册与校验共用同一个对象。
2. 官方那套 `validateJsonSchemaValue` 是**迭代式**（防深递归）；替身用递归就够——工具参数不会深。
   覆盖 `type` / `required` / `properties` / `additionalProperties` / `items` / `enum` + lossless 检查
   （`undefined`/`NaN`/`Infinity`/`-0` 都不合法）即可，报错风格对齐官方（`"路径" must be ...`）。

**别忘了一条**：`register(definition: ToolDefinition)` 收的就是**裸对象**，
`ToolSchema.parameters` 的类型是 `Record<string, unknown>`（注释：JSON Schema object）——
**自己拼标准 JSON Schema 是完全合规的**，`defineTool` 只是可选的语法糖。不见得非用它。

### E6. 桩测试全绿、真机一调就挂（三类原因，按出现频率排）

**现象**：`selftest` 通过、CLI 手动跑也正常，装进真实 `dsh web` 一调就出问题。
**根因**：桩测试证明的是**契约**，而下面三类差异只有真机才暴露：

| # | 差异 | 实例 | 为什么桩抓不住 |
|---|---|---|---|
| ① | **通道不同** | 宿主对工具返回值做 **lossless 校验**，桩/CLI 不做 | 桩用假参数调，走不到产出 `undefined` 的那条路径（见 A1） |
| ② | **桩不忠实** | 桩 `req` 没有 `socket.remoteAddress` | 带本机守卫的插件被一律 403，测了个寂寞（见 E2） |
| ③ | **接错了层** | 参数校验传的是**原始 DSL** 而不是编译后的 schema | 单测里手写标准 schema 所以全绿，一接真实管线一个字段都拦不住（见 E5） |

**修法（交付前必做的三件事）**：

1. **真宿主调一次工具** —— 不是脚本 `import` 后直接 `execute`，而是让 host 真的调它。这一条能抓住 ①；
2. **symlink 路径跑一次 CLI** —— `node <软链>/插件.mjs`。这一条能抓住入口守卫（见 C6）；
3. **面板点一遍** —— 刷新页面、点入口、切 Tab。这一条抓渲染期的问题。

> **共同点**：这三件事都"真机才能做"，所以最容易被跳过。
> **做不到时，必须在交付说明里标"未验证"**，不要写"完成"（见 E3）。

### E7. 自检污染真实数据

**现象**：跑几次自检后，用户的**真实数据**里多了一堆测试记录 / 测试账号。
**根因**：自检直接读写生产路径（`~/.dsh/xxx/...`），而开发期往往还没有隔离意识。
**修法**：让数据目录**可被环境变量覆盖**，自检在 import 之前把它指到临时目录：

```js
// 数据目录：默认 ~/.dsh/xxx，环境变量可覆盖
export function dataHome() {
  return process.env.MYAPP_HOME || path.join(os.homedir(), '.dsh', 'xxx');
}
```
```js
// 自检里：⚠️ 必须在 import 被测模块**之前**设置，所以要用动态 import
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'selfcheck-'));
process.env.MYAPP_HOME = TMP;
const { ... } = await import('../index.mjs');
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} });
```

**顺带的收益**：环境变量覆盖本身就是个有用的能力（多环境、CI、试用隔离）。

> 判断有没有隔离干净：跑一次自检，看**真实数据文件的条数/大小变没变**。变了就是没隔离。

### E8. 从**单个样本**归纳出的判据，最危险

**现象**：判据在手上这个样本上永远成立，换个样本就静默出错。

**三个实例（同一张脸）**：

| 判据 | 归纳自 | 换第二个样本后 |
|---|---|---|
| "蓝湖 Cookie 必须同时有 `user_token` + `PASSPORT`" | **一个**账号的 Cookie | 第二个账号**根本没有 `PASSPORT`**，直接被拒 |
| "用另一个账号试读，成功即归属" | 一个账号 + 一张假稿 | 实测**蓝湖不按账号隔离读稿**，任何账号都能读任何稿，"试读成功"证明不了归属 |
| "某接口一定返回 X 结构" | 一次响应 | 不同账号/不同版本返回少一个字段 |

**第四张脸（最隐蔽）：证据链被截断，却当成事实。** 一个报上来的"缺陷"是这样写实的 ——
"面板读取静默不完整：日志里那条链接**只有 `pid` 没有 `image_id`**，所以解析降级、块数缩水（158 vs 161）"。
复核时打开**原始** `usage.jsonl`：

1. 那条 url **`image_id` 齐全** —— 只是日志写入时把 url 截到了 120 字符，截断点正好落在 `image_id` **之前**，
   **看起来**"缺参数"。问题在日志，不在链接；
2. 再查那个 `image_id`：它属于**另一张稿**（375×1333 的"详情页"），而拿来对比的 161 块是 375×896 的"列表页" ——
   **两张不同的稿**，数字当然不同。

→ 一个"缺陷"由**两重误判**叠加而成，两条修改建议（"缺参数时提示链接不完整"）全都建立在不存在的前提上。
若照单全收，就会加一个**天天误报的假警报**。

**根因**：把**观察到的**当成了**规律**，而样本量是 1。

**还要防"会漂移的度量"**：同一张稿的块数会随解析改进变化（161 → 168），
**这种数字只能说明"有多少东西要核对"，不能当稳定性/完整性指标** —— 拿它做告警阈值必然误报。

**修法**：

1. **下判据时自问"这有几个样本支撑？"** —— 一个就该写成"待验证"，而不是写死；
2. **找反例比找正例值钱**：拿到第二个账号/第二份数据时，**第一件事是拿它去撞已有的判据**，
   而不是拿它跑通就收工（这次的第二个账号一撞就撞出两个 bug）；
3. **判据要"宽进严出"**：校验/解析放宽（只要有核心标识就接受），把严格性留给**真正要判定的那一步**；
4. **报缺陷/下结论前看原始数据**，不看摘要、不看被截断的日志副本 —— 摘要的截断点是**无声的**，它会把"完整"显示成"缺失"；
5. **对比两个数字前，先确认它们来自同一个主体**（同一张稿、同一次请求、同一个账号）；
   主体不一致时，数字差异**什么都不能证明** —— 这一步只花十秒，能挡掉一整类假阳性。

### E9. 自己代码注释里的实测结论，没读就动手

**现象**：改一个"显然"的地方，结果把已经跑通的功能整块打挂。

**实例**：给几何匹配加坐标换算时，我"想当然"地减掉了画板原点 ——
而 `flattenArtboard` 的注释里**早就写着实测结论**：

```
注：蓝湖给的子图层 frame 坐标是**相对画板原点**的（已验证：画板 left=-10279，子层 left=155.5）
```

也就是说坐标**本来就是相对的**，再减一次就错位（`16` 变成 `10295`），**全部匹配失效**。

**根因**：注释里的"实测/已验证/踩过"字样是**前人的血泪**，但被当成了普通说明跳过。

**修法**：

- 改某个函数之前，**先读它自己的注释**（尤其含"实测""已验证""注意""⚠️"的）；
- 自己写注释时**把"为什么"和"反例"写进去**（"不要减，实测画板 left 是 -10279，子层是相对值"），
  下一个 agent 才不会重踩；
- 报错/异常行为反常时，**先去注释里找答案**，往往已经有结论。


### E10. 「数据有、输出无」—— 排查先分层，别急着怀疑接口

**症状**：调用方反复说"这个字段读不到"，你去看接口和解析，值明明在。

**实例**（设计稿还原，来回返工好几轮）：`flattenArtboard` 产出的图层对象里
**既有** `opacity`（含父组累乘）**也有** `font.family`，但三张给模型看的文本表
（块表 / summary / region）**都只打印 尺寸·圆角·色值·字号字重**，把这两项丢了。
日常又默认用这三张表 → 那两项**等于不存在**：

- 半透明的"地图厚度层"被当成实心 → 做出两条生硬纯黑带；
- 正文字体全走系统兜底 → 观感和设计稿对不上。

**根因既不是 API 也不是解析，是渲染函数没把字段放进输出。**

**排查与修法**

1. **先分清是数据层还是输出层**：在解析现场 `console.log` 一个对象的全字段 ——
   值在 ⇒ 输出层问题；值不在 ⇒ 数据层问题。**别一上来就怀疑接口。**
2. **文本输出是「契约」，不是「调试打印」**：给模型看的表，**列 = 它能知道的一切**；
   表里没打的字段，模型就当它不存在。
3. **一个属性常有两个维度，只打一半等于没打**：
   `opacity`（图层）× 填充色 `alpha`；`font-size` × `font-family`；单色填充 × **多段渐变**。
4. **父级要累乘 / 继承**：`opacity` 与 `visible` 都得沿祖先链传递；
   扁平化时只读自身，就会把"组 50% 里的子层"报成 100%、把隐藏组里的子层照常列出。
5. **最隐蔽的一类：漏掉不会显得缺信息** ——
   渐变只打第一个 stop，表格里"有颜色"，看着挺完整，于是渐变被压成纯色，还原度悄悄掉。
   **"有值" ≠ "值完整"。**
6. **自检要断言"关键属性出现在文本输出里"**，而不只是断言数据结构正确 ——
   `renderXxx(...).includes('22/0.5')` 这种断言，才是这类缺陷的回归网
   （数据结构的断言会一直绿，因为数据层本来就是对的）。

> **同一份输出的第二层坑：截断。** region 表默认只列前 80 层，
> 711 层的稿子剩下 631 层**静默看不见**（"命中 711 层，只列前 80"缩在表头括号里）。
> 截断必须**参数可调**且**提示显眼**，否则调用方会以为"就这些" —— 与"输出无"是同一个病根。

### E11. 落了盘就算完事？产物要自带「能不能安全用」的元信息

**症状**：插件把文件下载/生成好了，调用方接手却踩坑 —— 而且往往**换个场景、过很久**才炸，
炸的时候根本联想不到是"产物少了一行信息"。

**实例**（设计稿切图）：`download_slices` 把切图存到本地 + `mapping.json`（url / 文件名 / 大小 / hash），
看着挺完整。但设计稿的整页背景是**半透明 PNG**
（实测 `7680×4320 RGBA`，**alpha 132~255**，衬底是画板 fill `#004687`）——
调用方"顺手"转成 JPG 上线 → 半透明光丝变不透明、深蓝衬底消失、**整屏发灰发白**。

最坑的是**肉眼验证不出来**：图片查看器默认把半透明合到**白底**，看上去像"设计稿本来就是浅色的"。
于是人以为"设计稿就长这样"，往错误的方向改了一轮。

**根因**：产物只回答了"这是什么文件"，没回答"**它有什么性质、能不能这么用**"。

**修法**

1. **落盘的同时记元信息**：尺寸、格式、`mode`、是否含 alpha、**alpha 范围**；
2. **顺手把结论也推出来**：别只写进 JSON —— 在人和模型**看得见的地方**打一行，
   并把**具体是哪些文件**列出来（"23 张含半透明"不如"这 3 张的 alpha 是 132~255"）；
3. **阈值要可判定**：`alphaRange: [132, 255]` 一眼能做决定；"可能含透明"这种措辞等于没说；
4. **保守即诚实**：解析不了就写"未解析"（`note`），**不猜**具体范围；
   未知字段一律 `null`（**别放 `undefined`** —— 宿主会拒收整个结果）；
5. **顺带补齐"空"的那一半**：同一批产物里 23 张 SVG 的 `mode` 若留空，
   等于一半文件没信息 —— 又回到「输出不完整」。认不出来的格式也要给个能用的标签（矢量图标 `vector`）。

> 判据：**调用方拿到产物后，能否在"不打开它"的前提下做出正确决策？**
> 只给路径和大小，等于把验证成本全推给下游，而下游往往没有你手上的那些上下文。

### E12. 比对类功能：**误报比漏报更致命**

**现象**：写了个"检查是否一致"的功能（设计稿 vs 页面、配置 vs 规范、schema vs 数据），
第一次跑出来一大片 ❌ —— 人看完就再也不信这份报告了，**哪怕里面混着一两个真问题**。

**实例**（字体族比对）：需求是"页面字体要和设计稿一致"。最直觉的写法是**字符串相等**：
设计稿 `Alibaba PuHuiTi 2.0` vs 页面 `"Alibaba PuHuiTi 2.0", -apple-system, "Microsoft YaHei", sans-serif` ——
**每一个正确的页面都会被判错**，因为页面 `font-family` 天生是**一个栈**，还带引号、大小写、`Family-Style` 写法差异。

**修法**

1. **先看"正常情况长什么样"**：写判定前先找 3~5 个**已知正确**的样本，让它们必须通过；
2. **归一化再判**：引号、空白、大小写、`Family-Style` 尾巴（`X-Regular` ≡ `X`）—— 少一条就误报一片；
3. **判据宽松但可解释**：设计稿字体**出现在页面栈前 3 位**即通过（而不是全等）——
   栈后面的系统回退字体本来就该在；
4. **留中间态**：存在但排太后 → 🟡（"存在但容易被盖住"），**别粗暴判 ❌**；
5. **建议要可抄**：`改成 font-family: <设计稿字体>, <当前前两位>` —— 报告的价值在**下一步动作**；
6. **不改变既有输出**：新能力用**加列/加字段**的方式接入，别悄悄改旧列语义（调用方零破坏）；
7. **"给人看的"和"给判定用的"必须是同一个东西**：表格里显示**短名**（`Alibaba PuHuiTi 2`）、
   判定却拿**原名**（`Alibaba PuHuiTi 2.0`）去比 —— 用户**照着你自己的输出抄**，反而被判 ❌，
   还收到「改成 `…2.0, …2`」这种把同一字体列两遍、等于没改的建议。
   **输出的可抄性 = 判定的等价性**：归一化必须覆盖你自己的显示变换（去掉的 `.0`、截断的 `…`、缩写），
   并且**只为这一处放宽** —— `Alibaba PuHuiTi`（v1）与 `Alibaba PuHuiTi 2.0`（v2）是不同字体，不能顺手合并
   （放宽与收紧都要有断言：一条证明"照抄能过"，一条证明"v1 不会被并到 v2"）。

> 漏报只是"没发现"，误报是"**把对的判成错的**" —— 后者会让人改错代码、并放弃这个工具。
> 一句判据：**宁可 🟡，不可假 ❌。**

### E13. 进不去真实 GUI 时，用「离线渲染审计」代替"看着还行"

**现象**：改了客户端 `client.js`，想验证"面板在浅色/深色下到底能不能看"，但**进不去真实界面** ——
`dsh web` 的启动令牌只在进程内（`?token=` 换一次签名 Cookie），自动化拿不到；截图只能靠人眼看，说不出数值。

**修法**：拼一个**离线页面**，把真实运行时的三样东西搬进去：
1. **真的 React UMD 构建**（不是自己写的假组件）；
2. **官方主题令牌 CSS**（从 `dsh-client-ui-theme` 抠出 `design_platform_css_default`，注入 `<style>`）；
3. **真实接口数据**（把插件真实调用拿到的 JSON 落盘，`fetch` 用桩**按 path** 回放，并保留 `content-type`）。

再用插件**真实打包产物**的加载协议把 `client.js` 挂上去（本项目是 `window.__ModuleLoader__.load({id, factory})`，
**不是 ESM**），然后渲染出面板。

**两个坑**：
- `createRoot(document.body)` 会**清空整个 body**（把搭好的容器一起干掉）—— 先建独立容器再挂；
- `fetch` 桩要按 path 分发，别只按方法。

**产出**：能**逐项量**（对比度 / 尺寸 / 滚动容器数 / 表格是否溢出），并出**改前改后对比图**。
本项目靠它量出暗色下主按钮 **1.05:1**（白底白字，等于看不见）—— 这种事"看着还行"永远发现不了。

## F 类：写面板（槽位路线 + 手写 CJS）的坑

> 这一批来自 `dsh-lanhu` 的三 Tab 面板（手写 CJS 表 + `ctx.slots` 注册，零构建）。
> D 类是 DOM 注入路线特有，这里是**槽位路线**特有的。

### F1. React key 用"数据里的名字" → 同名条目重复 key

**现象**：控制台告警 `Encountered two children with the same key`，并提示
`may cause children to be duplicated and/or omitted`；列表出现错位、展开态串行。

**根因**：拿业务字段当 key（如"设计稿的图层路径"）—— 业务数据里**同名兄弟节点是常态**
（实测一张蓝海稿里有十几条都叫 `Background+Border`），key 必然重复。

**修法**：构造数据时**给每条一个稳定唯一的 id**（自增序号即可），key 与"展开/选中"状态都用它。
不要用"名字 + 下标"凑——下标会随筛选变化，展开态会跳。

> 这个 bug **静态检查发现不了**，只有真渲染（或 jsdom 真渲染）才会报出来。

### F2. 一个子组件抛错会拖垮**整个壳**

**现象**：面板某个分支渲染时抛错 → 整个 GUI 白屏 / 不可用。
**根因**：Client 半边跑在壳的 React 树里，**没有错误边界**，异常会一路上抛。
**修法**：给每个 Tab / 每个面板块套一个自己的错误边界（`getDerivedStateFromError`），
失败时降级成一行可读提示 —— **宁愿少一个 Tab，不能让用户打不开界面**。

### F3. `localStorage` 在隐私模式 / 沙箱里会**抛异常**

**现象**：某个用户反馈"面板打不开"，你这里一切正常。
**根因**：`localStorage` 在隐私模式、`file://`、沙箱 iframe 里访问即抛（不是返回 null）。
**修法**：所有读写包 `try/catch`，失败就**降级成内存变量**：

```js
const store = (() => {
  const mem = {};
  return {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? (mem[k] ?? d) : v; } catch { return mem[k] ?? d; } },
    set(k, v) { mem[k] = v; try { localStorage.setItem(k, v); } catch {} },
  };
})();
```

**另外**：**大对象不要往 localStorage 塞**（配额 5MB 且同步写会卡）。
面板里存"用户输入的草稿"就够了，**结果数据别存**。

### F4. 大列表全量渲染会卡

**现象**：几百条数据的清单，面板一打开就卡顿、输入框掉帧。
**修法**：**默认只渲染前 N 条 + 「显示更多」按钮**，筛选/搜索在**数据层**做（不要渲染完再 CSS 隐藏）。
阈值参考：60 条左右起步，用户点一次加一倍。

### F5. 面板定位别用 `right`（会把面板甩到屏幕另一头）

**现象**：面板贴着侧栏入口才是对的，用 `right` 定位会跑到窗口右边。
**修法**：记住入口按钮的 `getBoundingClientRect()`，用 `left` 对齐它、`bottom` 停在它上方。
（入口在侧栏底部时，`right` 与 `left` 语义完全不同。）

### F6. `overflowX` 会把 `overflowY` **隐式**变成 `auto`

**现象**：只想让表格横向滚动，面板上却**多出一条纵向滚动条**，内容还被裁得莫名其妙。

**根因**：`overflow-x` 与 `overflow-y` 只要有一个不是 `visible`，另一个若为 `visible` 就会被**计算成 `auto`**。
所以只写 `overflowX:'auto'` 等于纵轴也 `auto`。

**修法**：横向滚动容器**显式**写 `overflowY:'hidden'`（反之亦然）。
并在离线审计里**断言"面板内滚动容器数"** —— 多一个就说明这里又漏了。

### F7. 表格 `width:'100%'` 会**压列**，而且**不触发滚动**

**现象**：表格内容溢出、末列右边界跑到面板外（实测：表盒 432 / 内容 500 / 末单元格右边界 524，面板只有 470），
但**横向滚动条不出现** —— 因为"宽度就是 100%"，溢出部分被挤掉而不是撑开。

**修法**：`width:'max-content'` + `minWidth:'100%'`，让表格**按内容撑开**、容器负责滚动。
（纯 `100%` 只适合内容一定放得下的场景；放不下时它会安静地骗你。）

### F8. flex 列里的表单控件要 `flex:'none'`

**现象**：textarea 在面板里被压成 **12px 高**，几乎看不见。

**根因**：父容器 `display:flex; flexDirection:column` 时子项默认 `flex-shrink:1`，
空间不够时**文本框会被压**（它不像按钮有 min-height 撑着）。

**修法**：flex 列里的表单控件写 `flex:'none'`（要能长高的用 `flex:'1 1 auto'` + `minHeight`）。
textarea 自增高配 `rows` + `maxHeight` 上限 + `overflowY:'auto'`，别只靠 `rows`。
