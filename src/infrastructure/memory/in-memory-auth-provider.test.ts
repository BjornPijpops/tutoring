import { describe, expect, it, vi } from 'vitest';
import { InMemoryAuthProvider } from './in-memory-auth-provider';
import { InMemoryNotifier } from './in-memory-notifier';

describe('InMemoryAuthProvider', () => {
  it('starts signed out and signs in and out, notifying listeners', async () => {
    const auth = new InMemoryAuthProvider();
    const listener = vi.fn();
    const unsubscribe = auth.onSessionChange(listener);

    expect(await auth.getSession()).toEqual({ ok: true, value: null });

    await auth.signIn('google');
    expect(await auth.getSession()).toMatchObject({ ok: true, value: { user: { role: 'tutee' } } });
    expect(listener).toHaveBeenLastCalledWith({
      user: { id: 'user-1', role: 'tutee', accessState: 'none' },
    });

    await auth.signOut();
    expect(listener).toHaveBeenLastCalledWith(null);

    unsubscribe();
    await auth.signIn('azure');
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('InMemoryNotifier', () => {
  it('records tutor notifications', async () => {
    const notifier = new InMemoryNotifier();
    await notifier.notifyTutor({ type: 'access-requested', requestId: 'r1' });
    expect(notifier.sent).toEqual([{ type: 'access-requested', requestId: 'r1' }]);
  });
});
