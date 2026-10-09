import { cloneJson, fingerprint, normalizeSource, normalizeRules, buildPrompt, parseJsonResponse, validatePlan, applyPlan, diffData } from './core.mjs';
import { parseSourceImport, sourceFromChat } from './chat-import.mjs';
import { discoverScripts, inspectSchema, validateSchema } from './schema.mjs';
import { makeHost, makeModelClient, observeGeneration, resolveDependencies, TOOL_VERSION } from './host.mjs';
import { mountUI } from './ui.mjs';
import { readWorldbookRules, readWorldbookCatalog, readWorldbookEntries, selectedRuleWarnings, assertRulesCurrent } from './worldbook.mjs';

function messageOf(error) { return String(error?.message || error || '操作失败').slice(0, 1600); }
function countLeaves(value) { if (!value || typeof value !== 'object') return 1; const values = Object.values(value); return values.length ? values.reduce((sum, item) => sum + countLeaves(item), 0) : 1; }
function scriptHash(scripts) { return fingerprint(scripts.map(({ id, content, enabled }) => ({ id, content, enabled: Boolean(enabled) }))); }

export function createController({ api, context, storage, fetcher, render, download, generationBusy }) {
  const host = makeHost({ api, context, storage, generationBusy });
  const model = makeModelClient(api);
  const view = { phase: 'idle', message: '导入旧存档或酒馆聊天文件，再读取新版结构、选择新版世界书规则。', scripts: [], selectedIds: [], worldbookEntries: [], worldbooks: [], activeWorldbook: '', selectedRuleIds: [], ruleWarnings: [], busy: false, canApply: false, backups: [] };
  let snapshot = null, source = null, oldScript = '', sourceRevision = 0, plan = null, trial = null, activeSources = [], selectedHash = '', request = null, epoch = 0, disposed = false;
  let ruleSnapshot = null, importedChat = null, reviewRequests = [], playerRequirements = '', pendingReview = null, manualResult = null;
  function emit() { if (!disposed) render({ ...view }); }
  function backupList() {
    const labels = { committed: '迁移已保存', prepared: '待核对备份', uncertain: '保存状态待核对', restored: '已恢复', 'rolled-back': '已自动恢复', 'not-applied': '未写入' };
    try { view.backups = host.backups().map(item => ({ id: item.id, label: `${item.target.label} · 第 ${item.target.floor} 楼 · ${labels[item.status] || item.status}`, createdAt: item.createdAt, restorable: Boolean(snapshot) && ['committed', 'prepared', 'uncertain'].includes(item.status) && ['identity', 'floor', 'swipe', 'messageHash', 'nativeMessageHash', 'chatLength'].every(key => item.target[key] === snapshot.target[key]) && [item.target.variablesHash, item.afterHash].includes(snapshot.target.variablesHash) })); }
    catch (error) { view.backups = []; view.error = messageOf(error); }
  }
  function cancel() {
    epoch++; request?.abort(); request = null; model.cancel(); view.busy = false;
    if (pendingReview) { plan = pendingReview.plan; view.preview = pendingReview.preview; view.schema = pendingReview.schema; view.resultData = pendingReview.resultData; manualResult = pendingReview.manualResult; reviewRequests = pendingReview.requests; view.reviewCount = reviewRequests.length; trial = null; view.canApply = false; pendingReview = null; }
    if (view.phase === 'analyzing') { view.phase = 'ready'; view.message = '分析已取消，聊天没有改动。'; } emit();
  }
  function invalidate(message) { cancel(); plan = null; trial = null; manualResult = null; view.resultData = undefined; view.preview = undefined; view.schema = undefined; view.canApply = false; view.phase = snapshot ? 'ready' : 'idle'; if (message) view.message = message; }
  function roots() { return view.scripts.filter(script => view.selectedIds.includes(script.id)); }
  function selectedRules() { return normalizeRules(view.worldbookEntries.filter(rule => view.selectedRuleIds.includes(rule.id))); }
  function updateRuleView() {
    view.ruleWarnings = [...selectedRuleWarnings(ruleSnapshot, selectedRules()), ...(view.catalogWarnings || [])];
    view.ruleInfo = `${view.worldbooks.length} 本可选世界书 · 已读取 ${view.worldbookEntries.length} 个条目 · 已选择 ${view.selectedRuleIds.length} 条新版规则`;
  }
  async function checkScripts() {
    if (!snapshot) throw new Error('请先读取目标聊天。');
    const current = api.getScriptTrees ? discoverScripts(await api.getScriptTrees({ type: 'character' })) : [];
    const effective = roots().map(item => item.id === 'manual-schema' ? item : current.find(script => script.id === item.id));
    if (effective.some(item => !item) || scriptHash(effective) !== selectedHash) throw new Error('所选结构脚本已变化，请重新读取并分析。');
  }
  async function refreshTarget({ floor = -1 } = {}) {
    invalidate(); view.error = ''; view.busy = true; emit();
    const token = ++epoch;
    try {
      const next = await host.read(floor);
      const trees = api.getScriptTrees ? await api.getScriptTrees({ type: 'character' }) : [];
      const books = await readWorldbookRules(api);
      const catalog = await readWorldbookCatalog(api, books.books);
      await host.assertCurrent(next);
      if (token !== epoch || disposed) return;
      snapshot = next; view.target = next.target;
      view.scripts = discoverScripts(trees);
      const enabled = view.scripts.filter(script => script.enabled);
      view.selectedIds = enabled.map(script => script.id);
      ruleSnapshot = books; view.worldbookEntries = books.entries; view.selectedRuleIds = books.entries.filter(entry => entry.enabled && entry.candidate).map(entry => entry.id);
      view.worldbooks = catalog.books; view.catalogWarnings = catalog.warnings; view.activeWorldbook = '';
      updateRuleView();
      view.phase = 'ready'; view.message = view.scripts.length ? '目标已读取。' : '未找到结构脚本，请粘贴新版源码。';
      view.capabilities = [`酒馆助手：${api.getTavernHelperVersion ? await api.getTavernHelperVersion() : '版本接口不可用'}`, `变量读取：可用`, `AI 分析：${api.generateRaw ? '可用' : '缺少接口'}`, `脚本发现：${api.getScriptTrees ? '可用' : '请粘贴源码'}`, `世界书列表：${api.getWorldbookNames ? '可用' : '仅当前关联'}`];
      backupList();
    } catch (error) { if (token === epoch) { snapshot = null; ruleSnapshot = null; view.target = undefined; view.worldbooks = []; view.catalogWarnings = []; view.worldbookEntries = []; view.selectedRuleIds = []; updateRuleView(); view.phase = 'error'; view.error = messageOf(error); } }
    finally { if (token === epoch) { view.busy = false; emit(); } }
  }
  function setSource(next, label) {
    source = next; oldScript = ''; reviewRequests = []; playerRequirements = ''; view.reviewCount = 0;
    view.source = next ? { label, fieldCount: countLeaves(next.statData), revision: ++sourceRevision } : undefined;
    view.sourceData = next?.statData;
  }
  async function captureSource({ floor = -1 } = {}) {
    invalidate(); view.busy = true; view.error = ''; emit(); const token = ++epoch;
    try {
      const next = await host.read(floor);
      const scripts = api.getScriptTrees ? discoverScripts(await api.getScriptTrees({ type: 'character' })).filter(script => script.enabled) : [];
      await host.assertCurrent(next);
      if (token !== epoch || disposed) return;
      importedChat = null; view.chatImport = undefined;
      setSource({ statData: cloneJson(next.variables.stat_data), scripts, origin: { ...next.target } }, `已读取：${next.target.label} / 第 ${next.target.floor} 楼 · 分支 ${next.target.swipe}`);
      view.message = '旧变量已提取。';
    } catch (error) { if (token === epoch) view.error = messageOf(error); }
    finally { if (token === epoch) { view.busy = false; emit(); } }
  }
  function selectChatSource(id) {
    if (view.busy) return;
    if (!importedChat) throw new Error('请先导入旧聊天文件。');
    const next = sourceFromChat(importedChat, id);
    invalidate(); setSource(next, `已提取：${next.origin.label} / 第 ${next.origin.floor} 楼 · 分支 ${next.origin.swipe}`);
    view.chatImport.selectedId = id; view.error = ''; view.message = '已提取所选分支。'; emit();
  }
  function importSource(text, filename = '') {
    if (view.busy) throw new Error('请先完成或取消当前操作。');
    const parsed = parseSourceImport(text, filename);
    invalidate(); importedChat = parsed.candidates.length ? parsed : null;
    view.chatImport = importedChat ? { label: parsed.label, candidates: parsed.candidates.map(({ statData, ...item }) => ({ ...item, fieldCount: countLeaves(statData) })), selectedId: parsed.selectedId } : undefined;
    if (importedChat && parsed.selectedId) { selectChatSource(parsed.selectedId); return; }
    setSource(parsed.source || null, parsed.source?.origin?.label ? `已导入：${parsed.source.origin.label}` : '已导入旧变量数据');
    view.message = importedChat ? '文件只有其他分支保存了变量，请选择要迁移的楼层和分支。' : '旧存档已导入；旧版世界书规则不参与迁移。'; view.error = ''; emit();
  }
  function editedVariables(text) {
    const data = parseJsonResponse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('变量必须是 JSON 对象，请保留最外层的大括号。');
    return cloneJson(data);
  }
  function editSource(text) {
    if (view.busy || !source) throw new Error('请先载入旧变量并结束当前操作。');
    const data = editedVariables(text);
    invalidate(); source = { ...source, statData: data };
    view.source = { ...view.source, fieldCount: countLeaves(data), edited: true };
    view.sourceData = data; view.error = ''; view.message = '旧变量已修改，可导出或重新分析。'; emit();
  }
  function editResult(text) {
    if (view.busy || !trial || !plan || view.phase === 'saved') throw new Error('请先生成尚未写入的迁移预览。');
    if (trial.unresolved.length) throw new Error('请先完成待处理选择，再编辑结果。');
    const data = editedVariables(text);
    const previous = { manualResult, trial, preview: view.preview, schema: view.schema, resultData: view.resultData, canApply: view.canApply, phase: view.phase };
    try { manualResult = data; rebuildPreview(view.preview.answers); }
    catch (error) {
      manualResult = previous.manualResult; trial = previous.trial;
      Object.assign(view, { preview: previous.preview, schema: previous.schema, resultData: previous.resultData, canApply: previous.canApply, phase: previous.phase });
      throw error;
    }
    view.error = '';
    view.message = view.schema.status === 'failed' ? '变量已修改，请修正结构错误。' : '变量已修改并重新检查，请核对后写入。'; emit();
  }
  async function importResult(text, filename = '') {
    if (view.busy) throw new Error('请先完成或取消当前操作。');
    if (!snapshot) throw new Error('请先读取要替换变量的目标聊天。');
    const imported = normalizeSource(text);
    invalidate(); view.busy = true; view.error = ''; emit(); const token = ++epoch;
    try {
      await host.assertCurrent(snapshot);
      await assertRulesCurrent(api, ruleSnapshot, selectedRules());
      if (token !== epoch || disposed) return;
      // Direct replacement compares against the current target when no old file was supplied.
      if (!source) setSource({ statData: cloneJson(snapshot.variables.stat_data), scripts: [], origin: { ...snapshot.target } }, `替换前：${snapshot.target.label} / 第 ${snapshot.target.floor} 楼`);
      activeSources = roots(); selectedHash = scriptHash(roots()); view.dependencyWarnings = [];
      plan = { version: 1, summary: `导入新版变量${filename ? '：' + filename : ''}`, operations: [], questions: [], warnings: [] };
      manualResult = imported.statData; reviewRequests = []; view.reviewCount = 0; playerRequirements = ''; view.analysisRequirements = undefined;
      rebuildPreview(); view.preview.summary = plan.summary;
      view.preview.changes.forEach(change => { change.reason = '导入的新版变量'; });
      view.message = view.canApply ? '已导入新版变量，确认后替换目标。' : '已导入，请先修正结构错误。';
    } catch (error) {
      if (token === epoch) { plan = null; trial = null; manualResult = null; view.resultData = undefined; view.preview = undefined; view.schema = undefined; view.canApply = false; view.phase = 'error'; view.error = messageOf(error); }
    } finally { if (token === epoch) { view.busy = false; emit(); } }
  }
  async function openWorldbook(name) {
    if (view.busy) return;
    if (!snapshot || !ruleSnapshot) throw new Error('请先读取新版目标聊天。');
    if (!name) { view.activeWorldbook = ''; emit(); return; }
    if (!view.worldbooks.some(book => book.name === name)) throw new Error('所选世界书不在可用列表中，请刷新目标后重试。');
    invalidate(); view.busy = true; view.error = ''; emit(); const token = ++epoch;
    try {
      const entries = await readWorldbookEntries(api, name);
      await host.assertCurrent(snapshot);
      await assertRulesCurrent(api, ruleSnapshot, []);
      if (token !== epoch || disposed) return;
      const next = [...view.worldbookEntries.filter(entry => entry.worldbook !== name), ...entries];
      if (next.length > 5000) throw new Error('已读取条目超过 5000 条，请刷新目标后只打开需要的世界书。');
      view.worldbookEntries = next; view.selectedRuleIds = view.selectedRuleIds.filter(id => next.some(entry => entry.id === id));
      view.activeWorldbook = name; updateRuleView(); view.message = `已打开“${name}”，勾选需要的新版规则。`;
    } catch (error) { if (token === epoch) view.error = messageOf(error); }
    finally { if (token === epoch) { view.busy = false; emit(); } }
  }
  function selectScripts(ids) { invalidate(); view.selectedIds = view.scripts.filter(item => ids.includes(item.id)).map(item => item.id); emit(); }
  function selectRules(ids) { if (view.busy) return; invalidate(); view.selectedRuleIds = view.worldbookEntries.filter(item => ids.includes(item.id)).map(item => item.id); updateRuleView(); emit(); }
  function editRules(content) {
    if (view.busy) return;
    invalidate(); view.worldbookEntries = view.worldbookEntries.filter(item => item.id !== 'manual-rules'); view.selectedRuleIds = view.selectedRuleIds.filter(id => id !== 'manual-rules');
    if (content.trim()) { view.worldbookEntries.push(...normalizeRules([{ id: 'manual-rules', name: '手动提供的变量更新规则', content, enabled: true }])); view.selectedRuleIds.push('manual-rules'); }
    updateRuleView(); emit();
  }
  function editTargetScript(content) {
    invalidate();
    view.scripts = view.scripts.filter(item => item.id !== 'manual-schema');
    if (content.trim()) { view.scripts.push({ id: 'manual-schema', name: '手动提供的新版本结构', content, enabled: true, score: 100 }); view.selectedIds = ['manual-schema']; }
    else view.selectedIds = view.scripts.filter(item => item.enabled).map(item => item.id);
    emit();
  }
  function rebuildPreview(answers = {}) {
    const calculated = manualResult ? { data: cloneJson(manualResult), unresolved: [] } : applyPlan(source.statData, plan, answers);
    const validation = validateSchema(activeSources, calculated.data);
    trial = { ...calculated, data: validation.data || calculated.data };
    trial.changes = diffData(source.statData, trial.data);
    const extra = activeSources.some(item => item.dependency) ? ['远程依赖按本次读取的源码快照分析，未验证其与宿主实际加载版本一致。'] : [];
    if (roots().some(item => item.id === 'manual-schema')) extra.push('手动提供的结构尚未确认已被目标卡加载。');
    if (roots().some(item => !item.enabled)) extra.push('选择了未启用的脚本，请确认它确实属于目标版本结构。');
    extra.push(...view.ruleWarnings);
    const warnings = [...new Set([...(validation.warnings || []), ...(view.dependencyWarnings || []), ...extra])];
    const status = validation.status === 'passed' && ((view.dependencyWarnings || []).length || extra.length) ? 'partial' : validation.status;
    view.schema = { status, errors: validation.errors || [], warnings };
    const related = (a, b) => a.slice(0, Math.min(a.length, b.length)).every((part, i) => b[i] === part);
    const changes = trial.changes.map(change => ({ ...change, reason: manualResult ? '玩家编辑后的结果' : plan.operations.find(op => related(op.path, change.path) || op.from && related(op.from, change.path))?.reason || '结构检查或待确认选项产生的变化' }));
    view.resultData = trial.data;
    view.preview = { summary: manualResult ? '已按手动编辑更新预览。' : plan.summary, manualEdited: Boolean(manualResult), changes, targetChanges: snapshot && fingerprint(snapshot.variables.stat_data) !== fingerprint(source.statData) ? diffData(snapshot.variables.stat_data, trial.data) : [], unresolved: trial.unresolved, questions: manualResult ? [] : plan.questions, warnings: plan.warnings, answers,
      counts: { add: changes.filter(item => item.kind === 'add').length, change: changes.filter(item => item.kind === 'change').length, remove: changes.filter(item => item.kind === 'remove').length } };
    view.canApply = Boolean(snapshot) && !trial.unresolved.length && status !== 'failed';
    view.phase = 'preview';
  }
  async function analyze(config, reviewContext) {
    if (view.busy) throw new Error('已有操作正在进行。');
    if (!source) throw new Error('请先读取或导入旧存档。');
    if (!snapshot) throw new Error('请先读取目标聊天。');
    if (!roots().some(script => script.content.trim())) throw new Error('请先选择或粘贴新版 MVU Zod 脚本。');
    const requirements = typeof config.requirements === 'string' ? config.requirements.trim() : '';
    if (requirements.length > 16000) throw new Error('迁移要求超过 16000 字，请精简后再分析。');
    playerRequirements = requirements;
    view.analysisRequirements = requirements;
    if (!reviewContext) reviewRequests = [];
    view.reviewCount = reviewRequests.length;
    const previousPreview = reviewContext ? view.preview : undefined, previousSchema = reviewContext ? view.schema : undefined;
    const previousResult = reviewContext ? view.resultData : undefined, previousManual = reviewContext ? manualResult : null;
    invalidate();
    if (reviewContext) { view.preview = previousPreview; view.schema = previousSchema; view.resultData = previousResult; pendingReview = { plan: reviewContext.previous_plan, preview: previousPreview, schema: previousSchema, resultData: previousResult, manualResult: previousManual, requests: reviewRequests.slice(0, -1) }; }
    view.error = ''; view.busy = true; view.phase = 'analyzing'; view.message = '正在读取源码依赖…'; emit();
    const token = ++epoch;
    const controller = new AbortController(); request = controller;
    try {
      await host.assertCurrent(snapshot);
      selectedHash = scriptHash(roots());
      await assertRulesCurrent(api, ruleSnapshot, selectedRules());
      const result = await resolveDependencies(roots(), { fetcher, signal: controller.signal });
      if (token !== epoch) return;
      activeSources = result.sources; view.dependencyWarnings = result.warnings;
      const report = inspectSchema(activeSources);
      let feedback;
      for (let attempt = 0; attempt < 2; attempt++) {
        view.phase = 'analyzing'; view.canApply = false;
        view.message = attempt ? '模型草案存在格式或结构问题，正在进行一次修正…' : reviewContext ? 'AI 正在结合你的反馈调整迁移方案…' : 'AI 正在分析新旧结构并整理迁移方案…'; emit();
        const prompt = buildPrompt({ source: source.statData, targetScripts: activeSources, oldScripts: oldScript.trim() ? [{ id: 'old-manual', name: '旧版结构', content: oldScript, enabled: true }] : source.scripts || [], targetRules: selectedRules(),
          playerRequirements, reviewContext,
          ruleContext: { newWarnings: view.ruleWarnings, scope: '仅玩家选中的新版世界书条目及手动规则；未渲染宏或模板。' },
          schemaReport: { status: report.status, fields: report.fields, warnings: [...(report.warnings || []), ...result.warnings] }, ...(feedback ? { feedback } : {}) });
        const response = await model.request(prompt, config, controller.signal);
        if (token !== epoch) return;
        await host.assertCurrent(snapshot); await checkScripts(); await assertRulesCurrent(api, ruleSnapshot, selectedRules()); await host.assertCurrent(snapshot);
        try {
          plan = validatePlan(parseJsonResponse(response));
          rebuildPreview();
          if (view.schema.status === 'failed' && !trial.unresolved.length && attempt === 0) { feedback = { previousPlan: plan, errors: view.schema.errors }; continue; }
          break;
        } catch (error) { if (attempt === 1) throw error; feedback = { error: messageOf(error), previousResponse: response.slice(0, 30000) }; }
      }
      view.message = view.canApply ? '预览已生成，尚未写入。' : '请处理待确认项或结构错误。';
    } catch (error) { if (token === epoch) { plan = reviewContext?.previous_plan || null; trial = null; manualResult = previousManual; view.resultData = previousResult; view.canApply = false; view.preview = previousPreview; view.schema = previousSchema; view.phase = 'error'; view.error = messageOf(error); view.message = '本次分析没有写入聊天。'; } }
    finally { if (token === epoch) { view.busy = false; request = null; pendingReview = null; emit(); } }
  }
  async function revise(config) {
    if (view.busy) throw new Error('请先完成或取消当前分析。');
    if (!plan || !view.preview || view.phase === 'saved') throw new Error('请先生成尚未写入的迁移预览。');
    const instruction = typeof config.instructions === 'string' ? config.instructions.trim() : '';
    if (!instruction) throw new Error('请填写希望修改的内容。');
    const requests = [...reviewRequests, instruction];
    if (requests.join('\n').length > 16000) throw new Error('累计修改意见超过 16000 字，请在分析页整理要求后重新分析。');
    const reviewContext = { requests, previous_plan: cloneJson(plan), previous_answers: cloneJson(view.preview.answers || {}), ...(manualResult ? { player_edited_result: cloneJson(view.resultData) } : {}) };
    reviewRequests = requests;
    await analyze({ ...config, requirements: playerRequirements }, reviewContext);
  }
  function answer(id, index) { if (!plan || view.busy || manualResult) return; rebuildPreview({ ...(view.preview?.answers || {}), [id]: index }); emit(); }
  async function apply({ ackPartial, confirmed }) {
    if (!confirmed) throw new Error('请先确认预览中的变化和目标位置。');
    if (!plan || !trial || !view.canApply || trial.unresolved.length) throw new Error('当前预览尚不能写入。');
    if (view.schema.status !== 'passed' && !ackPartial) throw new Error('请先确认未覆盖的结构检查范围。');
    if (view.busy) throw new Error('已有操作正在进行。');
    view.busy = true; view.canApply = false; view.error = ''; emit();
    try {
      await checkScripts();
      await assertRulesCurrent(api, ruleSnapshot, selectedRules());
      await host.assertCurrent(snapshot);
      const result = await host.commit({ snapshot, statData: trial.data, metadata: { toolVersion: TOOL_VERSION, sourceHash: fingerprint(source.statData), schemaHash: selectedHash, ruleHash: fingerprint(selectedRules()), validation: view.schema.status, summary: view.preview.summary, manualEdited: Boolean(manualResult) } });
      snapshot = result.snapshot; view.target = snapshot.target;
      view.phase = 'saved'; view.message = result.unchanged ? '变量一致，无需写入。' : '已保存并读回核对，备份可恢复。';
      backupList();
    } catch (error) {
      view.phase = 'error'; view.error = messageOf(error); view.message = '保存未完成。';
      // A transient generation block must not permanently disable a valid preview.
      try { await host.assertCurrent(snapshot); view.canApply = Boolean(trial) && !trial.unresolved.length && view.schema?.status !== 'failed'; } catch { view.canApply = false; }
      backupList();
    }
    finally { view.busy = false; emit(); }
  }
  async function restore(id) {
    if (view.busy) throw new Error('已有操作正在进行。');
    invalidate(); view.busy = true; view.error = ''; emit();
    try { const result = await host.restore(id); snapshot = result.snapshot; view.target = snapshot.target; view.phase = 'saved'; view.message = result.unchanged ? '当前数据已是迁移前状态。' : '已恢复迁移前变量并读回核对。'; backupList(); }
    catch (error) { view.phase = 'error'; view.error = messageOf(error); }
    finally { view.busy = false; emit(); }
  }
  function exportSource() {
    if (!source) throw new Error('没有可导出的旧存档。');
    download('mvu-old-save.json', { format: 'mvu-zod-migration', kind: 'source', version: 1, toolVersion: TOOL_VERSION, statData: source.statData, scripts: source.scripts || [], ...(source.origin ? { origin: source.origin } : {}) });
  }
  function exportVariables() {
    if (!source) throw new Error('请先提取旧变量。');
    download('mvu-old-variables.json', { stat_data: cloneJson(source.statData) });
  }
  function exportResult() {
    if (!trial || trial.unresolved.length || view.schema?.status === 'failed') throw new Error('请先解决待确认项和结构错误后再导出新版变量。');
    download('mvu-migrated-save.json', { format: 'mvu-zod-migration', kind: 'result', version: 1, toolVersion: TOOL_VERSION, statData: trial.data, scripts: roots(), rules: selectedRules(), ruleWarnings: view.ruleWarnings, origin: view.target || {}, validation: view.schema, applied: view.phase === 'saved' });
  }
  function exportReport() {
    if (!plan || !view.preview) throw new Error('请先生成迁移预览。');
    download('mvu-migration-report.json', { format: 'mvu-zod-migration', kind: 'report', version: 1, toolVersion: TOOL_VERSION, target: view.target, status: view.phase, plan, result: view.preview, ...(manualResult ? { playerEditedResult: cloneJson(view.resultData) } : {}), validation: view.schema, targetRules: selectedRules(), playerRequirements, reviewRequests });
  }
  function exportBackup(id) {
    const backup = host.backups().find(item => item.id === id);
    if (!backup) throw new Error('找不到该备份。');
    download(`mvu-backup-${backup.id}.json`, backup);
  }
  function clear() {
    if (view.busy && view.phase !== 'analyzing') throw new Error('请等当前读取或保存结束后再清空。');
    cancel();
    snapshot = null; source = null; oldScript = ''; plan = null; trial = null; manualResult = null;
    activeSources = []; selectedHash = ''; ruleSnapshot = null; importedChat = null; reviewRequests = []; playerRequirements = ''; pendingReview = null;
    const resetRevision = (view.resetRevision || 0) + 1;
    for (const key of Object.keys(view)) delete view[key];
    Object.assign(view, { phase: 'idle', resetRevision, message: '', scripts: [], selectedIds: [], worldbookEntries: [], worldbooks: [], activeWorldbook: '', selectedRuleIds: [], ruleWarnings: [], busy: false, canApply: false, backups: [] });
    backupList(); emit();
  }
  function poll() {
    if (!snapshot || view.busy && view.phase !== 'analyzing') return;
    try { const current = host.identity(); if (current.key !== snapshot.target.identity || current.chatLength !== snapshot.target.chatLength) { invalidate('聊天已切换或有新消息，请重新读取目标。旧存档仍保留在面板中。'); snapshot = null; view.target = undefined; view.phase = 'idle'; emit(); } } catch { invalidate('当前聊天不可用，请打开目标卡并重新读取。'); snapshot = null; view.target = undefined; emit(); }
  }
  function fail(error) { view.error = messageOf(error); emit(); }
  const actions = { capture: options => options?.replaceSource === true ? captureSource(options) : refreshTarget(options), refresh: () => refreshTarget(), importSource, importResult, selectChatSource, editSource, editResult, exportVariables, openWorldbook, selectScripts, editTargetScript, selectRules, editRules,
    setOldScript: text => { invalidate(); oldScript = text; emit(); }, analyze, revise, cancel, clear, answer, apply, exportSource, exportResult, exportReport, exportBackup, restore };
  actions.importBackup = text => { host.importBackup(text); backupList(); view.message = '备份已导入，只有目标聊天与数据仍匹配时才能恢复。'; emit(); };
  backupList(); emit();
  return { actions, refresh: () => refreshTarget(), poll, fail, dispose() { cancel(); disposed = true; }, state: () => ({ view, snapshot, source, plan, trial }) };
}

