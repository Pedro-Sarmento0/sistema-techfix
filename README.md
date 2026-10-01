# sistema-techfix

## Desenvolvimento

Instale as dependências e inicie a API e o Vite em terminais separados:

```bash
npm install
npm run server
npm run dev
```

Abra `http://localhost:5173`. A API usa `http://localhost:3000` e, sem `DATABASE_URL`, persiste os dados no servidor em `data/techfix.json`, que não deve ser versionado.

## Produção

```bash
npm run build
npm start
```

O servidor serve o build, exige sessão em cookie `HttpOnly`, aplica expiração e limite de tentativas, armazena apenas hash `scrypt` das senhas e valida as operações no backend. Cada cadastro cria uma conta isolada; usuários criados dentro de uma conta compartilham os dados dessa conta. Publique atrás de HTTPS para habilitar o atributo `Secure` do cookie e o HSTS.

## Vercel

Importe este repositório na Vercel. O arquivo `vercel.json` publica o build Vite e encaminha `/api/*` para a função em `api/index.mjs`. Configure `NODE_ENV=production` e `DATABASE_URL` nas variáveis do projeto.

Com `DATABASE_URL`, o sistema cria automaticamente as tabelas `techfix_state` e `techfix_sessions` na primeira inicialização e adiciona a coluna `account_id` às tabelas de usuários, clientes e atendimentos existentes. Dados anteriores são associados à primeira conta já cadastrada; a migração não remove os registros. Credenciais, clientes, atendimentos e auditoria ficam separados por conta no servidor Supabase.
