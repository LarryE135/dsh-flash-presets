// 历史 preset id 的解析兜底（独立插件入口）。
//
// 为什么要单独一行：第五轮审计 T1-1 —— 别名层原来挂在 plan-mode-ui 那一行上，而它的 inject 里有
// webServer；桌面端（Electron）与无 web 的组合里那一行会停在 pending，别名层跟着不存在，于是
// 「0.2.6–0.2.8 建的 -lite 会话」在桌面端照样打不开。这里只 inject agentPresets，任何宿主都能加载。
//
// 对应 cordis.patch.yml 里的一行：
//     - id: flash-presets-alias
//       name: 'dsh-flash-presets/alias'
import { schedulePresetAliases } from './preset-alias.js';

export default {
  name: 'dsh-flash-presets/alias',
  inject: ['agentPresets'],
  apply(ctx) {
    schedulePresetAliases(ctx, { verbose: true });
  },
};
