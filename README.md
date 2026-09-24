# Bot WhatsApp + Dashboard

Bot que encaminha mensagens de clientes do WhatsApp para o seu número, permite
assumir a conversa manualmente (`!assumir`) e conta com uma dashboard web para
acompanhar e responder tudo em tempo real.

## Estrutura

- `bot.js` — lógica do bot (Baileys) + eventos para a dashboard.
- `server.js` — servidor web (Express + Socket.io) que serve a dashboard e liga tudo.
- `db.js` — camada de banco de dados: usa **PostgreSQL** automaticamente se
  `DATABASE_URL`/`DATABASE_PRIVATE_URL` estiver definida (ex.: Railway), ou
  **SQLite** localmente caso contrário.
- `store.js` — histórico de conversas e mensagens, persistido no banco de dados
  (antes ficava num arquivo `conversations.json`, que se perdia a cada deploy).
- `public/` — a dashboard em si (HTML/CSS/JS puro, sem build).
- `index.js` — modo antigo sem dashboard (`npm run bot-only`), mantido por
  compatibilidade.

## O que foi corrigido nesta versão

- **Persistência real em banco de dados**: conversas e mensagens agora ficam
  em tabelas (`conversations`, `messages`) no Postgres/SQLite, não mais num
  JSON solto que se perdia a cada redeploy.
- **`store.js` assíncrono** de ponta a ponta, com `server.js` e `bot.js`
  atualizados para usar `await` corretamente (antes havia leituras
  desatualizadas e possíveis condições de corrida).
- **Cookies de sessão** corrigidos (`secure: 'auto'`) para funcionar em HTTPS
  atrás do proxy do Railway sem precisar configurar `FRONTEND_URL`.
- **`public/config.js`** não aponta mais para uma URL fixa de um deploy
  específico — usa same-origin por padrão, funcionando em qualquer domínio.
- **Armazenamento configurável** via `STORAGE_DIR`: banco SQLite, sessão do
  WhatsApp (`auth_info/`) e mídias (`media/`) ficam todos dentro dela, prontos
  para apontar para um Volume persistente no Railway.
- **Contatos persistidos**: contatos enviados pela agenda do WhatsApp e nomes
  identificados nas mensagens são salvos na tabela `contacts` e aparecem na
  página Contatos do painel.
- Pequenos ajustes de robustez (reconexão do Baileys, limpeza de arquivo
  temporário quando o envio de mídia falha, recriação da pasta `auth_info`
  após desconectar, etc.).
- Removidos do pacote: `node_modules/`, `.git/`, sessão do WhatsApp
  (`auth_info/`), mídias e bancos de dados de exemplo que estavam
  **misturados no zip original** — continham dados reais de clientes e não
  deveriam ser versionados nem reaproveitados num novo ambiente.

## Correções da versão 1.0.1

- **Não respondia quando o contato chamava primeiro**: contatos novos chegam
  com um ID interno do WhatsApp (`@lid`) em vez do telefone. O bot só lembrava
  esse ID em memória; após qualquer restart ele tentava enviar para
  `<id>@s.whatsapp.net` (inexistente) e a mensagem sumia sem erro. Agora o JID
  real fica salvo no banco (`contacts.jid`) e é usado no envio. Também:
  conversas iniciadas por você e respondidas via LID são mescladas, números BR
  com/sem o 9 são tentados, número inexistente gera erro claro e mensagens
  como localização/contato/figurinha aparecem no chat.
- **Precisava de F5 / disconnect**:
  - worker que caía só voltava quando alguém recarregava a página → agora o
    servidor reinicia sozinho (espera crescente) e requisições pendentes não
    ficam mais penduradas (timeout + rejeição quando o worker morre);
  - sessão deslogada pelo celular exigia "disconnect" manual → agora limpa as
    credenciais e gera um novo QR automaticamente;
  - reconexão do WhatsApp tentava uma única vez → agora insiste com backoff;
  - worker atendia pedidos antes do banco estar pronto (tela vazia no F5) →
    agora espera o banco;
  - painel resincroniza sozinho (volta de aba, internet, queda do socket e a
    cada 10s/60s), e chat aberto por telefone acompanha a conversa quando o
    servidor a guarda sob outro número (LID).

## Rodando localmente

```bash
npm install
cp .env.example .env
# edite o .env: ADMIN_NUMBER, ADMIN_USERNAME, ADMIN_PASSWORD, SESSION_SECRET
npm start
```

