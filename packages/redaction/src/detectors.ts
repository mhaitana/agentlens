/**
 * Built-in secret detectors (spec §8.4). Each detector describes a category,
 * a label used in the redacted placeholder, and a global regex that matches the
 * secret. Detectors are applied in array order; more-specific patterns first.
 *
 * Note: JavaScript regexes do not support inline `(?i)` flags, so
 * case-insensitivity is expressed with the literal `i` flag where needed.
 * Format-prefix patterns (AKIA, AIza, ghp, …) stay case-sensitive to avoid
 * false positives; keyword patterns (password, authorization, …) use `i`.
 */

export interface Detector {
  category: string;
  label: string;
  /** Global regex. */
  pattern: RegExp;
}

export const DETECTORS: readonly Detector[] = [
  // PEM private keys (multi-line) — must run before generic key patterns.
  {
    category: "private-key",
    label: "private-key",
    pattern:
      /-----BEGIN (?:[A-Z ]* )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]* )?PRIVATE KEY-----/g,
  },
  // JSON Web Tokens (three base64url segments, first two starting with ey).
  {
    category: "jwt",
    label: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  // AWS access key id (case-sensitive format).
  { category: "cloud-credential", label: "aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  // Google API key (case-sensitive format).
  { category: "api-key", label: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  // GitHub tokens (case-sensitive format).
  {
    category: "api-key",
    label: "github-token",
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9]{20,}\b/g,
  },
  // Slack tokens (case-sensitive format).
  { category: "api-key", label: "slack-token", pattern: /\bxox[abps]-[A-Za-z0-9-]{10,}\b/g },
  // Stripe keys (case-sensitive format).
  {
    category: "api-key",
    label: "stripe-key",
    pattern: /\b(?:sk|pk|rk)_(?:live|test)_[0-9A-Za-z]{24,}\b/g,
  },
  // OpenAI / Anthropic API keys (case-sensitive format). OpenAI project keys
  // are `sk-proj-…`; Anthropic keys are `sk-ant-api03-…`. Both are long, but
  // we use a 16-char floor so short synthetic test tokens still match while
  // everyday `sk-` prefixes (e.g. "sk-ip") do not.
  {
    category: "api-key",
    label: "openai-anthropic-key",
    pattern: /\bsk-(?:proj|ant)-[A-Za-z0-9_-]{16,}\b/g,
  },
  // Bearer / Authorization header values (case-insensitive keyword).
  {
    category: "auth-header",
    label: "auth-header",
    pattern:
      /\b(?:authorization|bearer)\s*[:=]\s*['"]?(?:bearer\s+)?[A-Za-z0-9._~+/=-]{16,}['"]?/gi,
  },
  // Cloud credential env assignments (AWS / Azure / GCP / DO).
  {
    category: "cloud-credential",
    label: "cloud-credential",
    pattern:
      /\b(?:aws_secret_access_key|aws_access_key_id|aws_session_token|azure_client_secret|google_application_credentials|gcp_service_account|digitalocean_token|gcp_api_key)\s*[:=]\s*['"]?([^\s'"]{8,})['"]?/gi,
  },
  // Connection strings (scheme://user:pass@host).
  {
    category: "connection-string",
    label: "connection-string",
    pattern:
      /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqp|amqps|postgresql):\/\/[^\s'"<>]+/gi,
  },
  // Password / secret / token assignments (KEY = VALUE).
  {
    category: "password",
    label: "password",
    pattern:
      /\b(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|client[_-]?secret|access[_-]?token|refresh[_-]?token|private[_-]?key)\s*[:=]\s*['"]?(\S{6,})['"]?/gi,
  },
  // Cookies (case-insensitive keyword).
  {
    category: "cookie",
    label: "cookie",
    pattern: /\b(?:cookie|set-cookie)\s*[:=]\s*['"]?([^\s;'"]{6,})['"]?/gi,
  },
];

/** Email detector, applied only when redactEmails is enabled. */
export const EMAIL_DETECTOR: Detector = {
  category: "email",
  label: "email",
  pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+/g,
};
