/** Player-facing migration panel. Data, API calls and persistence belong to actions. */
import { CHAT_FILE_LIMIT } from './chat-import.mjs';
import { attachDrag } from './drag.mjs';
const CSS = `
.head{cursor:grab}.variable-editor textarea{min-height:240px;font:13px/1.7 var(--mono)}.variable-editor .actions{margin-bottom:16px}.editor-note:empty{display:none}
.review-box{margin-top:26px;padding:22px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.review-box textarea{min-height:104px}.chat-choice{margin-top:16px}.rule-library>.hint{max-width:56em}.rule-filters{margin-bottom:14px}.rule-entry .check>span>span{display:block}
:host{all:initial;color-scheme:light;font:14px/1.75 "PingFang SC","Microsoft YaHei","Segoe UI",sans-serif;color:#252525;--paper:#f7f6f2;--ink:#252525;--muted:#65635e;--line:#ddd9d1;--accent:#b7422c;--soft:#eeece6;--serif:"Noto Serif SC","Source Han Serif SC","Songti SC",SimSun,serif;--mono:"Cascadia Code",Consolas,monospace}
*{box-sizing:border-box;min-width:0}[hidden]{display:none!important}
dialog{margin:auto;padding:0;border:1px solid #e4e3dc;border-radius:12px;width:min(1152px,calc(100vw - 40px));max-width:calc(100vw - 40px);height:min(900px,calc(100vh - 40px));height:min(900px,calc(100dvh - 40px));max-height:calc(100dvh - 40px);background:var(--paper);color:var(--ink);box-shadow:0 32px 120px #0005;overflow:hidden}
dialog[open]{display:flex}dialog::backdrop{background:#111111cc;backdrop-filter:blur(5px)}
dialog.fallback{position:fixed;inset:20px;z-index:2147483647}.fallback-shade{position:fixed;inset:0;z-index:2147483646;background:#111111cc}
.shell{display:grid;grid-template-columns:218px minmax(0,1fr);width:100%;height:100%;min-height:0}.workspace{display:flex;flex-direction:column;min-height:0}
.rail{display:flex;flex-direction:column;gap:34px;padding:34px 22px 22px;background:#111111;color:#f5f3ee;overflow:auto}
.wordmark{display:flex;align-items:center;gap:13px}.monogram{display:grid;place-items:center;width:36px;height:36px;flex:none;background:#eeeae2;color:#171717;font:26px/1 var(--serif);border-radius:50% 50% 2px 50%;transform:rotate(-8deg)}
h1{font:600 26px/1.25 var(--serif);letter-spacing:.08em;margin:0}.brand-sub{font-size:11px;line-height:1.5;letter-spacing:.01em;color:#b4b4b4;margin-top:7px}
.navigation{display:flex;flex-direction:column;gap:8px}.nav-button{display:grid;grid-template-columns:25px minmax(0,1fr);align-items:center;gap:10px;text-align:left;background:transparent!important;color:#bcbcbc;border:1px solid transparent!important;padding:15px 12px;border-radius:5px;position:relative;min-height:54px}.nav-button[aria-current=step]{color:#fffaf4;background:#242424!important;border-color:#3a3a3a!important}.nav-button[aria-current=step]:after{content:'';position:absolute;left:-1px;top:16px;bottom:16px;width:3px;border-radius:2px;background:#d9755b}.nav-button:hover:not(:disabled){color:white;background:#202020!important}.nav-num{font:11px/1.4 var(--mono);font-variant-numeric:tabular-nums;color:#8a8a8a}.nav-button[aria-current=step] .nav-num{color:#e28b74}.nav-label{font-size:14px;line-height:1.5;letter-spacing:.025em}.nav-button:disabled{opacity:1;color:#777}.nav-button:disabled .nav-num{color:#676767}
.rail-art{margin:auto 0 2px;position:relative;height:156px;flex:none;overflow:hidden}.orbit{position:absolute;width:112px;height:112px;border:1px solid #515151;border-radius:50%;left:3px;top:9px}.orbit.second{left:42px;top:34px;border-color:#92908b}.orbit:after{content:'';position:absolute;width:6px;height:6px;background:#dfdcd5;border-radius:50%;top:16px;right:10px}.orbit.second:after{top:auto;bottom:10px;left:19px;background:#d9755b}.orbit-arrow{position:absolute;left:60px;top:44px;font:36px/1 var(--serif);color:#e6e3dc}.rail-caption{font-size:11px;line-height:1.7;letter-spacing:.025em;color:#a5a5a5;border-top:1px solid #353535;padding-top:16px}
.head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 32px;border-bottom:1px solid var(--line);flex:none}.breadcrumb{font-size:12px;color:var(--muted);letter-spacing:.035em}.breadcrumb strong{color:var(--ink);font-weight:500;margin-left:12px}.close{width:44px;min-height:44px;flex:none;border-radius:50%;font-size:24px;padding:0!important;line-height:1}
.scroll{overflow:auto;overscroll-behavior:contain;flex:1;min-height:0;padding:30px 34px 34px;scrollbar-gutter:stable;scrollbar-width:thin;scrollbar-color:#c9c5bd transparent}.scroll::-webkit-scrollbar{width:5px}.scroll::-webkit-scrollbar-thumb{background:#c9c5bd;border-radius:4px}.scroll::-webkit-scrollbar-button{display:none}
.intro{display:block;margin-bottom:24px}.hero-title{font:500 clamp(28px,3.2vw,36px)/1.45 var(--serif);letter-spacing:0;margin:0;overflow-wrap:anywhere}.hero-title em{font-style:normal;color:var(--accent)}.hero-copy{max-width:52em;font-size:13px;line-height:1.85;color:var(--muted);margin:12px 0 0}.intro-line{display:inline}
dialog[data-panel=result] .hero-title{font-size:clamp(24px,2.8vw,32px)}dialog[data-panel=result] .intro-line{display:inline}dialog[data-panel=result] .hero-copy{display:none}dialog[data-panel=result] .intro{margin-bottom:22px}
button,input,textarea,select{font:inherit;color:inherit;max-width:100%}button,select,input:not([type=checkbox]):not([type=radio]){min-height:44px}
button{border:1px solid #cbc7be;border-radius:5px;padding:10px 15px;background:#fffefa;cursor:pointer;white-space:normal;line-height:1.4;transition:background .18s,color .18s,border-color .18s,transform .18s}
button:hover:not(:disabled){background:#eeece6;border-color:#aaa59b}button:active:not(:disabled){transform:translateY(1px)}button:disabled{opacity:.46;cursor:not-allowed}.primary{background:var(--accent);color:#fff9f0;border-color:var(--accent);font-weight:600}.primary:hover:not(:disabled){background:#923421;border-color:#923421}.primary:after{content:'↗';display:inline-block;margin-left:16px;font-size:18px;font-weight:400}.quiet{background:transparent}.danger{color:#a63525;border-color:#c88270}
:focus-visible{outline:3px solid #b7422c;outline-offset:3px}.rail :focus-visible{outline-color:#dfcbbd}
input,textarea,select{background:#fffefa;border:1px solid #cfcbc3;border-radius:4px;padding:10px 12px;width:100%;transition:border-color .18s}input:hover,textarea:hover,select:hover{border-color:#aaa59b}input:focus,textarea:focus,select:focus{border-color:var(--accent)}textarea{resize:vertical;min-height:120px;line-height:1.65;tab-size:2}input[type=checkbox],input[type=radio]{width:18px;height:18px;flex:none;accent-color:#333333;margin:0}
input[type=file]{font-size:12px;padding:8px;border:1px dashed #bdb6aa;background:#f0eee8}input::file-selector-button{border:0;background:#e6e1d7;color:#34312d;padding:8px 12px;border-radius:3px;margin-right:10px;cursor:pointer}.code{font-family:var(--mono);font-size:12px}
h2{font-size:18px;line-height:1.5;margin:0 0 22px;font-weight:600;letter-spacing:.015em}h3{font-size:15px;margin:0 0 10px;font-weight:600}p{margin:0 0 10px}p:last-child{margin-bottom:0}.muted{color:var(--muted)}.small{font-size:12px}.section{animation:mzm-reveal .25s ease both}.section-heading{display:flex;gap:11px;align-items:center}.section-heading:before{content:attr(data-number);font:11px var(--mono);width:24px;display:block;color:#8b8477;flex:none}
details{border-top:1px solid var(--line)}summary{cursor:pointer;min-height:46px;padding:13px 0;font-size:13px;font-weight:500;list-style:none;display:flex;align-items:center;justify-content:space-between;gap:14px}summary::-webkit-details-marker{display:none}summary:after{content:'+';font:18px var(--mono);color:#807a71;flex:none}details[open]>summary:after{content:'−'}details[open]>summary{margin-bottom:8px}details>summary:hover{color:var(--accent)}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:end}.row>*{flex:1}.row>.fit{flex:0 0 auto}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.field{display:block;margin-bottom:14px}.field>span:first-child{display:block;margin-bottom:8px;font-size:13px;font-weight:500}.check{display:flex;gap:10px;align-items:flex-start;min-height:44px;padding:11px 0;cursor:pointer}.check input{margin-top:4px}.check>span{flex:1}.radio{align-items:center}.radio input{margin:0}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.actions button{flex:0 1 auto}.actions.compact button{font-size:12px;padding:8px 12px}
.notice{border-left:2px solid #817a6d;background:#eeece5;padding:12px 15px;margin:12px 0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}.warn{background:#f7f0df;border-color:#b79045;color:#72501c}.error{background:#f9eae3;border-color:#bb624b;color:#8c3020}.status{margin:0 0 28px;border:0;border-left:2px solid #8d8679;background:#eeece5;padding:11px 14px}.status strong{display:block;font-size:13px;font-weight:600}.status p{font-size:12px;line-height:1.8;margin:4px 0 0;color:#69645c}.status.error p{color:#913c2b}.status.loading strong:before{content:'';display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--accent);margin-right:9px;animation:mzm-pulse 1.5s ease infinite}
.tag{font:10px/1.6 var(--mono);padding:3px 7px;border-radius:2px;background:#e5ebda;color:#3d5631;display:inline-block;flex:none}.tag.warn{background:#f1e5d4;color:#82501e}.script{border-top:1px solid var(--line)}.script label{margin:0;padding:14px 0}.script .hint{display:block;margin-top:2px}.break{overflow-wrap:anywhere;word-break:break-word}.hint{margin-top:6px;color:var(--muted);font-size:12px;line-height:1.8}.spaced{margin-top:20px}
.transfer{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:24px;margin-bottom:28px}.transfer-item{padding:0 0 16px;border-bottom:1px solid var(--line);position:relative}.transfer-item:last-child{padding-left:24px;border-left:1px solid var(--line)}.transfer-label{font-size:11px;line-height:1.6;letter-spacing:.035em;color:#80786b;margin-bottom:8px}.transfer-item h3{font-size:17px;line-height:1.6;font-weight:600;margin-bottom:10px}.transfer-item .break{font-size:13px;line-height:1.8;min-height:48px;color:var(--muted);margin-bottom:14px}.transfer-item button{font-size:13px}.transfer-item .row{gap:8px}.transfer-item .row>.fit{flex:1 1 auto}.read-options{margin-top:12px}.read-options .row{align-items:start}.read-options .field{flex:1 1 100%}.source-tools{margin-top:12px}.source-tools summary{font-size:12px}.capabilities{border-top:1px solid var(--line);padding-top:14px;font-size:11px;line-height:1.9;margin-top:20px}
.connection-card{border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:22px 0;margin:22px 0}.connection-heading{font-size:18px;line-height:1.7;font-weight:600;margin-bottom:8px}.analysis-lead{font-size:13px;line-height:1.85;color:var(--muted);max-width:540px}.analysis-actions{padding:18px 0}.analysis-actions .primary{min-height:50px}.analysis-footnote{font-size:12px;color:var(--muted);margin-top:12px}
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin:22px 0 26px;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.stat{padding:18px 15px;border-right:1px solid var(--line)}.stat:first-child{padding-left:0}.stat:last-child{border:0}.stat strong{display:block;font:400 32px/1.2 var(--mono);font-variant-numeric:tabular-nums;letter-spacing:-.035em;margin-bottom:8px}.stat span{font-size:12px;color:var(--muted)}.stat.pending strong{color:var(--accent)}
.result-summary{font-size:14px;line-height:1.85;max-width:55em}.target-context{padding:12px 0;font-size:12px;line-height:1.8;color:var(--muted);border-bottom:1px solid var(--line);overflow-wrap:anywhere}.schema-report{border:0;background:#eeece5;padding:0 14px;margin:14px 0}.schema-report>summary{font-size:13px}.schema-report>p,.schema-report>.list{font-size:12px}.schema-report[open]{padding-bottom:14px}.schema-report.warn{background:#f7f0df}.schema-report.error{background:#f9eae3}.diff-toolbar{display:flex;align-items:center;justify-content:space-between;gap:20px;margin:8px 0}.diff-toolbar .field{margin:0;flex:0 0 158px}.diff-toolbar .hint{margin:0;max-width:320px}.change{border-top:1px solid var(--line);padding:20px 0}.change-title{display:flex;gap:9px;align-items:baseline;margin-bottom:12px;font-size:12px;font-weight:600}.path{overflow-wrap:anywhere}.comparison{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:1px;background:var(--line);border:1px solid var(--line);border-radius:5px;overflow:hidden}.before,.after{background:#efefe8;padding:12px 14px}.after{background:#edf2e4}.value-label{font-size:12px;line-height:1.6;letter-spacing:0;color:#69675f;display:block;margin-bottom:10px}pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;font:13px/1.8 var(--mono);max-height:260px;overflow:auto}.reason{margin-top:11px;font-size:12px;line-height:1.85;color:var(--muted)}.reason:before{content:'↳';margin-right:8px;color:#8c997a}
.question{margin:18px 0;padding:20px;border:1px solid #d7c493;background:#faf5e7;border-radius:5px}.question fieldset{padding:0;border:0;margin:0}.question legend{font-size:13px;font-weight:600;overflow-wrap:anywhere}.question .check{border-top:1px solid #e4d9bb}.option-value{color:#756b52;font:11px/1.7 var(--mono);display:block;white-space:pre-wrap;overflow-wrap:anywhere;margin-top:4px}
.rule-library{margin-top:26px}.rule-library h3{margin-bottom:7px}.rule-entry{padding:4px 0 10px;border-top:1px solid var(--line)}.rule-entry .check{padding-bottom:5px}.rule-entry details{border:0;margin-left:28px}.rule-entry summary{min-height:44px;padding:8px 0;font-size:12px}.rule-entry pre{max-height:220px;padding:12px;background:#eeeae2;border-radius:4px}.rule-entry .hint{display:block;margin-top:3px;font-size:11px}.rule-count{font-size:12px;color:var(--muted);margin:10px 0}.rule-warning{font-size:12px;color:#82502b;margin:7px 0}.rule-filters{margin:16px 0 8px}.rule-filters .field{margin-bottom:4px}
.list{padding-left:18px;margin:8px 0;overflow-wrap:anywhere}.list li{margin:5px 0}.backup{padding:18px 0;border-bottom:1px solid var(--line)}.backup-title{font-size:13px;font-weight:600;overflow-wrap:anywhere}.backup .row{align-items:center}.confirm,.apply-box{margin-top:22px;border:1px solid #d6d0c5;border-radius:5px;padding:18px;background:#eeece5}.apply-box .check{font-size:12px}.apply-box>.warn{padding:12px;border-radius:3px}.apply-box>.primary{margin-top:12px}.confirm{background:#f7f0df;border-color:#dccb9e}
.foot{display:flex;gap:12px;align-items:center;border-top:1px solid var(--line);padding:14px 32px;background:var(--paper);flex:none}.foot .muted{flex:1;font-size:12px}.foot button{flex:none;font-size:13px}.foot .quiet{border-color:transparent}.empty{padding:20px 0;color:var(--muted);font-size:13px}.busy-text{font-size:12px;line-height:1.8;color:var(--muted)}
@keyframes mzm-reveal{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}@keyframes mzm-pulse{50%{opacity:.35}}
@media(max-width:900px){.shell{grid-template-columns:178px minmax(0,1fr)}.rail{padding:28px 15px}.wordmark{gap:10px}.brand-sub{font-size:10px}.scroll{padding:24px}.head,.foot{padding-left:24px;padding-right:24px}.hero-title{font-size:32px}.transfer{gap:16px}.transfer-item:last-child{padding-left:16px}.rail-art{transform:scale(.88);transform-origin:left bottom}}
@media(max-width:640px){dialog{width:calc(100vw - 12px);max-width:calc(100vw - 12px);height:calc(100vh - 12px);height:calc(100dvh - 12px);max-height:calc(100dvh - 12px);border-radius:9px}.shell{display:flex;flex-direction:column}.rail{display:block;padding:16px 16px 0;overflow:visible}.wordmark{gap:11px;padding-bottom:16px}.monogram{width:30px;height:30px;font-size:23px}h1{font-size:22px}.brand-sub{font-size:10px;margin-top:5px}.navigation{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px}.nav-button{display:flex;justify-content:center;gap:6px;min-height:46px;padding:10px 3px!important;border-radius:4px 4px 0 0}.nav-button[aria-current=step]{border-bottom:0!important}.nav-button[aria-current=step]:after{inset:auto 8px 0;height:2px;width:auto}.nav-num{font-size:10px}.nav-label{font-size:12px;letter-spacing:0}.rail-art,.rail-caption{display:none}.workspace{flex:1;overflow:hidden}.head{height:0;padding:0;border:0}.breadcrumb{display:none}.close{position:absolute;top:14px;right:13px;background:transparent;color:#eeeeee;border-color:#535353!important;width:44px;min-height:44px}.scroll{padding:24px 19px;scrollbar-gutter:auto}.intro{margin-bottom:22px}.hero-title{font-size:29px;line-height:1.5}.hero-copy{font-size:13px;line-height:1.85;margin-top:10px}.status{margin-bottom:26px;padding:11px 12px}.section-heading{font-size:16px;margin-bottom:20px}.transfer{grid-template-columns:minmax(0,1fr);gap:22px;margin-bottom:24px}.transfer-item:last-child{padding-left:0;border-left:0}.transfer-item .break{min-height:0}.transfer-label{margin-bottom:6px}.transfer-item .actions{margin-top:10px}.grid{grid-template-columns:minmax(0,1fr)}.row>.fit{flex:1 1 120px}.actions>button{flex:1 1 120px}.foot{padding:11px 16px;gap:10px}.foot .muted{font-size:11px;line-height:1.7}.foot .quiet{display:none}.foot .primary{font-size:12px;max-width:166px;padding:10px 12px}.foot .primary:after{margin-left:9px}.stats{margin:18px 0}.stat{padding:15px 8px}.stat strong{font-size:28px}.stat span{font-size:11px}.comparison{grid-template-columns:minmax(0,1fr)}.before,.after{padding:14px}.diff-toolbar{display:block}.diff-toolbar .field{margin-bottom:10px}.change-title{flex-wrap:wrap}.apply-box,.question{padding:14px}.connection-heading{font-size:17px}input,textarea,select{font-size:16px}textarea.code{font-size:14px}.backup .row>div{flex-basis:100%}.result-summary{font-size:13px}}
@media(max-width:350px){.scroll{padding:22px 15px}.nav-num{display:none}.hero-title{font-size:26px}.foot{padding:10px 13px}.foot .primary:after{display:none}.stat strong{font-size:25px}}
@media(max-width:640px){.wordmark{padding-right:50px}.head{cursor:auto}.variable-editor textarea{font-size:16px}.foot .clear-content{display:inline-flex;padding:9px 8px;min-width:64px;justify-content:center}.foot .muted{font-size:10px}.foot .primary{max-width:140px}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
@media(pointer:coarse){.head{cursor:auto}}
`;

