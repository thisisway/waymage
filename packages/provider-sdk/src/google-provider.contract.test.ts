import { GoogleImageProvider } from './google-provider';
import { encodePng } from './png';
import { runProviderContract } from './contract';

/**
 * O adapter real passando pelo MESMO contrato dos fakes.
 *
 * É aqui que a promessa da interface `ImageProvider` se paga: se o Google se comporta nas
 * bordas como o provedor de desenvolvimento, o orquestrador não precisa saber qual dos dois
 * está atendendo.
 *
 * O `fetch` é de mentira. Verificar a integração de verdade exige a chave do usuário, e isso
 * é feito uma vez, à mão — não num teste que roda a cada commit gastando a conta de alguém.
 */
const PNG = encodePng(32, 32, () => [128, 128, 128] as const);

function stubFetch(): typeof fetch {
  return (async (input: unknown) =>
    String(input).includes('generativelanguage')
      ? new Response(
          JSON.stringify({
            steps: [
              {
                type: 'model_output',
                content: [{ type: 'image', mime_type: 'image/png', data: PNG.toString('base64') }],
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      : new Response(PNG, {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })) as typeof fetch;
}

runProviderContract('google-gemini (fetch de mentira)', {
  create: () => new GoogleImageProvider({ apiKey: 'chave-de-teste', fetchImpl: stubFetch() }),
  // A chamada é assíncrona por dentro: o contrato espera o job sair de `running`.
  settle: async (provider, providerJobId) => {
    for (let i = 0; i < 50; i++) {
      if ((await provider.getStatus(providerJobId)).state !== 'running') return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  },
});
