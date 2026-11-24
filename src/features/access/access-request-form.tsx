import { useState, type SyntheticEvent } from 'react';
import { ACCESS_MESSAGE_MAX_LENGTH } from '../../core/domain/access-request';
import type { Identity } from '../../core/domain/user';
import {
  Button,
  CharacterCounter,
  DefinitionList,
  ErrorSummary,
  Field,
  StatusMessage,
  TextArea,
} from '../../shared/ui';
import styles from './access.module.css';

const MESSAGE_ID = 'access-message';
const COUNTER_ID = 'access-message-counter';
const TOO_LONG = `Your message must be ${String(ACCESS_MESSAGE_MAX_LENGTH)} characters or fewer.`;

/** Props of {@link AccessRequestForm}. */
export interface AccessRequestFormProps {
  /** The signed-in account, shown back to the user; not editable here. */
  identity: Identity | null;
  onSubmit: (message: string) => Promise<void>;
  busy: boolean;
  /** Problem from the last attempt; the message stays in the form. */
  error?: string;
  /** Shown as an `h2` when the form follows other content (e.g. "Ask again"). */
  heading?: string;
}

/** Message box with the user's name and e-mail, the privacy note and the send button. */
export function AccessRequestForm({
  identity,
  onSubmit,
  busy,
  error,
  heading,
}: AccessRequestFormProps) {
  const [message, setMessage] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const tooLong = message.length > ACCESS_MESSAGE_MAX_LENGTH;
  const showError = submitted && tooLong;

  const handleSubmit = (event: SyntheticEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (tooLong) return;
    void onSubmit(message.trim());
  };

  return (
    <form onSubmit={handleSubmit} noValidate autoComplete="off" className={styles['form']}>
      {heading ? <h2>{heading}</h2> : null}
      <p>Tell the tutor who you are and ask for access to the availability calendar.</p>
      {identity ? (
        <section aria-label="Your details" className={styles['details']}>
          <DefinitionList
            items={[
              ...(identity.displayName ? [{ label: 'Name', value: identity.displayName }] : []),
              { label: 'Email', value: identity.email },
            ]}
          />
          <p className={styles['muted']}>
            From your Google account. Change it there if it is wrong.
          </p>
        </section>
      ) : null}
      {showError ? <ErrorSummary errors={[{ fieldId: MESSAGE_ID, message: TOO_LONG }]} /> : null}
      <Field
        label="Message (optional)"
        hint="For example: who you are or why you would like to join. Please do not include sensitive information."
        error={showError ? TOO_LONG : undefined}
        id={MESSAGE_ID}
      >
        {(props) => (
          <TextArea
            {...props}
            aria-describedby={[props['aria-describedby'], COUNTER_ID].filter(Boolean).join(' ')}
            value={message}
            onChange={(event) => {
              setMessage(event.target.value);
            }}
          />
        )}
      </Field>
      <CharacterCounter id={COUNTER_ID} value={message} max={ACCESS_MESSAGE_MAX_LENGTH} />
      {error ? <StatusMessage status="error">{error}</StatusMessage> : null}
      <Button type="submit" loading={busy}>
        Send request
      </Button>
      <p className={styles['muted']}>
        What happens to this: the tutor gets your Google name, email and message by email and sees
        them here. Nobody else does. They are only used to decide on access, and kept until you no
        longer need access or ask for them to be deleted. To delete them, just ask the tutor.
      </p>
    </form>
  );
}
