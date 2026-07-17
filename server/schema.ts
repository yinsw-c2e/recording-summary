import { z } from "zod";

export const cardTypeSchema = z.enum([
  "raw_idea",
  "project_idea",
  "knowledge",
  "task",
  "question",
  "reflection",
  "daily_note",
  "uncertain"
]);

export const relationTypeSchema = z.enum([
  "continuation",
  "duplicate",
  "refinement",
  "contradiction",
  "task_followup",
  "knowledge_link",
  "project_link",
  "uncertain"
]);

export const organizedCardSchema = z.object({
  type: cardTypeSchema.default("uncertain"),
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(2000),
  keyPoints: z.array(z.string().min(1)).default([]),
  actions: z.array(z.string().min(1)).default([]),
  tags: z.array(z.string().min(1).max(32)).default([]),
  sourceTextRange: z.string().default("full"),
  sourceQuote: z.string().max(800).default(""),
  confidence: z.number().min(0).max(1).default(0.6)
});

export const editCardSchema = z.object({
  type: cardTypeSchema,
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(2000),
  keyPoints: z.array(z.string().trim().min(1)).max(30).default([]),
  actions: z.array(z.string().trim().min(1)).max(30).default([]),
  tags: z.array(z.string().trim().min(1).max(32)).max(12).default([])
});

export const organizeResultSchema = z.object({
  cleanedTranscript: z.string().default(""),
  items: z.array(organizedCardSchema).default([])
});

export const relationSchema = z.object({
  fromTitle: z.string().min(1),
  toCardId: z.string().min(1),
  relationType: relationTypeSchema.default("uncertain"),
  confidence: z.number().min(0).max(1).default(0.5),
  rationale: z.string().default("")
});

export const linkResultSchema = z.object({
  relations: z.array(relationSchema).default([])
});

export const qualityResultSchema = z.object({
  issues: z
    .array(
      z.object({
        severity: z.enum(["low", "medium", "high"]),
        message: z.string(),
        cardTitle: z.string().optional()
      })
    )
    .default([])
});

export type OrganizedCardInput = z.infer<typeof organizedCardSchema>;
export type OrganizeResult = z.infer<typeof organizeResultSchema>;
export type LinkResult = z.infer<typeof linkResultSchema>;
export type QualityResult = z.infer<typeof qualityResultSchema>;
