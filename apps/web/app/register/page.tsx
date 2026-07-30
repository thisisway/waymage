import { AuthForm } from '../../components/auth-form';

export const metadata = { title: 'Criar conta · Waymage' };

export default function RegisterPage() {
  return <AuthForm mode="register" />;
}
