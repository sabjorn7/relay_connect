import { createCheckoutHandler } from './handler.mjs';
// Optional root-installed server file; never part of Git or the public bundle.
let clubSigningKey = Deno.env.get('PRODAMUS_SECRET_KEY');
if (!clubSigningKey) {
    try { clubSigningKey = JSON.parse(Deno.readTextFileSync(new URL('./.prodamus-key.json', import.meta.url))).key; }
    catch { /* Missing club key must not block the existing non-club checkout. */ }
}
Deno.serve(createCheckoutHandler({ fetch, env: {
    SUPABASE_URL: Deno.env.get('SUPABASE_URL'),
    SUPABASE_ANON_KEY: Deno.env.get('SUPABASE_ANON_KEY'),
    SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    PRODAMUS_SECRET_KEY: clubSigningKey,
    SITE_ORIGIN: Deno.env.get('SITE_ORIGIN'),
} }));
