import 'dotenv/config';
import { buildApp } from './app.js';
import { openDb } from './db.js';
import { startScheduler, syncConfigured } from './sync.js';
const { APP_PASSWORD, SESSION_SECRET, DB_PATH = './data/glicemia.db', PORT = '8080', WEB_DIR = './dist/web' } = process.env;
if (!APP_PASSWORD || !SESSION_SECRET || SESSION_SECRET.length < 32) {
    console.error('Defina APP_PASSWORD e SESSION_SECRET (>= 32 caracteres) no ambiente');
    process.exit(1);
}
const db = openDb(DB_PATH);
const app = await buildApp({ db, password: APP_PASSWORD, sessionSecret: SESSION_SECRET, webDir: WEB_DIR });
await app.listen({ port: Number(PORT), host: '0.0.0.0' });
if (syncConfigured)
    startScheduler(db);
else
    app.log.warn('LLU_EMAIL/LLU_PASSWORD ausentes: sincronização desativada');
const shutdown = async () => {
    await app.close();
    db.close();
    process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
//# sourceMappingURL=index.js.map