import { Upload } from 'lucide-react'
import { useRef } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/dialog'
import { downloadCsv, readFileText } from '@/lib/export'
import type { ImportResult } from '@/lib/importers'

/** Кнопка импорта CSV: читает файл, запускает импортёр и показывает итог. Рядом — ссылка на шаблон. */
export function ImportButton({
  run,
  templateName,
  templateHeaders,
  templateExample,
}: {
  run: (text: string) => Promise<ImportResult>
  templateName: string
  templateHeaders: string[]
  templateExample: (string | number)[]
}) {
  const ref = useRef<HTMLInputElement>(null)
  const confirm = useConfirm()

  const onFile = async (file: File | undefined) => {
    if (!file) return
    try {
      const res = await run(await readFileText(file))
      if (res.messages.length) {
        const shown = res.messages.slice(0, 8)
        await confirm({
          title: `Импорт завершён: добавлено ${res.created}, пропущено ${res.skipped}`,
          description: (
            <ul className="list-disc space-y-1 pl-4 text-xs">
              {shown.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
              {res.messages.length > shown.length && <li>…и ещё {res.messages.length - shown.length}</li>}
            </ul>
          ),
          confirmLabel: 'Понятно',
        })
      } else toast.success(`Импорт завершён: добавлено ${res.created}.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось импортировать файл.')
    } finally {
      if (ref.current) ref.current.value = ''
    }
  }

  return (
    <>
      <input ref={ref} type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
      <Button variant="outline" size="sm" onClick={() => ref.current?.click()}>
        <Upload /> Импорт CSV
      </Button>
      <Button variant="link" size="sm" className="text-xs" onClick={() => downloadCsv(templateName, templateHeaders, [templateExample])}>
        Шаблон
      </Button>
    </>
  )
}
