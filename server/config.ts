import 'dotenv/config'
import { z } from 'zod'

const bool = (fallback: boolean) => z.string().optional().transform((value) => {
  if (value === undefined) return fallback
  return value.toLowerCase() === 'true'
})

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  APP_URL: z.string().url().default('http://localhost:5173'),
  ADMIN_APP_URL: z.string().url().optional(),
  DATABASE_URL: z.string().min(1).default('postgres://mira@127.0.0.1:5432/mira'),
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  RECONSTRUCTION_WORKER_URL: z.string().url().default('http://localhost:8787'),
  RECONSTRUCTION_WORKER_TOKEN: z.string().optional(),
  STORAGE_DIRECTORY: z.string().min(1).default('storage'),
  EFT_INSTRUCTIONS: z.string().default('Contact support for bank details before making your EFT. Use the order reference shown below.'),
  DEV_BYPASS_PAYWALL: bool(false),
  REQUIRE_EMAIL_VERIFICATION: bool(false),
  AUTH_IP_HEADER: z.string().default('x-forwarded-for'),
  ADMIN_EMAILS: z.string().default(''),
  PAYSTACK_SECRET_KEY: z.string().optional(),
  PAYSTACK_API_URL: z.string().url().default('https://api.paystack.co'),
  BILLING_CURRENCY: z.string().length(3).default('zar'),
  PRICE_QUICK_CENTS: z.coerce.number().int().nonnegative().default(2900),
  PRICE_PREVIEW_CENTS: z.coerce.number().int().nonnegative().default(4900),
  PRICE_BALANCED_CENTS: z.coerce.number().int().nonnegative().default(7900),
  PRICE_HIGH_CENTS: z.coerce.number().int().nonnegative().default(12900),
  PRICE_MAXIMUM_CENTS: z.coerce.number().int().nonnegative().default(19900),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: bool(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  EMAIL_FROM: z.string().default('Mira <no-reply@example.com>'),
})

const parsed = schema.parse(process.env)
if (parsed.NODE_ENV === 'production' && !parsed.BETTER_AUTH_SECRET) {
  throw new Error('BETTER_AUTH_SECRET is required in production.')
}

const developmentSecret = 'mira-development-only-secret-change-me-000000000000'

export const config = {
  ...parsed,
  betterAuthSecret: parsed.BETTER_AUTH_SECRET || developmentSecret,
  devBypassPaywall: parsed.NODE_ENV !== 'production' && parsed.DEV_BYPASS_PAYWALL,
  trustedOrigins: [parsed.APP_URL, parsed.ADMIN_APP_URL].filter((origin): origin is string => Boolean(origin)),
  adminEmails: parsed.ADMIN_EMAILS.split(',').map((email) => email.trim().toLowerCase()).filter(Boolean),
} as const

export type Quality = 'quick' | 'preview' | 'balanced' | 'high' | 'maximum'

export const qualityOrder: Quality[] = ['quick', 'preview', 'balanced', 'high', 'maximum']
export const qualityPrices: Record<Quality, number> = {
  quick: config.PRICE_QUICK_CENTS,
  preview: config.PRICE_PREVIEW_CENTS,
  balanced: config.PRICE_BALANCED_CENTS,
  high: config.PRICE_HIGH_CENTS,
  maximum: config.PRICE_MAXIMUM_CENTS,
}

export const isQuality = (value: unknown): value is Quality =>
  typeof value === 'string' && qualityOrder.includes(value as Quality)
