ALTER TABLE "Project" ADD COLUMN "description" TEXT NOT NULL DEFAULT '';
CREATE TABLE "ContentItem" (
 "id" TEXT PRIMARY KEY NOT NULL,
 "kind" TEXT NOT NULL CHECK("kind" IN ('task','event','preparation','question','note','reference')),
 "title" TEXT NOT NULL,
 "description" TEXT NOT NULL DEFAULT '',
 "outcome" TEXT NOT NULL DEFAULT '',
 "projectId" TEXT REFERENCES "Project"("id") ON DELETE SET NULL,
 "parentId" TEXT REFERENCES "ContentItem"("id") ON DELETE SET NULL,
 "activityId" TEXT REFERENCES "ContentItem"("id") ON DELETE CASCADE,
 "linkedTaskId" TEXT REFERENCES "ContentItem"("id") ON DELETE SET NULL,
 "originItemId" TEXT REFERENCES "ContentItem"("id") ON DELETE SET NULL,
 "startDate" TEXT,
 "endDate" TEXT,
 "startTime" TEXT,
 "endTime" TEXT,
 "location" TEXT NOT NULL DEFAULT '',
 "timeZone" TEXT NOT NULL DEFAULT 'Asia/Jerusalem',
 "status" TEXT NOT NULL DEFAULT 'PLANNED',
 "percent" INTEGER NOT NULL DEFAULT 0 CHECK("percent" BETWEEN 0 AND 100),
 "position" INTEGER NOT NULL DEFAULT 0,
 "revision" INTEGER NOT NULL DEFAULT 0,
 "creationFingerprint" TEXT,
 "sourceMeta" TEXT NOT NULL DEFAULT '',
 "createdAt" INTEGER NOT NULL,
 "updatedAt" INTEGER NOT NULL
);
CREATE INDEX "ContentItem_projectId" ON "ContentItem"("projectId");
CREATE INDEX "ContentItem_parentId" ON "ContentItem"("parentId");
CREATE INDEX "ContentItem_activityId" ON "ContentItem"("activityId");
CREATE INDEX "ContentItem_linkedTaskId" ON "ContentItem"("linkedTaskId");
CREATE INDEX "ContentItem_kind_endDate" ON "ContentItem"("kind","endDate");
CREATE TABLE "EventProject" (
 "itemId" TEXT NOT NULL REFERENCES "ContentItem"("id") ON DELETE CASCADE,
 "projectId" TEXT NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE,
 PRIMARY KEY("itemId","projectId")
);
CREATE TABLE "ItemContact" (
 "itemId" TEXT NOT NULL REFERENCES "ContentItem"("id") ON DELETE CASCADE,
 "contactId" TEXT NOT NULL REFERENCES "Contact"("id") ON DELETE CASCADE,
 "role" TEXT NOT NULL CHECK("role" IN ('counterparty','executor','responsible')),
 PRIMARY KEY("itemId","contactId","role")
);
CREATE UNIQUE INDEX "ItemContact_singleResponsible" ON "ItemContact"("itemId") WHERE "role"='responsible';
CREATE INDEX "ItemContact_contactId" ON "ItemContact"("contactId");
CREATE TABLE "Tag" (
 "id" TEXT PRIMARY KEY NOT NULL,
 "name" TEXT NOT NULL,
 "key" TEXT UNIQUE NOT NULL,
 "archived" INTEGER NOT NULL DEFAULT 0,
 "revision" INTEGER NOT NULL DEFAULT 0,
 "createdAt" INTEGER NOT NULL,
 "updatedAt" INTEGER NOT NULL
);
CREATE TABLE "ItemTag" (
 "itemId" TEXT NOT NULL REFERENCES "ContentItem"("id") ON DELETE CASCADE,
 "tagId" TEXT NOT NULL REFERENCES "Tag"("id") ON DELETE CASCADE,
 PRIMARY KEY("itemId","tagId")
);
CREATE INDEX "ItemTag_tagId" ON "ItemTag"("tagId");
CREATE TABLE "ContentNote" (
 "id" TEXT PRIMARY KEY NOT NULL,
 "body" TEXT NOT NULL,
 "kind" TEXT NOT NULL DEFAULT 'comment' CHECK("kind" IN ('comment','question')),
 "resolved" INTEGER NOT NULL DEFAULT 0,
 "authorId" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
 "authorName" TEXT NOT NULL DEFAULT '',
 "revision" INTEGER NOT NULL DEFAULT 0,
 "createdAt" INTEGER NOT NULL
);
CREATE TABLE "ItemNote" (
 "itemId" TEXT NOT NULL REFERENCES "ContentItem"("id") ON DELETE CASCADE,
 "noteId" TEXT NOT NULL REFERENCES "ContentNote"("id") ON DELETE CASCADE,
 PRIMARY KEY("itemId","noteId")
);
CREATE TABLE "ContentFile" (
 "id" TEXT PRIMARY KEY NOT NULL,
 "name" TEXT NOT NULL,
 "type" TEXT NOT NULL,
 "size" INTEGER NOT NULL,
 "data" BLOB NOT NULL,
 "sha256" TEXT NOT NULL,
 "createdAt" INTEGER NOT NULL
);
CREATE TABLE "ItemFile" (
 "itemId" TEXT NOT NULL REFERENCES "ContentItem"("id") ON DELETE CASCADE,
 "fileId" TEXT NOT NULL REFERENCES "ContentFile"("id") ON DELETE CASCADE,
 PRIMARY KEY("itemId","fileId")
);
CREATE TABLE "ReviewImport" (
 "snapshotId" TEXT PRIMARY KEY NOT NULL,
 "digest" TEXT NOT NULL,
 "result" TEXT NOT NULL,
 "createdAt" INTEGER NOT NULL
);
INSERT INTO "WorkspaceMeta"("key","value") VALUES('product-model','1');
CREATE TABLE "ImportDraft" (
 "id" TEXT PRIMARY KEY NOT NULL,
 "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
 "snapshotId" TEXT NOT NULL,
 "digest" TEXT NOT NULL,
 "sourceJson" TEXT NOT NULL,
 "reviewJson" TEXT NOT NULL,
 "createdAt" INTEGER NOT NULL
);
CREATE TABLE "ImportDraftFile" (
 "draftId" TEXT NOT NULL REFERENCES "ImportDraft"("id") ON DELETE CASCADE,
 "sourceId" TEXT NOT NULL,
 "data" BLOB NOT NULL,
 "sha256" TEXT NOT NULL,
 PRIMARY KEY("draftId","sourceId")
);
