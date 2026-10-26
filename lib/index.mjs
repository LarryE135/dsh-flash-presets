/**
 * dsh-flash-presets 以 DSH 组合包（dsh.bundle + cordis.patch.yml）形式交付：安装时向
 * profile 的插件列表插入 @deepseek-ai/dsh-agent-preset 行，宿主在运行时不需要加载本包的
 * 任何代码。这个模块只是给包一个合法的运行时入口（main/exports 指向真实文件并导出
 * apply），apply 是空实现。
 */
export function apply() {}
