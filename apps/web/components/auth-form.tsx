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
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-lg font-semibold tracking-tight">Waymage</h1>
        <p className="mt-1 text-sm text-ink-secondary">
          {isRegister ? 'Crie sua conta e seu workspace.' : 'Entre para continuar.'}
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
            <p role="alert" className="text-sm text-state-error">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-surface-base transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? 'Aguarde…' : isRegister ? 'Criar conta' : 'Entrar'}
          </button>
        </form>

        <p className="mt-6 text-sm text-ink-muted">
          {isRegister ? 'Já tem conta? ' : 'Ainda não tem conta? '}
          <a href={isRegister ? '/login' : '/register'} className="text-accent hover:underline">
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
      <span className="mb-1.5 block text-xs font-medium text-ink-secondary">{label}</span>
      <input
        {...props}
        className="w-full rounded-md border border-surface-border bg-surface-raised px-3 py-2 text-sm text-ink-primary placeholder:text-ink-muted"
      />
      {hint && <span className="mt-1.5 block text-xs text-ink-muted">{hint}</span>}
    </label>
  );
}
