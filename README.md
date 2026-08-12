# ClipPronto

Editor de vídeos verticais baseado em modelos, com timeline, cortes de pausas,
transcrição local, ranking animado, produtos, sobreposições e exportação no
próprio navegador.

## Como os dados são armazenados

Este MVP não usa Supabase nem banco remoto. Vídeos, modelos e ajustes permanecem
no cache/armazenamento do navegador do dispositivo que estiver sendo usado.
Isso mantém o processamento privado e evita cobrança por uso, mas ainda não
sincroniza projetos entre computadores ou navegadores diferentes.

## Desenvolvimento local

Requisito: Node.js 22 ou superior.

```bash
npm ci
npm run dev
```

Abra `http://localhost:3000`.

## Publicação na Vercel

O projeto já inclui `vercel.json`, build Next.js próprio para a Vercel e cache
de longa duração para fontes e modelos locais de processamento.

1. Envie este projeto para um repositório privado chamado `clippronto` no GitHub.
2. Na Vercel, selecione **Add New → Project** e importe o repositório.
3. Mantenha **Framework Preset: Next.js**.
4. O comando de build será detectado do `vercel.json`: `npm run build:vercel`.
5. Publique. Nenhuma variável de ambiente é necessária no MVP atual.

Cada novo envio à branch `main` dispara uma publicação automática.

## Comandos úteis

```bash
npm run build:vercel  # valida exatamente o build usado pela Vercel
npm run build         # valida o ambiente local atual
npm run lint
```

## Limites atuais

- O cache do navegador não é um armazenamento permanente na nuvem.
- Limpar os dados do navegador apaga projetos salvos apenas naquele dispositivo.
- Para contas, equipe, sincronização e arquivos duráveis, a próxima etapa será
  adicionar Supabase, Vercel Blob ou outro armazenamento remoto.
