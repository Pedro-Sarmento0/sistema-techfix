# sistema-techfix

## Desenvolvimento

Instale as dependências e inicie a API e o Vite em terminais separados:

```bash
npm install
npm run server
npm run dev
```

Abra `http://localhost:5173`. A API usa `http://localhost:3000` e persiste os dados no servidor em `data/techfix.json`, que não deve ser versionado. Em produção, substitua esse adaptador por um banco gerenciado com backups e controle de acesso do ambiente.

## Produção

```bash
npm run build
npm start
```

O servidor serve o build, exige sessão em cookie `HttpOnly`, aplica expiração e limite de tentativas, armazena apenas hash `scrypt` das senhas e valida as operações no backend. Publique atrás de HTTPS para habilitar o atributo `Secure` do cookie e o HSTS.
