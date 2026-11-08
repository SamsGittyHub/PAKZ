import "server-only";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export const env = {
  /** PostgREST base URL, e.g. http://postgrest.railway.internal:3000 */
  get postgrestUrl() { return required("POSTGREST_URL").replace(/\/$/, ""); },
  /** Shared with PostgREST (PGRST_JWT_SECRET); the app signs its service_role token with it. */
  get jwtSecret() { return required("PGRST_JWT_SECRET"); },
  /** Signs admin session cookies. */
  get sessionSecret() { return required("SESSION_SECRET"); },
  get siteUrl() { return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"; },
  get cronSecret() { return required("CRON_SECRET"); },
  s3: () => ({
    endpoint: required("S3_ENDPOINT"),
    bucket: required("S3_BUCKET"),
    region: process.env.S3_REGION || "auto",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  }),
  stripeSecret: () => process.env.STRIPE_SECRET_KEY,
  stripeWebhookSecret: () => process.env.STRIPE_WEBHOOK_SECRET,
  resendKey: () => process.env.RESEND_API_KEY,
  emailFrom: () => process.env.EMAIL_FROM,
  anthropicKey: () => process.env.ANTHROPIC_API_KEY,
};

/** Which integrations are configured — shown on the settings page without exposing secrets. */
export function integrationStatus() {
  return {
    database: Boolean(process.env.POSTGREST_URL && process.env.PGRST_JWT_SECRET),
    storage: Boolean(process.env.S3_ENDPOINT && process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID),
    sessions: Boolean(process.env.SESSION_SECRET),
    stripe: Boolean(process.env.STRIPE_SECRET_KEY),
    stripeWebhook: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    stripeMode: process.env.STRIPE_SECRET_KEY?.startsWith("sk_live") ? "live" : "test",
    email: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    cron: Boolean(process.env.CRON_SECRET),
  };
}
