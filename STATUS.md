# 验证状态与边界

2026-10-09，v0.5.1 公开试用版。

v0.5.1 新增 GitHub 仓库地址安装入口，复用 v0.5.0 的迁移功能源码。两种入口共用本地备份；扩展不会自动导入脚本、修改聊天、发起模型请求或改变角色卡规则。

## 已检查

- v0.5.1 共 139 项离线检查通过，无失败、无跳过，覆盖解析、AI 方案、变量编辑、备份写入、恢复、并发保护、界面状态、拖动和扩展启动；包含现有 Zod 4 的静态子集对照。
- 原版模拟宿主完成提取、编辑、模拟 AI 分析、写入、恢复、新版文件替换及清空流程。320/390px 预览没有横向溢出。
- 扩展入口另检查延迟启动、缺少酒馆助手、依赖恢复、重复入口、停用、页面退出和启动失败后的重试。
- 扩展入口在模拟浏览器中完成旧变量读取、新版资料读取、模拟分析、备份写入及读回；停用后入口移除，重新启用后本地备份仍可见。本次页面未捕获到错误或警告。
- JSON 脚本、打包 JS 与维护源通过生成同步检查；安装清单及生命周期导出接受独立静态校验。

## 尚未验证

- 真实酒馆通过扩展管理器安装、加载、停用和卸载。
- 真实脚本导入、实际模型调用、下一轮 MVU 更新、重载持久化及玩家手机。
- 模拟响应式页曾出现来源未确认的 `MutationObserver.observe` 类型异常；未发现本项目直接调用，仍不能宣称控制台零错误。

结构检查只覆盖受支持的 Zod 4 静态子集，不能证明任意转换函数、动态源码或自然语言更新规则全部满足。AI 方案需由玩家核对；代码不会执行 AI 生成的 JS 或 SQL。

## 安装接口依据

固定源码核对日期为 2026-10-09，不代表玩家实际安装版本：

- 酒馆助手 4.11.3：[导入入口](https://github.com/N0VI028/JS-Slash-Runner/blob/ed8b2360b32d9cfb96770d44e5c4ae45c2071a86/src/panel/script/Toolbar.vue) 使用 JSON 文件选择器；导入后停用并重新分配 ID。
- 同版[初始化入口](https://github.com/N0VI028/JS-Slash-Runner/blob/ed8b2360b32d9cfb96770d44e5c4ae45c2071a86/src/index.ts)与[全局 API](https://github.com/N0VI028/JS-Slash-Runner/blob/ed8b2360b32d9cfb96770d44e5c4ae45c2071a86/src/function/index.ts)：宿主的 `TavernHelper` 提供迁移所用接口。
- SillyTavern 1.19.0：[扩展加载与生命周期](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/extensions.js)与[宿主上下文](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/st-context.js)。扩展入口在 `activate` 中安排后续启动，使用 `APP_READY` 补一次检测，停用/卸载通过 `deactivate` 清理自身运行实例。

缺少必需接口时显示重试入口，不执行迁移；不凭酒馆助手的安装目录名称判断可用性。扩展不设置模型回复等待上限。
