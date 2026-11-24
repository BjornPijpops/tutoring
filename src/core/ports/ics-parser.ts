import type { ParsedIcs } from '../domain/calendar-event';
import type { IsoDateTime } from '../domain/interval';
import type { PortResult } from './port-error';

/** Options of {@link IcsParser.parse}. */
export interface IcsParseOptions {
  /** Start of the window of interest; earlier occurrences are skipped as past. */
  readonly from: IsoDateTime;
  /** End of the expansion window for repeating events. */
  readonly to: IsoDateTime;
}

/**
 * Reads an iCalendar file into importable occurrences. Implementations keep only the
 * title and times: never description, location, attendees, organizer or the raw text.
 */
export interface IcsParser {
  parse(text: string, options: IcsParseOptions): PortResult<ParsedIcs>;
}
