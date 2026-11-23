import type { ConfigError } from '../core/config';
import { Container, PageHeading, StatusMessage } from '../shared/ui';

/** Props of {@link ConfigErrorScreen}. */
export interface ConfigErrorScreenProps {
  error: ConfigError;
}

/** Full-page message shown instead of the app when the build configuration is invalid. */
export function ConfigErrorScreen({ error }: ConfigErrorScreenProps) {
  return (
    <Container>
      <PageHeading>Configuration problem</PageHeading>
      <StatusMessage status="error">
        {error.message}. Check the environment variables listed in .env.example and rebuild.
      </StatusMessage>
    </Container>
  );
}
