/** Time zone in which the tutor works; all wall-clock rules are evaluated here. */
export const TUTOR_TIME_ZONE = 'Europe/Brussels';

/** Local hours (24h clock) in which tutoring can happen. */
export interface TutoringHours {
  readonly openHour: number;
  readonly closeHour: number;
}

/** Tutoring is possible from 08:00 until 22:00, every day including weekends. */
export const TUTORING_HOURS: TutoringHours = { openHour: 8, closeHour: 22 };

/** Length of one calendar cell in minutes. */
export const SLOT_MINUTES = 30;
