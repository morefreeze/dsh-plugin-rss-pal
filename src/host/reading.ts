export interface ReadingEvent {
  clientId: string;
  sequence: number;
  progress: number;
  seconds: number;
  opened?: boolean;
}
export function validateReading(event: ReadingEvent): void {
  if (
    !event ||
    typeof event.clientId !== "string" ||
    !event.clientId.trim() ||
    event.clientId.length > 200 ||
    !Number.isSafeInteger(event.sequence) ||
    event.sequence < 0 ||
    !Number.isFinite(event.progress) ||
    event.progress < 0 ||
    event.progress > 1 ||
    !Number.isFinite(event.seconds) ||
    event.seconds < 0 ||
    event.seconds > 120
  )
    throw new Error("Invalid reading event");
}
/** Only one foreground client's time may own the current 120-second lease. */
export function ownsReadingLease(
  lease: { clientId: string; at: number } | null,
  event: ReadingEvent,
  now: number,
): boolean {
  return (
    !lease || lease.clientId === event.clientId || now - lease.at > 120_000
  );
}