const schemaLabels = { passed: '已覆盖的结构检查通过', supported: '已识别结构，等待结果检查', failed: '发现结构错误，暂不能写入', partial: '部分结构可检查', unavailable: '暂不能检查结构' };
const phaseLabels = { idle: '先准备旧存档与新版结构', ready: '资料已准备，可以分析', analyzing: '正在分析迁移方案', preview: '迁移预览 · 尚未写入', saved: '本次存档操作已完成', error: '本次操作未完成' };
const kindLabels = { add: '新增', remove: '删除', change: '改动' };
const asArray = value => Array.isArray(value) ? value : [];
const records = value => asArray(value).filter(item => item && typeof item === 'object' && !Array.isArray(item));
const textOf = value => value == null ? '' : String(value);
const pathOf = path => Array.isArray(path) && path.length ? path.map(String).join(' / ') : '根数据';
const countOf = value => Array.isArray(value) ? value.length : Math.max(0, Number(value) || 0);
function jsonText(value) { if (value === undefined) return '不存在'; try { return JSON.stringify(value, null, 2); } catch { return '无法显示此值'; } }
function signature(value) { try { return JSON.stringify(value); } catch { return ''; } }

export function mountUI({ document: doc, actions = {} }) {
  if (!doc?.createElement || !doc.body) throw new Error('迁移面板需要可访问的宿主页面。');
  let view = {}, destroyed = false, opened = false, previousFocus = null, scrollLock = null;
  let scriptSignature = '', questionSignature = '', changeSignature = '', targetChangeSignature = '', backupSignature = '', confirmationSignature = '', schemaReportStatus = '';
  let visibleChanges = 40, visibleTargetChanges = 40, targetDirty = false, oldDirty = false, restoreId = null, sourceRevision;
  let activePanel = 'prepare', resetRevision = 0;
  let rulesDirty = false, ruleSignature = '', visibleRules = 40, bookSignature = '', chatSignature = '', importEpoch = 0, resultImportEpoch = 0;
  const panelScroll = {}, panels = {}, navNodes = new Map();
  const disposers = [];
  const dynamicDisposers = { scripts: [], rules: [], questions: [], backups: [] };
  const el = (tag, text, className) => { const node = doc.createElement(tag); if (text != null) node.textContent = textOf(text); if (className) node.className = className; return node; };
  const on = (node, type, handler) => { node.addEventListener(type, handler); disposers.push(() => node.removeEventListener(type, handler)); };
  const onDynamic = (scope, node, type, handler) => { node.addEventListener(type, handler); dynamicDisposers[scope].push(() => node.removeEventListener(type, handler)); };
  const cleanDynamic = scope => dynamicDisposers[scope].splice(0).forEach(dispose => dispose());
  const root = el('div'); root.id = 'mvu-zod-migrator-ui';
  const shadow = root.attachShadow({ mode: 'open' });
  const style = el('style', CSS); shadow.append(style);
  const fallbackShade = el('div', null, 'fallback-shade'); fallbackShade.hidden = true; shadow.append(fallbackShade);
  const dialog = el('dialog'); dialog.setAttribute('aria-labelledby', 'mzm-heading');
  const shell = el('div', null, 'shell'), rail = el('aside', null, 'rail'), workspace = el('div', null, 'workspace');
  const wordmark = el('div', null, 'wordmark'), monogram = el('span', '续', 'monogram'); monogram.setAttribute('aria-hidden', 'true');
  const brand = el('div', null, 'brand'); const heading = el('h1', '续章'); heading.id = 'mzm-heading';
  brand.append(heading, el('div', 'MVU Zod · 存档迁移', 'brand-sub')); wordmark.append(monogram, brand);
  const navigation = el('nav', null, 'navigation'); navigation.setAttribute('aria-label', '迁移工作区');
  rail.append(wordmark, navigation);
  const head = el('header', null, 'head'), breadcrumb = el('div', '工作区 /', 'breadcrumb'), panelLabel = el('strong', '准备资料'); breadcrumb.append(panelLabel);
  const closeButton = el('button', '×', 'quiet close'); closeButton.type = 'button'; closeButton.setAttribute('aria-label', '关闭迁移面板');
  head.append(breadcrumb, closeButton);
  const body = el('main', null, 'scroll');
  const localError = el('div', '', 'notice error'); localError.hidden = true; localError.setAttribute('role', 'alert');
  const status = el('section', null, 'notice status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true');
  const statusTitle = el('strong'), statusMessage = el('p'), progress = el('p', '', 'busy-text'); status.append(statusTitle, statusMessage, progress);
  body.append(status, localError);

  const button = (text, handler, className = '', scope = null) => { const b = el('button', text, className); b.type = 'button'; if (scope) onDynamic(scope, b, 'click', handler); else on(b, 'click', handler); return b; };
  const field = (label, input, hint) => { const l = el('label', null, 'field'); l.append(el('span', label), input); if (hint) l.append(el('span', hint, 'hint')); return l; };
  const input = (type, value = '') => { const n = el('input'); n.type = type; n.value = value; return n; };
  const check = (label, type = 'checkbox') => { const n = input(type), l = el('label', null, 'check'); l.append(n, el('span', label)); return { node: l, input: n }; };
  const section = (title, key, number) => { const n = el('section', null, 'section'); n.id = 'mzm-panel-' + key; n.dataset.panel = key; const h = el('h2', title, 'section-heading'); h.dataset.number = number; h.tabIndex = -1; n.append(h); body.append(n); panels[key] = n; return n; };
  const errorMessage = error => { let message = error?.message || textOf(error) || '操作失败，请重试。'; if (apiKey.value) message = message.split(apiKey.value).join('[密钥已隐藏]'); return message; };
  async function run(name, ...args) {
    if (destroyed) return;
    localError.hidden = true;
    if (typeof actions[name] !== 'function') { localError.textContent = '当前环境未连接此操作：' + name; localError.hidden = false; return false; }
    try { const success = await actions[name](...args); return success !== false && !destroyed; }
    catch (error) { if (!destroyed) { localError.textContent = errorMessage(error); localError.hidden = false; } return false; }
  }
  function variableEditor(label, action, dataFor) {
    const node = el('details', null, 'variable-editor'), code = el('textarea', '', 'code'), note = el('p', '', 'hint editor-note');
    code.spellcheck = false; code.rows = 10;
    let dirty = false;
    const sync = () => { if (!dirty && node.open) { const text = jsonText(dataFor() || {}); if (code.value !== text) code.value = text; } };
    const save = button(action === 'editSource' ? '应用旧变量编辑' : '检查并更新结果', async () => {
      const value = code.value;
      if (await run(action, value)) { if (code.value === value) { dirty = false; sync(); } updateButtons(); }
    });
    const reset = button('撤销未应用编辑', () => { dirty = false; sync(); updateButtons(); }, 'quiet');
    const buttons = el('div', null, 'actions'); buttons.append(save, reset);
    node.append(el('summary', label), field(label + '（JSON）', code), note, buttons);
    on(node, 'toggle', sync);
    on(code, 'input', () => { dirty = true; writeAck.input.checked = false; partialAck.input.checked = false; updateButtons(); });
    return { node, dirty: () => dirty, clear(empty = false) { dirty = false; if (empty) code.value = ''; else sync(); }, render(disabled) { sync(); code.disabled = disabled; save.disabled = disabled || !dirty; reset.disabled = disabled || !dirty; note.textContent = dirty ? '编辑尚未应用。' : ''; } };
  }

  const prepare = section('准备迁移数据', 'prepare', '01');
  const transfer = el('div', null, 'transfer'), sourceCard = el('div', null, 'transfer-item'), targetCard = el('div', null, 'transfer-item');
  sourceCard.append(el('h3', '旧存档变量'));
  targetCard.append(el('h3', '新版目标'));
  const targetInfo = el('p', '尚未读取目标聊天', 'break');
  const floor = input('number', '-1'); floor.min = '-1'; floor.step = '1'; floor.inputMode = 'numeric';
  const sourceFloor = input('number', '-1'); sourceFloor.min = '-1'; sourceFloor.step = '1'; sourceFloor.inputMode = 'numeric';
  function capture(replaceSource = false) {
    const selectedFloor = replaceSource ? sourceFloor : floor;
    if (!selectedFloor.checkValidity() || !Number.isInteger(Number(selectedFloor.value)) || selectedFloor.value.trim() === '') { selectedFloor.reportValidity(); localError.textContent = '请输入楼层编号；-1 表示最新楼层。'; localError.hidden = false; return; }
    run('capture', { floor: Number(selectedFloor.value), replaceSource });
  }
  const captureButton = button('读取新版目标', () => capture());
  const refreshButton = button('刷新目标状态', () => run('refresh'), 'quiet');
  const captureRow = el('div', null, 'row'); captureRow.append(captureButton, refreshButton);
  captureButton.classList.add('fit'); refreshButton.classList.add('fit');
  const sourceInfo = el('p', '旧数据：尚未导入或读取', 'muted break');
  const exportSourceButton = button('导出旧存档与结构', () => run('exportSource'));
  const replaceSourceButton = button('提取当前聊天', () => capture(true), 'quiet');
  const exportVariablesButton = button('下载提取的变量', () => run('exportVariables'));
  const sourceActions = el('div', null, 'actions compact'); sourceActions.append(replaceSourceButton, exportVariablesButton);
  const sourceTools = el('details', null, 'source-tools'); sourceTools.append(el('summary', '读取指定旧楼层 / 导出结构'), field('旧存档读取楼层', sourceFloor, '-1 为最近有效楼层；其他编号从 0 开始。'), exportSourceButton);
  const readOptions = el('details', null, 'read-options'); readOptions.append(el('summary', '指定读取楼层'), field('读取楼层', floor, '-1 自动寻找最近有变量的楼层，其他编号从 0 开始。'));
  sourceCard.append(sourceInfo);
  const targetActionField = el('div', null, 'field'); targetActionField.append(captureRow);
  const resultFile = input('file'); resultFile.accept = '.json,application/json';
  on(resultFile, 'change', async () => {
    const file = resultFile.files?.[0]; if (!file) return;
    const token = ++resultImportEpoch;
    if (file.size > 8 * 1024 * 1024) { localError.textContent = '变量文件超过 8 MiB。'; localError.hidden = false; resultFile.value = ''; return; }
    try {
      const text = await file.text();
      if (!destroyed && token === resultImportEpoch && await run('importResult', text, file.name) && view.phase === 'preview') { reviewText.value = ''; showPanel('result', true); updateButtons(); }
    } catch (error) { if (!destroyed && token === resultImportEpoch) { localError.textContent = errorMessage(error); localError.hidden = false; } }
    finally { if (token === resultImportEpoch) resultFile.value = ''; }
  });
  targetCard.append(targetInfo, targetActionField, readOptions, field('导入新版变量存档', resultFile));
  transfer.append(sourceCard, targetCard); prepare.append(transfer);
  const importArea = el('details', null, 'source-tools'); importArea.append(el('summary', '或粘贴旧变量 / 聊天内容'));
  const importFile = input('file'); importFile.accept = '.json,.jsonl,application/json,application/x-ndjson';
  const importText = el('textarea'); importText.className = 'code'; importText.placeholder = '旧变量 JSON、工具存档，或酒馆导出的聊天 JSONL'; importText.spellcheck = false;
  const importButton = button('使用这份旧数据', () => run('importSource', importText.value));
  on(importFile, 'change', async () => {
    const file = importFile.files?.[0]; if (!file) return;
    const token = ++importEpoch;
    if (file.size > CHAT_FILE_LIMIT) { localError.textContent = '文件超过 64 MiB，请导出较短的聊天副本或单独变量。'; localError.hidden = false; return; }
    try { const text = await file.text(); if (!destroyed && token === importEpoch) await run('importSource', text, file.name); }
    catch (error) { if (!destroyed && token === importEpoch) { localError.textContent = errorMessage(error); localError.hidden = false; } }
    finally { if (token === importEpoch) importFile.value = ''; }
  });
  const chatChoice = el('div', null, 'chat-choice'), chatSelect = el('select');
  on(chatSelect, 'change', () => run('selectChatSource', chatSelect.value));
  chatChoice.append(field('选择旧聊天存档', chatSelect)); chatChoice.hidden = true;
  const sourceVariables = variableEditor('查看 / 编辑旧变量', 'editSource', () => view.sourceData);
  importArea.append(field('或粘贴 JSON / JSONL', importText), importButton);
  sourceCard.append(field('提取旧聊天 / 存档变量', importFile, 'JSON / JSONL'), chatChoice, sourceActions, sourceVariables.node, importArea, sourceTools);
  const scriptTitle = el('h3', '新版结构脚本'); scriptTitle.className = 'spaced';
  const scripts = el('div'); scripts.setAttribute('aria-label', '候选新版结构脚本');
  const scriptEmpty = el('p', '读取新版目标，或粘贴结构脚本。', 'empty'); scripts.append(scriptEmpty);
  const scriptNodes = new Map();
  const targetEditor = el('details'); targetEditor.append(el('summary', '查看或手动提供新版结构源码'));
  const targetCode = el('textarea'); targetCode.className = 'code'; targetCode.spellcheck = false; targetCode.rows = 8; targetCode.placeholder = '粘贴新版 MVU Zod 结构脚本；内容仅用于分析，不会作为代码执行';
  const targetSave = button('使用这份新版源码', async () => { const value = targetCode.value; if (await run('editTargetScript', value)) { if (targetCode.value === value) targetDirty = false; updateButtons(); } });
  const targetDraftInfo = el('span', '', 'hint');
  on(targetCode, 'input', () => { targetDirty = true; targetDraftInfo.textContent = '源码有未应用的修改'; updateButtons(); });
  targetEditor.append(field('新版结构源码', targetCode), targetDraftInfo, targetSave);
  const oldEditor = el('details'); oldEditor.append(el('summary', '补充旧版结构源码（可选）'));
  const oldCode = el('textarea'); oldCode.className = 'code'; oldCode.spellcheck = false; oldCode.rows = 6;
  oldCode.placeholder = '有旧版 MVU Zod 脚本时粘贴在这里，可帮助 AI 判断字段改名与含义变化';
  const oldSave = button('使用这份旧版源码', async () => { const value = oldCode.value; if (await run('setOldScript', value)) { if (oldCode.value === value) oldDirty = false; updateButtons(); } });
  const oldDraftInfo = el('span', '', 'hint');
  on(oldCode, 'input', () => { oldDirty = true; oldDraftInfo.textContent = '旧版源码有未应用的修改'; updateButtons(); });
  oldEditor.append(field('旧版结构源码', oldCode), oldDraftInfo, oldSave);
  const capabilities = el('div', '', 'hint capabilities'), diagnostics = el('details'); diagnostics.append(el('summary', '连接信息'), capabilities); prepare.append(scriptTitle, scripts, targetEditor, oldEditor);

  const ruleLibrary = el('div', null, 'rule-library'), ruleInfo = el('p', '', 'rule-count'), ruleWarnings = el('div');
  const ruleBrowser = el('details'); ruleBrowser.append(el('summary', '查看与选择世界书条目'));
  const bookSearch = input('search'); bookSearch.placeholder = '搜索酒馆中的世界书名称';
  const bookSelect = el('select');
  on(bookSearch, 'input', () => { bookSignature = ''; renderBooks(); });
  on(bookSelect, 'change', async () => { const name = bookSelect.value; visibleRules = 40; ruleSearch.value = ''; selectedOnly.input.checked = false; await run('openWorldbook', name); bookSignature = ''; renderBooks(); });
  const bookFields = el('div', null, 'grid'); bookFields.append(field('查找世界书', bookSearch), field('选择世界书', bookSelect));
  const ruleSearch = input('search'); ruleSearch.placeholder = '按世界书、条目名称或正文搜索';
  const allRules = check('显示全部条目（含未启用条目）'); allRules.input.checked = true;
  const selectedOnly = check('只看已选条目（跨世界书）');
  const ruleFilters = el('div', null, 'rule-filters'); ruleFilters.append(field('查找条目', ruleSearch), allRules.node, selectedOnly.node);
  const ruleList = el('div'); ruleList.setAttribute('aria-label', '世界书规则条目'); const ruleNodes = new Map();
  const ruleCount = el('p', '', 'hint'), moreRules = button('显示更多条目', () => { visibleRules += 40; ruleSignature = ''; renderRules(); updateButtons(); }, 'quiet');
  on(ruleSearch, 'input', () => { visibleRules = 40; ruleSignature = ''; renderRules(); updateButtons(); });
  on(allRules.input, 'change', () => { visibleRules = 40; ruleSignature = ''; renderRules(); updateButtons(); });
  on(selectedOnly.input, 'change', () => { visibleRules = 40; ruleSignature = ''; renderRules(); updateButtons(); });
  const clearRules = button('清空规则选择', () => run('selectRules', []), 'quiet');
  ruleBrowser.append(bookFields, ruleFilters, ruleCount, ruleList, moreRules, clearRules);
  const ruleEditor = el('details'); ruleEditor.append(el('summary', '手动补充变量更新规则'));
  const ruleCode = el('textarea'); ruleCode.rows = 6; ruleCode.placeholder = '粘贴世界书中的变量更新规则；它会作为分析资料，不会被执行。';
  const ruleDraftInfo = el('span', '', 'hint');
  const ruleSave = button('使用这份规则', async () => { const value = ruleCode.value; if (await run('editRules', value)) { if (ruleCode.value === value) rulesDirty = false; updateButtons(); } });
  on(ruleCode, 'input', () => { rulesDirty = true; updateButtons(); });
  ruleEditor.append(field('新版变量更新规则', ruleCode), ruleDraftInfo, ruleSave);
  ruleLibrary.append(el('h3', '新版变量更新规则'), ruleInfo, ruleWarnings, ruleBrowser, ruleEditor);
  prepare.append(ruleLibrary, diagnostics);

  const analysis = section('配置分析连接', 'analysis', '02');
  const mode = el('select'); for (const [value, label] of [['current', '使用酒馆当前连接'], ['custom', '使用独立 API 配置']]) { const option = el('option', label); option.value = value; mode.append(option); }
  const apiUrl = input('url'); apiUrl.placeholder = 'https://api.example.com/v1'; apiUrl.autocomplete = 'off';
  const apiModel = input('text'); apiModel.placeholder = '填写模型名称'; apiModel.autocomplete = 'off';
  const apiKey = input('password'); apiKey.autocomplete = 'off'; apiKey.spellcheck = false; apiKey.setAttribute('data-private', 'true');
  const custom = el('div', null, 'grid'); custom.hidden = true;
  custom.append(field('API 地址', apiUrl), field('模型名称', apiModel), field('API 密钥', apiKey, '仅保留在本次面板会话，不写进存档或导出文件。'));
  on(mode, 'change', () => { custom.hidden = mode.value !== 'custom'; });
  const structured = check('JSON 格式约束（需接口支持）');
  const requirements = el('textarea'); requirements.rows = 4; requirements.maxLength = 16000;
  requirements.placeholder = '例如：保留已发生的剧情与关系；新增数值没有明确依据时先询问，不要直接填满。';
  on(requirements, 'input', () => { writeAck.input.checked = false; partialAck.input.checked = false; updateButtons(); });
  const connectionConfig = () => ({ mode: mode.value, url: mode.value === 'custom' ? apiUrl.value.trim() : '', key: mode.value === 'custom' ? apiKey.value : '', model: mode.value === 'custom' ? apiModel.value.trim() : '', structured: structured.input.checked });
  const analyzeButton = button('分析并生成迁移预览', () => run('analyze', { ...connectionConfig(), requirements: requirements.value }), 'primary');
  const cancelButton = button('取消分析', () => run('cancel'), 'quiet');
  const analysisButtons = el('div', null, 'actions analysis-actions'); analysisButtons.append(analyzeButton, cancelButton);
  const connectionCard = el('div', null, 'connection-card'); connectionCard.append(field('分析连接', mode), custom, structured.node);
  const analysisRuleInfo = el('p', '', 'target-context');
  analysis.append(connectionCard, field('迁移要求（可选）', requirements), analysisRuleInfo, el('p', '将所选资料发送给模型，不发送聊天正文。', 'hint'), analysisButtons);

  const result = el('section', null, 'section'); result.hidden = true; result.setAttribute('aria-labelledby', 'mzm-result-heading');
  result.id = 'mzm-panel-result'; result.dataset.panel = 'result'; panels.result = result;
  const resultHeading = el('h2', '迁移结果', 'section-heading'); resultHeading.dataset.number = '03'; resultHeading.id = 'mzm-result-heading'; resultHeading.tabIndex = -1;
  const resultSummary = el('p', '', 'break result-summary'), resultTarget = el('p', '', 'target-context');
  const stats = el('div', null, 'stats'); const statNodes = {};
  for (const [key, label, cls] of [['add', '新增字段', ''], ['change', '改动字段', ''], ['remove', '删除字段', 'removed'], ['pending', '等待选择', 'pending']]) { const box = el('div', null, 'stat ' + cls), number = el('strong', '0'); box.append(number, el('span', label)); stats.append(box); statNodes[key] = number; }
  const resultWarnings = el('div');
  const schemaBlock = el('details', null, 'schema-report'); const schemaTitle = el('summary'), schemaExplanation = el('p'), schemaList = el('ul', null, 'list'); schemaBlock.append(schemaTitle, schemaExplanation, schemaList);
  const questions = el('div'); questions.setAttribute('aria-label', '需要你选择的项目'); const questionNodes = new Map();
  const detail = el('details'); detail.open = true; detail.append(el('summary', '查看迁移前后的变化'));
  const filter = el('select'); for (const [value, label] of [['all', '全部变化'], ['change', '只看改动'], ['add', '只看新增'], ['remove', '只看删除']]) { const option = el('option', label); option.value = value; filter.append(option); }
  const changeInfo = el('p', '', 'hint'); const changes = el('div');
  const moreButton = button('显示更多变化', () => { visibleChanges += 40; renderChanges(); }, 'quiet');
  on(filter, 'change', () => { visibleChanges = 40; renderChanges(); });
  const diffToolbar = el('div', null, 'diff-toolbar'); diffToolbar.append(field('筛选变化', filter), changeInfo); detail.append(diffToolbar, changes, moreButton);
  const targetDetail = el('details', null, 'spaced'); targetDetail.hidden = true;
  const targetDetailTitle = el('summary', '目标聊天将被替换的内容');
  const targetChangeInfo = el('p', '', 'hint'), targetChanges = el('div');
  const moreTargetButton = button('显示更多变化', () => { visibleTargetChanges += 40; renderTargetChanges(); }, 'quiet');
  targetDetail.append(targetDetailTitle, el('p', '这里列出目标楼层写入前后实际发生的变化，请核对其中已有的游玩进度。', 'notice warn'), targetChangeInfo, targetChanges, moreTargetButton);
  const resultExports = el('div', null, 'actions');
  const exportResultButton = button('下载新版变量存档', () => run('exportResult'));
  const exportReportButton = button('下载迁移报告', () => run('exportReport'), 'quiet'); resultExports.append(exportResultButton, exportReportButton);
  const partialAck = check('我已了解未覆盖的结构检查范围。'); partialAck.node.classList.add('warn');
  const writeAck = check('我已核对目标聊天、楼层和变化，确认写入。');
  const applyButton = button('备份并应用到目标聊天', () => {
    if (canApplyNow()) run('apply', { ackPartial: partialAck.input.checked, confirmed: writeAck.input.checked });
  }, 'primary');
  const applyNote = el('p', '', 'hint');
  const applyBox = el('div', null, 'apply-box'); applyBox.append(partialAck.node, writeAck.node, applyButton, applyNote);
  const reviewBox = el('div', null, 'review-box'), reviewText = el('textarea'); reviewText.rows = 3; reviewText.maxLength = 16000;
  reviewText.placeholder = '指出要保留、撤销或修改的内容，也可以补充字段含义。';
  const reviewInfo = el('p', '', 'hint');
  const reviseButton = button('按反馈重新调整方案', async () => {
    const instructions = reviewText.value;
    if (await run('revise', { ...connectionConfig(), instructions }) && view.phase === 'preview' && reviewText.value === instructions) reviewText.value = '';
    updateButtons();
  });
  on(reviewText, 'input', () => { writeAck.input.checked = false; partialAck.input.checked = false; updateButtons(); });
  reviewBox.append(field('补充修改意见', reviewText), reviewInfo, reviseButton);
  const resultVariables = variableEditor('编辑迁移结果', 'editResult', () => view.resultData);
  on(partialAck.input, 'change', updateButtons); on(writeAck.input, 'change', updateButtons);
  result.append(resultHeading, resultSummary, resultTarget, stats, resultWarnings, schemaBlock, questions, resultVariables.node, detail, targetDetail, reviewBox, resultExports, applyBox); body.append(result);

  const restore = section('备份与恢复', 'restore', '04'); const backupList = el('div');
  const backupFile = input('file'); backupFile.accept = '.json,application/json';
  on(backupFile, 'change', async () => {
    const file = backupFile.files?.[0]; if (!file) return;
    if (file.size > 10 * 1024 * 1024) { localError.textContent = '备份文件超过 10 MiB，请检查选择的文件。'; localError.hidden = false; backupFile.value = ''; return; }
    try { const text = await file.text(); if (!destroyed) await run('importBackup', text); }
    catch (error) { if (!destroyed) { localError.textContent = errorMessage(error); localError.hidden = false; } }
    finally { backupFile.value = ''; }
  });
  const restoreConfirm = el('div', null, 'confirm'); restoreConfirm.hidden = true;
  const restoreText = el('p'); const restoreButtons = el('div', null, 'actions');
  const restoreConfirmButton = button('确认恢复这份备份', async () => { const id = restoreId; if (id != null && await run('restore', id)) { restoreId = null; restoreConfirm.hidden = true; } }, 'danger');
  const restoreCancel = button('取消恢复', () => { restoreId = null; restoreConfirm.hidden = true; }, 'quiet');
  restoreButtons.append(restoreConfirmButton, restoreCancel); restoreConfirm.append(restoreText, restoreButtons);
  restore.append(el('p', '备份保存在当前浏览器，可下载保存。', 'hint'), field('导入本工具导出的迁移前备份', backupFile), backupList, restoreConfirm);
  const foot = el('footer', null, 'foot'); const footText = el('span', '预览不会修改聊天。', 'muted small');
  const clearButton = button('清空内容', () => run('clear'), 'quiet clear-content'); clearButton.title = '清空本次资料、输入和结果；聊天与备份保留';
  const nextButton = button('继续 · AI 分析', () => showPanel('analysis', true), 'primary'); foot.append(footText, clearButton, nextButton);
  const panelMeta = {
    prepare: { label: '准备资料', number: '01' },
    analysis: { label: 'AI 分析', number: '02' },
    result: { label: '核对结果', number: '03' },
    restore: { label: '备份恢复', number: '04' }
  };
  for (const [key, meta] of Object.entries(panelMeta)) {
    const n = button('', () => showPanel(key), 'nav-button'), label = el('span', meta.label, 'nav-label');
    n.append(el('span', meta.number, 'nav-num'), label);
    n.setAttribute('aria-label', meta.label); n.setAttribute('aria-controls', 'mzm-panel-' + key); n.dataset.destination = key;
    navigation.append(n); navNodes.set(key, n);
  }
  workspace.append(head, body, foot); shell.append(rail, workspace); dialog.append(shell); shadow.append(dialog); doc.body.append(root);
  const desktopDrag = () => (doc.defaultView?.innerWidth || 1024) > 640 && !doc.defaultView?.matchMedia?.('(pointer: coarse)').matches;
  const updateTitlebar = () => { head.tabIndex = desktopDrag() ? 0 : -1; };
  updateTitlebar(); if (doc.defaultView) on(doc.defaultView, 'resize', updateTitlebar);
  const drag = attachDrag({ element: dialog, handles: [head], window: doc.defaultView, storage: (() => { try { return doc.defaultView?.localStorage; } catch {} })(), key: 'mvu-zod-migrator.panel-position.v1', enabled: desktopDrag });

  function showPanel(key, focus = false) {
    if (!panels[key] || key === 'result' && !view.preview) return;
    panelScroll[activePanel] = body.scrollTop || 0; activePanel = key;
    updatePanels(); body.scrollTop = panelScroll[key] || 0;
    if (focus) { const title = key === 'result' ? resultHeading : panels[key].querySelectorAll('h2')[0]; title?.focus({ preventScroll: true }); }
  }
  function updatePanels() {
    if (activePanel === 'result' && !view.preview) { activePanel = 'prepare'; body.scrollTop = 0; if (opened) navNodes.get('prepare')?.focus(); }
    const meta = panelMeta[activePanel];
    dialog.dataset.panel = activePanel;
    status.hidden = !view.error && !view.busy && view.phase !== 'saved';
    for (const [key, panel] of Object.entries(panels)) panel.hidden = key !== activePanel;
    for (const [key, node] of navNodes) { if (key === activePanel) node.setAttribute('aria-current', 'step'); else node.removeAttribute('aria-current'); node.disabled = key === 'result' && !view.preview; }
    panelLabel.textContent = meta.number + '  ' + meta.label;
    nextButton.hidden = activePanel !== 'prepare'; nextButton.disabled = !!view.busy || !view.source || !view.target || !asArray(view.selectedIds).length || targetDirty || oldDirty || rulesDirty || sourceVariables.dirty();
  }

  function partialRequired() { return !['passed', 'failed'].includes(view.schema?.status); }
  function variableDraft() { return sourceVariables.dirty() || resultVariables.dirty(); }
  function canApplyNow() { return !!view.canApply && !view.busy && !targetDirty && !oldDirty && !rulesDirty && !variableDraft() && !reviewText.value.trim() && (view.analysisRequirements === undefined || requirements.value.trim() === view.analysisRequirements) && view.phase !== 'saved' && view.schema?.status !== 'failed' && countOf(view.preview?.unresolved) === 0 && writeAck.input.checked && (!partialRequired() || partialAck.input.checked); }
  function updateButtons() {
    const busy = !!view.busy, hasSource = !!view.source;
    clearButton.disabled = busy && view.phase !== 'analyzing';
    [captureButton, replaceSourceButton, refreshButton, importButton, importFile, backupFile, floor, sourceFloor, mode, apiUrl, apiModel, apiKey, structured.input, targetCode, oldCode, targetSave, oldSave].forEach(n => { n.disabled = busy; });
    for (const n of scriptNodes.values()) n.input.disabled = busy;
    for (const n of ruleNodes.values()) n.input.disabled = busy;
    ruleCode.disabled = busy; ruleSave.disabled = busy;
    bookSelect.disabled = busy || !view.target; clearRules.disabled = busy || !asArray(view.selectedRuleIds).length; chatSelect.disabled = busy;
    requirements.disabled = busy; reviewText.disabled = busy;
    reviewBox.hidden = view.phase === 'saved';
    reviseButton.disabled = busy || !view.preview || !reviewText.value.trim() || targetDirty || oldDirty || rulesDirty || variableDraft() || (view.analysisRequirements !== undefined && requirements.value.trim() !== view.analysisRequirements);
    reviewInfo.textContent = view.reviewCount ? `已调整 ${view.reviewCount} 轮` : ''; reviewInfo.hidden = !view.reviewCount;
    for (const row of questionNodes.values()) row.inputs.forEach(n => { n.disabled = busy; });
    analyzeButton.disabled = busy || !hasSource || targetDirty || oldDirty || rulesDirty || variableDraft();
    analyzeButton.textContent = view.preview ? '重新分析迁移方案' : '分析并生成迁移预览';
    cancelButton.hidden = view.phase !== 'analyzing'; cancelButton.disabled = view.phase !== 'analyzing';
    exportSourceButton.disabled = busy || !hasSource || sourceVariables.dirty();
    exportVariablesButton.disabled = busy || !hasSource || sourceVariables.dirty();
    resultFile.disabled = busy || !view.target || targetDirty || oldDirty || rulesDirty || sourceVariables.dirty();
    sourceVariables.node.hidden = !hasSource;
    sourceVariables.render(busy || !hasSource);
    resultVariables.render(busy || !view.resultData || view.phase === 'saved' || countOf(view.preview?.unresolved) > 0);
    exportResultButton.disabled = busy || !view.preview || variableDraft() || countOf(view.preview?.unresolved) > 0 || view.schema?.status === 'failed';
    exportReportButton.disabled = busy || !view.preview || variableDraft();
    partialAck.input.disabled = busy; writeAck.input.disabled = busy; applyButton.disabled = !canApplyNow();
    partialAck.node.hidden = !partialRequired();
    applyBox.hidden = view.phase === 'saved';
    applyNote.textContent = variableDraft() ? '请先应用或撤销变量编辑。' : view.schema?.status === 'failed' ? '请先修正结构错误。' : countOf(view.preview?.unresolved) > 0 ? '请先完成待处理选择。' : !view.canApply ? '当前结果暂不能写入。' : '';
    targetDraftInfo.textContent = targetDirty ? '源码有未应用的修改，请先点击“使用这份新版源码”。' : '';
    oldDraftInfo.textContent = oldDirty ? '旧版源码有未应用的修改，请先点击“使用这份旧版源码”。' : '';
    ruleDraftInfo.textContent = rulesDirty ? '规则有未应用的修改，请先点击“使用这份规则”。' : '';
    restoreConfirmButton.disabled = busy || !records(view.backups).some(b => b.id === restoreId && b.restorable);
    restoreConfirm.querySelectorAll('button').forEach(b => { if (b !== restoreConfirmButton) b.disabled = busy; });
    backupList.querySelectorAll('button').forEach(b => { b.disabled = busy || b.dataset.backupAction === 'restore' && b.dataset.restorable !== 'true'; });
    updatePanels();
  }

  function renderScripts() {
    const entries = records(view.scripts), sig = signature(entries.map(s => [s.id, s.name, s.enabled, s.content]));
    if (sig !== scriptSignature) {
      scriptSignature = sig; cleanDynamic('scripts'); scripts.replaceChildren(); scriptNodes.clear();
      for (const script of entries) {
        const row = el('div', null, 'script'), item = check('');
        const label = item.node.lastChild; label.append(el('span', script.name || '未命名脚本', 'break'), el('span', script.enabled === false ? ' · 当前未启用' : ' · 当前已启用', 'hint'));
        item.input.value = textOf(script.id); row.append(item.node); scripts.append(row); scriptNodes.set(textOf(script.id), item);
        onDynamic('scripts', item.input, 'change', () => run('selectScripts', [...scriptNodes].filter(([, value]) => value.input.checked).map(([id]) => id)));
      }
      if (!entries.length) scripts.append(scriptEmpty);
    }
    const ids = new Set(asArray(view.selectedIds).map(String));
    for (const [id, node] of scriptNodes) node.input.checked = ids.has(id);
    const selectedContent = entries.filter(s => ids.has(String(s.id))).map(s => s.content || '').join('\n\n');
    if (!targetDirty && shadow.activeElement !== targetCode && targetCode.value !== selectedContent) targetCode.value = selectedContent;
  }

  function renderBooks() {
    const query = bookSearch.value.trim().toLowerCase(), active = view.activeWorldbook || '';
    const books = records(view.worldbooks).filter(book => book.name === active || String(book.name).toLowerCase().includes(query));
    const sig = signature([books, active]);
    if (sig === bookSignature) return;
    bookSignature = sig; bookSelect.replaceChildren();
    const all = el('option', query && !books.length ? '没有匹配的世界书' : '全部已读取条目'); all.value = ''; bookSelect.append(all);
    for (const book of books) { const option = el('option', `${book.name}${asArray(book.scopes).length ? ' · 当前关联' : ''}`); option.value = book.name; bookSelect.append(option); }
    bookSelect.value = active;
  }

  function renderChatSource() {
    const data = view.chatImport, sig = signature(data);
    chatChoice.hidden = !data;
    if (sig !== chatSignature) {
      chatSignature = sig; chatSelect.replaceChildren();
      if (data && !data.selectedId) { const option = el('option', '请选择楼层和分支'); option.value = ''; chatSelect.append(option); }
      for (const candidate of records(data?.candidates)) { const option = el('option', `${candidate.label} · ${candidate.fieldCount} 个字段`); option.value = candidate.id; chatSelect.append(option); }
      chatSelect.value = data?.selectedId || '';
    }
  }

  function renderRules() {
    const entries = records(view.worldbookEntries), selected = new Set(asArray(view.selectedRuleIds)), query = ruleSearch.value.trim().toLowerCase();
    const filtered = entries.filter(rule => (selectedOnly.input.checked ? selected.has(rule.id) : !view.activeWorldbook || rule.worldbook === view.activeWorldbook)
      && (allRules.input.checked || query || rule.candidate || selected.has(rule.id)) && (!query || `${rule.worldbook} ${rule.name} ${rule.content}`.toLowerCase().includes(query)));
    const visible = filtered.slice(0, visibleRules), sig = signature(visible);
    if (sig !== ruleSignature) {
      ruleSignature = sig; cleanDynamic('rules'); ruleList.replaceChildren(); ruleNodes.clear();
      for (const rule of visible) {
        const row = el('div', null, 'rule-entry'), item = check('');
        item.node.lastChild.append(el('span', rule.name, 'break'), el('span', `${rule.worldbook} · ${rule.uid === null ? '手动资料' : '条目 ' + rule.uid} · ${rule.enabled ? '已启用' : '未启用'}${rule.candidate ? ' · 建议检查' : ''}`, 'hint break'));
        const detail = el('details'), code = el('pre'); detail.append(el('summary', '查看规则原文'), code);
        onDynamic('rules', detail, 'toggle', () => { if (detail.open && !code.textContent) code.textContent = rule.content || '（空条目）'; });
        onDynamic('rules', item.input, 'change', () => { const ids = new Set(asArray(view.selectedRuleIds)); if (item.input.checked) ids.add(rule.id); else ids.delete(rule.id); run('selectRules', [...ids]); });
        row.append(item.node, detail); ruleList.append(row); ruleNodes.set(rule.id, item);
      }
      if (!visible.length) ruleList.append(el('p', entries.length ? '没有符合条件的条目。可搜索正文、显示全部条目，或手动补充规则。' : '没有读到可选择的世界书条目，可手动补充规则。', 'empty'));
    }
    for (const [id, item] of ruleNodes) item.input.checked = selected.has(id);
    moreRules.hidden = visible.length >= filtered.length;
    ruleCount.textContent = `显示 ${visible.length} / ${filtered.length} 条`;
    ruleInfo.textContent = view.ruleInfo || '读取目标后选择条目';
    ruleWarnings.replaceChildren(); asArray(view.ruleWarnings).forEach(w => ruleWarnings.append(el('p', w, 'rule-warning')));
    analysisRuleInfo.textContent = `已选 ${selected.size} 条新版规则`;
    const manual = entries.find(rule => rule.id === 'manual-rules');
    if (!rulesDirty && shadow.activeElement !== ruleCode) ruleCode.value = manual?.content || '';
  }

  function renderQuestions() {
    const list = records(view.preview?.questions), sig = signature(list);
    if (sig !== questionSignature) {
      questionSignature = sig; cleanDynamic('questions'); questions.replaceChildren(); questionNodes.clear();
      if (list.length) questions.append(el('h3', '需要你选择的项目'));
      for (const question of list) {
        const box = el('div', null, 'question'), fs = el('fieldset'), legend = el('legend', question.question || '请选择处理方式');
        fs.append(legend, el('p', pathOf(question.path), 'hint')); const inputs = [];
        asArray(question.options).forEach((option, index) => {
          if (!option || typeof option !== 'object') return;
          const item = check('', 'radio'); item.input.name = 'mzm-q-' + textOf(question.id); item.input.value = String(index);
          item.node.lastChild.append(el('span', option.label || '选项 ' + (index + 1)), el('span', jsonText(option.value), 'option-value'));
          onDynamic('questions', item.input, 'change', () => { if (item.input.checked) run('answer', question.id, index); });
          inputs.push(item.input); fs.append(item.node);
        });
        box.append(fs); questions.append(box); questionNodes.set(textOf(question.id), { inputs });
      }
    }
    for (const [id, row] of questionNodes) { const selected = view.preview?.answers?.[id]; row.inputs.forEach((n, i) => { n.checked = selected === i; }); }
  }

  function appendChanges(container, items) {
    for (const change of items) {
      const row = el('article', null, 'change'), title = el('div', null, 'change-title');
      title.append(el('span', kindLabels[change.kind] || '变化', 'tag' + (change.kind === 'remove' ? ' warn' : '')), el('span', pathOf(change.path), 'path'));
      const pair = el('div', null, 'comparison'), before = el('div', null, 'before'), after = el('div', null, 'after');
      before.append(el('span', '迁移前', 'value-label'), el('pre', jsonText(change.before))); after.append(el('span', '迁移后', 'value-label'), el('pre', jsonText(change.after))); pair.append(before, after); row.append(title, pair);
      if (change.reason) row.append(el('p', change.reason, 'reason')); container.append(row);
    }
  }

  function renderChanges() {
    const list = records(view.preview?.changes), filtered = filter.value === 'all' ? list : list.filter(c => c.kind === filter.value);
    const items = filtered.slice(0, visibleChanges); changes.replaceChildren(); appendChanges(changes, items);
    if (!items.length) changes.append(el('p', list.length ? '这个筛选下没有变化。' : '没有字段发生变化。', 'empty'));
    changeInfo.textContent = `${items.length} / ${filtered.length} 项`;
    moreButton.hidden = items.length >= filtered.length;
    moreButton.textContent = `再显示 ${Math.min(40, filtered.length - items.length)} 项`;
  }

  function renderTargetChanges() {
    const list = records(view.preview?.targetChanges), items = list.slice(0, visibleTargetChanges);
    targetDetail.hidden = !list.length;
    targetDetailTitle.textContent = `目标聊天将被替换的内容 · ${list.length} 项`;
    targetChangeInfo.textContent = `${items.length} / ${list.length} 项`;
    targetChanges.replaceChildren(); appendChanges(targetChanges, items);
    moreTargetButton.hidden = items.length >= list.length;
    moreTargetButton.textContent = `再显示 ${Math.min(40, list.length - items.length)} 项`;
  }

  function renderSchema() {
    const report = view.schema || { status: 'unavailable' };
    schemaTitle.textContent = '源码静态结构检查：' + (schemaLabels[report.status] || textOf(report.status));
    schemaBlock.className = 'schema-report' + (report.status === 'failed' ? ' error' : ['partial', 'unavailable'].includes(report.status) ? ' warn' : '');
    if (schemaReportStatus !== report.status) { schemaReportStatus = report.status; schemaBlock.open = report.status !== 'passed'; }
    schemaExplanation.textContent = report.status === 'passed' ? '静态检查通过；实际续玩仍需验证。' : report.status === 'failed' ? '请修正以下字段。' : '以下转换或约束未完全检查。';
    schemaList.replaceChildren();
    asArray(report.errors).forEach(e => schemaList.append(el('li', `${pathOf(e?.path)}：${e?.message || textOf(e)}`)));
    asArray(report.warnings).forEach(w => schemaList.append(el('li', w?.message || w)));
    schemaList.hidden = !schemaList.childNodes.length;
  }

  function renderBackups() {
    const backups = records(view.backups), sig = signature(backups);
    if (sig !== backupSignature) {
      backupSignature = sig; cleanDynamic('backups'); backupList.replaceChildren();
      for (const backup of backups) {
        const row = el('div', null, 'backup'), content = el('div'), layout = el('div', null, 'row');
        content.append(el('div', backup.label || '迁移前备份', 'backup-title'), el('div', backup.createdAt || '', 'hint'));
        const restoreButton = button('恢复此备份', () => { restoreId = backup.id; restoreText.textContent = `将恢复“${backup.label || '这份备份'}”。恢复时会再次核对目标与数据；不符合条件时会停止。`; restoreConfirm.hidden = false; updateButtons(); restoreConfirmButton.focus(); }, 'quiet fit', 'backups');
        restoreButton.dataset.restorable = String(!!backup.restorable); restoreButton.dataset.backupAction = 'restore';
        const downloadButton = button('下载备份', () => run('exportBackup', backup.id), 'quiet fit', 'backups'); downloadButton.dataset.backupAction = 'download';
        layout.append(content, downloadButton, restoreButton); row.append(layout);
        if (!backup.restorable) row.append(el('p', '当前目标或数据与备份不匹配，暂不能恢复。', 'hint')); backupList.append(row);
      }
      if (!backups.length) backupList.append(el('p', '还没有迁移前备份。成功写入前会先自动建立备份。', 'empty'));
    }
    if (restoreId != null && !backups.some(b => b.id === restoreId && b.restorable)) { restoreId = null; restoreConfirm.hidden = true; }
  }

  function render(next) {
    if (destroyed) return;
    const previousPhase = view.phase;
    view = next || {};
    if ((view.resetRevision || 0) !== resetRevision) {
      resetRevision = view.resetRevision || 0; importEpoch++; resultImportEpoch++;
      for (const node of [importText, targetCode, oldCode, ruleCode, requirements, reviewText, apiUrl, apiModel, apiKey, importFile, resultFile, backupFile, bookSearch, ruleSearch]) node.value = '';
      mode.value = 'current'; custom.hidden = true; structured.input.checked = false; floor.value = '-1'; sourceFloor.value = '-1';
      allRules.input.checked = true; selectedOnly.input.checked = false; filter.value = 'all';
      targetDirty = false; oldDirty = false; rulesDirty = false; sourceRevision = undefined; sourceVariables.clear(true); resultVariables.clear(true);
      restoreId = null; restoreConfirm.hidden = true; localError.hidden = true;
      for (const detailNode of shadow.querySelectorAll('details')) detailNode.open = false;
      detail.open = true; visibleRules = visibleChanges = visibleTargetChanges = 40;
      for (const key of Object.keys(panelScroll)) delete panelScroll[key]; activePanel = 'prepare'; body.scrollTop = 0;
    }
    if (view.source?.revision != null && view.source.revision !== sourceRevision) {
      sourceRevision = view.source.revision; oldCode.value = ''; oldDirty = false; reviewText.value = ''; sourceVariables.clear();
    }
    if (!view.preview) resultVariables.clear();
    const newConfirmSignature = signature([view.target, view.preview?.changes, view.preview?.targetChanges, view.preview?.answers, view.preview?.summary, view.schema]);
    if (confirmationSignature !== newConfirmSignature) { writeAck.input.checked = false; partialAck.input.checked = false; confirmationSignature = newConfirmSignature; }
    statusTitle.textContent = phaseLabels[view.phase] || '迁移状态';
    statusMessage.textContent = view.error || view.message || '先读取当前卡与楼层，或导入已导出的旧存档。';
    status.className = 'notice status' + (view.error || view.phase === 'error' ? ' error' : view.phase === 'analyzing' ? ' loading' : '');
    progress.textContent = view.progress || ''; progress.hidden = !view.progress;
    dialog.setAttribute('aria-busy', String(!!view.busy));
    targetInfo.textContent = view.target ? `目标：${view.target.label || '当前聊天'} · 楼层 ${view.target.floor ?? '未知'} · 分支 ${view.target.swipe ?? '未知'}` : '目标：尚未读取当前聊天';
    resultTarget.textContent = targetInfo.textContent;
    sourceInfo.textContent = view.source ? `${view.source.label || '已载入旧数据'}${view.source.fieldCount == null ? '' : ` · ${view.source.fieldCount} 个字段`}${view.source.edited ? ' · 已编辑' : ''}` : '未载入旧变量';
    capabilities.textContent = asArray(view.capabilities).join(' · ');
    renderScripts(); renderBooks(); renderRules(); renderChatSource();
    if (view.preview) {
      resultHeading.textContent = view.phase === 'saved' ? '迁移结果 · 已完成核验' : '迁移预览 · 尚未写入';
      resultSummary.textContent = view.preview.summary || '请核对以下变化，再应用到目标聊天。';
      const list = records(view.preview.changes); for (const kind of ['add', 'change', 'remove']) statNodes[kind].textContent = String(list.filter(c => c.kind === kind).length);
      statNodes.pending.textContent = String(countOf(view.preview.unresolved));
      resultWarnings.replaceChildren(); asArray(view.preview.warnings).forEach(w => resultWarnings.append(el('p', w?.message || w, 'notice warn')));
      renderSchema(); renderQuestions();
      const nextChanges = signature(list); if (changeSignature !== nextChanges) { changeSignature = nextChanges; visibleChanges = 40; renderChanges(); }
      const nextTargetChanges = signature(view.preview.targetChanges); if (targetChangeSignature !== nextTargetChanges) { targetChangeSignature = nextTargetChanges; visibleTargetChanges = 40; renderTargetChanges(); }
    }
    renderBackups(); updateButtons();
    footText.textContent = view.phase === 'saved' ? '已保存并读回' : view.phase === 'analyzing' ? '等待模型 · 可取消' : '写入前自动备份';
    if (opened && previousPhase === 'analyzing' && view.phase === 'preview' && view.preview) {
      panelScroll.result = 0; showPanel('result', true);
    }
    if (opened && previousPhase !== 'analyzing' && view.phase === 'analyzing' && activePanel === 'result') showPanel('analysis', true);
  }

  function open() {
    if (destroyed || opened) return;
    previousFocus = doc.activeElement; opened = true;
    if (doc.documentElement?.style) { scrollLock = { element: doc.documentElement, overflow: doc.documentElement.style.overflow }; doc.documentElement.style.overflow = 'hidden'; }
    try { dialog.showModal(); } catch { fallbackShade.hidden = false; dialog.classList.add('fallback'); dialog.setAttribute('open', ''); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); }
    drag.restore();
    closeButton.focus();
  }
  function close() {
    if (!opened || destroyed) return;
    opened = false; try { dialog.close(); } catch { dialog.removeAttribute('open'); }
    dialog.removeAttribute('open'); fallbackShade.hidden = true; apiKey.value = ''; writeAck.input.checked = false; partialAck.input.checked = false;
    if (scrollLock) { if (scrollLock.element.style.overflow === 'hidden') scrollLock.element.style.overflow = scrollLock.overflow; scrollLock = null; }
    if (previousFocus?.isConnected && typeof previousFocus.focus === 'function') previousFocus.focus();
  }
  function requestClose() { close(); run('close'); }
  on(closeButton, 'click', requestClose);
  on(dialog, 'cancel', event => { event.preventDefault(); requestClose(); });
  on(dialog, 'keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); requestClose(); return; }
    if (event.key !== 'Tab') return;
    const nodes = [...dialog.querySelectorAll('button,input,select,textarea,summary,[tabindex="0"]')].filter(n => !n.disabled && !n.closest('[hidden]') && n.getClientRects().length > 0);
    if (!nodes.length) return;
    const active = shadow.activeElement, first = nodes[0], last = nodes.at(-1);
    if (event.shiftKey && (active === first || !nodes.includes(active))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
  });
  function destroy() { if (destroyed) return; close(); destroyed = true; drag.destroy(); apiKey.value = ''; disposers.splice(0).forEach(dispose => dispose()); Object.keys(dynamicDisposers).forEach(cleanDynamic); root.remove(); scriptNodes.clear(); ruleNodes.clear(); questionNodes.clear(); view = {}; }
  render({ phase: 'idle', scripts: [], selectedIds: [], backups: [] });
  return { root, render, destroy, open, close };
}
