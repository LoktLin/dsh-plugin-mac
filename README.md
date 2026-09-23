# dsh-plugin-mac

> 一个 DSH（DeepSeek Harness）技能：把「给自己加一个插件」做成**能装上、能验证、能被别人复用**的东西。

**macOS 专用**（单机实践固化）· 适用于 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH）Web GUI · Apache-2.0

---

## 它解决什么

DSH 的扩展有好几种形态（插件包 Host 半边 / Client 半边 / 动态 Cordis 插件 / agent preset / 技能），**选错会白干**；
而插件包本身有一批**「写错了不报错、只是静默不生效」**的地方 —— 补丁 id 对不上、`exports` 路径不存在、槽位名拼错、
客户端 `apply` 抛错、Host 改了没重启……`apply()` 从未执行却毫无提示是常态。

这个技能把整条链路的**契约、坑与自检脚本**固化下来：选形态 → 生成骨架 → 写两半边 → 挂载 → 分层验证。

## 安装

```bash
git clone <本仓库地址> ~/.dsh/skills/dsh-plugin-mac
```

DSH 启动时按 `~/.dsh/skills/<名字>/SKILL.md` 识别技能（**目录名即技能名**，两段路径），无需其它注册。

## 里面有什么

| 路径 | 是什么 |
|---|---|
| `SKILL.md` | 技能本体：五步流程（取证 → 骨架 → Host → Client → 挂载）+ 生效边界表 + 排障表 + 升级工作流 |
| `references/contracts.md` | 官方契约：槽位全目录、`webServer` 路由、工具声明、`dsh.client` 字段 |
| `references/lightweight-path.md` | A 路线（无构建、纯 DOM 注入）逐层解剖，含 DOM 自愈与主题合成 |
| `references/standard-path.md` | B 路线（TS + tsdown + React + 槽位）完整写法 |
| `references/pitfalls.md` | 实测坑清单，八类：装配期 / 静默失效 / 壳起不来 / 改了不生效 / DOM 注入 / 开发流程 / 写面板 |
| `references/ecosystem.md` | 官方包地图与社区插件（可抄什么） |
| `references/core-update.md` | DSH 本体升级后的六步契约兼容工作流 |
| `references/used-apis.md` | 我们依赖的官方 API 清单：谁在用、失效后果、怎么 feature-detect |
| `scripts/scaffold.mjs` | 生成插件骨架（两半边 + 声明 + 模板） |
| `scripts/selftest.mjs` | 桩自检：不碰真实 `dsh web`，验证两半边契约（两条路线都认） |
| `scripts/probe-contracts.mjs` | 契约探针：对比基线，报出槽位增删与契约翻转 |
| `scripts/test-skill.mjs` | 技能自身自检（探针与它的文档） |
| `scripts/dump-theme-tokens.mjs` | **主题令牌核对**：抠出官方真实令牌，标出代码里**名字写错**的令牌 |
| `assets/templates/` | 脚手架产物模板（`index.js` / `client.js` / `cordis.patch.yml` / `package.json` …） |

> **不随仓库发布**（已加入 `.gitignore`）：
> `参考-源码/` —— 本机的插件源码目录（含独立仓库，体积大）；
> `evals/` —— 技能评测用例（含内部开发路径）。

## 几个常用命令

```bash
node scripts/test-skill.mjs                 # 技能自身自检
node scripts/scaffold.mjs dsh-mytool        # 生成插件骨架
node scripts/selftest.mjs --plugin <插件目录>  # 桩自检：验证两半边契约
node scripts/probe-contracts.mjs --scan <插件目录>  # DSH 升级后的契约检查

# 令牌名写错不会报错，只会静默走 fallback —— 这条能扫出来：
node scripts/dump-theme-tokens.mjs --scan <插件目录>
```

## 两条最容易吃亏的边界

- **Host 半边是启动时的快照**：改了 `index.js` / `lib/*.mjs` **必须重启 `dsh web`**；只改 `lib/client.js` 刷新页面即可。
- **面板没有的功能 ≠ 工具没有**：AI 看到的是**工具 schema**，那才是唯一真身。

## License

[Apache-2.0](LICENSE)
