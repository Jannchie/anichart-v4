// ───────────────────────── 未来功能挂载点 ─────────────────────────
// 将作品导出为 mp4 视频（可能作为付费功能）。
// 实现时复用 apps/studio 的 Remotion 管线：以 chartConfig + dataset 作为 input props，
// 在渲染 worker / Remotion Lambda 上 headless 渲成 mp4，回存对象存储并写回 work.posterKey / 视频 key。
// 目前仅留接口、不实现。
export function renderWorkToVideo(_workId: string): Promise<never> {
  throw createError({ statusCode: 501, statusMessage: '视频导出功能即将上线' })
}
