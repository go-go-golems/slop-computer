// Classify provider diagnostics without forwarding their raw content to a page.
export class ProviderError extends Error {
  readonly code: string;
  constructor(diagnostic: string) {
    const auth =
      /\b(?:401|403)\b|unauthori[sz]ed|authentication|invalid.{0,20}(?:api.?key|token)|(?:expired|missing).{0,20}(?:token|credential)|no.{0,20}(?:api.?key|credential)/i.test(
        diagnostic,
      );
    const limited = /\b429\b|rate.?limit|too many requests/i.test(diagnostic);
    super(
      auth
        ? "Pi authentication for this provider failed. Log in through Pi, then restart slop."
        : limited
          ? "The provider rate limit was reached. Wait briefly and retry."
          : "The model provider request failed. Retry or choose another model.",
    );
    this.code = auth
      ? "authentication_error"
      : limited
        ? "rate_limited"
        : "upstream_error";
  }
}
