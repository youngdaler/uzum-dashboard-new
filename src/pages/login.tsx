import { zodResolver } from '@hookform/resolvers/zod'
import { Coins } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/form'
import { signIn, signUp } from '@/data/store'

const schema = z.object({
  email: z.email('Введите корректный email'),
  password: z.string().min(6, 'Минимум 6 символов'),
  fullName: z.string().optional(),
})
type Values = z.infer<typeof schema>

export default function LoginPage() {
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) })

  const submit = handleSubmit(async (v) => {
    try {
      if (mode === 'in') await signIn(v.email, v.password)
      else {
        const r = await signUp(v.email, v.password, v.fullName ?? '')
        if (r.needsConfirmation) toast.success('Аккаунт создан. Подтвердите email по ссылке из письма, затем войдите.')
        else toast.success('Аккаунт создан.')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось выполнить вход.')
    }
  })

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm" noValidate>
        <div className="mb-5 flex items-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Coins className="size-5" />
          </div>
          <div>
            <h1 className="text-base font-semibold">Uzum Business</h1>
            <p className="text-xs text-muted-foreground">{mode === 'in' ? 'Вход в аккаунт' : 'Создание аккаунта'}</p>
          </div>
        </div>
        <div className="space-y-3">
          {mode === 'up' && (
            <Field label="Имя">
              <Input {...register('fullName')} autoComplete="name" />
            </Field>
          )}
          <Field label="Email" error={errors.email?.message}>
            <Input type="email" autoComplete="email" {...register('email')} aria-invalid={!!errors.email} />
          </Field>
          <Field label="Пароль" error={errors.password?.message}>
            <Input type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} {...register('password')} aria-invalid={!!errors.password} />
          </Field>
        </div>
        <Button type="submit" className="mt-5 w-full" disabled={isSubmitting}>
          {isSubmitting ? 'Подождите…' : mode === 'in' ? 'Войти' : 'Зарегистрироваться'}
        </Button>
        <button type="button" className="mt-3 w-full text-center text-xs text-muted-foreground hover:text-foreground" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
          {mode === 'in' ? 'Нет аккаунта? Зарегистрироваться' : 'Уже есть аккаунт? Войти'}
        </button>
      </form>
    </div>
  )
}
