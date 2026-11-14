export type SafePayload = {
  data: Record<string, string | number>
  subject?: string
}

export class DeveventsPayload {
  private readonly data: SafePayload['data'] = {}

  addReason(reason: string): void {
    this.data.reason = reason
  }

  toSafePayload(subject: string | undefined): SafePayload {
    return subject === undefined ? { data: this.data } : { data: this.data, subject }
  }
}
