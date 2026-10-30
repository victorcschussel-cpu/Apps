import crypto from 'node:crypto';
const COOKIE = 'sess';
const MAX_AGE = 180 * 24 * 3600; // PWA no iPhone: evitar pedir senha toda semana
const safeEqual = (a, b) => {
    const ha = crypto.createHash('sha256').update(a).digest();
    const hb = crypto.createHash('sha256').update(b).digest();
    return crypto.timingSafeEqual(ha, hb);
};
export function registerAuth(app, password) {
    let failures = 0;
    app.post('/api/login', async (req, reply) => {
        // Atraso crescente contra tentativa e erro (app de um usuário só).
        await new Promise((r) => setTimeout(r, Math.min(failures, 10) * 500));
        if (!safeEqual(req.body?.password ?? '', password)) {
            failures++;
            return reply.code(401).send({ error: 'Senha incorreta' });
        }
        failures = 0;
        const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
        reply.setCookie(COOKIE, String(exp), {
            signed: true, httpOnly: true, sameSite: 'lax', path: '/', maxAge: MAX_AGE,
            secure: process.env.NODE_ENV === 'production',
        });
        return { ok: true };
    });
    app.post('/api/logout', async (_req, reply) => {
        reply.clearCookie(COOKIE, { path: '/' });
        return { ok: true };
    });
    app.addHook('onRequest', async (req, reply) => {
        if (!req.url.startsWith('/api/') || req.url === '/api/login' || req.url === '/api/health')
            return;
        const raw = req.cookies[COOKIE];
        const un = raw ? req.unsignCookie(raw) : null;
        if (!un?.valid || Number(un.value) < Date.now() / 1000)
            return reply.code(401).send({ error: 'Não autenticado' });
    });
}
//# sourceMappingURL=auth.js.map