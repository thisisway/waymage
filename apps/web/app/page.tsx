import { redirect } from 'next/navigation';

/** A raiz não tem conteúdo próprio: a lista de projetos é o ponto de entrada do produto. */
export default function RootPage() {
  redirect('/projects');
}
