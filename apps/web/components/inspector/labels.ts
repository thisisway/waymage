/**
 * Rótulos em português para os valores dos enums do SceneSpec.
 *
 * Os *valores* permanecem em inglês no schema porque são contrato: o prompt compiler e os
 * adapters de provedor dependem deles. O que se traduz é só o que a pessoa lê.
 */
export const LABELS: Record<string, string> = {
  // intent.purpose
  social_media_campaign: 'Campanha de redes sociais',
  advertisement: 'Anúncio',
  product_shot: 'Foto de produto',
  editorial: 'Editorial',
  portrait: 'Retrato',
  thumbnail: 'Miniatura',
  banner: 'Banner',
  presentation: 'Apresentação',
  other: 'Outro',

  // posições e espaço negativo
  none: 'Nenhum',
  left: 'Esquerda',
  right: 'Direita',
  center: 'Centro',
  top: 'Topo',
  bottom: 'Base',

  // subject.type
  person: 'Pessoa',
  group: 'Grupo',
  product: 'Produto',
  animal: 'Animal',
  object: 'Objeto',
  scene_only: 'Só cenário',

  // gaze
  camera: 'Para a câmera',
  away: 'Para longe',
  down: 'Para baixo',
  up: 'Para cima',
  side: 'De lado',

  // scene.time
  dawn: 'Amanhecer',
  morning: 'Manhã',
  midday: 'Meio-dia',
  afternoon: 'Tarde',
  golden_hour: 'Golden hour',
  evening: 'Fim de tarde',
  night: 'Noite',

  // scene.weather
  clear: 'Céu limpo',
  cloudy: 'Nublado',
  overcast: 'Encoberto',
  rain: 'Chuva',
  snow: 'Neve',
  fog: 'Névoa',

  // detalhe / intensidade
  low: 'Baixo',
  medium: 'Médio',
  high: 'Alto',

  // camera.shot
  extreme_close_up: 'Primeiríssimo plano',
  close_up: 'Primeiro plano',
  head_and_shoulders: 'Rosto e ombros',
  waist_up: 'Da cintura para cima',
  three_quarter: 'Plano americano',
  full_body: 'Corpo inteiro',
  wide: 'Plano aberto',
  extreme_wide: 'Plano muito aberto',

  // camera.angle
  eye_level: 'Altura dos olhos',
  birds_eye: 'Visão superior',
  worms_eye: 'Contra-plongée',
  dutch: 'Inclinado',

  // profundidade de campo
  deep: 'Profunda',
  shallow: 'Rasa',

  // orientação
  landscape: 'Paisagem',
  square: 'Quadrado',

  // iluminação
  soft: 'Suave',
  hard: 'Dura',
  natural: 'Natural',
  studio: 'Estúdio',
  dramatic: 'Dramática',
  subtle: 'Sutil',
  balanced: 'Equilibrado',
  strong: 'Forte',
  flat: 'Plano',
  cinematic: 'Cinematográfico',
  cool: 'Fria',
  neutral: 'Neutra',
  warm_neutral: 'Neutra quente',
  warm: 'Quente',
  mixed: 'Mista',
  front: 'Frontal',
  back: 'Contraluz',
  ambient: 'Ambiente',

  // composição
  thirds: 'Regra dos terços',
  golden_ratio: 'Proporção áurea',
  symmetry: 'Simetria',
  diagonal: 'Diagonal',

  // saída
  draft: 'Rascunho',
  standard: 'Padrão',
  final: 'Final',
  webp: 'WebP',
  png: 'PNG',
  jpeg: 'JPEG',
};

export function label(value: string): string {
  return LABELS[value] ?? value;
}
