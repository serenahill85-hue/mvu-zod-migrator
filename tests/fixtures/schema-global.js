// A card using the host's z global and a runtime-ready callback.
const RELATIONS = ['陌生', '熟悉', '朋友'];
const INITIAL = { 地点: '街道', 金币: 0 };
const Person = z.object({
  名字: z.string().min(1),
  好感度: z.coerce.number().min(0).max(100).prefault(0),
  关系: z.enum(RELATIONS).default('陌生'),
  备注: z.string().nullable().optional(),
}).passthrough();
const Schema = z.object({
  玩家: z.object({ 金币: z.coerce.number().int().nonnegative().prefault(INITIAL.金币), 地点: z.string().default(INITIAL.地点) }),
  角色: z.record(z.string(), Person).prefault({}),
  背包: z.array(z.object({ 编号: z.string(), 数量: z.number().int().min(1) }).strict()).prefault([]),
  开关: z.boolean().default(false),
}).passthrough();
$(async () => { await waitGlobalInitialized('Mvu'); registerMvuSchema(Schema); });
