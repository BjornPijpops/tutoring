import { Container } from '../../shared/ui';
import { CalendarManager } from './calendar-manager';

/** Tutor calendar page; access is checked by the route guard and by the backend. */
export function CalendarPage() {
  return (
    <Container>
      <CalendarManager />
    </Container>
  );
}
