export function resolveImportTarget(existingByDoi, existingByClaim) {
  if (existingByDoi) {
    return { action: "attach", workId: existingByDoi.id, slug: existingByDoi.slug };
  }
  if (existingByClaim) {
    return { action: "update", workId: existingByClaim.id, slug: existingByClaim.slug };
  }
  return { action: "insert" };
}
