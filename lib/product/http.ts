import { WorkspaceError } from "../workspace/database";
export async function multipart(req: Request, max: number) {
  const reader = req.body?.getReader();
  if (!reader) throw new WorkspaceError("Файлы не переданы");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > max) {
      await reader.cancel();
      throw new WorkspaceError("Превышен размер загрузки", 413);
    }
    chunks.push(value);
  }
  try {
    return await new Response(Buffer.concat(chunks), {
      headers: { "content-type": req.headers.get("content-type") || "" },
    }).formData();
  } catch {
    throw new WorkspaceError("Не удалось прочитать загрузку");
  }
}
