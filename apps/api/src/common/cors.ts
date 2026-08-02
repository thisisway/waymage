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
 * **Todos os métodos padrão, e não só os que a aplicação usa hoje.** A primeira versão desta
 * lista enumerava o que existia no momento, e quebrou assim que uma rota `PUT` nasceu: o
 * cadastro de chave falhava no preflight, com uma mensagem genérica que não apontava para
 * aqui.
 *
 * Liberar um método não cria rota nenhuma — o que não existe continua respondendo 404. Quem
 * autoriza é o guard, não esta lista; acoplá-la ao conjunto de rotas só criava uma segunda
 * coisa para manter em sincronia.
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
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  };
}
