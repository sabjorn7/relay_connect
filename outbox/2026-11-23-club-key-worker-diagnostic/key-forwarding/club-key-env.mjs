// Runs in the trusted MAIN worker, never inside checkout-pay-link.
// Does not read/write global environment or expose the key in logs.
const CLUB_SERVICE = '/home/deno/functions/checkout-pay-link';
export async function clubWorkerEnv(servicePath, envVars, readText = path => Deno.readTextFile(path)) {
    if (typeof servicePath !== 'string' || servicePath.replace(/\/+$/, '') !== CLUB_SERVICE) return envVars;
    if (envVars.some(([name, value]) => name === 'PRODAMUS_SECRET_KEY' && typeof value === 'string' && value.trim())) return envVars;
    // A key-loading failure must not break the existing non-club checkout branch.
    try {
        const parsed = JSON.parse(await readText(CLUB_SERVICE + '/.prodamus-key.json'));
        if (!parsed || Array.isArray(parsed) || typeof parsed.key !== 'string' || !parsed.key.trim()) return envVars;
        return [...envVars.filter(([name]) => name !== 'PRODAMUS_SECRET_KEY'), ['PRODAMUS_SECRET_KEY', parsed.key]];
    } catch { return envVars; }
}