export function launch(env = globalThis) {
  let win = env;
  try { if (env.parent?.document) win = env.parent; } catch {}
  const doc = win.document;
  if (!doc?.body) throw new Error('无法访问酒馆界面，迁移助手未启动。');
  const singleton = '__MVU_ZOD_MIGRATOR_V1__';
  win[singleton]?.destroy?.();
  const apiNames = ['getVariables', 'replaceVariables', 'getChatMessages', 'getScriptTrees', 'getCharWorldbookNames', 'getChatWorldbookName', 'getWorldbookNames', 'getWorldbook', 'generateRaw', 'stopGenerationById', 'getTavernHelperVersion', 'getButtonEvent', 'eventOn'];
  const api = Object.fromEntries(apiNames.map(name => [name, typeof env[name] === 'function' ? env[name].bind(env) : typeof win.TavernHelper?.[name] === 'function' ? win.TavernHelper[name].bind(win.TavernHelper) : undefined]));
  let ui, controller;
  const pending = [];
  const context = () => { const ctx = win.SillyTavern?.getContext?.(); if (!ctx) throw new Error('没有检测到 SillyTavern 宿主。'); return ctx; };
  let generationProbe = env.migrationGenerationProbe;
  const generation = observeGeneration({ context, getProbe: () => generationProbe });
  // Import the already-loaded core module from this host, including subpath installs.
  if (typeof generationProbe !== 'function') {
    import(new URL('script.js', doc.baseURI).href).then(core => { if (typeof core.isGenerating === 'function') generationProbe = core.isGenerating; }).catch(() => {});
  }
  const download = (name, data) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }));
    const a = doc.createElement('a'); a.href = url; a.download = name; doc.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  controller = createController({ api, context, storage: win.localStorage, generationBusy: () => generation.busy(), fetcher: env.fetch?.bind(env), render: view => ui ? ui.render(view) : pending.push(view), download });
  const actions = Object.fromEntries(Object.entries(controller.actions).map(([name, fn]) => [name, (...args) => Promise.resolve().then(() => fn(...args)).catch(error => { controller.fail(error); return false; })]));
  actions.close = () => ui.close();
  ui = mountUI({ document: doc, actions });
  pending.forEach(view => ui.render(view));
  const open = () => ui.open();
  let stopButton;
  if (api.getButtonEvent && api.eventOn) { try { const listener = api.eventOn(api.getButtonEvent('打开迁移助手'), open); stopButton = typeof listener === 'function' ? listener : () => listener?.stop?.(); } catch {} }
  const launcher = doc.createElement('button');
  launcher.type = 'button'; launcher.textContent = '存档迁移'; launcher.title = '打开 MVU Zod 存档迁移助手';
  launcher.style.cssText = 'position:fixed;right:12px;top:64px;z-index:99990;min-height:44px;width:max-content;max-width:calc(100vw - 8px);white-space:nowrap;box-sizing:border-box;padding:8px 15px;border-radius:6px;border:1px solid #cbc7be;background:#f7f6f2;color:#303030;box-shadow:0 4px 18px #0002;font:14px sans-serif;cursor:pointer;';
  launcher.addEventListener('click', open); doc.body.append(launcher);
  const interval = env.setInterval(() => controller.poll(), 1000);
  let dead = false;
  const destroy = () => { if (dead) return; dead = true; env.clearInterval(interval); stopButton?.(); generation.destroy(); controller.dispose(); ui.destroy(); launcher.remove(); env.removeEventListener('pagehide', destroy); if (win[singleton]?.destroy === destroy) delete win[singleton]; };
  env.addEventListener('pagehide', destroy, { once: true });
  win[singleton] = { destroy, open };
  return win[singleton];
}
