// Structured logging with token redaction. Never log secrets.
import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug"),
  redact: {
    paths: [
      "*.accessToken",
      "*.refreshToken",
      "*.accessTokenEnc",
      "*.refreshTokenEnc",
      "*.password",
      "*.passwordHash",
      "accessToken",
      "refreshToken",
      "authorization",
      "req.headers.authorization",
      "req.headers.cookie",
    ],
    censor: "[redacted]",
  },
  base: undefined,
});

export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
