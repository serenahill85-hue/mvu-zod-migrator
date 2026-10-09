import { normalizeSource, parseJsonResponse, cloneJson } from './core.mjs';

export const CHAT_FILE_LIMIT = 64 * 1024 * 1024;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const message = row => record(row) && typeof row.mes === 'string' && typeof row.is_user === 'boolean';
const header = row => record(row) && (Object.hasOwn(row, 'chat_metadata') || typeof row.user_name === 'string' && typeof row.character_name === 'string');

// Parse saved variables only. Story text, UpdateVariable blocks and templates are never replayed.
export function parseSourceImport(input, filename = '') {
  let value;
  if (typeof input === 'string') {
    if (new TextEncoder().encode(input).length > CHAT_FILE_LIMIT) throw new Error('聊天文件超过 64 MiB，请导出较短的聊天副本或单独的变量存档。');
    const raw = input.replace(/^\uFEFF/, '').trim();
    const lines = raw.split(/\r?\n/).filter(line => line.trim());
    let first;
    try { first = lines.length > 1 ? JSON.parse(lines[0]) : null; } catch {}
    if (lines.length > 1 && (header(first) || message(first))) {
      value = lines.map((line, index) => {
        try { return parseJsonResponse(line, { maxBytes: CHAT_FILE_LIMIT, validate: false }); }
        catch (error) { throw new Error(`聊天文件第 ${index + 1} 行无法读取：${error.message}`); }
      });
    } else value = parseJsonResponse(raw, { maxBytes: CHAT_FILE_LIMIT, validate: false });
  } else value = cloneJson(input);

  let rows = null;
  if (Array.isArray(value) && value.some(row => header(row) || message(row))) rows = value;
  else if (record(value) && Array.isArray(value.chat) && (header(value) || value.chat.some(message))) rows = value.chat;
  else if (message(value)) rows = [value];
  else if (header(value)) rows = [];
  if (!rows) return { source: normalizeSource(value), candidates: [] };

  const candidates = []; let floor = 0;
  for (const [index, row] of rows.entries()) {
    if (index === 0 && header(row) && !message(row)) continue;
    if (!message(row)) throw new Error(`聊天第 ${floor} 楼不是支持的酒馆消息格式，已停止导入。`);
    const active = row.swipe_id ?? 0;
    if (!Number.isSafeInteger(active) || active < 0) throw new Error(`聊天第 ${floor} 楼的分支编号无效。`);
    const variables = row.variables;
    if (variables !== undefined && variables !== null) {
      if (!Array.isArray(variables) && !record(variables)) throw new Error(`聊天第 ${floor} 楼的 variables 格式无效。`);
      for (const key of Object.keys(variables)) {
        if (!/^(0|[1-9]\d*)$/.test(key)) continue;
        const saved = variables[key], swipe = Number(key);
        if (!record(saved) || !Object.hasOwn(saved, 'stat_data')) continue;
        if (!Number.isSafeInteger(swipe)) throw new Error(`聊天第 ${floor} 楼的变量分支编号无效。`);
        if (!record(saved.stat_data)) throw new Error(`聊天第 ${floor} 楼、分支 ${swipe} 的 stat_data 不是对象，已停止导入。`);
        const statData = cloneJson(saved.stat_data);
        candidates.push({ id: `${floor}:${swipe}`, floor, swipe, active: active === swipe,
          label: `第 ${floor} 楼 · 分支 ${swipe}${active === swipe ? '（当前）' : '（其他分支）'}${row.name ? ' · ' + String(row.name).slice(0, 80) : ''}`, statData });
      }
    }
    floor++;
  }
  if (!candidates.length) throw new Error('聊天文件中没有找到已保存的 MVU stat_data。仅有正文或变量更新指令的导出不能还原存档，请从旧聊天导出变量。');
  candidates.reverse();
  const selected = candidates.find(item => item.active);
  return { candidates, selectedId: selected?.id || '', label: filename || '旧聊天文件' };
}

export function sourceFromChat(parsed, id) {
  const candidate = parsed.candidates.find(item => item.id === id);
  if (!candidate) throw new Error('请选择聊天文件中要迁移的变量楼层和分支。');
  return { statData: cloneJson(candidate.statData), scripts: [], origin: { label: parsed.label, floor: candidate.floor, swipe: candidate.swipe, sourceType: 'chat-file' } };
}
