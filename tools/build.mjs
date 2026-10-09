import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parse } from '../src/vendor/acorn.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const modules = new Map();
const order = [];
const digest = text => createHash('sha256').update(text).digest('hex');
async function visit(file) {
  file = resolve(file);
  if (!file.startsWith(root + '\\') && !file.startsWith(root + '/')) throw new Error('Bundle import leaves project');
  if (modules.has(file)) return modules.get(file).id;
  const source = await readFile(file, 'utf8');
  const ast = parse(source, { sourceType: 'module', ecmaVersion: 'latest' });
  const item = { id: `module${modules.size}`, source, hash: digest(source), file };
  modules.set(file, item);
  const edits = [], imports = [], exports = [];
  for (const node of ast.body) {
    if (node.type === 'ImportDeclaration') {
      if (!node.source.value.startsWith('.')) throw new Error('Only local, vendored imports are allowed');
      const dependency = await visit(resolve(dirname(file), node.source.value));
      for (const spec of node.specifiers) {
        if (spec.type === 'ImportNamespaceSpecifier') imports.push(`const ${spec.local.name}=${dependency};`);
        else imports.push(`const ${spec.local.name}=${dependency}[${JSON.stringify(spec.type === 'ImportDefaultSpecifier' ? 'default' : spec.imported.name)}];`);
      }
      edits.push([node.start, node.end, '']);
    } else if (node.type === 'ExportNamedDeclaration') {
      if (node.source) throw new Error('Reexports require explicit local imports');
      if (node.declaration) {
        edits.push([node.start, node.declaration.start, '']);
        if (node.declaration.id) exports.push([node.declaration.id.name, node.declaration.id.name]);
        for (const declaration of node.declaration.declarations || []) {
          if (declaration.id.type !== 'Identifier') throw new Error('Destructured exports unsupported');
          exports.push([declaration.id.name, declaration.id.name]);
        }
      } else {
        exports.push(...node.specifiers.map(spec => [spec.exported.name, spec.local.name]));
        edits.push([node.start, node.end, '']);
      }
    } else if (node.type === 'ExportDefaultDeclaration') throw new Error('Default exports unsupported in this source set');
  }
  let body = source;
  edits.sort((a, b) => b[0] - a[0]).forEach(([start, end, replacement]) => { body = body.slice(0, start) + replacement + body.slice(end); });
  item.compiled = `const ${item.id}=(()=>{\n${imports.join('\n')}\n${body}\nreturn {${exports.map(([key, value]) => `${JSON.stringify(key)}:${value}`).join(',')}};\n})();`;
  order.push(item);
  return item.id;
}
const main = await visit(resolve(root, 'src/main.mjs'));
const license = await readFile(resolve(root, 'src/vendor/ACORN-LICENSE.txt'), 'utf8');
const banner = `/* MVU Zod 存档迁移助手 0.5.1 — Acorn 8.15.0\n${license.replaceAll('*/', '* /')}\n*/\n`;
const shared = `${banner}(()=>{'use strict';\n${order.map(item => item.compiled).join('\n')}\n`;
const content = `${shared}${main}.launch(globalThis);\n})();\n`;
const preview = `${shared}globalThis.MvuMigration={launch:${main}.launch,createController:${main}.createController};\n})();\n`;
parse(content, { ecmaVersion: 'latest', sourceType: 'script' });
const artifact = {
  type: 'script', enabled: true, name: 'MVU Zod 存档迁移助手 v0.5.1', id: 'ea33b63a-90d8-4655-881b-78d4050cbd35', content,
  info: 'AI 结合角色卡 MVU Zod 源码、所选世界书变量更新规则及旧存档生成迁移预览。备份后手动确认写入，支持恢复。仅处理单角色聊天指定楼层当前分支 stat_data，不修改世界书。源码静态检查不等于执行原始 Zod。实际酒馆与模型待用户试用。',
  button: { enabled: true, buttons: [{ name: '打开迁移助手', visible: true }] }, data: {}, export_with: { data: false, button: true }
};
const spec = { schemaVersion: 1, deliveryMode: 'component', kind: 'helper-script', items: [{ artifactName: 'mvu-zod-migrator', value: artifact }] };
const outputs = new Map([
  ['dist/mvu-zod-migrator.js', content], ['dist/mvu-zod-migrator.json', JSON.stringify(artifact, null, 2) + '\n'],
  ['preview/bundle.js', preview], ['build/component-spec.json', JSON.stringify(spec, null, 2) + '\n'],
  ['dist/source-manifest.json', JSON.stringify({ version: '0.5.1', source: order.map(item => ({ path: relative(root, item.file).replaceAll('\\', '/'), sha256: item.hash })), scriptSha256: digest(content), runtime: { tavernHelper: '4.11.3 source baseline; runtime capability detection', realHost: 'pending', model: 'pending' } }, null, 2) + '\n']
]);
outputs.set('dist/SHA256SUMS.txt', ['mvu-zod-migrator.json', 'mvu-zod-migrator.js', 'source-manifest.json'].map(name => `${digest(outputs.get('dist/' + name))}  ${name}`).join('\n') + '\n');
for (const [name, text] of outputs) {
  const path = resolve(root, name);
  if (check) { if (await readFile(path, 'utf8') !== text) throw new Error(`Outdated generated output: ${name}`); }
  else { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text, 'utf8'); }
}
console.log(`${check ? 'CHECK' : 'BUILD'} PASS: ${order.length} source modules, ${Buffer.byteLength(content)} byte script, ${outputs.size} outputs`);
