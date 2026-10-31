CREATE TABLE "Project" (
 "id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "key" TEXT NOT NULL,
 "color" TEXT NOT NULL DEFAULT '#7ba0df', "archived" BOOLEAN NOT NULL DEFAULT false,
 "revision" INTEGER NOT NULL DEFAULT 0, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "Project_key_key" ON "Project"("key");
CREATE TABLE "Contact" (
 "id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "key" TEXT NOT NULL,
 "type" TEXT NOT NULL DEFAULT 'Человек', "responsible" BOOLEAN NOT NULL DEFAULT false,
 "archived" BOOLEAN NOT NULL DEFAULT false, "revision" INTEGER NOT NULL DEFAULT 0,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "Contact_key_key" ON "Contact"("key");
ALTER TABLE "Task" ADD COLUMN "projectId" TEXT REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD COLUMN "responsibleContactId" TEXT REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'task';
ALTER TABLE "Task" ADD COLUMN "startTime" TEXT;
ALTER TABLE "Task" ADD COLUMN "endTime" TEXT;
ALTER TABLE "Task" ADD COLUMN "location" TEXT;
ALTER TABLE "Task" ADD COLUMN "timeZone" TEXT NOT NULL DEFAULT 'Asia/Jerusalem';
ALTER TABLE "Task" ADD COLUMN "legacyTags" TEXT;
ALTER TABLE "Task" ADD COLUMN "legacyAssignments" TEXT;
ALTER TABLE "Task" ADD COLUMN "creationFingerprint" TEXT;
ALTER TABLE "Task" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "Task_projectId_idx" ON "Task"("projectId");
CREATE INDEX "Task_responsibleContactId_idx" ON "Task"("responsibleContactId");
CREATE TABLE "TaskExecutor" (
 "taskId" TEXT NOT NULL, "contactId" TEXT NOT NULL,
 PRIMARY KEY("taskId","contactId"),
 FOREIGN KEY("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 FOREIGN KEY("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "TaskExecutor_contactId_idx" ON "TaskExecutor"("contactId");
ALTER TABLE "TaskComment" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'comment';
ALTER TABLE "TaskComment" ADD COLUMN "resolved" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TaskComment" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "WorkspaceMeta" ("key" TEXT NOT NULL PRIMARY KEY, "value" TEXT NOT NULL);
INSERT INTO "WorkspaceMeta"("key","value") VALUES ('revision','0');
INSERT INTO WorkspaceMeta(key,value) VALUES ('instance',lower(hex(randomblob(16))));
