export type AttachmentMeta = {
  id: string;
  taskId: string;
  name: string;
  type: string;
  size: number;
  createdAt: number;
};
async function checked(res: Response) {
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Не удалось выполнить операцию с файлом");
  }
  return res;
}
export async function listTaskAttachments(
  taskId: string,
): Promise<AttachmentMeta[]> {
  return (
    await checked(
      await fetch(`/api/tasks/${taskId}/attachments`, { cache: "no-store" }),
    )
  ).json();
}
export async function countTaskAttachments(taskId: string) {
  return (await listTaskAttachments(taskId)).length;
}
export async function addTaskAttachment(
  taskId: string,
  file: File,
): Promise<AttachmentMeta> {
  const form = new FormData();
  form.set("file", file);
  const res = await checked(
    await fetch(`/api/tasks/${taskId}/attachments`, {
      method: "POST",
      body: form,
    }),
  );
  window.dispatchEvent(new Event("attachments:changed"));
  return res.json();
}
export async function getAttachmentBlob(id: string): Promise<Blob> {
  return (
    await checked(await fetch(`/api/attachments/${id}`, { cache: "no-store" }))
  ).blob();
}
export async function deleteAttachment(id: string) {
  await checked(await fetch(`/api/attachments/${id}`, { method: "DELETE" }));
  window.dispatchEvent(new Event("attachments:changed"));
}
