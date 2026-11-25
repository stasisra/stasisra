ALTER TABLE "ContentItem" ADD COLUMN "eventType" TEXT NOT NULL DEFAULT ''
  CHECK ("eventType" IN ('', 'meeting', 'trip', 'call', 'other'));

CREATE TABLE "ItemParticipant" (
  "itemId" TEXT NOT NULL REFERENCES "ContentItem"("id") ON DELETE CASCADE,
  "contactId" TEXT NOT NULL REFERENCES "Contact"("id") ON DELETE CASCADE,
  PRIMARY KEY ("itemId", "contactId")
);
CREATE INDEX "ItemParticipant_contactId" ON "ItemParticipant"("contactId");

CREATE TABLE "EventOutcomeTask" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "sourceItemId" TEXT REFERENCES "ContentItem"("id") ON DELETE SET NULL,
  "taskId" TEXT NOT NULL REFERENCES "ContentItem"("id") ON DELETE CASCADE,
  "body" TEXT NOT NULL,
  "sourceTitle" TEXT NOT NULL,
  "eventTitle" TEXT NOT NULL,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL,
  UNIQUE ("sourceItemId", "taskId")
);
CREATE INDEX "EventOutcomeTask_taskId" ON "EventOutcomeTask"("taskId");

INSERT INTO "WorkspaceMeta" ("key", "value") VALUES ('event-workflows', '1');
