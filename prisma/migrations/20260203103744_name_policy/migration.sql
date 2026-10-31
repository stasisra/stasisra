-- CreateTable
CREATE TABLE "NamePolicy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "percentComplete" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "tags" TEXT,
    "executorName" TEXT,
    "responsibleName" TEXT,
    "executorId" TEXT,
    "responsibleId" TEXT,
    "parentTaskId" TEXT,
    "ownerId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Task_executorId_fkey" FOREIGN KEY ("executorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("createdAt", "description", "endDate", "executorId", "executorName", "id", "parentTaskId", "percentComplete", "priority", "responsibleId", "responsibleName", "sortOrder", "startDate", "status", "tags", "title", "updatedAt") SELECT "createdAt", "description", "endDate", "executorId", "executorName", "id", "parentTaskId", "percentComplete", "priority", "responsibleId", "responsibleName", "sortOrder", "startDate", "status", "tags", "title", "updatedAt" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE INDEX "Task_startDate_idx" ON "Task"("startDate");
CREATE INDEX "Task_endDate_idx" ON "Task"("endDate");
CREATE INDEX "Task_executorId_idx" ON "Task"("executorId");
CREATE INDEX "Task_responsibleId_idx" ON "Task"("responsibleId");
CREATE INDEX "Task_parentTaskId_idx" ON "Task"("parentTaskId");
CREATE INDEX "Task_executorName_idx" ON "Task"("executorName");
CREATE INDEX "Task_responsibleName_idx" ON "Task"("responsibleName");
CREATE INDEX "Task_ownerId_idx" ON "Task"("ownerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "NamePolicy_scope_field_value_key" ON "NamePolicy"("scope", "field", "value");
