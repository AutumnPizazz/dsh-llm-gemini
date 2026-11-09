# 上游记录

- 仓库：https://github.com/deepseek-ai/deepseek-harness
- 来源：`@deepseek-ai/dsh-llm-pi-ai@0.2.2-rc.1` 的 `lib/index.js` 与 `locale/`
- 许可证：MIT，完整声明见仓库根目录的 `LICENSE` 与 `NOTICE`
- 原始适配器 SHA-256：见 `vendor/upstream.json`
- 适配器改动：见 `vendor/llm-pi-ai.patch`
- 原生请求实现：`@earendil-works/pi-ai@1.5.0` 的 `api/google-generative-ai.lazy`

适配器差异只包含 Google 原生 API 工厂导入、协议表新增项、模型发现分派及相关注释。新增的 `src/google-discovery.mjs` 处理 Google 模型列表的认证、分页和字段映射，沿用上游的响应体长度限制与凭据校验。

升级 DSH 或 pi-ai 时，需要重新核对 schema、适配器入口、签名回放及运行时解析机制，并更新版本与原始哈希。当前声明只覆盖已验证版本。

参考：

- [Google Gemini API](https://ai.google.dev/gemini-api/docs)
- [Google Models API](https://ai.google.dev/api/models)
- [Google thought signatures](https://ai.google.dev/gemini-api/docs/thought-signatures)
