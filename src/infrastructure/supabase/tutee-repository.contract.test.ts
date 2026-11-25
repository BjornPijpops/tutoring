import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll } from 'vitest';
import {
  ADMIN_ID,
  createTuteeDatabase,
  tuteeId,
  type TuteeDatabase,
} from '../../test/tutee-database';
import { defineTuteeContract, type ContractFactory } from '../../test/tutee-contract';
import { SupabaseTuteeRepository } from './tutee-repository';

let t: TuteeDatabase;

/** A Supabase client whose rpc() runs the real SQL functions on PGlite as the tutor. */
function pgliteClient(database: TuteeDatabase): SupabaseClient {
  return {
    async rpc(name: string, args: Record<string, unknown> = {}) {
      const keys = Object.keys(args);
      const list = keys.map((key, index) => `${key} => $${String(index + 1)}`).join(', ');
      try {
        await database.asRole('authenticated', ADMIN_ID);
        const result = await database.db.query<{ data: unknown }>(
          `select to_jsonb(public.${name}(${list})) as data`,
          keys.map((key) => args[key]),
        );
        return { data: result.rows[0]?.data ?? null, error: null };
      } catch (error) {
        const failure = error as { code?: string; message?: string };
        return { data: null, error: { code: failure.code, message: failure.message ?? '' } };
      }
    },
  } as unknown as SupabaseClient;
}

beforeAll(async () => {
  t = await createTuteeDatabase();
});
afterAll(async () => {
  await t.close();
});

const factory: ContractFactory = async (tutees, sessions = []) => {
  await t.reset();
  for (const tutee of tutees) {
    const status = tutee.status ?? 'approved';
    const cooling = (status === 'denied' || status === 'revoked') && tutee.cooldownActive;
    await t.addTutee({
      id: tuteeId(tutee.n),
      ...(tutee.name ? { name: tutee.name } : {}),
      ...(tutee.email ? { email: tutee.email } : {}),
      status,
      requestedAgo: `-${String(tutee.requestedMinutesAgo ?? 1440)} minutes`,
      nextRequestAt: cooling ? new Date(Date.now() + 36e5).toISOString() : null,
    });
  }
  const sessionIds: string[] = [];
  for (const session of sessions) {
    sessionIds.push(
      await t.addSession({
        userId: tuteeId(session.n),
        status: session.status,
        startsInHours: session.startsInHours,
      }),
    );
  }
  return { repo: new SupabaseTuteeRepository(pgliteClient(t)), sessionIds, userId: tuteeId };
};

defineTuteeContract('sql', factory);
