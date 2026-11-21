# NEON SURVIVORS ⚡

Jogo de sobrevivência cooperativa em tempo real para dois amigos. Um no PC e outro no celular.

## Como jogar pela internet

É necessário publicar este servidor uma única vez. O jogo ainda **não está hospedado**.

1. Envie esta pasta para um repositório GitHub.
2. No [Render](https://render.com), crie um **Web Service** usando o repositório.
3. **Build Command:** `npm install`; **Start Command:** `npm start`. Se houver opção gratuita, selecione-a.
4. Abra a URL fornecida pelo Render e clique em **CRIAR SALA**.
5. Clique em **COPIAR LINK** e envie ao amigo no celular. Ele abre o link e entra automaticamente.

## Testar no computador

Instale Node.js 18+, execute `npm install` e `npm start` nesta pasta e abra http://localhost:3000. No mesmo Wi-Fi, seu amigo pode acessar `http://IP_LOCAL_DO_PC:3000`, caso o firewall permita.

## Como funciona

- 2 jogadores cooperam contra monstros em ondas progressivas.
- Inimigos grandes são mais resistentes; elimine os inimigos e sobreviva.
- Inimigos podem deixar kits verdes que recuperam 30 de vida.
- Entre ondas, os vivos recuperam 15 de vida; aliados derrotados retornam com 40 de vida.
- Quando os dois morrem, a partida acaba. Use **RECOMEÇAR**.

**PC:** WASD / setas para andar; mouse para mirar; clique ou espaço para atirar.

**Celular:** joystick da esquerda para andar; controle de mira + botão ATIRAR à direita.

Servidor Node.js + WebSocket, sem contas, sem banco de dados. Salas são temporárias e desaparecem quando todos saem. Use uma única instância de servidor.
