# Ninja CREAMi Fit

Site React + Vite. A API e o armazenamento foram migrados para o projeto **RepassaFacil.API**, em `../repassafacil-api/Creami/`: receitas, fotos, perfis, favoritos, notas, administração, TBCA, IBGE, Open Food Facts, FatSecret e identificação de alimentos por foto.

O cliente compartilhado em `src/lib/http.js` envia cookies e trata erros de todas as chamadas. O site chama `/api/creami`, `/api/image`, `/api/foods`, `/api/food-catalog` e `/api/food-ai`. As funções em `api/` somente encaminham as chamadas ao Repassa Fácil. O proxy mantém o cookie HttpOnly administrativo no domínio do site. As regras e as chaves privadas ficam no backend .NET.

```sh
npm install
npm run dev:api # em outro terminal; usa a configuração privada do Repassa Fácil
npm run dev
npm run typecheck
npm test
npm run build
```

No desenvolvimento, o proxy usa `http://127.0.0.1:5075`. Para outro host, configure `REPASSAFACIL_API_URL` em `.env.local` e reinicie o Vite. Em produção, o proxy usa `https://repassafacil-api.onrender.com` por padrão. `REPASSAFACIL_API_URL` permite trocar esse destino. As rotas CREAMi precisam estar publicadas nessa API. A URL deve conter somente a origem HTTPS do Repassa Fácil, sem `/api`. O frontend continua com sua chave pública `VITE_CLERK_PUBLISHABLE_KEY`; chaves privadas de Clerk, FatSecret, IA e banco pertencem ao Repassa Fácil.

A inclusão de receitas abre a página `/receitas/nova`, com formulário mais largo no desktop e seções empilhadas no celular. A página permite acesso direto, recarregamento e navegação pelos botões Voltar e Avançar do navegador. O envio mantém fotos, alimentos e pesos no mesmo contrato da API; falhas de envio preservam os campos para tentar novamente.

O catálogo de alimentos vem da API e é guardado no cache do navegador. A busca local e o cálculo por peso continuam disponíveis depois de carregar a tabela. A consulta remota e a publicação de receitas exigem conexão. Os códigos e pesos dos alimentos são preservados. A busca combina as fontes sem duplicar códigos retornados localmente e pela API.

O cliente conserva a identificação de aparelho e a migração idempotente do antigo IndexedDB. O backend .NET preserva o mesmo contrato, hashes de autoria e identificação Clerk. A troca de backend não permite editar a receita de outro autor nem recupera uma identificação de aparelho apagada.

O frontend espera o Clerk carregar antes de consultar o perfil e atualiza os dados ao entrar, sair ou trocar de conta. Leituras pendentes da conta anterior não são reutilizadas. O backend valida sessões pelo JWKS público da instância Clerk configurada e autoriza os domínios `www.ninjacreamifit.com.br`, `ninjacreamifit.com.br` e `ninjacreamifit.vercel.app` por padrão. A chave privada Clerk é necessária para consultar o e-mail verificado de administradores, mas não para o login normal.

A administração usa o mesmo login Clerk do site, sem senha administrativa separada. O backend libera apenas o e-mail primário verificado da lista `CREAMI_ADMIN_EMAILS`. O padrão contém `rafaelmmunareto@gmail.com`, `rafael.munareto@icloud.com` e `vitorsalima@gmail.com`. Em produção, as ações administrativas por senha e os cookies antigos não concedem acesso. Para ativar a verificação por e-mail no Render, configure `CLERK_SECRET_KEY` da mesma instância usada pelo site e salve com novo deploy.

A documentação de configuração, migração e operação está em [repassafacil-api/docs/ninja-creami.md](../repassafacil-api/docs/ninja-creami.md).

O exportador mantém uma cópia privada do catálogo e das fotos antes da migração:

```sh
node scripts/export-repassafacil.mjs --source=local --output=../repassafacil-api/.creami-migration/development.json
node scripts/export-repassafacil.mjs --source=blob --dataset=production --env-file=.env.migration.local --output=../repassafacil-api/.creami-migration/production.json
```

Os arquivos em `scripts/legacy-server/` são usados somente para ler o formato anterior e testar compatibilidade; não são usados pelas funções nem pelo Vite. As bases em `public/data/` são cópias históricas usadas nesses testes. As bases ativas e os importadores estão no backend, em `Creami/Data/` e `Creami/Tools/`. O banco antigo permanece intacto como backup.

Os testes deste repositório cobrem o proxy, cálculo nutricional, validações e compatibilidade com bancos antigos. O teste HTTP/PostgreSQL da API migrada fica em `repassafacil-api/tests/Creami.IntegrationTests`.

A entrada por voz aguarda o início do microfone, mostra a transcrição e preserva o texto parcial ao tocar em **Parar e analisar**. Capturas antigas são canceladas ao fechar o formulário ou sair da aba. Falhas de permissão, conexão e ausência de fala são exibidas mesmo sem texto na busca. As rotinas em `src/lib/speech-input.js` e `src/lib/voice-food.js` tratam os eventos de captura e quantidades como “banana 150 gramas”, “leite 200ml” e “cento e cinquenta gramas de banana”. Os testes simulam os eventos do navegador; a captura nativa também depende do serviço de reconhecimento e das permissões do aparelho.

A busca de alimentos carrega as fontes externas em páginas com cursor, mantém os resultados já recebidos e ordena os alimentos carregados por calorias. O total exibido é de itens carregados, não uma promessa de tamanho da base externa. Cada resultado mostra sua fonte. A API busca um termo obrigatório no FatSecret e aplica todas as palavras ao nome e à marca para evitar resultados amplos de “zero”. A base padrão do FatSecret é a dos EUA; a base brasileira depende da disponibilidade e da autorização de localização da conta no provedor.

Alimentos manuais são salvos no PostgreSQL compartilhado pelo Repassa Fácil, mesmo sem publicar uma receita. Um código de barras não encontrado abre o cadastro com o código preenchido. O salvamento é idempotente; cadastros concorrentes do mesmo código reutilizam o alimento existente. Os valores são informados por 100 g/ml. Falhas preservam o formulário. As próximas buscas consultam também os alimentos da comunidade.

O tema padrão acompanha o sistema do aparelho. Em **Meu perfil → Aparência**, é possível escolher **Automático**, **Claro** ou **Escuro**. A preferência é aplicada imediatamente, guardada neste navegador e sincronizada entre suas abas. A paleta é aplicada antes da montagem do React para evitar um fundo claro ao abrir no modo escuro.
