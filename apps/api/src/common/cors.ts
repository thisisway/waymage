/**
 * CORS da API.
 *
 * Fica separado do `main.ts` para poder ser exercitado por teste: um preflight só passa pelo
 * plugin do Fastify se a configuração real for a mesma, e reproduzi-la no teste garantiria
 * apenas que a cópia está certa.
 *
 * **Origem explícita.** `origin: true` com `credentials` aceitaria qualquer site e anularia a
 * proteção do `SameSite` — seria abrir a sessão para qualquer página que o usuário visitasse.
 *
 * **Métodos declarados.** O padrão do `@fastify/cors` é `GET,HEAD,POST`, os métodos "simples"
 * do CORS. Sem declarar, o preflight de `PATCH` e `DELETE` volta negado, e no browser isso
 * derruba o autosave da cena e a exclusão de referência — sem aparecer em nenhum teste que
 * não passe por um preflight.
 *
 * Cabeçalhos ficam de fora de propósito: sem `allowedHeaders`, o plugin reflete os que o
 * preflight pediu, o que já cobre `content-type`, `x-csrf-token` e `idempotency-key` sem
 * precisar mantê-los em duas listas.
 */
export function corsOptions(origin: string) {
  // Sem anotação de tipo: o adapter Fastify espera `FastifyCorsOptions`, e o `CorsOptions`
  // genérico do Nest aceita uma forma de callback que o Fastify não implementa. Deixar o
  // TypeScript inferir mantém o objeto compatível com o adapter em uso.
  return {
    origin,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'],
  };
}
