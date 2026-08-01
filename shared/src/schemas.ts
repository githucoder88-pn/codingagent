/**
 * CODER — shared zod schemas (Phase 2).
 *
 * One source of truth for request validation on both the backend API and
 * the CLI side.
 */

import { z } from "zod";
import { FEEDBACK_MAX_RATING, FEEDBACK_MIN_RATING, KEY_PROVIDERS } from "./constants.js";

export const emailSchema = z.string().email().max(254).transform((e) => e.trim().toLowerCase());

export const passwordSchema = z.string().min(8).max(200);

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
});

export const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const providerKeySchema = z.object({
  provider: z.enum(KEY_PROVIDERS),
  apiKey: z.string().min(8).max(1024),
});

export const settingsPatchSchema = z
  .object({
    historyEnabled: z.boolean().optional(),
    trainingOptIn: z.boolean().optional(),
  })
  .refine((v) => v.historyEnabled !== undefined || v.trainingOptIn !== undefined, {
    message: "at least one setting must be provided",
  });

export const chatPromptSchema = z.object({
  clientRecordId: z.string().min(1).max(200).optional(),
  sessionId: z.string().min(1).max(200),
  provider: z.string().min(1).max(100),
  model: z.string().min(1).max(200),
  prompt: z.string().min(1).max(200_000),
  response: z.string().max(500_000).optional(),
  tokensUsed: z.number().int().nonnegative().optional(),
  latencyMs: z.number().int().nonnegative().optional(),
  forTraining: z.boolean().optional(),
});

export const feedbackSchema = z.object({
  promptId: z.string().min(1).optional(),
  rating: z.number().int().min(FEEDBACK_MIN_RATING).max(FEEDBACK_MAX_RATING),
  comment: z.string().max(2000).optional(),
});

export const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  sessionId: z.string().max(200).optional(),
});

export const chatCompletionsSchema = z.object({
  provider: z.enum(KEY_PROVIDERS),
  model: z.string().min(1).max(200),
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant", "tool"]),
        content: z.string(),
      }),
    )
    .min(1)
    .max(200),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(1_000_000).optional(),
});

export const adminQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  search: z.string().max(200).optional(),
  action: z.string().max(100).optional(),
  days: z.coerce.number().int().min(1).max(365).default(14),
});

export const accountSessionSchema = z.object({
  token: z.string().min(10),
  user: z.object({
    id: z.string(),
    email: z.string(),
    role: z.enum(["user", "admin", "superadmin"]),
  }),
  serverUrl: z.string().url(),
  loggedInAt: z.string(),
});

export const privacySettingsSchema = z.object({
  historyEnabled: z.boolean().default(true),
  trainingOptIn: z.boolean().default(false),
});

export const localRecordSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  sessionId: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  prompt: z.string().max(500_000).optional(),
  response: z.string().max(500_000).optional(),
  tokensUsed: z.number().int().nonnegative().optional(),
  latencyMs: z.number().int().nonnegative().optional(),
  remotePromptId: z.string().optional(),
  syncedAt: z.string().optional(),
  forTraining: z.boolean().optional(),
  feedback: z
    .object({
      rating: z.number().int().min(FEEDBACK_MIN_RATING).max(FEEDBACK_MAX_RATING),
      comment: z.string().max(2000).optional(),
      createdAt: z.string(),
    })
    .optional(),
});