No PowerShell, use `Copy-Item .env.example .env`, edite o arquivo e substitua
`ADMIN_NUMBER` pelo número real do WhatsApp que controlará o bot, somente com
DDI e DDD. Sem essa variável o processo é encerrado de propósito antes de
conectar ao WhatsApp.

Abra **http://localhost:3000**. Faça login com `ADMIN_USERNAME`/`ADMIN_PASSWORD`
(criados automaticamente no banco na primeira execução). O QR Code aparece na
barra lateral — escaneie com o WhatsApp do número que vai ser o bot.

No cadastro, `username` é o ID exclusivo usado somente para entrar no painel.
O campo `display_name` (Nome no painel) é independente e é o nome mostrado no
painel e usado na assinatura das mensagens enviadas pela dashboard. Usuários
existentes recebem automaticamente o próprio `username` como nome exibido e
podem alterá-lo em **Meu perfil**.

Cada cadastro também informa um número WhatsApp próprio. Ao entrar no painel,
esse número recebe uma sessão Baileys e um QR Code exclusivos, armazenados em
`STORAGE_DIR/users/<id>/`. As conversas, bloqueios, mídias e sessão de cada
usuário ficam isolados das demais contas. O histórico de mensagens e os
contatos também ficam persistidos nessa mesma instalação. O número deve ser informado com DDI,
somente dígitos, entre 10 e 15 caracteres.

Sem Postgres configurado, os dados ficam em `./database.sqlite` (ou dentro de
`STORAGE_DIR`, se você definir essa variável).

## Deploy no Railway (com banco de dados)

1. **Crie um projeto no Railway** e conecte este repositório (ou faça upload
   via `railway up`).
2. **Adicione um plugin PostgreSQL** ao projeto (`+ New` → `Database` →
   `PostgreSQL`). O Railway já injeta `DATABASE_URL` automaticamente no seu
   serviço — o `db.js` detecta isso sozinho e passa a usar Postgres.
3. **Adicione um Volume** ao serviço do bot (`Settings` → `Volumes`), montado
   por exemplo em `/app/storage`. É nele que ficam a sessão do WhatsApp
   (`auth_info/`) e as mídias recebidas/enviadas — sem isso, você precisaria
   escanear o QR Code de novo a cada deploy.
4. **Configure as variáveis de ambiente** do serviço (`Settings` →
   `Variables`), usando `.env.example` como referência:
   - `ADMIN_NUMBER` — seu número de WhatsApp (o que vai controlar o bot).
   - `ADMIN_USERNAME` / `ADMIN_PASSWORD` — login do painel.
   - `SESSION_SECRET` — string aleatória longa.
   - `STORAGE_DIR=/app/storage` — mesmo caminho do Volume criado no passo 3.
   - Não é necessário definir `DATABASE_URL` (o Railway já injeta) nem `PORT`
     (o Railway também injeta).
5. **Deploy.** O Railway detecta automaticamente que é um projeto Node
   (via `package.json`, script `start`) e roda `npm install && npm start`.
6. Abra a URL pública gerada pelo Railway, faça login e escaneie o QR Code
   com o WhatsApp que vai ser o bot.

### Observações importantes

- As sessões de login do painel ficam em memória (`express-session` sem
  store externo). Isso é suficiente para um único serviço/instância — se você
  reiniciar o deploy, só será necessário logar de novo no painel (a conexão
  do WhatsApp, essa sim, fica salva no Volume).
- O usuário admin do painel é criado **apenas uma vez**, na primeira
  inicialização do banco. Trocar `ADMIN_PASSWORD` depois não atualiza um
  usuário já existente — se precisar trocar a senha, atualize direto na
  tabela `users` do Postgres (ou apague o banco para recriar do zero, caso
  ainda não tenha dados importantes).
- Nunca comite o arquivo `.env` (ele já está no `.gitignore`).

## Comandos pelo WhatsApp (do número admin)

- `!assumir 5511999999999` — assume a conversa com esse número; tudo que você
  digitar depois é repassado a ele.
- `!enviar 5511999999999 sua mensagem` (ou `!mandar`) — envia uma mensagem
  pontual sem precisar "assumir" antes.
- `!sair` ou `!encerrar` — larga a conversa assumida.

## Rodando sem dashboard (modo antigo)

```bash
npm run bot-only
```

Roda só `index.js`: QR Code no terminal, comandos `!assumir` / `!sair` /
`!status` pelo WhatsApp, sem painel web nem banco de dados.
