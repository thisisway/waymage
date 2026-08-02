import { OpenAIImageProvider } from './openai-provider';
import { runProviderContract } from './contract';
import { encodePng } from './png';

/**
 * O segundo adapter real passando pelo mesmo contrato.
 *
 * É o que prova que a promessa da interface se sustenta: dois fornecedores com formatos de
 * requisição diferentes — um JSON, outro multipart —, uma imagem por chamada contra várias, e
 * máscaras em formatos opostos, todos indistinguíveis para o orquestrador.
 */
// PNG de verdade, e não bytes quaisquer: o contrato exige que o provedor informe as
// dimensões, e elas são lidas do cabeçalho.
const PNG = encodePng(48, 24, () => [200, 100, 50] as const);

function stubFetch(): typeof fetch {
  return (async (input: unknown) =>
    String(input).includes('api.openai.com')
      ? new Response(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      : new Response(PNG, {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })) as typeof fetch;
}

runProviderContract('openai-image (fetch de mentira)', {
  create: () => new OpenAIImageProvider({ apiKey: 'sk-teste', fetchImpl: stubFetch() }),
  settle: async (provider, providerJobId) => {
    for (let i = 0; i < 50; i++) {
      if ((await provider.getStatus(providerJobId)).state !== 'running') return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  },
});
