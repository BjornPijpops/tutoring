import type { ParsedIcs } from '../../core/domain/calendar-event';
import { err, ok } from '../../core/domain/result';
import type { IcsParser, PortError, PortResult } from '../../core/ports';

/** Fake {@link IcsParser} that returns a canned result (or error), for tests. */
export class FakeIcsParser implements IcsParser {
  /** Texts passed to {@link parse}, in order. */
  readonly parsedTexts: string[] = [];

  constructor(private readonly outcome: ParsedIcs | PortError) {}

  parse(text: string): PortResult<ParsedIcs> {
    this.parsedTexts.push(text);
    return Promise.resolve('kind' in this.outcome ? err(this.outcome) : ok(this.outcome));
  }
}
