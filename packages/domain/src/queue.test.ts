import { describe, expect, it } from 'vitest';
import { generationEventsChannel, generationJobPayloadSchema } from './queue';

describe('contrato da fila de geração', () => {
  const valid = {
    generationJobId: '0f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b',
    workspaceId: '1f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b',
    requestId: 'req_123',
  };

  it('aceita um payload bem formado', () => {
    expect(generationJobPayloadSchema.parse(valid)).toEqual(valid);
  });

  it('rejeita id que não é uuid — a fila é fronteira de confiança', () => {
    expect(() => generationJobPayloadSchema.parse({ ...valid, generationJobId: '1' })).toThrow();
  });

  it('rejeita payload sem workspaceId, que é o que garante o isolamento', () => {
    const { workspaceId: _omitted, ...semWorkspace } = valid;
    expect(() => generationJobPayloadSchema.parse(semWorkspace)).toThrow();
  });

  it('deriva um canal de eventos estável por job', () => {
    expect(generationEventsChannel('abc')).toBe('generation:events:abc');
  });
});
