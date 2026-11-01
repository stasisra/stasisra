import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { need, ID } from "./service";
import { touch, WorkspaceError } from "../workspace/database";
export const MAX_FILE = 20 * 1024 * 1024;
export function saveFile(
  db: Database.Database,
  itemId: string,
  file: { id?: string; name: string; type: string; data: Uint8Array },
) {
  if (!file.data.byteLength || file.data.byteLength > MAX_FILE)
    throw new WorkspaceError("Выберите непустой файл до 20 МБ", 413);
  const id = file.id ? ID.parse(file.id) : randomUUID(),
    name = [...file.name].slice(0, 255).join(""),
    bytes = Buffer.from(file.data),
    sha = createHash("sha256").update(bytes).digest("hex");
  return db
    .transaction(() => {
      need(db, "ContentItem", ID.parse(itemId));
      const old = db
        .prepare(
          "SELECT id,name,type,size,sha256,createdAt FROM ContentFile WHERE id=?",
        )
        .get(id) as any;
      if (old) {
        if (
          old.name !== name ||
          old.sha256 !== sha ||
          !db
            .prepare("SELECT 1 FROM ItemFile WHERE itemId=? AND fileId=?")
            .get(itemId, id)
        )
          throw new WorkspaceError("Идентификатор файла уже используется", 409);
        return old;
      }
      const createdAt = Date.now();
      db.prepare(
        "INSERT INTO ContentFile(id,name,type,size,data,sha256,createdAt) VALUES(?,?,?,?,?,?,?)",
      ).run(
        id,
        name,
        file.type || "application/octet-stream",
        bytes.length,
        bytes,
        sha,
        createdAt,
      );
      db.prepare("INSERT INTO ItemFile(itemId,fileId) VALUES(?,?)").run(
        itemId,
        id,
      );
      touch(db);
      return { id, name, type: file.type, size: bytes.length, createdAt };
    })
    .immediate();
}
export function unlinkFile(
  db: Database.Database,
  itemId: string,
  fileId: string,
) {
  db.transaction(() => {
    need(db, "ContentItem", ID.parse(itemId));
    db.prepare("DELETE FROM ItemFile WHERE itemId=? AND fileId=?").run(
      itemId,
      ID.parse(fileId),
    );
    db.prepare(
      "DELETE FROM ContentFile WHERE id=? AND NOT EXISTS (SELECT 1 FROM ItemFile WHERE fileId=?)",
    ).run(fileId, fileId);
    touch(db);
  }).immediate();
}
