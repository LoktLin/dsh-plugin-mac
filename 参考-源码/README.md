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
