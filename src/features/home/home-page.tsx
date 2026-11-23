import { ButtonLink, Container, PageHeading } from '../../shared/ui';

/** Landing page. */
export function HomePage() {
  return (
    <Container>
      <PageHeading lead="Personal tutoring sessions. Sign in to request access and book a time.">
        Tutoring
      </PageHeading>
      <ButtonLink to="/login">Sign in</ButtonLink>
    </Container>
  );
}
