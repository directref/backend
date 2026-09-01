/** Single source of truth for the referral response-time escalation ladder.
 *  Change the day counts here — everything that reads them (the sweep, and
 *  any future copy) follows automatically. */
export const ESCALATION_DAYS = {
  REMINDER: 1,   // referrer gets a nudge
  ESCALATE: 3,   // seeker is told the referrer hasn't responded
  AUTO_CANCEL: 5, // application closes, seeker's credit is refunded
} as const;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const ESCALATION_MS = {
  REMINDER: ESCALATION_DAYS.REMINDER * MS_PER_DAY,
  ESCALATE: ESCALATION_DAYS.ESCALATE * MS_PER_DAY,
  AUTO_CANCEL: ESCALATION_DAYS.AUTO_CANCEL * MS_PER_DAY,
} as const;
