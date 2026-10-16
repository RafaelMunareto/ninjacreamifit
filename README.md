# Ninja CREAMi Fit

React + Vite com uma API local escrita em JavaScript. Funciona inteiramente no navegador, sem servidor ou credenciais.

## Funcionalidades

- Cadastro, edição e exclusão das receitas criadas no perfil local.
- Fotos persistentes, redimensionadas para até 1.200 px antes do armazenamento.
- Ingredientes e etapas separados, programa da CREAMi, re-spin, toppings, tempo e macros.
- Favoritos, uma avaliação por receita e perfil com nome editável.
- Busca por nome, autor, ingrediente e topping, sem diferenciar acentos.
- Filtros por categoria, favoritos e receitas próprias; ordenação por nota, proteína e calorias.
- Atualização de dados entre abas abertas na mesma origem.

## Camada de dados

`src/lib/local-api.js` implementa a API assíncrona usando IndexedDB (`ninja-creami-fit`, versão 1). O banco tem as coleções `recipes`, `favorites`, `ratings` e `settings`. As gravações só retornam sucesso depois que a transação termina; exclusões removem também favoritos e notas associados.

Métodos disponíveis: `getSnapshot()`, `saveRecipe(input, id?)`, `deleteRecipe(id)`, `toggleFavorite(id)`, `rateRecipe(id, nota)`, `saveProfile(nome)` e `subscribe(listener)`. `filterRecipes(receitas, filtros)` faz buscas e ordenações sem alterar o catálogo recebido.

O catálogo de seis receitas em `src/data/recipes.js` é inserido somente na criação do banco. Suas notas iniciais são exemplos. `src/lib/photo.js` valida e prepara as fotos; `src/types.ts` documenta os contratos usados pela interface e pelo JavaScript com JSDoc.

Os dados pertencem ao navegador e à origem em que o site foi aberto. Persistem ao recarregar e fechar a página, mas limpar o armazenamento do site os remove. Não há login, sincronização entre dispositivos, moderação nem publicação para outros visitantes. O perfil local organiza os dados; não é uma fronteira de autenticação. Uma comunidade compartilhada exige futuramente uma API e um banco no servidor.

## Comandos

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm typecheck
pnpm test
pnpm build
```

Os testes executam a API JavaScript com `fake-indexeddb` e verificam o fluxo de cadastro, persistência, busca, edição, favoritos, alteração de notas, validação e exclusão.
