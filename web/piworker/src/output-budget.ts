// One generated-token budget per call, shared by its rounds. slop sets no
// per-person budget; this only bounds one call (default 64k tokens).
export class OutputBudget {
  remaining: number;
  private admitted = 0;
  constructor(limit = 65536) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 65536)
      throw new Error("Invalid generated-token budget");
    this.remaining = limit;
  }
  next(modelLimit: number) {
    this.admitted = Math.min(modelLimit, this.remaining);
    if (this.admitted < 1) throw new Error("Generated-token budget exhausted");
    return this.admitted;
  }
  consume(output: number | undefined) {
    if (!Number.isSafeInteger(output) || output! < 0 || output! > this.admitted)
      throw new Error(
        "Provider returned unknown or invalid generated-token usage",
      );
    this.remaining -= output!;
  }
}
