/**
 * 把预设源文件里的 `!!js <expr>` 标签解析成具体布尔值。
 *
 * 为什么要有这一步：`!!js` 是 DSH 加载器自己的 YAML 标签，不是标准 YAML。
 * 任何普通解析器（js-yaml / yamllint / GitHub 预览 / 第三方插件工具）都会在它上面报错，
 * 而报错信息长这样：
 *   could not determine a constructor for the tag 'tag:yaml.org,2002:js'
 * 这会让"配置文件坏了"看起来像"插件坏了"，是排查时最容易走偏的一步。
 *
 * 因此：源文件保留 `!!js`（一份源、两种平台，安装时才定型），
 * 安装脚本与医生工具在写盘前调用本模块，落盘的 profile 补丁里只有 true / false。
 */
const TAGS = [
  {
    re: /^(\s*)disabled: !!js process\.platform === 'win32'\s*$/gm,
    want: platform => platform === 'win32',
    note: "tool-bash：Windows 上禁用",
  },
  {
    re: /^(\s*)disabled: !!js process\.platform !== 'win32'\s*$/gm,
    want: platform => platform !== 'win32',
    note: "tool-pwsh：非 Windows 上禁用",
  },
];

export function resolvePlatformTags(text, platform = process.platform) {
  let out = text;
  for (const tag of TAGS) out = out.replace(tag.re, (_m, indent) => indent + 'disabled: ' + tag.want(platform));
  const leftover = out.match(/!!js[ \t]+[^\n]*/);
  if (leftover) {
    throw new Error('遇到不认识的 !!js 表达式，未做平台解析：' + leftover[0].trim() +
      ' —— 请在 lib/platform-tags.mjs 里登记它，否则写进 profile 的补丁会被普通解析器判为坏文件');
  }
  return out;
}

export function hasPlatformTags(text) {
  return /!!js/.test(text);
}

export function describeTags() {
  return TAGS.map(t => t.note);
}
