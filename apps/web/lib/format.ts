/**
 * Tempo relativo em português.
 *
 * `Intl.RelativeTimeFormat` é stdlib e já sabe pluralizar e conjugar em qualquer locale —
 * escrever "há 2 dias" à mão significa reimplementar isso e errar nos casos de borda.
 */
const relative = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto', style: 'long' });

const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['week', 7 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
];

export function timeAgo(iso: string): string {
  const elapsed = Date.now() - new Date(iso).getTime();

  for (const [unit, ms] of UNITS) {
    if (Math.abs(elapsed) >= ms) {
      return relative.format(-Math.round(elapsed / ms), unit);
    }
  }
  return 'agora mesmo';
}
