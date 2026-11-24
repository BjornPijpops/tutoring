// Deno entry point. Deployed by the owner with `npx supabase functions deploy`; the secrets
// below are set with `npx supabase secrets set` and are never in the repository.
import { handleRequest } from './logic.ts';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Promise<Response>): void;
};

Deno.serve((request) =>
  handleRequest(request, {
    supabaseUrl: Deno.env.get('SUPABASE_URL') ?? '',
    serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    webhookSecret: Deno.env.get('WEBHOOK_SECRET') ?? '',
    resendApiKey: Deno.env.get('RESEND_API_KEY') ?? '',
    tutorEmail: Deno.env.get('TUTOR_EMAIL') ?? '',
  }),
);
