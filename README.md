# Ninja CREAMi Fit

React + Vite com uma API JavaScript e um banco **SQLite** no mesmo projeto da Vercel. Receitas, fotos e avaliações ficam no servidor e são compartilhadas entre aparelhos.

## Como funciona

- A pessoa informa seu nome e envia a receita, sem criar conta ou senha.
- O site lembra a identificação do autor no navegador. **Minhas receitas** permite editar e excluir suas próprias publicações.
- O catálogo é compartilhado. Outros visitantes veem novas receitas e alterações ao abrir a página; páginas abertas atualizam a cada 15 segundos e ao voltar para a aba.
- Proteína, carboidratos, gorduras e calorias são obrigatórios, inclusive na edição. Campo vazio não equivale a zero.
- Favoritos pertencem ao perfil. Cada perfil pode dar uma nota por receita e alterar essa nota.
- A administração com senha pode editar e excluir qualquer receita e alterar os totais de avaliações.

## Alimentos e cálculo por peso

No formulário, a pessoa busca um alimento na **base local TBCA**, escolhe o item e informa seu peso em gramas. Calorias, proteínas, carboidratos e gorduras do pote são somados automaticamente. Os alimentos e pesos são preservados para a edição posterior; o preenchimento manual continua disponível.

A busca e os cálculos acontecem no navegador usando `public/data/tbca-foods-v1.json`, um arquivo estático do próprio site. Não há serviço externo de nutrição, chave de API, conta de provedor ou consulta ao GitHub durante o uso. A tabela só é baixada ao abrir o formulário; depois de carregada, a busca e os cálculos continuam funcionando sem rede. Publicar receitas e ver as atualizações de outros aparelhos continuam exigindo conexão com a API do site.

O arquivo contém **5.668 alimentos**, sendo **5.654 com os quatro valores necessários ao cálculo**. A origem é o [arquivo alimentos.txt de raul-rznd](https://github.com/raul-rznd/web-scraping-tbca/blob/main/alimentos.txt), uma extração da Tabela Brasileira de Composição de Alimentos. A cópia incluída registra o commit de origem e o SHA-256 do conteúdo original. O arquivo original tem cerca de 17,5 MB; a versão reduzida do site tem cerca de 1,17 MB e mantém apenas identificação, descrição, grupo e os nutrientes utilizados.

Os valores são por **100 g**. A importação usa energia em **kcal**, proteína em g, **carboidrato total** em g e lipídios em g; kcal não é confundido com kJ e mililitros não são convertidos em gramas. Valores `NA`, ausentes ou contraditórios ficam desconhecidos, e esses alimentos são identificados como incompletos. Registros repetidos com valores idênticos são consolidados. `tr` é preservado como indicador de traços, tratado como aproximadamente zero no cálculo e informado na tela. O arredondamento ocorre somente após a soma dos ingredientes.

Para regenerar a cópia local a partir da versão de origem fixada no script:

```sh
node scripts/import-tbca.mjs
# Ou importar um arquivo já baixado, sem rede:
node scripts/import-tbca.mjs /caminho/alimentos.txt
```

O SQLite de receitas usa a versão 2 do esquema para guardar os códigos TBCA e os pesos. A versão anterior do banco continua sendo lida e é atualizada na próxima gravação, preservando receitas, perfis, notas e senha. A tabela pública de alimentos não contém dados dos usuários.

## Armazenamento e API

`api/creami.js` e `api/image.js` são Vercel Functions. `server/service.js` valida os dados e a autoria no servidor. O cliente em `src/lib/api.js` envia as operações pela API, sem gravar receitas no IndexedDB.

`server/sqlite.js` usa **sql.js (SQLite em WebAssembly)** para ler e gravar um arquivo SQLite real, com tabelas para receitas, perfis, notas, favoritos, importações e credencial administrativa. Macros e calorias são colunas numéricas obrigatórias. As gravações usam transações e parâmetros SQL; as relações têm chaves e restrições. O banco e as credenciais nunca são enviados ao frontend nem colocados em `public/`.

Em produção, `server/storage.js` persiste o arquivo SQLite em um **Vercel Blob privado** conectado ao projeto; fotos ficam em objetos separados. A API carrega o banco para executar a operação e só confirma a gravação depois de persistir o arquivo. Leituras usam `useCache: false`; atualizações condicionais com ETag evitam que gravações simultâneas sobrescrevam outras alterações e a API repete a operação quando há conflito. Referências: [sql.js](https://github.com/sql-js/sql.js), [SDK Vercel Blob](https://vercel.com/docs/vercel-blob/using-blob-sdk).

Novos conjuntos usam `creami/<ambiente>/catalog.sqlite`. Na migração do servidor existente, a chave histórica `catalog.json` é mantida para preservar a atualização atômica e impedir perda de gravações que estejam em andamento. Seu conteúdo passa a ser **SQLite binário**, com tipo `application/vnd.sqlite3`, independentemente da extensão antiga. Antes da conversão, uma cópia privada do JSON original é preservada em `backups/before-sqlite-<hash>.json`. Receitas, perfis, favoritos, avaliações, histórico de importação e senha são mantidos.

O catálogo inicial é inserido somente na primeira gravação. Nova publicação do código não reinicia os dados. Ambientes Preview usam outro prefixo; `CREAMI_DATASET` permite escolher um conjunto isolado explicitamente.

Em desenvolvimento com Vite, a mesma API persiste em `.data/development/catalog.sqlite`, no servidor local. Um `catalog.json` anterior é lido automaticamente e permanece intacto como cópia após a primeira gravação em SQLite. Esse diretório é ignorado pelo Git e pela publicação. Vercel Functions sempre persistem o SQLite no Blob e retornam erro se ele não estiver conectado; não existe fallback silencioso para gravação no aparelho.

O SQLite roda na API do próprio projeto. Um banco executado apenas no navegador seria individual por aparelho. O disco local das funções da Vercel é temporário, por isso a cópia persistente fica no Blob. Essa implementação regrava o arquivo completo em cada alteração e atende um catálogo pequeno; um serviço SQL dedicado é mais adequado para bancos grandes ou muitas gravações concorrentes.

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

Os testes cobrem o fluxo HTTP entre perfis independentes, autorização, fotos, votos, migração, gravações concorrentes e persistência após reiniciar o servidor. A migração para SQLite verifica também a integridade do arquivo, consultas SQL relacionais, preservação dos dados antigos e rejeição de gravações inválidas ou desatualizadas. Os testes da API antiga permanecem para compatibilidade com dados anteriores.
