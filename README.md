# Ninja CREAMi Fit

React + Vite com uma API local escrita em JavaScript. Funciona inteiramente no navegador, sem servidor ou credenciais externas.

## Funcionalidades

- Envio de receitas informando apenas o nome, que fica lembrado neste navegador.
- Autores podem editar e excluir suas receitas em **Minhas receitas**, sem senha.
- Administração local com senha para gerenciar qualquer receita e seus totais de avaliações.
- Edição de autor, foto, macros, ingredientes, etapas, programa, re-spin, toppings e avaliações.
- Fotos persistentes, redimensionadas para até 1.200 px antes do armazenamento.
- Ingredientes e etapas separados, programa da CREAMi, re-spin e toppings.
- Proteína, carboidratos, gorduras e calorias obrigatórios por pote, inclusive na edição; zero deve ser informado explicitamente quando aplicável.
- Favoritos, uma avaliação por receita e perfil com nome editável.
- Busca por nome, autor, ingrediente e topping, sem diferenciar acentos.
- Filtros por categoria, favoritos e receitas próprias; ordenação por nota, proteína e calorias.
- Atualização de dados entre abas abertas na mesma origem.

## Camada de dados

`src/lib/local-api.js` implementa a API assíncrona usando IndexedDB (`ninja-creami-fit`, versão 1). O banco tem as coleções `recipes`, `favorites`, `ratings` e `settings`. As gravações só retornam sucesso depois que a transação termina; exclusões removem também favoritos e notas associados.

Métodos disponíveis: `getSnapshot()`, `saveRecipe(input, id?)`, `deleteRecipe(id)`, `toggleFavorite(id)`, `rateRecipe(id, nota)`, `saveProfile(nome)` e `subscribe(listener)`. `filterRecipes(receitas, filtros)` faz buscas e ordenações sem alterar o catálogo recebido.

O catálogo de seis receitas em `src/data/recipes.js` é inserido somente na criação do banco. Suas notas iniciais são exemplos. `src/lib/photo.js` valida e prepara as fotos; `src/types.ts` documenta os contratos usados pela interface e pelo JavaScript com JSDoc.

O campo opcional `authorName` de `saveRecipe` salva o nome do perfil junto com a receita na mesma transação, sem cadastro separado. A autoria usa o ID estável do perfil, não o nome exibido: trocar o nome ou usar o nome de outra pessoa não transfere receitas. O autor pode alterar foto, ingredientes, preparo e macros, preservando as avaliações. A edição dos totais de estrelas e avaliações continua restrita ao administrador. Alterações administrativas no nome exibido preservam o vínculo da receita com seu criador.

Os dados pertencem ao navegador e à origem em que o site foi aberto. Persistem ao recarregar e fechar a página, mas limpar o armazenamento do site os remove. Não há sincronização entre dispositivos nem publicação para outros visitantes. Uma comunidade compartilhada exige futuramente uma API e um banco no servidor.

## Administração

Abra **Meu perfil → Administração**, ou **Administração** no rodapé. No primeiro acesso, crie e confirme uma senha de 10 a 128 caracteres. Não existe senha padrão. Nos próximos acessos, entre com a senha cadastrada. Recarregar a página ou sair do painel encerra a sessão; é possível alterar a senha informando a atual.

O administrador pode editar e excluir todas as receitas, inclusive as do catálogo inicial. Os métodos `saveRecipe(input, id, details?)` e `deleteRecipe(id)` verificam a autoria ou a sessão de administrador nas operações de edição e exclusão. `details` exige sessão de administrador e permite alterar autor, média de estrelas e total de avaliações. Cadastro de novas receitas, edição e exclusão das próprias receitas, favoritos e avaliações ficam disponíveis na área pública.

Ao editar apenas os detalhes da receita, os votos locais são preservados. Ao alterar explicitamente a média ou a contagem de avaliações, os totais informados substituem o consolidado e a nota local anterior é incorporada a ele. Uma nova nota local conta como uma nova avaliação. Use média 0 para total 0 e média de 1 a 5 para total maior que 0.

`setupAdmin`, `loginAdmin`, `logoutAdmin` e `changeAdminPassword` gerenciam o acesso local. A senha é derivada com PBKDF2-HMAC-SHA-256, 600.000 iterações e salt aleatório de 16 bytes; o banco guarda somente o derivado e os parâmetros. Referências: [OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) e [Web Crypto](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveBits). É necessário HTTPS ou localhost.

Essa senha é uma barreira para o uso normal da interface, não uma proteção contra quem controla o navegador e seu armazenamento. Cada navegador configura seu próprio administrador. Não há recuperação por e-mail, e limpar os dados do site remove tanto a senha quanto as receitas. Autorização para um site compartilhado exige validação no servidor.

## Comandos

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm typecheck
pnpm test
pnpm build
```

Os testes executam a API JavaScript com `fake-indexeddb` e verificam o fluxo de cadastro, persistência, busca, edição, favoritos, alteração de notas, validação e exclusão.
