# dsh-llm-gemini

为 DSH 模型设置中的「自定义模型 API」增加 Gemini 原生协议 `google-generative-ai`。插件调用 pi-ai 已有的 Google 原生实现，沿用 DSH 的流式输出、工具调用、凭据引用与思考签名回放。

许可证：MIT。适配版本：DSH `0.2.2-rc.1`、pi-ai `1.5.0`。

## 使用

接入后，打开「设置 → 模型 → 添加模型提供商 → 自定义模型 API」，API 协议下拉框会多出：

```text
google-generative-ai
```

这是 Gemini 原生协议的标准标识。官方界面对新增协议显示其标识；现有三个选项的名称与顺序保持不变。

官方 Gemini 原生基础地址为 `https://generativelanguage.googleapis.com/v1beta`。第三方提供商需要实际支持 Google 原生请求格式；仅提供 OpenAI 兼容端点的服务使用对应的 OpenAI 协议。

在界面中输入密钥、模型 ID，并按模型能力选择图片输入和思考档位。插件从凭据服务读取密钥，配置示例只写引用：

```yaml
providers:
  my-gemini:
    api: google-generative-ai
    baseURL: https://generativelanguage.googleapis.com/v1beta
    apiKeyEnv: MY_GEMINI_API_KEY
    models:
      - id: gemini-3-flash-preview
        input: [text, image]
        reasoningEfforts:
          low: low
          high: high
```

这是 `llm-pi-ai` 配置片段。模型 ID 是示例，应替换为端点实际提供的模型。模型列表获取支持原生认证、分页、名称及输入/输出 token 上限，并过滤纯嵌入模型。

## 本地软链接接入

从仓库根目录执行。已有依赖时可直接运行安装脚本；离线开发可先把依赖链接到本机安装的 DSH：

```bash
node scripts/link-installed.mjs "$(dirname "$(dirname "$(realpath "$(command -v dsh)")")")"
node scripts/link-profile.mjs --profile web
```

也可以把已安装的 DSH 包目录通过 `DSH_RUNTIME_ROOT` 传给 `scripts/link-installed.mjs`。脚本校验 DSH 与 pi-ai 版本。

`link-profile.mjs` 以当前仓库位置计算相对路径，登记以下链接：

| 位置 | 作用 |
| --- | --- |
| `~/.dsh/plugins/dsh-llm-gemini` | 用户插件目录 |
| `~/.dsh/profiles/web/node_modules/dsh-llm-gemini` | 插件包与 bundle |
| `~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-llm-pi-ai` | 将原有适配器入口解析到扩展实现 |

脚本在 profile 的 `package.json` 和现有 `pnpm-lock.yaml` 中登记两个相对 `link:` 依赖，并添加插件 bundle。修改前的登记文件备份到该 profile 的 `.plugin-manager/backups/`。脚本可重复执行，遇到其他适配器的现有链接会拒绝覆盖。

**完成接入后重新启动该 profile 的 DSH 进程。** DSH 将新增的核心包本地覆盖视为需要重启的解析变更，刷新网页无法替换进程中已经加载的模块。无需修改服务商配置或重新录入密钥。

`--profile` 可以指定其他 profile；`--home` 或 `DSH_HOME` 可以指定 DSH home。脚本只处理指定 profile。

卸载本项目登记，随后重新启动 DSH：

```bash
node scripts/link-profile.mjs --profile web --remove
```

卸载恢复接入前的相关依赖和 bundle 状态，只移除本次创建的链接。已有提供商配置仍保存在原来的 `llm-pi-ai` 条目中；其中使用新增协议的路由需要改用可用协议或停用。

## 实现

官方适配器没有公开的协议注册接口。`src/adapter.mjs` 来自官方 MIT 发行包，只增加 Google 原生协议工厂及其模型列表分派；具体模型请求仍由 pi-ai 的 `googleGenerativeAIApi()` 执行。上游哈希和差异保存在 `vendor/`，方便升级时核对。

Cordis bundle patch 的 `name` 是匹配条件，不支持给已有条目改名。本项目使用 DSH 原有的 profile 本地包解析机制：原条目 ID、模块说明和 `llm-pi-ai` 设置命名空间不变。`cordis.patch.yml` 因此是空的登记层。官方模型页面直接读取扩展后的后端配置 schema，无需复制前端页面。

本项目不修改全局 DSH 安装文件，不提供 OpenAI 与 Gemini 的额外转换网关。

## 验证

```bash
npm run check
npm test
```

测试使用本机 loopback 模拟端点和临时 profile，验证：

- 下拉框所依赖的序列化 schema 接受新增协议，同时保留原有三种协议。
- 自定义路由通过 Google SDK 发送原生流式请求，传递头部、工具及思考档位。
- 工具调用签名经过 JSON 持久化、重建适配器后仍回传到下一轮。
- 原生模型列表认证、分页、去重及 token 上限；原有 OpenAI 列表行为。
- 真实 Cordis/LLM 挂载、卸载与替换，官方 profile 解析及本地包覆盖。
- 相对软链接接入、重复执行和卸载，已有 profile 配置保持一致。

测试无需真实 API key，不产生模型推理费用。真实云端模型及第三方网关仍须使用对应账号实际验收。

[上游与许可证](docs/UPSTREAM.md) · [隐私约定](docs/PRIVACY.md)
