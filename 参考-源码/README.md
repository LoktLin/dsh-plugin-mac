# 参考-源码/

**这个目录放你自己的插件源码 —— 本仓库不含它的内容**（`.gitignore` 忽略了它，只放行本文件）。

理由有两条：里面是**本机的活代码**（含各自独立的 git 仓库），而且体积大（本机实测 32 MB）。

## 约定

技能里的一条约定（见 `SKILL.md` §1）：**新写的插件包一律放这一层** ——

```
~/.dsh/skills/dsh-plugin-mac/参考-源码/<包名>/
```

`scripts/scaffold.mjs` 默认就往这里输出（目录不存在会自动建）：

```bash
node scripts/scaffold.mjs dsh-mytool      # → 参考-源码/dsh-mytool/
```

## 本机那份里还有什么

技能作者自己那份里，还放着一批**已单独开源**的插件，作为**只读参照**（未安装、也不建议装）：

| 目录 | 仓库 | 用途 |
|---|---|---|
| `dsh-eggy/` | [LoktLin/dsh-eggy](https://github.com/LoktLin/dsh-eggy) | A 路线（无构建、纯 DOM 注入）的完整范例 |
| `dsh-lanhu/` | [LoktLin/dsh-lanhu](https://github.com/LoktLin/dsh-lanhu) | B 路线（槽位 + React）的真实实现 |

它们**不会**随本仓库发布 —— 想看代码直接去上面的仓库。

## 第三方参考（只读，非本人作品）

| 目录 | 仓库 | 许可 | 拿它当什么参考 |
|---|---|---|---|
| `lanhu-mcp/` | [dsphper/lanhu-mcp](https://github.com/dsphper/lanhu-mcp) | **MIT**<br>`Copyright (c) 2025 Lanhu MCP Server Contributors` | 社区第三方**蓝湖 MCP**（Python + FastMCP，~7000 行主文件 + `lanhu_design/` 分层包 + 12 个测试文件）。价值在于：它多读了三个接口（`/api/project/product_documents` 产品文档、`/api/project/multi_info`、另域 `dds.lanhuapp.com` 的 `/api/dds/image/store_schema_revise`），并有几段可移植的小算法（固定版本选择、字体需求聚合、切图密度判定、几何间距） |

> ⚠️ **它同样是拿浏览器 Cookie 访问非官方接口**（`LANHU_COOKIE`），DDS 那条还用了硬编码 Basic auth + 独立 Cookie
> —— 与官方无关、随时可能失效，**只能当参考，不要当稳定契约**。
>
> MIT 允许商用/修改/再分发，**义务是保留版权声明与许可声明**：本技能的代码若直接搬运了它的实现，
> 需在该文件头或 `NOTICE` 里保留上面那行版权。
> （功能、算法思想、接口形状本身不受版权保护，**独立实现无需声明**。）

