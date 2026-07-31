'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../lib/api';

/**
 * Formulário de login e cadastro.
 *
 * Um componente para os dois porque a diferença é um campo e um verbo — dois arquivos
 * quase idênticos divergiriam na primeira mudança de estilo.
 */
export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const isRegister = mode === 'register';

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const data = new FormData(event.currentTarget);
    const email = String(data.get('email') ?? '');
    const password = String(data.get('password') ?? '');

    try {
      if (isRegister) {
        await api.register({ name: String(data.get('name') ?? ''), email, password });
      } else {
        await api.login({ email, password });
      }
      router.push('/projects');
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Não foi possível conectar à API. Ela está rodando?',
      );
      setPending(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-6">
      {/* Halo azul do DS: dá profundidade ao fundo sem competir com o formulário. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-[36rem] w-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-pill opacity-20 blur-3xl"
        style={{ background: 'radial-gradient(circle, #1D66FF 0%, transparent 70%)' }}
      />

      <div className="animate-rise relative w-full max-w-sm rounded-xl border border-surface-border bg-surface-raised p-8 shadow-lg">
        <h1 className="text-h2 text-ink-primary">Waymage</h1>
        <p className="mt-1.5 text-[14px] leading-relaxed text-ink-secondary">
          {isRegister
            ? 'Crie sua conta e comece com 100 créditos.'
            : 'Entre para continuar de onde parou.'}
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {isRegister && (
            <Field label="Nome" name="name" type="text" autoComplete="name" required />
          )}
          <Field label="E-mail" name="email" type="email" autoComplete="email" required />
          <Field
            label="Senha"
            name="password"
            type="password"
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            required
            {...(isRegister
              ? {
                  minLength: 12,
                  hint: 'Mínimo de 12 caracteres. Uma frase longa é melhor que símbolos.',
                }
              : {})}
          />

          {error && (
            // role="alert" para que leitores de tela anunciem o erro sem o usuário procurar.
            <p
              role="alert"
              className="animate-rise rounded-md border border-state-error/30 bg-state-error/10 px-3 py-2.5 text-[13px] leading-relaxed text-state-error"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-accent px-4 py-2.5 text-[14px] font-bold text-white shadow-glow-sm transition-all duration-fast ease-out hover:bg-accent-80 hover:shadow-glow active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
          >
            {pending ? 'Aguarde…' : isRegister ? 'Criar conta' : 'Entrar'}
          </button>
        </form>

        <p className="mt-6 text-[13px] text-ink-muted">
          {isRegister ? 'Já tem conta? ' : 'Ainda não tem conta? '}
          <a
            href={isRegister ? '/login' : '/register'}
            className="font-semibold text-accent-40 transition-colors hover:text-accent"
          >
            {isRegister ? 'Entrar' : 'Criar conta'}
          </a>
        </p>
      </div>
    </main>
  );
}

function Field({
  label,
  hint,
  ...props
}: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-2 block text-label uppercase text-ink-muted">{label}</span>
      <input
        {...props}
        className="w-full rounded-md border border-surface-border bg-surface-overlay px-3 py-2.5 text-[14px] text-ink-primary transition-all duration-fast ease-out placeholder:text-ink-muted hover:border-surface-hover focus:border-accent focus:bg-surface-hover focus:outline-none"
      />
      {hint && <span className="mt-2 block text-micro leading-relaxed text-ink-muted">{hint}</span>}
    </label>
  );
}
