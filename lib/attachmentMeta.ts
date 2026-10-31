export const attachmentSelect = {
  id: true,
  taskId: true,
  name: true,
  type: true,
  size: true,
  createdAt: true,
} as const;
export function attachmentMeta<T extends { createdAt: Date }>(row: T) {
  return { ...row, createdAt: row.createdAt.getTime() };
}
