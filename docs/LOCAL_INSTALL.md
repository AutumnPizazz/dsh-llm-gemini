# 本地接入验证

本次接入的目标为已有 `web` profile。仓库位置按开发约定为 `~/git_program/dsh/dsh-llm-gemini`；仓库与 profile 的新增登记使用相对路径。

- 已创建用户插件目录、profile 插件包及官方适配器包别名三个软链接。
- 官方 profile 加载器识别新增 bundle，跳过的 bundle 为 0。
- 接入前后，既有组合告警均为 24 条，内容完全相同。
- 原有 `llm-pi-ai` 条目及其配置、profile 的 `cordis.patch.yml`、全局安装的官方适配器文件均保持一致。
- 新建隔离进程，使用官方 `PluginPackages` 与 Cordis `Loader` 解析实际 profile，确认原适配器入口解析到本插件，配置 schema 提供第四个协议 `google-generative-ai`。
- 原有提供商配置可通过扩展适配器的配置校验。
- 12 项自动化测试通过；覆盖原生流式请求、工具调用签名持久化回放、模型列表、配置兼容以及相对链接安装/卸载。
- 打包检查排除了依赖目录、测试产物和 Git 元数据。

登记文件备份保存在目标 profile 的 `.plugin-manager/backups/`，不纳入仓库。本次没有重新启动正在运行的 DSH。重新启动该 profile 的进程后，新下拉框选项才会出现在实际页面中。

验证使用隔离合成凭据与 loopback 模拟服务，没有调用真实 Gemini 云端模型。
