import { ButtonLink, Container, PageHeading } from '../../shared/ui';

/** Shown for unknown routes. */
export function NotFoundPage() {
  return (
    <Container>
      <PageHeading lead="We could not find that page.">Page not found</PageHeading>
      <ButtonLink to="/">Back to home</ButtonLink>
    </Container>
  );
}
