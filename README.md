# Glicemia por refeição

App pessoal que monta a tabela de glicemia por refeição a partir do FreeStyle Libre
(LibreLinkUp + CSV do LibreView). Arquitetura e regras: [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

## Rodar localmente
```bash
npm install
cp .env.example .env        # preencha LLU_*, APP_PASSWORD, SESSION_SECRET
npm run test:login          # testa o login e lista as últimas leituras
npm run dev:server          # API em :8080 (sincroniza ao iniciar)
npm run dev:web             # front em :5173 com proxy para a API
npm test                    # testes
```

## Deploy no Fly.io
```bash
fly launch --no-deploy --copy-config      # aceite o fly.toml; troque o nome do app se pedir
fly volumes create glicemia_data -r gru -s 1
fly secrets set LLU_EMAIL=... LLU_PASSWORD=... APP_PASSWORD=... SESSION_SECRET=$(openssl rand -hex 32)
fly deploy
```
- A máquina fica sempre ligada (`auto_stop_machines = "off"`), porque o job roda no processo.
- O banco está em `/data/glicemia.db`, no volume. O Fly tira snapshot diário do volume; para uma cópia
  local: `fly ssh sftp get /data/glicemia.db`.
- No iPhone/iPad: abra a URL no Safari → Compartilhar → **Adicionar à Tela de Início**.
