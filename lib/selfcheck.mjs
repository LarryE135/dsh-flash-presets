/**
 * dsh-flash-presets 宿主层自检插件（bundle patch 插入 `flash-presets-selfcheck` 行）。
 *
 * 职责：profile 启动后校验三个预设行是否进入组合、关键配置键是否齐备、以及
 * agent-preset-registry 是否把某个预设标记为 broken（配置键在已装 DSH 上失效时
 * mount 会失败，registry 会把失败原因留在 roster 的 broken 字段）。
 *
 * 设计红线：
 *  - 零 inject：所有服务都经 ctx.get() 动态读取，服务缺失（如 0.1.x 没有
 *    agentPresets）时静默降级，绝不阻断 profile 启动。
 *  - 只写日志，永不 throw。
 *  - 用户可在 profile 补丁层关掉它：
 *      - id: flash-presets-selfcheck
 *        disabled: true
 */

const EXPECTED = {
  'compaction-basic': ['thresholdRatio', 'retainTokens', 'compactionRetries'],
  'tool-result-pruner': ['thresholdChars', 'headChars', 'tailChars'],
  'tool-presentation': ['mode'],
};

const DEFAULT_PRESETS = ['flash-lean-ptc-v1', 'flash-lean-ptc-v2', 'flash-lean-ptc-v3'];

function rowsOf(plugins, out = []) {
  for (const row of plugins || []) {
    if (!row || typeof row !== 'object') continue;
    if (row.id) out.push(row);
    if (Array.isArray(row.config)) rowsOf(row.config, out);
  }
  return out;
}

export default class FlashPresetsSelfcheck {
  constructor(ctx, config) {
    this.ctx = ctx;
    this.config = config || {};
    this.presets = Array.isArray(this.config.presets) && this.config.presets.length > 0
      ? this.config.presets
      : DEFAULT_PRESETS;
    // 延后到宿主树就绪后再跑；任何失败都被吞掉。
    Promise.resolve()
      .then(() => this.run())
      .catch((error) => this.log('error', 'selfcheck 自身失败（不影响启动）: ' + String(error && error.message ? error.message : error)));
  }

  log(level, message) {
    const text = '[dsh-flash-presets] ' + message;
    let logged = false;
    try {
      const logger = this.ctx && this.ctx.logger;
      if (logger && typeof logger[level] === 'function') { logger[level](text); logged = true; }
    } catch {
      /* 继续走 stderr 兜底 */
    }
    // 发现问题时双写 stderr：headless 等形态下 logger 的输出可能不可见，
    // 自检结果必须能被操作者看到。
    if (!logged || level === 'error' || level === 'warn') {
      try { process.stderr.write(text + '\n'); } catch { /* 彻底静默 */ }
    }
  }

  get(name) {
    try {
      return this.ctx.get(name);
    } catch {
      return undefined;
    }
  }

  async run() {
    const loader = this.get('loader');
    if (typeof process !== 'undefined' && process.env && process.env.DSH_FLASH_PRESETS_DEBUG === '1') {
      try {
        const probe = [];
        for (const e of (loader && loader.entries ? loader.entries() : [])) {
          const id = e && (e.id || (e.options && e.options.id));
          probe.push(String(id));
          if (probe.length >= 12) break;
        }
        this.log('error', 'debug: loader=' + String(loader ? 'present' : 'absent') + ' first ids: ' + probe.join(', '));
      } catch (err) {
        this.log('error', 'debug: loader iteration failed: ' + String(err && err.message));
      }
    }
    if (loader && typeof loader.await === 'function') {
      try {
        await loader.await();
      } catch {
        /* 等待宿主树稳定失败时继续做静态检查 */
      }
    }

    const problems = [];
    let entries = [];
    try {
      entries = (loader && typeof loader.entries === 'function' ? loader.entries() : []) || [];
    } catch {
      /* 拿不到 entries 时退回 registry 检查 */
    }
    const byId = new Map();
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      // 树条目的 .id 可能带 'include:' 前缀（cordis-plugin-include 的命名），
      // 真实 id 在 options.id；优先取 options，再回退裸 id。
      const id = (entry.options && entry.options.id) || entry.id;
      const cfg = entry.config || (entry.options && entry.options.config);
      if (id) {
        byId.set(id, { disabled: entry.disabled, config: cfg });
      }
    }

    // 1) 静态：我们的 preset 行是否在组合里、关键配置键是否齐备。
    for (const presetId of this.presets) {
      const rowId = 'preset-' + presetId;
      const entry = byId.get(rowId);
      if (!entry) {
        problems.push(`${rowId} 行未进入组合（bundle 已选中但该行被覆盖/删除）`);
        continue;
      }
      if (entry.disabled === true) {
        this.log('info', `${rowId} 已被用户显式停用，跳过检查`);
        continue;
      }
      const plugins = entry.config && entry.config.plugins;
      if (!Array.isArray(plugins)) {
        problems.push(`${rowId} 缺少 config.plugins`);
        continue;
      }
      const rows = rowsOf(plugins);
      for (const [pluginId, keys] of Object.entries(EXPECTED)) {
        const row = rows.find((r) => r.id === pluginId);
        if (!row) {
          problems.push(`${presetId}: 缺少 ${pluginId} 行`);
          continue;
        }
        const cfg = row.config || {};
        for (const key of keys) {
          if (!(key in cfg)) problems.push(`${presetId}: ${pluginId} 缺少配置键 ${key}`);
        }
      }
    }

    // 2) 动态：agent-preset-registry 的 broken 状态（配置键失效时 mount 失败会记在这里）。
    const agentPresets = this.get('agentPresets');
    if (agentPresets && typeof agentPresets.list === 'function') {
      try {
        const roster = (await agentPresets.list()) || [];
        for (const presetId of this.presets) {
          const row = roster.find((r) => r && (r.id === presetId || r.id === 'preset-' + presetId));
          if (!row) {
            problems.push(`预设 ${presetId} 未注册进 agent-preset-registry`);
            continue;
          }
          if (row.broken) problems.push(`预设 ${presetId} 挂载失败（broken）：${row.broken}`);
        }
      } catch (error) {
        this.log('warn', '无法读取 agent-preset-registry 状态: ' + String(error && error.message ? error.message : error));
      }
    }

    if (problems.length === 0) {
      this.log('info', `selfcheck OK（${this.presets.join('/')} 已挂载，配置键齐备）`);
      return;
    }
    for (const problem of problems) this.log('error', 'selfcheck 发现问题：' + problem);
    this.log('error', `selfcheck 发现 ${problems.length} 个问题。多数情况是 DSH 版本与预设不匹配：请升级本包或调整 DSH 版本（engines.dsh 要求 ${this.config.dshRange || '见 package.json'}）。详见 https://github.com/LarryE135/dsh-flash-presets#known-issues`);
  }
}
