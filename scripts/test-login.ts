// Teste de login no LibreLinkUp: descobre a região e lista as últimas leituras.
// Uso: cp .env.example .env && preencher && npx tsx scripts/test-login.ts [n]
import 'dotenv/config';
import axios from 'axios';
import { DateTime } from 'luxon';
import { LibreLinkUpClient } from '@diakem/libre-link-up-api-client';

const { LLU_EMAIL, LLU_PASSWORD, LLU_VERSION = '4.16.0', LLU_PATIENT_NAME, TZ_DISPLAY = 'America/Sao_Paulo' } = process.env;
const N = Number(process.argv[2] ?? 10);

if (!LLU_EMAIL || !LLU_PASSWORD) {
  console.error('Defina LLU_EMAIL e LLU_PASSWORD no .env');
  process.exit(1);
}

const headers = { product: 'llu.android', version: LLU_VERSION, 'content-type': 'application/json' };

// 1) Login "cru" no host global para ver qual região a conta pertence (redirect).
async function probeRegion() {
  const { data } = await axios.post('https://api.libreview.io/llu/auth/login',
    { email: LLU_EMAIL, password: LLU_PASSWORD }, { headers });
  if (data.status !== 0) {
    console.log(`Login global: status=${data.status}`, JSON.stringify(data.data?.step ?? data.error ?? {}));
    return;
  }
  if (data.data?.redirect) console.log(`Região da conta: ${data.data.region} (redirect)`);
  else console.log(`Região da conta: global (sem redirect), país=${data.data?.user?.country}`);
}

async function main() {
  await probeRegion();

  // 2) Leitura via biblioteca (segue o redirect de região automaticamente).
  const client = LibreLinkUpClient({
    username: LLU_EMAIL!,
    password: LLU_PASSWORD!,
    clientVersion: LLU_VERSION,
    ...(LLU_PATIENT_NAME ? { connectionIdentifier: LLU_PATIENT_NAME } : {}),
  });
  const login = await client.login();
  const u = login.data.user as { firstName?: string; country: string };
  console.log(`Login OK: usuário ${u.firstName ?? '?'} (${u.country})`);

  const raw = await client.readRaw();
  const c = raw.connection;
  console.log(`Paciente: ${c.firstName} ${c.lastName} | sensor: ${raw.activeSensors?.[0]?.sensor?.sn ?? '?'}`);

  const { current, history } = await client.read();
  const fmt = (d: Date) => DateTime.fromJSDate(d).setZone(TZ_DISPLAY).toFormat('dd/LL HH:mm:ss');
  const all = [...history, current].sort((a, b) => a.date.getTime() - b.date.getTime());

  console.log(`\nAtual: ${current.value} mg/dL ${current.trend} em ${fmt(current.date)} (UTC ${current.date.toISOString()})`);
  console.log(`Histórico: ${history.length} pontos, de ${fmt(all[0].date)} a ${fmt(all.at(-1)!.date)}`);
  const gaps = all.slice(1).map((r, i) => (r.date.getTime() - all[i].date.getTime()) / 60000);
  console.log(`Intervalo entre pontos (min): mediana ${gaps.sort((a, b) => a - b)[gaps.length >> 1]}`);

  console.log(`\nÚltimas ${N} leituras (${TZ_DISPLAY}):`);
  for (const r of all.slice(-N)) console.log(`  ${fmt(r.date)}  ${String(r.value).padStart(3)} mg/dL`);
}

main().catch((e) => {
  console.error('Falhou:', e.response ? `HTTP ${e.response.status} ${JSON.stringify(e.response.data)}` : e.message);
  process.exit(1);
});
