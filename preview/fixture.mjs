const old = {玩家:{金币:120,体力:80},角色:{林夏:{好感度:72,关系:'朋友'}},剧情:{时间:'周五傍晚',事件:['约好周末看演出']}};
const normalSchema = `import { registerMvuSchema } from 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource@e3747bdf23a4397353c4e255591ebe621b0783ae/dist/util/mvu_zod.js';
const Person = z.object({好感度:z.number().min(0).max(100),关系:z.string()}).passthrough();
const Schema = z.object({玩家:z.object({资产:z.object({金币:z.number().min(0)}),体力:z.number().min(0).max(100)}).passthrough(),角色:z.record(z.string(),Person),剧情:z.object({时间:z.string(),事件:z.array(z.string())}).passthrough(),任务:z.array(z.string()).prefault([])}).passthrough();
registerMvuSchema(Schema);`;
const complexSchema = normalSchema.replace('体力:z.number().min(0).max(100)', '体力:z.number().transform(v => Math.min(100,Math.max(0,v)))');
let script = normalSchema;
let generating = false;
const generationEvents = new Map();
const eventSource = { on(name, fn) { if (!generationEvents.has(name)) generationEvents.set(name, new Set()); generationEvents.get(name).add(fn); }, removeListener(name, fn) { generationEvents.get(name)?.delete(fn); }, emit(name, ...args) { for (const fn of generationEvents.get(name) || []) fn(...args); } };
const row = {name:'林夏',is_user:false,is_system:false,mes:'林夏递来一张演出门票，约好周末一起去。',swipe_id:0,swipes:['林夏递来一张演出门票，约好周末一起去。'],variables:[{stat_data:structuredClone(old),schema:'Zod fixture',other_owner:{untouched:true}}]};
const ctx = {characterId:0,characters:[{name:'测试角色卡',avatar:'migration-fixture.png'}],chatId:'独立预览',chat:[row],eventSource,eventTypes:{GENERATION_STARTED:'generation_started',GENERATION_ENDED:'generation_ended',GENERATION_STOPPED:'generation_stopped',CHAT_CHANGED:'chat_changed'},getCurrentChatId(){return this.chatId;},async saveChat(){update();}};
const update = () => { document.querySelector('#state').textContent=JSON.stringify(row.variables[row.swipe_id],null,2); };
const requests=[];const cancelled=new Set();
window.SillyTavern={getContext:()=>ctx};
window.getTavernHelperVersion=()=> '4.11.3（模拟）';
window.getScriptTrees=()=>[{type:'folder',id:'folder',enabled:true,name:'结构',scripts:[{type:'script',id:'schema-v2',name:'变量结构 v2',enabled:true,content:script}]}];
window.getCharWorldbookNames=()=>({primary:'测试卡世界书',additional:[]});
window.getChatWorldbookName=()=>null;
window.getWorldbookNames=()=>['测试卡世界书','独立玩法说明','无关背景资料'];
window.getWorldbook=async name=> name==='独立玩法说明' ? [
  {uid:0,name:'任务与金币迁移说明',enabled:true,content:'迁移保留实际金币，旧卡没有任务记录时新增空列表。'},
  {uid:1,name:'额外设定（不选）',enabled:true,content:'未选择的内容不进入分析。'}
] : name==='无关背景资料' ? [{uid:0,name:'城市传闻',enabled:true,content:'本次不读取的世界书。'}] : [
  {uid:0,name:'变量更新规则',enabled:true,content:'玩家.资产.金币：当前实际持有的金币，收入和支出时更新。玩家.体力：范围 0–100；休息恢复、行动消耗。迁移时保持原有金币和体力，不结算尚未发生的事件。',strategy:{type:'constant',keys:[],scan_depth:'same_as_global'},probability:100},
  {uid:1,name:'人物关系更新规则',enabled:true,content:'变量更新规则：角色好感度范围 0–100，依据已经发生的互动更新；关系称呼与既有事实应保留。'},
  {uid:2,name:'世界设定',enabled:true,content:'这是一座有音乐演出的小城。'},
  {uid:3,name:'旧版变量更新规则',enabled:false,content:'旧版资料，不应自动作为新版生效规则。'}
];
window.getVariables=({message_id})=>structuredClone(ctx.chat[message_id].variables[ctx.chat[message_id].swipe_id]);
window.replaceVariables=(value,{message_id})=>{ctx.chat[message_id].variables[ctx.chat[message_id].swipe_id]=structuredClone(value);update();};
window.getChatMessages=(floor)=>{const m=ctx.chat[floor];return m?[{message_id:floor,name:m.name,role:'assistant',swipe_id:m.swipe_id,swipes:[...m.swipes],swipes_data:structuredClone(m.variables)}]:[];};
window.stopGenerationById=id=>{cancelled.add(id);return true;};
window.generateRaw=async config=>{
  requests.push(config);await new Promise(resolve=>setTimeout(resolve,350));
  if(cancelled.has(config.generation_id)) throw new Error('模拟请求已取消');
  const payload=JSON.parse(config.ordered_prompts[1].content),review=payload.player_review;
  const instructions=review?.requests?.join('\n')||'';
  const customAmount=/金币.*110|110.*金币/.test(instructions);
  return JSON.stringify({version:1,summary:review?'已结合玩家反馈调整迁移方案，仍以原始旧存档为基准。':'保留已游玩的状态，将金币移入新版资产结构，并补上空任务列表。',operations:customAmount?[{op:'set',path:['玩家','资产','金币'],value:110,reason:'模拟反馈要求金币改为 110。'},{op:'remove',path:['玩家','金币'],reason:'金币已移至新版字段。'},{op:'set',path:['任务'],value:[],reason:'新增空任务列表。'}]:[{op:'move',from:['玩家','金币'],path:['玩家','资产','金币'],reason:'新版结构将金币放入玩家资产，金额原样保留。'},{op:'set',path:['任务'],value:[],reason:'新版新增任务列表；不编造未发生的任务。'}],questions:[],warnings:['当前为模拟模型回复，仅用于验证交互。']});
};
window.fixture={ctx,row,old,requests,setScript(value){script=value;},normalSchema,complexSchema};
// Model the script iframe's parent as this simulated host, even inside a responsive preview iframe.
const environment={parent:window,migrationGenerationProbe:()=>generating,fetch:window.fetch.bind(window),setInterval:window.setInterval.bind(window),clearInterval:window.clearInterval.bind(window),addEventListener:window.addEventListener.bind(window),removeEventListener:window.removeEventListener.bind(window)};
for(const name of ['getTavernHelperVersion','getScriptTrees','getCharWorldbookNames','getChatWorldbookName','getWorldbookNames','getWorldbook','getVariables','replaceVariables','getChatMessages','generateRaw','stopGenerationById']) environment[name]=window[name];
const app=window.MvuMigration.launch(environment);
document.querySelector('#open').onclick=()=>app.open();
document.querySelector('#complex').onclick=()=>{script=complexSchema;app.open();};
document.querySelector('#normal').onclick=()=>{script=normalSchema;app.open();};
document.querySelector('#switch').onclick=()=>{ctx.chatId=ctx.chatId==='独立预览'?'另一个聊天':'独立预览';update();};
document.querySelector('#advance').onclick=()=>{row.variables[0].stat_data.玩家.体力--;update();};
document.querySelector('#dry-run').onclick=()=>{eventSource.emit('generation_started','normal',{},true);app.open();};
document.querySelector('#generating').onclick=()=>{generating=!generating;eventSource.emit(generating?'generation_started':'generation_ended','normal',{},false);document.querySelector('#generating').textContent=generating?'结束模拟生成':'开始模拟生成';};
update();app.open();
