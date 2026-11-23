# Supabase adapters

Adapters implementing the ports in `src/core/ports` with Supabase land together with the first feature that needs them. Until then `container.ts` wires the in-memory adapters from `../memory`.

Only this folder (and `container.ts`) may import `@supabase/*`.
