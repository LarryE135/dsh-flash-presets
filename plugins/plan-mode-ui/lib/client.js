window.__ModuleLoader__.load({
  id: "dsh-plan-mode-ui",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var React = require("react");

    var API = "/api/plan-mode/state";
    var BLUE = "#4074e4";
    var BLUE_DARK = "#4074e4";
    var BUILD = "v45";
    var STYLE_ID = "pmo-style-" + BUILD;

    // 动画状态：原生计划模式进行中 → 书写态；否则用本插件自己的阶段。
    // 单独抽出来是为了能被测试直接断言（不依赖 React 渲染栈）。
    // 四态：off（未启用） / armed（已启用、空闲） / planning（回合在跑） / executing（批准后执行）
    // 权威值来自服务端 state.indicator；旧服务端没有该字段时按 native/phase 兜底。
    function glyphPhase(s) {
      var o = s || {};
      if (typeof o.indicator === "string" && o.indicator.length > 0) return o.indicator;
      if (o.native === true) return "planning";
      return o.phase === "planning" || o.phase === "executing" ? o.phase : "idle";
    }

    // 四态对应的无障碍文案（图标本身只有形状与运动差异）
    // 有状态时的短标签：官方「计划」胶囊被我们隐藏后，这层信息得由我们补回来，
    // 否则"计划模式开着"在界面上完全不可见（只剩一枚 15px 图标）。
    function phaseText(p) {
      if (p === "planning") return "计划中";
      if (p === "executing") return "执行中";
      if (p === "planned") return "已计划";
      if (p === "armed") return "计划";
      return "";
    }
    function phaseLabel(p, s) {
      if (p === "planning") return s && s.native === true ? "（原生计划模式进行中）" : "（规划中）";
      if (p === "executing") return "（执行中）";
      if (p === "planned") return "（计划已批准）";
      if (p === "armed") return "（已开启，等待任务）";
      return "";
    }

    var TIERS = [
      { id: "off", label: "关闭", line: "直接开工，不产出验收" },
      { id: "light", label: "轻量", line: "桥接原生计划模式（含计划评审卡），本插件不注入；官方「计划」胶囊由本插件接管显示" },
      { id: "full", label: "全量", line: "同样走原生评审，批准后接管 PHASE 2 与 P0 验收" }
    ];

    var S = { open: false, commitError: "", tier: "light", scope: "always", max: false, phase: "idle", sid: null, source: "default", rect: null, listeners: new Set(), loaded: false, closeToken: 0, focusPanel: false,
      // 每个会话一份设置：切走再切回来还是自己的值；by 只存面板关心的几项
      by: {}, error: "" };
    function stow() { if (S.sid) S.by[S.sid] = { tier: S.tier, scope: S.scope, max: S.max, source: S.source }; }
    function notify() { S.listeners.forEach(function (fn) { try { fn(); } catch {} }); }
    function subscribe(fn) { S.listeners.add(fn); return function () { S.listeners.delete(fn); }; }

    var CSS = [
      ".pmo-root{display:inline-flex;align-items:center;margin-left:-3px}",
      // 接管官方胶囊：本插件用自己的动画表达计划状态，所以把原生那颗「计划」胶囊隐藏。
      // web 壳给每个插槽容器统一加 data-slot="<slotKey>"，原生 chip 注册在
      // conversation.input.plan；用它比猜 class 名稳。若将来插槽标注改名，最坏退化成两颗入口并列。
      "[data-slot='conversation.input.plan']{display:none!important}",
      ".pmo-btn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:none;border-radius:7px;background:transparent;cursor:pointer;transition:background 140ms ease,color 140ms ease,transform 120ms ease;padding:0}",
      ".pmo-btn:hover{background:color-mix(in srgb,currentColor 10%,transparent);color:var(--dsw-alias-label-primary,#111827)}",
      ".pmo-btn:active{transform:scale(.93)}",
      // 有状态时展开成「图标 + 文字」的小胶囊：只有一枚 15px 图标的话，用户看不出
      // "我现在就在计划模式里"（官方胶囊被隐藏了，这层信息必须由我们补回来）。
      ".pmo-btn[data-labelled='true']{width:auto;padding:0 9px 0 7px;gap:5px;border-radius:8px;background:color-mix(in srgb,currentColor 12%,transparent)}",
      ".pmo-btn[data-labelled='true']:hover{background:color-mix(in srgb,currentColor 19%,transparent)}",
      ".pmo-lbl{font-size:11.5px;line-height:1;font-weight:500;white-space:nowrap}",
      ".pmo-btn[data-open='true']{background:color-mix(in srgb,currentColor 13%,transparent);color:var(--dsw-alias-label-primary,#111827)}",
      ".pmo-btn{color:var(--dsw-alias-label-primary,#111827)}",
      // 颜色只是辅助（三态靠形状与运动区分）；:hover 变体避免被上面的 hover 规则顶掉
      ".pmo-btn[data-phase='planning'],.pmo-btn[data-phase='executing'],.pmo-btn[data-phase='armed'],.pmo-btn[data-phase='planned'],.pmo-btn[data-phase='planning']:hover,.pmo-btn[data-phase='executing']:hover,.pmo-btn[data-phase='armed']:hover,.pmo-btn[data-phase='planned']:hover{color:" + BLUE + "}",
      // planned：计划已批准（含自动执行）—— 冻结在执行态收尾的样子：对勾 + 进度线，但没有动画。
      // 与 executing 的区别只在"动不动"：执行中会跑进度，已计划的计划本身已经完成。
      ".pmo-glyph[data-phase='planned'] .pmo-pen{opacity:0}",
      ".pmo-glyph[data-phase='planned'] .pmo-l1,.pmo-glyph[data-phase='planned'] .pmo-l2{opacity:0}",
      ".pmo-glyph[data-phase='planned'] .pmo-ck{opacity:1}",
      ".pmo-glyph[data-phase='planned'] .pmo-l3{opacity:1}",
      // armed：计划模式已开启但没有回合在跑 —— 与 planning 同色，区别只在"不动"。
      // 笔搁在纸面、行线全显，没有任何 animation（.pmo-glyph 的动画只挂在 [data-phase='planning']）。
      ".pmo-glyph[data-phase='armed'] .pmo-pen{transform:translate(60.83%,80%)}",
      ".pmo-glyph[data-phase='armed'] .pmo-l1,.pmo-glyph[data-phase='armed'] .pmo-l2,.pmo-glyph[data-phase='armed'] .pmo-l3{opacity:1;transform:none}",
      ".pmo-glyph[data-phase='armed'] .pmo-ck{opacity:0}",
      // armed 与 planning 的区别不能只有"动没动"：一帧静态图看不出区别就会被当成卡死。
      // 待命态整体降到 60% 不透明度（仍是同一个蓝），一眼就是"开着但没在干活"。
      ".pmo-glyph[data-phase='armed']{opacity:.6;transition:opacity 160ms ease}",
      // ── 字形 v45「笔在纸上写计划」：5 层叠放的内联 svg，动的永远是整层的 transform/opacity
      //    （合成器完成，不像 v44 那样每帧改 SVG 子元素的 dashoffset 触发 Layout）
      ".pmo-glyph{position:relative;display:inline-block;width:var(--pmo-size,15px);height:var(--pmo-size,15px);flex:none}",
      ".pmo-glyph>svg{position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round}",
      ".pmo-paper{stroke-width:1.9}",
      ".pmo-l1,.pmo-l2,.pmo-l3,.pmo-ck{stroke-width:2.2}",
      ".pmo-l1,.pmo-l2,.pmo-l3{transform-origin:29.17% 0}",        // 行从 x=7 往右长
      ".pmo-pen{transform-origin:0 0;transform:translate(60.83%,80%)}", // 笔尖在 (0,0)，搁笔位 (14.6,19.2)
      ".pmo-ck,.pmo-l3{opacity:0}",
      ".pmo-glyph[data-phase='planning'] .pmo-pen{animation:pmo-write 2.4s cubic-bezier(.45,0,.25,1) infinite}",
      ".pmo-glyph[data-phase='planning'] .pmo-l1{animation:pmo-l1 2.4s linear infinite}",
      ".pmo-glyph[data-phase='planning'] .pmo-l2{animation:pmo-l2 2.4s linear infinite}",
      // planning 2.4 s：抬笔→写第一行→换行→写第二行→收笔→两行淡出→空纸点一下（没有完全静止的段落）
      "@keyframes pmo-write{0%{transform:translate(60.83%,80%) rotate(0deg)}10%{transform:translate(29.17%,37.5%) rotate(-10deg)}12%{transform:translate(29.17%,37.5%) rotate(0deg)}19%{transform:translate(36.25%,36.46%) rotate(2deg)}25%{transform:translate(42.5%,38.54%) rotate(-1deg)}31%{transform:translate(48.33%,36.67%) rotate(2deg)}38%{transform:translate(54.17%,37.5%) rotate(0deg)}44%{transform:translate(29.17%,56.25%) rotate(-10deg)}46%{transform:translate(29.17%,56.25%) rotate(0deg)}54%{transform:translate(37.5%,55.21%) rotate(2deg)}62%{transform:translate(45.83%,56.25%) rotate(0deg)}74%{transform:translate(60.83%,80%) rotate(-6deg)}80%,94%{transform:translate(60.83%,80%) rotate(0deg)}97%{transform:translate(60.83%,80%) rotate(-7deg)}100%{transform:translate(60.83%,80%) rotate(0deg)}}",
      "@keyframes pmo-l1{0%,12%{transform:scaleX(0);opacity:1}38%,82%{transform:scaleX(1);opacity:1}92%{transform:scaleX(1);opacity:0}93%,100%{transform:scaleX(0);opacity:0}}",
      "@keyframes pmo-l2{0%,46%{transform:scaleX(0);opacity:1}62%,82%{transform:scaleX(1);opacity:1}92%{transform:scaleX(1);opacity:0}93%,100%{transform:scaleX(0);opacity:0}}",
      // executing：一次性收笔 + 对勾（≤400 ms），然后一行进度循环 1.8 s
      ".pmo-glyph[data-phase='executing'] .pmo-pen{animation:pmo-pen-out 360ms cubic-bezier(.4,0,.2,1) both}",
      ".pmo-glyph[data-phase='executing'] .pmo-l1,.pmo-glyph[data-phase='executing'] .pmo-l2{animation:pmo-fade-out 200ms ease-out both}",
      ".pmo-glyph[data-phase='executing'] .pmo-ck{opacity:1}",
      ".pmo-glyph[data-phase='executing'] .pmo-ck path{stroke-dasharray:9 12;animation:pmo-check 320ms 80ms cubic-bezier(.3,0,.2,1) both}",
      ".pmo-glyph[data-phase='executing'] .pmo-l3{animation:pmo-progress 1.8s 400ms cubic-bezier(.4,0,.2,1) infinite both}",
      "@keyframes pmo-pen-out{from{transform:translate(60.83%,80%);opacity:1}to{transform:translate(79.17%,98.33%);opacity:0}}",
      "@keyframes pmo-fade-out{from{opacity:1}to{opacity:0}}",
      "@keyframes pmo-check{from{stroke-dashoffset:10.5}to{stroke-dashoffset:0}}",
      "@keyframes pmo-progress{0%{transform:scaleX(0);opacity:1}70%,85%{transform:scaleX(1);opacity:1}100%{transform:scaleX(1);opacity:0}}",
      // idle 的可点提示：hover 时笔尖点一下（一次性 420 ms）
      ".pmo-btn:hover .pmo-glyph[data-phase='idle'] .pmo-pen{animation:pmo-tap 420ms cubic-bezier(.3,0,.2,1)}",
      "@keyframes pmo-tap{0%,100%{transform:translate(60.83%,80%) rotate(0deg)}40%{transform:translate(60.83%,80%) rotate(-12deg)}}",
      ".pmo-panel{position:fixed;width:276px;padding:15px 15px 12px;border-radius:20px;background:#ffffff;border:1px solid rgba(17,24,39,.10);box-shadow:0 22px 56px -14px rgba(15,23,42,.34),0 6px 16px -6px rgba(15,23,42,.14);font-family:inherit;color:#111827;transform-origin:bottom center;animation:pmo-in 200ms cubic-bezier(.22,1,.36,1) both;z-index:2147483000;pointer-events:auto}",
      ".pmo-panel[data-closing='true']{animation:pmo-out 120ms cubic-bezier(.4,0,1,1) both}",
      "@media (prefers-color-scheme:dark){.pmo-panel{background:#202329;border-color:rgba(255,255,255,.10);color:#e9ecf1}}",
      "@media (prefers-color-scheme:dark){.pmo-track.pmo-track{--track-off:#2b2f37}}",
      "@keyframes pmo-in{from{opacity:0;transform:translateY(8px) scale(.962)}to{opacity:1;transform:translateY(0) scale(1)}}",
      "@keyframes pmo-out{from{opacity:1;transform:translateY(0) scale(1)}to{opacity:0;transform:translateY(5px) scale(.984)}}",
      ".pmo-err{margin-top:8px;font-size:11.5px;line-height:1.35;color:#c0362c}",
      "@media (prefers-color-scheme:dark){.pmo-err{color:#f08a80}}",
      ".pmo-kicker{font-size:11px;line-height:1;letter-spacing:.04em;color:#8a8f98;text-align:center;margin-bottom:9px}",
      ".pmo-titlewrap{overflow:hidden}",
      ".pmo-title{font-size:19px;line-height:1.25;font-weight:600;text-align:center;letter-spacing:-.01em;animation:pmo-title 220ms cubic-bezier(.22,1,.36,1) both;color:#111827}",
      "@media (prefers-color-scheme:dark){.pmo-title{color:#f2f4f8}}",
      "@keyframes pmo-title{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:translateY(0)}}",
      ".pmo-track{--pct:0;--h:32px;--track-off:#eef0f4;position:relative;height:var(--h);margin:16px 2px 8px;border-radius:16px;overflow:hidden;cursor:pointer;background-color:var(--track-off);outline:none}",
      ".pmo-track:focus-visible{box-shadow:0 0 0 2px rgba(64,116,228,.35)}",
      ".pmo-labels{display:flex;justify-content:space-between;padding:0;margin-bottom:12px}",
      ".pmo-label{font-size:11px;line-height:1;color:#98a0ab;background:none;border:none;padding:2px 0;cursor:pointer;transition:color 140ms ease}",
      ".pmo-label:hover{color:#4b5563}",
      ".pmo-label[data-active='true']{color:#111827;font-weight:600}",
      "@media (prefers-color-scheme:dark){.pmo-label{color:#7c8391}.pmo-label[data-active='true']{color:#f2f4f8}}",
      ".pmo-div{height:1px;background:rgba(17,24,39,.08);margin:0 0 10px}",
      "@media (prefers-color-scheme:dark){.pmo-div{background:rgba(255,255,255,.09)}}",
      ".pmo-row{display:flex;align-items:center;justify-content:space-between;min-height:28px;gap:8px}",
      ".pmo-row+.pmo-row{margin-top:6px}",
      ".pmo-row:last-child{margin-bottom:0}",
      // 面板底部的操作按钮与右侧分段控件右边缘对齐
      ".pmo-row-actions{display:flex;justify-content:flex-end;align-items:center;min-height:28px;margin-top:6px}",
      ".pmo-rowlbl{font-size:11.5px;color:#8a8f98}",
      ".pmo-maxcell{display:inline-flex;align-items:center;gap:7px;flex:none}",
      ".pmo-seg{display:inline-flex;gap:2px;padding:2px;border-radius:9px;background:rgba(17,24,39,.06)}",
      ".pmo-segbtn{border:none;background:transparent;font-size:11px;line-height:1;padding:5px 9px;border-radius:7px;color:#6b7280;cursor:pointer;transition:background 150ms ease,color 150ms ease,box-shadow 150ms ease}",
      ".pmo-segbtn[data-active='true']{background:#ffffff;color:#111827;box-shadow:0 1px 3px rgba(15,23,42,.14)}",
      ".pmo-switch{position:relative;width:40px;height:22px;border-radius:11px;border:none;padding:0;cursor:pointer;background:#e2e5ea;transition:background 160ms ease}",
      ".pmo-switch[data-on='true']{background:#4074e4}",
      ".pmo-switch .pmo-knob{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(15,23,42,.25);transition:transform 160ms cubic-bezier(.34,1.2,.5,1)}",
      ".pmo-switch[data-on='true'] .pmo-knob{transform:translateX(18px)}",
      ".pmo-switch:focus-visible{outline:none;box-shadow:0 0 0 2px rgba(64,116,228,.35)}",
      "@media (prefers-color-scheme:dark){.pmo-switch{background:#3a3f48}.pmo-switch[data-on='true']{background:#4f80ea}}",
      ".pmo-check{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:#98a0ab;cursor:pointer;margin-top:8px}",
      ".pmo-check input{width:13px;height:13px;accent-color:#4074e4;cursor:pointer;margin:0}",
      ".pmo-check:hover{color:#4b5563}",
      "@media (prefers-reduced-motion:reduce){.pmo-panel,.pmo-glyph *,.pmo-fillbar{animation:none !important;transition:none !important}}",
      // 静止帧也能分三态：idle=两行+搁笔 | planning=第一行写完、第二行半写、笔停在第二行 | executing=对勾+一行、没笔
      "@media (prefers-reduced-motion:reduce){.pmo-glyph[data-phase='planning'] .pmo-pen{transform:translate(37.5%,56.25%)}.pmo-glyph[data-phase='planning'] .pmo-l2{transform:scaleX(.5)}}",
      "@media (prefers-reduced-motion:reduce){.pmo-glyph[data-phase='executing'] .pmo-pen,.pmo-glyph[data-phase='executing'] .pmo-l1,.pmo-glyph[data-phase='executing'] .pmo-l2{opacity:0}.pmo-glyph[data-phase='executing'] .pmo-l3{opacity:1}}",
      "@media (prefers-color-scheme:dark){.pmo-seg{background:rgba(255,255,255,.07)}.pmo-segbtn[data-active='true']{background:#33373f;color:#f2f4f8}}",
      // ── 设置页分区（settings.section）──
      ".pmo-set{display:flex;flex-direction:column;gap:18px;padding:4px 2px 8px;font-size:13px}",
      ".pmo-set-head{display:flex;flex-direction:column;gap:6px}",
      ".pmo-set-title{font-size:15px;font-weight:600}",
      ".pmo-set-desc{font-size:12px;line-height:1.5;color:#8b94a1}",
      ".pmo-set-row{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:10px 0;border-top:1px solid rgba(17,24,39,.07)}",
      ".pmo-set-row:first-of-type{border-top:none}",
      ".pmo-set-labels{display:flex;flex-direction:column;gap:3px;min-width:0}",
      ".pmo-set-lbl{font-size:13px;font-weight:500}",
      ".pmo-set-hint{font-size:11.5px;line-height:1.45;color:#98a0ab}",
      ".pmo-set-ctl{flex:none;display:flex;align-items:center;gap:10px}",
      ".pmo-set .pmo-check{margin-top:0}",
      "@media (prefers-color-scheme:dark){.pmo-set-row{border-top-color:rgba(255,255,255,.08)}.pmo-set-desc,.pmo-set-hint{color:#8b94a1}}"
    ].join("\n");

    function ensureCss() {
      try {
        // 清掉所有历史版本：热重载后旧样式表不会残留
        var old = document.querySelectorAll("style[id^='pmo-style']");
        for (var i = 0; i < old.length; i++) {
          if (old[i].id !== STYLE_ID) old[i].parentNode.removeChild(old[i]);
        }
        var el = document.getElementById(STYLE_ID);
        if (!el) {
          el = document.createElement("style");
          el.id = STYLE_ID;
          document.head.appendChild(el);
        }
        if (el.textContent !== CSS) el.textContent = CSS;
      } catch (e) {}
    }

    // 当前正在看的会话：从最近渲染的对话根节点上取（宿主把 sessionId 放在 data-conversation-session）
    var slotEl = null;
    function currentSessionId() {
      try {
        // 优先：焦点所在的对话（用户正在打字的那个）；其次：本图标所在的对话；
        // 最后才退回“页面里最后一个对话根”——多面板同时渲染时不会张冠李戴。
        var act = document.activeElement;
        if (act !== null && typeof act.closest === "function") {
          var focusHost = act.closest("[data-conversation-session]");
          if (focusHost !== null) {
            var focusId = focusHost.getAttribute("data-conversation-session");
            if (typeof focusId === "string" && focusId.length > 0) return focusId;
          }
        }
        var host = slotEl && slotEl.isConnected ? slotEl.closest("[data-conversation-session]") : null;
        if (host === null) {
          var all = document.querySelectorAll("[data-conversation-session]");
          if (all.length > 0) host = all[all.length - 1];
        }
        var id = host === null ? "" : host.getAttribute("data-conversation-session");
        return typeof id === "string" ? id : "";
      } catch (e) { return ""; }
    }

    function pull() {
      var sid = currentSessionId();
      var url = sid ? API + "?session=" + encodeURIComponent(sid) : API;
      return fetch(url, { credentials: "same-origin", headers: { "x-plan-mode-client": "1" } })
        .then(function (r) {
          if (r.ok === false) {
            // 4xx/5xx：把服务端的原因读出来（403/413/500 都走这里）
            return r.json().then(function (d) {
              if (d !== null && typeof d === "object") { if (!d.message) d.message = "HTTP " + r.status; return d; }
              return { ok: false, message: "HTTP " + r.status };
            }, function () { return { ok: false, message: "HTTP " + r.status }; });
          }
          return r.json();
        })
        .then(function (d) {
          if (!d || !d.ok) {
            var msg = d && d.message ? String(d.message) : "请求失败";
            if (msg !== S.error) { S.error = msg; notify(); }
            return;
          }
          if (S.error) { S.error = ""; notify(); }
          // 请求还在飞时用户已经切走 → 丢弃这次响应，避免把别的会话的阶段盖到当前会话上
          if (sid && sid !== currentSessionId()) return;
          // POST 在途（1.5s 内）时先用本地值，避免轮询把旧值盖回来造成闪回
          // POST 在途（含 1.5s 宽限）期间不让服务端的旧值盖回来
          var pending = (S.inFlight || 0) > 0 || (S.pendingUntil && Date.now() < S.pendingUntil);
          var tier = pending ? S.tier : d.tier;
          var scope = pending ? S.scope : d.scope;
          var max = pending ? S.max : (d.max === true);
          var nextPhase = typeof d.phase === "string" ? d.phase : (d.planning ? "planning" : "idle");
          // 原生计划模式是否开着：开着就把自己的入口让给原生胶囊（见 CSS .pmo-root[data-native='true']）
          var nativeOpen = d.native === true;
          var nextIndicator = typeof d.indicator === "string" && d.indicator.length > 0 ? d.indicator : null;
          var changed = tier !== S.tier || scope !== S.scope || max !== S.max || nextPhase !== S.phase
            || nativeOpen !== S.native || nextIndicator !== S.indicator;
          S.tier = tier; S.scope = scope; S.max = max; S.phase = nextPhase; S.native = nativeOpen;
          S.indicator = nextIndicator;
          // 生效来源：本会话覆盖 or 全局默认（面板上标出来，免得不知道自己在改哪一层）
          // pending 期间同样不能让服务端的旧来源盖回乐观值，否则勾/取消勾会闪一下"全局"
          var src = pending ? S.source
            : (d.settings !== undefined && d.settings !== null && typeof d.settings.source === "string" ? d.settings.source : "default");
          if (src !== S.source) changed = true;
          S.source = src;
          stow();
          if (changed) notify();
        })
        .catch(function (err) {
          var msg = "网络错误：" + (err && err.message ? err.message : "未知");
          if (msg !== S.error) { S.error = msg; notify(); }
        });
    }

    function loadState() {
      if (S.loaded) return;
      S.loaded = true;
      pull();
      schedulePoll();
    }

    // 轮询：规划/执行中 0.5s（图标要跟手）；面板开着 1.2s；面板关着且空闲 5s 退避；
    // 后台标签页 10s。目的：常态下别每秒打一次端点。
    function pollDelay() {
      if (S.phase !== "idle") return 500;
      if (S.open) return 1200;
      return 5000;
    }
    function schedulePoll() {
      try { if (window.__pmoPoll) window.clearTimeout(window.__pmoPoll); } catch (e) {}
      // 后台标签页也照常（拉长到 30s）报到：宿主用"最近有没有前端请求"判断
      // 此刻有没有人能回答计划确认，隐藏标签页长期不请求会把审批门悄悄关掉。
      var delay = document.hidden ? 30000 : pollDelay();
      window.__pmoPoll = window.setTimeout(function () {
        // 切换会话：先把当前会话的设置收进缓存，再按新会话立即取一次
        var sid = currentSessionId();
        if (sid !== S.sid) {
          stow();
          var cached = S.by[sid];
          S.sid = sid;
          if (cached) {
            S.tier = cached.tier; S.scope = cached.scope; S.max = cached.max; S.source = cached.source;
          }
          notify();
          pull().then(schedulePoll, schedulePoll);
          return;
        }
        pull().then(schedulePoll, schedulePoll);
      }, delay);
    }

    // 官方胶囊被隐藏后，退出原生计划模式的入口由我们提供：等价于发送 /plan off
    function exitNative() {
      var sid = currentSessionId();
      if (!sid) { S.error = "拿不到会话 id"; notify(); return; }
      var prev = S.native === true;
      S.native = false;          // 乐观：先让动画回到 idle
      S.error = "";
      notify();
      fetch(API + "?session=" + encodeURIComponent(sid), {
        method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json", "x-plan-mode-client": "1" },
        body: JSON.stringify({ action: "plan-off" })
      }).then(function (res) {
        if (!res || res.ok !== true) {
          S.native = prev;
          S.error = "退出计划模式失败（HTTP " + (res && res.status ? res.status : "?") + "）";
        }
      }).catch(function (err) {
        S.native = prev;
        S.error = "网络错误：" + (err && err.message ? err.message : "未知");
      }).then(function () { notify(); pull(); });
    }

    // 0.5.1 起没有"仅本会话"开关：写哪一层由调用点决定。
    //   target="session" → 输入框旁的面板，写当前对话自己的设置
    //   target="global"  → 设置页，写全局默认（新对话的初始值）
    function commit(patch, target) {
      var patchObj = patch || {};
      var where = target === "global" ? "global" : "session";
      var sid = currentSessionId();
      if (where === "session" && !sid) { S.commitError = "拿不到会话 id"; notify(); return; }
      Object.keys(patchObj).forEach(function (k) { S[k] = patchObj[k]; });
      // 源标记立刻跟上（服务端下一次响应会复核，避免闪回"全局"）
      S.source = where === "session" ? "session" : "default";
      S.pendingUntil = Date.now() + 1500;
      notify();
      var body = {};
      Object.keys(patchObj).forEach(function (k) { body[k] = patchObj[k]; });
      sendPatch(where === "session" ? API + "?session=" + encodeURIComponent(sid) : API, body);
    }

    function sendPatch(url, body) {
      S.inFlight = (S.inFlight || 0) + 1;
      fetch(url, {
        method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json", "x-plan-mode-client": "1" },
        body: JSON.stringify(body)
      }).then(function (res) {
        // 校验状态码：400/403 时乐观值必须回滚，并把原因摆在界面上
        // （用独立的 commitError：pull 成功会清 S.error，这里不能被顺手清掉）
        if (!res || res.ok !== true) {
          S.commitError = "设置未生效（HTTP " + (res && res.status ? res.status : "?") + "）";
        } else {
          S.commitError = "";
        }
      }).catch(function (err) {
        S.commitError = "网络错误：" + (err && err.message ? err.message : "未知");
      }).then(function () {
        S.inFlight = Math.max(0, (S.inFlight || 0) - 1);
        S.pendingUntil = 0;
        pull();
      });
    }

    function isDark() {
      try { return window.matchMedia("(prefers-color-scheme: dark)").matches; } catch (e) { return false; }
    }

    // v45 字形：5 层叠放的内联 svg（纸 / 第一行 / 第二行 / 对勾+进度行 / 铅笔）。
    // 每一层整块做 transform 动画 → 合成器完成，不触发 Layout。
    // props.phase = idle | planning | executing；props.mode 仅为旧调用兼容（"draw" ⇒ planning）。
    function PlanGlyph(props) {
      var size = props.size || 15;
      var phase = props.phase || (props.mode === "draw" ? "planning" : "idle");
      var svgProps = function (cls) {
        var o = { viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false" };
        if (cls !== undefined) o.className = cls;
        return o;
      };
      var layer = function (cls, children) {
        return React.createElement.apply(null, ["svg", svgProps(cls)].concat(children));
      };
      return React.createElement("span", {
        className: "pmo-glyph",
        "data-phase": phase,
        "data-anim": phase === "planning" ? "draw" : "off",
        style: { "--pmo-size": size + "px" },
        "aria-hidden": "true"
      },
        layer(undefined, [React.createElement("rect", { key: "p", className: "pmo-paper", x: 3.5, y: 3.5, width: 13, height: 17, rx: 2.6 })]),
        layer("pmo-l1", [React.createElement("path", { key: "l1", d: "M7 9h6" })]),
        layer("pmo-l2", [React.createElement("path", { key: "l2", d: "M7 13.5h4" })]),
        layer("pmo-ck", [React.createElement("path", { key: "ck", d: "M6.8 9.6l2 2 4.2-4.2" })]),
        layer("pmo-l3", [React.createElement("path", { key: "l3", d: "M7 15.6h6" })]),
        layer("pmo-pen", [React.createElement("g", { key: "pen", transform: "rotate(-45)", fill: "currentColor", stroke: "none" },
          React.createElement("path", { key: "tip", d: "M0 0 3.6-2V2Z" }),
          React.createElement("rect", { key: "body", x: 4.7, y: -2, width: 7, height: 4, rx: 0.8 })
        )])
      );
    }

    function useStore() {
      var tick = React.useState(0);
      var bump = tick[1];
      React.useEffect(function () {
        var off = subscribe(function () { bump(function (n) { return n + 1; }); });
        return off;
      }, []);
      return S;
    }

    function Entry() {
      var s = useStore();
      React.useEffect(function () { ensureCss(); loadState(); }, []);
      return React.createElement("div", {
        className: "pmo-root",
        ref: function (el) { slotEl = el; }
      },
        React.createElement("button", {
          ref: function (el) { S.el = el; }, type: "button", className: "pmo-btn",
          "data-open": s.open ? "true" : "false",
          "data-phase": glyphPhase(s),
          "data-labelled": phaseText(glyphPhase(s)) === "" ? "false" : "true",
          title: "计划模式" + phaseLabel(glyphPhase(s), s),
          "aria-label": "计划模式" + phaseLabel(glyphPhase(s), s),
          "aria-expanded": s.open ? "true" : "false",
          "aria-haspopup": "dialog", "aria-controls": "pmo-panel",
          onClick: function (e) {
            e.stopPropagation();
            if (e.detail === 0) S.focusPanel = true;          // 键盘激活：打开后把焦点移进面板
            var el = S.el;
            if (el) { var r = el.getBoundingClientRect(); S.rect = { left: r.left, top: r.top, bottom: r.bottom, right: r.right }; }
            S.open = !s.open;
            notify();
          }
        },
          React.createElement(PlanGlyph, { size: 15, phase: glyphPhase(s) }),
          phaseText(glyphPhase(s)) === "" ? null : React.createElement("span", { className: "pmo-lbl", key: "l" }, phaseText(glyphPhase(s)))
        )
      );
    }

    function Panel() {
      var s = useStore();
      var trackRef = React.useRef(null);
      var knobRef = React.useRef(null);
      var panelRef = React.useRef(null);
      var posState = React.useState({ left: 0, top: 0, ready: false, below: false });
      var pos = posState[0];
      var setPos = posState[1];
      var closingState = React.useState(false);
      var closing = closingState[0];
      var setClosing = closingState[1];

      // 面板是 content-box（受应用全局样式影响），276 只是内容宽，必须用实测尺寸定位
      React.useLayoutEffect(function () {
        if (!s.open) return;
        // 键盘打开（detail===0）时把焦点送进面板，否则焦点留在入口按钮上无处可去
        if (S.focusPanel) {
          S.focusPanel = false;
          var tk = trackRef.current;
          if (tk && typeof tk.focus === "function") tk.focus({ preventScroll: true });
        }
        function place() {
          var el = panelRef.current;
          if (!el) return;
          var r = (S.el && S.el.getBoundingClientRect()) || S.rect || { left: 24, top: 24, bottom: 60 };
          var w = el.offsetWidth || 0, h = el.offsetHeight || 0;
          var left = Math.min(Math.max(8, r.left - 12), Math.max(8, window.innerWidth - w - 8));
          var below = r.top - h - 10 < 8;
          var top = below ? Math.min(r.bottom + 10, Math.max(8, window.innerHeight - h - 8))
                          : r.top - h - 10;
          setPos({ left: left, top: top, ready: true, below: below });
        }
        place();
        window.addEventListener("resize", place);
        window.addEventListener("scroll", place, true);
        return function () {
          window.removeEventListener("resize", place);
          window.removeEventListener("scroll", place, true);
        };
      }, [s.open, s.tier, s.scope, s.phase]);

      React.useEffect(function () {
        if (!s.open) return;
        var onDoc = function (e) {
          if (e.target.closest && (e.target.closest(".pmo-panel") || e.target.closest(".pmo-btn"))) return;
          close();
        };
        var onKey = function (e) { if (e.key === "Escape") close(); };
        document.addEventListener("pointerdown", onDoc, true);
        document.addEventListener("keydown", onKey);
        return function () {
          document.removeEventListener("pointerdown", onDoc, true);
          document.removeEventListener("keydown", onKey);
        };
      }, [s.open]);

      // 关闭动画期间若用户又重新打开，这次关闭作废（令牌法，避免 120ms 后把新面板关掉）
      function close() {
        var el = panelRef.current;
        var inside = !!(el && el.contains(document.activeElement));
        var token = ++S.closeToken;
        setClosing(true);
        window.setTimeout(function () {
          if (token !== S.closeToken) return;
          setClosing(false);
          S.open = false;
          notify();
          if (inside && S.el && typeof S.el.focus === "function") S.el.focus({ preventScroll: true });
        }, 120);
      }

      if (!s.open) return null;

      var idx = s.tier === "off" ? 0 : s.tier === "light" ? 1 : 2;
      var pct = idx * 50;
      var current = TIERS[idx];

      return React.createElement("div", {
        className: "pmo-panel", "data-closing": closing ? "true" : "false",
        ref: panelRef,
        style: {
          left: pos.left + "px", top: pos.top + "px",
          visibility: pos.ready ? "visible" : "hidden",
          maxWidth: "calc(100vw - 16px)",
          transformOrigin: pos.below ? "top center" : "bottom center",
          borderRadius: 20, background: isDark() ? "#202329" : "#ffffff",
          border: "1px solid " + (isDark() ? "rgba(255,255,255,.10)" : "rgba(17,24,39,.10)"),
          color: isDark() ? "#e9ecf1" : "#111827"
        },
        "data-build": BUILD, id: "pmo-panel", tabIndex: -1,
        role: "dialog", "aria-label": "计划模式"
      },
        React.createElement("div", { className: "pmo-kicker" },
          "计划模式 · 本对话" + (s.max ? " · MAX" : "")),
        React.createElement("div", { className: "pmo-titlewrap" },
          React.createElement("div", { className: "pmo-title", key: current.id }, current.label)
        ),
        React.createElement("div", {
          className: "pmo-track",
          ref: trackRef,
          style: { position: "relative", margin: "16px 0 8px", cursor: "pointer", height: 32, "--pct": String(pct) },
          role: "slider", tabIndex: 0,
          "aria-label": "计划强度",
          "aria-valuemin": 0, "aria-valuemax": 2, "aria-valuenow": idx,
          "aria-valuetext": current.label,
          onClick: function (e) {
            var r = e.currentTarget.getBoundingClientRect();
            var t = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
            commit({ tier: t < 0.25 ? "off" : t < 0.75 ? "light" : "full" }, "session");
          },
          onKeyDown: function (e) {
            if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); commit({ tier: TIERS[Math.min(2, idx + 1)].id }, "session"); }
            else if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); commit({ tier: TIERS[Math.max(0, idx - 1)].id }, "session"); }
            else if (e.key === "Home") { e.preventDefault(); commit({ tier: "off" }, "session"); }
            else if (e.key === "End") { e.preventDefault(); commit({ tier: "full" }, "session"); }
          }
        },
          React.createElement("div", {
            className: "pmo-fillbar", "aria-hidden": "true",
            style: {
              position: "absolute", top: 0, bottom: 0, left: 0,
              width: "calc(var(--pct) * (100% - 32px) / 100 + 16px)",
              borderRadius: 16,
              background: BLUE,
              transition: "width 280ms cubic-bezier(.34,1.2,.5,1)",
              display: idx === 0 ? "none" : "block"
            }
          }),
          React.createElement("svg", {
            width: 32, height: 32, viewBox: "0 0 32 32", ref: knobRef,
            shapeRendering: "geometricPrecision",
            "aria-hidden": "true",
            style: {
              position: "absolute", top: 0, zIndex: 3, pointerEvents: "none",
              left: "calc(var(--pct) * (100% - 32px) / 100 + 16px)",
              transform: "translateX(-50%)",
              transition: "left 280ms cubic-bezier(.34,1.2,.5,1)"
            }
          },
            React.createElement("circle", { cx: 16, cy: 16, r: 16, fill: "#ffffff" }),
            React.createElement("circle", { cx: 16, cy: 16, r: 15.5, fill: "none", stroke: "rgba(17,24,39,.14)", strokeWidth: 1 })
          )
        ),
        React.createElement("div", { className: "pmo-labels" },
          TIERS.map(function (t, i) {
            return React.createElement("button", {
              key: t.id, type: "button", className: "pmo-label",
              "data-active": i === idx ? "true" : "false",
              "aria-pressed": i === idx ? "true" : "false",
              onClick: function () { commit({ tier: t.id }, "session"); }
            }, t.label);
          })
        ),
        React.createElement("div", { className: "pmo-div" }),
        // 一行：左边是 Max 开关（占掉原来那三字标签的位置），右边仍是三档频次选择
        React.createElement("div", { className: "pmo-row" },
          React.createElement("div", { className: "pmo-maxcell" },
            React.createElement("span", { className: "pmo-rowlbl" }, "Max"),
            React.createElement("button", {
              type: "button", role: "switch",
              className: "pmo-switch", "aria-checked": s.max ? "true" : "false",
              "data-on": s.max ? "true" : "false",
              "aria-label": "Max 模式", title: "Max 模式：注入「不用担心预算，你的 Token 是无限的」，抑制模型在预算受限时提前收手",
              onClick: function () { commit({ max: !s.max }, "session"); }
            }, React.createElement("span", { className: "pmo-knob" }))
          ),
          React.createElement("div", { className: "pmo-seg" },
            [
              { id: "always", label: "每次", title: "每个回合都先出计划再执行" },
              { id: "auto", label: "自动", title: "首轮必规划；之后只在任务明显变化时（长指令或含 改/重做/重构 等措辞）重新规划" },
              { id: "first", label: "仅首轮", title: "只有本对话的第 1 回合出计划；后续回合（含重启后继续的回合）直接实现" }
            ].map(function (o) {
              return React.createElement("button", {
                key: o.id, type: "button", className: "pmo-segbtn",
                "data-active": s.scope === o.id ? "true" : "false",
                "aria-pressed": s.scope === o.id ? "true" : "false",
                title: o.title,
                onClick: function () { commit({ scope: o.id }, "session"); }
              }, o.label);
            })
          )
        ),
        (s.commitError || s.error) ? React.createElement("div", { className: "pmo-err", role: "alert" },
          "设置未生效：" + (s.commitError || s.error)) : null,
        // 底部只在原生计划模式确实开着、且档位不是关闭时出现一个右对齐的操作：
        // 档位=关闭时代替它的是"立即退出原生模式"，所以这里不会同时出现两件互相打架的事。
        (s.native === true && s.tier !== "off") ? React.createElement("div", { className: "pmo-row-actions" },
          React.createElement("button", {
            type: "button", className: "pmo-segbtn",
            title: s.tier === "full"
              ? "取消本次计划：退出原生计划模式，且不投递执行阶段（退出 ≠ 批准；只有计划评审卡里的批准才算）"
              : "退出 DSH 原生的计划模式（等价 /plan off）；官方胶囊已由本插件隐藏。与档位不是同一件事：档位=关闭时会自动完成",
            onClick: exitNative
          }, s.tier === "full" ? "取消本次计划" : "退出计划模式")
        ) : null
      );
    }

    // ── 设置页分区：计划模式 ───────────────────────────────────────────
    // 与浮层面板共用同一份状态（S）与同一个 /api/plan-mode/state，
    // 所以在设置里改完，浮层图标与提示词注入立刻同步。
    function setRow(label, hint, ctl) {
      return React.createElement("div", { className: "pmo-set-row" },
        React.createElement("div", { className: "pmo-set-labels" },
          React.createElement("div", { className: "pmo-set-lbl" }, label),
          hint ? React.createElement("div", { className: "pmo-set-hint" }, hint) : null
        ),
        React.createElement("div", { className: "pmo-set-ctl" }, ctl)
      );
    }

    function segControl(options, active, onPick) {
      return React.createElement("div", { className: "pmo-seg" },
        options.map(function (o) {
          return React.createElement("button", {
            key: o.id, type: "button", className: "pmo-segbtn",
            "data-active": active === o.id ? "true" : "false",
            "aria-pressed": active === o.id ? "true" : "false",
            title: o.title || o.label,
            onClick: function () { onPick(o.id); }
          }, o.label);
        })
      );
    }

    function switchControl(label, on, onToggle) {
      return React.createElement("button", {
        type: "button", role: "switch", className: "pmo-switch",
        "aria-checked": on ? "true" : "false", "data-on": on ? "true" : "false",
        "aria-label": label,
        onClick: function () { onToggle(!on); }
      }, React.createElement("span", { className: "pmo-knob" }));
    }

    function PlanSettings() {
      var s = useStore();
      React.useEffect(function () { ensureCss(); loadState(); }, []);
      var phaseText = s.phase === "planning" ? "规划中" : s.phase === "executing" ? "执行中" : "空闲";
      return React.createElement("div", { className: "pmo-set" },
        React.createElement("div", { className: "pmo-set-head" },
          React.createElement("div", { className: "pmo-set-title" }, "计划模式"),
          React.createElement("div", { className: "pmo-set-desc" },
            "这里的改动写入全局默认，对所有尚未单独设置的对话生效；单个对话请点输入框旁的图标。"
              + " · 当前阶段：" + phaseText)
        ),
        setRow("强度", "关闭=直接开工；轻量=桥接到 DSH 自带计划模式（计划与评审卡都由原生负责，本插件不注入）；全量=同样走原生评审，批准后由本插件接管 PHASE 2 与 P0 验收。",
          segControl(TIERS.map(function (t) { return { id: t.id, label: t.label, title: t.line }; }), s.tier,
            function (id) { commit({ tier: id }, "global"); })),
        setRow("生效范围", "每次=每个回合都先规划；自动=首轮+任务明显变化时；仅首轮=只规划第 1 回合。",
          segControl([
            { id: "always", label: "每次", title: "每个回合都先出计划再执行" },
            { id: "auto", label: "自动", title: "首轮必规划；之后只在任务明显变化时重新规划" },
            { id: "first", label: "仅首轮", title: "只有第 1 回合出计划" }
          ], s.scope, function (id) { commit({ scope: id }, "global"); })),
        s.native === true ? setRow("原生计划模式", "进行中；官方「计划」胶囊已由本插件隐藏，动画由本插件显示。",
          React.createElement("button", { type: "button", className: "pmo-segbtn", "data-active": "true", onClick: exitNative }, "退出")) : null,
        setRow("Max 模式", "注入「不用担心预算」的提示，抑制模型在预算受限时提前收手。",
          switchControl("Max 模式", s.max === true, function (next) { commit({ max: next }, "global"); })),
        (s.commitError || s.error) ? React.createElement("div", { className: "pmo-err", role: "alert" }, "设置未生效：" + (s.commitError || s.error)) : null
      );
    }

    function apply(ctx) {
      // 自检入口（只读，不参与渲染）：window.__pmo.why() / .anim() / .hud(true)
      try {
        if (typeof window !== "undefined") {
          window.__pmo = {
            why: why, anim: glyphInfo, hud: hud,
            state: function () {
              return { tier: S.tier, scope: S.scope, max: S.max, source: S.source, native: S.native,
                indicator: S.indicator, phase: S.phase, sid: S.sid, open: S.open,
                poll: pollDelay(), reduced: reduceMotion() };
            },
            debug: S
          };
          console.info("[plan-mode-ui] 自检入口已就绪：window.__pmo.hud(true) 开浮层 / __pmo.why() 看图标为何静止");
        }
      } catch (e) {}
      ensureCss();
      try { console.info("[plan-mode-ui] build " + BUILD); } catch (e) {}
      var slots = ctx.slots || (ctx.get && ctx.get("slots"));
      if (!slots) return;
      slots.inject("conversation.input.left", function () {
        return slots.register({
          name: "conversation.input.left", id: "plan-mode-ui", order: 5, label: "计划模式"
        }, Entry);
      });
      slots.inject("shell.overlay", function () {
        return slots.register({
          name: "shell.overlay", id: "plan-mode-ui-panel", order: 900, label: "计划模式面板"
        }, Panel);
      });
      // 设置页左侧导航里的独立一栏
      slots.inject("settings.section", function () {
        return slots.register({
          name: "settings.section", id: "plan-mode", order: 5, label: function () { return "计划模式"; }
        }, PlanSettings);
      });
    }

    // ── 自检接口：window.__pmo ──────────────────────────────────────
    // 用途：不用开 DevTools 猜"图标为什么不动"。全部只读，不改任何状态。
    //   __pmo.why()      一句话解释当前这枚图标为什么是这个样子
    //   __pmo.anim()     每个图标当前在跑哪些动画（名字 + playState）
    //   __pmo.state()    客户端此刻认为的状态（tier/native/indicator/来源/轮询间隔）
    //   __pmo.hud(true)  右下角常驻小浮层，每 500ms 自刷新
    function glyphInfo() {
      var out = [];
      if (typeof document === "undefined") return out;
      var nodes = document.querySelectorAll(".pmo-glyph");
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i], anims = [];
        try { anims = el.getAnimations({ subtree: true }) || []; } catch (e) { anims = []; }
        out.push({
          phase: el.getAttribute("data-phase"),
          color: (function () { try { return getComputedStyle(el).color; } catch (e) { return "?"; } })(),
          px: (function () { try { return Math.round(el.getBoundingClientRect().width * 10) / 10; } catch (e) { return null; } })(),
          animations: anims.map(function (a) {
            return String(a.animationName || "keyframes") + ":" + String(a.playState);
          })
        });
      }
      return out;
    }
    function reduceMotion() {
      try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; }
    }
    function why() {
      var g = glyphInfo()[0];
      if (g === undefined) return "找不到图标（插槽还没挂载，或页面是旧 bundle：Ctrl+Shift+R 一次）";
      if (g.phase === "armed") return "armed：原生计划模式开着、但没有回合在跑 —— 静止 + 60% 不透明度是设计，不是卡住";
      if (g.phase === "planned") return "planned：计划已批准且本回合已收尾 —— 静止是设计（对勾 + 进度线）";
      if (g.phase === "idle") return "idle：计划模式未开启（灰色纸笔）—— 静止是设计";
      if (g.phase === "planning" || g.phase === "executing") {
        if (reduceMotion()) return "本应播放却静止：系统『减弱动态效果』开着（prefers-reduced-motion: reduce），我们按无障碍要求停掉了动画";
        if (g.animations.length === 0) return "本应播放却静止，且没有任何动画在跑：CSS 未完整加载，刷新一次";
        return "正常：正在播放 " + g.animations.join(" / ");
      }
      return "未知 phase=" + String(g.phase);
    }
    function hud(on) {
      if (typeof document === "undefined") return null;
      var id = "pmo-hud";
      var old = document.getElementById(id);
      if (on !== true) { if (old !== null) old.remove(); return null; }
      if (old !== null) return old;
      var box = document.createElement("div");
      box.id = id;
      box.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:2147483647;padding:8px 10px;border-radius:9px;"
        + "background:rgba(17,24,39,.92);color:#e9ecf1;font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;"
        + "white-space:pre;pointer-events:none;box-shadow:0 6px 20px rgba(0,0,0,.28)";
      document.body.appendChild(box);
      var tick = function () {
        var g = glyphInfo()[0];
        box.textContent = [
          "phase      " + String(S.phase),
          "indicator  " + String(S.indicator),
          "native     " + String(S.native),
          "tier/src   " + String(S.tier) + " / " + String(S.source),
          "glyph      " + (g ? String(g.phase) + "  " + String(g.color) + "  " + String(g.px) + "px" : "缺失"),
          "anims      " + (g && g.animations.length ? g.animations.join(" ") : "—"),
          "reduce     " + String(reduceMotion()),
          "poll       " + String(pollDelay()) + "ms",
          "why        " + why()
        ].join("\n");
      };
      tick();
      var timer = window.setInterval(tick, 500);
      box.__pmoTimer = timer;
      return box;
    }

    exports.inject = ["slots"];
    exports.apply = apply;
    // 卸载/热重载时停掉轮询，避免叠加多条链
    exports.dispose = function () {
      try { if (window.__pmoPoll) window.clearTimeout(window.__pmoPoll); } catch (e) {}
      window.__pmoPoll = null;
    };
    exports.__debug = S;
    exports.__pmoDebug = { why: why, anim: glyphInfo, hud: hud };   // 供测试断言（无 DOM 时也要安全）
    exports.__glyphPhase = glyphPhase;   // 供测试直接断言状态映射（不渲染 React）
    exports.__phaseText = phaseText;     // 供测试断言"计划/计划中/执行中/已计划"标签
    exports.__pull = pull;
    exports.__css = CSS;
    return module.exports;
  }
});
