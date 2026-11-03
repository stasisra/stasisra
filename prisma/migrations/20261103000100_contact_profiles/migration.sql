ALTER TABLE "Contact" ADD COLUMN "company" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Contact" ADD COLUMN "position" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Contact" ADD COLUMN "phones" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Contact" ADD COLUMN "emails" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Contact" ADD COLUMN "addresses" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Contact" ADD COLUMN "website" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Contact" ADD COLUMN "notes" TEXT NOT NULL DEFAULT '';
CREATE TABLE "ContactProject" (
 "contactId" TEXT NOT NULL REFERENCES "Contact"("id") ON DELETE CASCADE,
 "projectId" TEXT NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE,
 PRIMARY KEY("contactId","projectId")
);
CREATE INDEX "ContactProject_projectId" ON "ContactProject"("projectId");
INSERT INTO "WorkspaceMeta"("key","value") VALUES('contact-profiles','1');
