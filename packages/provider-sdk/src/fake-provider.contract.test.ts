import { FakeImageProvider } from './fake-provider';
import { runProviderContract } from './contract';

/**
 * O contrato rodando contra dois perfis.
 *
 * Um provedor só prova pouca coisa: o contrato existe para garantir que o orquestrador
 * funcione com qualquer implementação, e isso não se verifica com uma amostra de tamanho um.
 */

// `latencyMs: 0` conclui na primeira consulta, então não há o que esperar.
runProviderContract('fake (padrão)', {
  create: () => new FakeImageProvider({ latencyMs: 0 }),
});

runProviderContract('fake (perfil estúdio)', {
  create: () =>
    new FakeImageProvider({
      id: 'estudio',
      latencyMs: 0,
      creditsPerImage: 4,
      capabilities: {
        transparentBackground: true,
        negativePrompt: false,
        maxOutputs: 2,
        maxReferenceImages: 2,
      },
    }),
});
