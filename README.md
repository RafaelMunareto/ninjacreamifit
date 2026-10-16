# Ninja CREAMi Fit

React + Vite com uma API JavaScript no mesmo projeto da Vercel. Receitas, fotos e avaliações ficam no servidor e são compartilhadas entre aparelhos.

## Como funciona

- A pessoa informa seu nome e envia a receita, sem criar conta ou senha.
- O site lembra a identificação do autor no navegador. **Minhas receitas** permite editar e excluir suas próprias publicações.
- O catálogo é compartilhado. Outros visitantes veem novas receitas e alterações ao abrir a página; páginas abertas atualizam a cada 15 segundos e ao voltar para a aba.
- Proteína, carboidratos, gorduras e calorias são obrigatórios, inclusive na edição. Campo vazio não equivale a zero.
- Favoritos pertencem ao perfil. Cada perfil pode dar uma nota por receita e alterar essa nota.
- A administração com senha pode editar e excluir qualquer receita e alterar os totais de avaliações.

## Armazenamento e API

`api/creami.js` e `api/image.js` são Vercel Functions. `server/service.js` valida os dados e a autoria no servidor. O cliente em `src/lib/api.js` envia as operações pela API, sem gravar receitas no IndexedDB.

Em produção, `server/storage.js` usa um **Vercel Blob privado** conectado ao projeto. O documento `creami/production/catalog.json` contém o catálogo, perfis e avaliações; fotos ficam em objetos separados. Leituras do catálogo usam `useCache: false` e atualizações condicionais com ETag evitam que gravações simultâneas sobrescrevam outras alterações. Referência: [SDK Vercel Blob](https://vercel.com/docs/vercel-blob/using-blob-sdk).

O catálogo inicial é inserido somente na primeira gravação. Nova publicação do código não reinicia os dados. Ambientes Preview usam outro prefixo; `CREAMI_DATASET` permite escolher um conjunto isolado explicitamente.

Em desenvolvimento com Vite, a mesma API persiste em `.data/development/`, no servidor local. Esse diretório é ignorado pelo Git e pela publicação. Vercel Functions sempre usam Blob e retornam erro se ele não estiver conectado; não existe fallback silencioso para gravação no aparelho.

O navegador guarda somente um identificador privado aleatório do autor. O servidor guarda seu hash, e o nome exibido não concede acesso às receitas de outra pessoa. Limpar os dados do navegador remove essa identificação, mas não exclui as receitas já publicadas no servidor. Acesso de um mesmo autor em outro aparelho exige futuramente vincular o perfil a uma conta.

## Migração dos dados anteriores

Ao abrir a versão nova no endereço em que criou suas receitas, o cliente consulta o banco antigo em modo de leitura e envia automaticamente as receitas do perfil para o servidor, incluindo fotos. Favoritos e notas próprias também são migrados. A importação é idempotente: repetir uma tentativa não duplica receitas nem recria publicações já excluídas.

O banco antigo permanece intacto como cópia de segurança. Hashes e senhas da administração local nunca são enviados pelo navegador. Totais administrativos antigos não são aceitos de clientes sem autorização; apenas a própria nota do autor pode ser migrada.

## Administração online

A senha inicial é configurada no servidor pela variável secreta `CREAMI_ADMIN_CREDENTIAL`, que contém o derivado PBKDF2-HMAC-SHA-256 (600.000 iterações) e salt aleatório. Ela inicializa apenas um catálogo novo. Senhas alteradas pelo painel ficam no armazenamento privado e têm precedência sobre esse valor inicial em publicações futuras.

O acesso usa um cookie HttpOnly, SameSite=Strict e Secure na Vercel, com validade de oito horas. **Sair e voltar ao site** encerra o acesso. Alterar a senha invalida as sessões anteriores. A criação livre de senha administrativa pela interface é permitida apenas no servidor de desenvolvimento.

A senha temporária gerada para o responsável fica em `.admin-access.local`, um arquivo privado, excluído do Git e da publicação. Entre no painel, altere a senha e guarde-a. Não publique esse arquivo.

Ao alterar apenas a receita, as avaliações são preservadas. Ao alterar explicitamente média ou quantidade, as avaliações existentes são incorporadas ao consolidado; novas avaliações passam a ser contadas à parte.

## Desenvolvimento e publicação

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm typecheck
pnpm test
pnpm build
```

Na Vercel, conecte um Blob com acesso **Private** ao projeto. A conexão configura `BLOB_READ_WRITE_TOKEN` ou `BLOB_STORE_ID` com OIDC. Configure `CREAMI_ADMIN_CREDENTIAL` como Secret e publique o projeto inteiro, incluindo `api/` e `server/`; publicar apenas `dist/` não inclui a API.

```sh
vercel link --project ninjacreamifit --scope rafaelmunaretos-projects
vercel deploy
vercel deploy --prod
```

Não coloque tokens ou a credencial de administrador em variáveis `VITE_*`, pois elas são enviadas ao navegador.

Os testes cobrem o fluxo HTTP entre perfis independentes, autorização, fotos, votos, migração, gravações concorrentes e persistência após reiniciar o servidor. Os testes da API antiga permanecem para compatibilidade com dados anteriores.
