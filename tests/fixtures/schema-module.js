// A differently authored card: imported aliases, spread shape, strict root.
import { z as zz } from 'zod';
import { registerMvuSchema as register } from 'https://example.invalid/mvu_zod.js';
const COMMON = { id: zz.string().min(1), active: zz.coerce.boolean().prefault(false) };
const Phase = zz.enum({ start: '开始', done: '结束' });
const Root = zz.strictObject({
  进度: zz.object({ ...COMMON, 阶段: Phase, 完成时间: zz.string().nullish() }),
  记录: zz.array(zz.string()).max(3).default([]),
  分数: zz.number().min(-10).max(100),
});
register(Root);
