import { z } from "zod";
import { dateOnly } from "./dates";
export const taskStatusEnum = z.enum([
  "PLANNED",
  "IN_PROGRESS",
  "PAUSED",
  "DONE",
]);
export const taskPriorityEnum = z.enum(["LOW", "MEDIUM", "HIGH"]);
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null));
const ymd = z
  .string()
  .refine((v) => dateOnly(v) !== null, "Укажите корректную дату YYYY-MM-DD");
const fields = z.object({
  title: z.string().trim().min(1, "Укажите название задачи").max(1000),
  description: text(100_000),
  startDate: ymd,
  endDate: ymd,
  executorId: text(100),
  responsibleId: text(100),
  executorName: text(500),
  responsibleName: text(500),
  parentTaskId: text(100),
  percentComplete: z.number().int().min(0).max(100),
  status: taskStatusEnum,
  priority: taskPriorityEnum,
  tags: text(10_000),
  sortOrder: z.number().int().min(-2147483648).max(2147483647),
});
export const taskCreateSchema = fields
  .extend({
    percentComplete: fields.shape.percentComplete.default(0),
    status: taskStatusEnum.default("PLANNED"),
    priority: taskPriorityEnum.default("MEDIUM"),
    sortOrder: fields.shape.sortOrder.default(0),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: "Дата окончания раньше даты начала",
    path: ["endDate"],
  });
export const taskUpdateSchema = fields.partial();
export function normalizeTags(value: string | null | undefined): string | null {
  const tokens = new Map<string, string>();
  for (const token of (value || "").split(",")) {
    const clean = token.replace(/\s+/g, " ").trim();
    if (clean && !tokens.has(clean.toLowerCase()))
      tokens.set(clean.toLowerCase(), clean);
  }
  return [...tokens.values()].join(",") || null;
}
