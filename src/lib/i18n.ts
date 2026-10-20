/**
 * Задел под переключение языка (ru/uz). Сейчас интерфейс — на русском; строки навигации
 * вынесены в словарь, остальные тексты можно переносить сюда постепенно.
 * Переключатель в интерфейсе намеренно не показывается, пока не переведены все страницы.
 */
export type Lang = 'ru' | 'uz'

const dict = {
  ru: {
    'nav.dashboard': 'Дашборд',
    'nav.products': 'Товары',
    'nav.batches': 'Партии закупок',
    'nav.calculator': 'Калькулятор',
    'nav.sales': 'Продажи',
    'nav.inventory': 'Склад и остатки',
    'nav.expenses': 'Расходы',
    'nav.finance': 'Финансы и прибыль',
    'nav.analytics': 'Аналитика',
    'nav.evaluation': 'Оценка закупки',
    'nav.settings': 'Настройки',
  },
  uz: {
    'nav.dashboard': 'Boshqaruv paneli',
    'nav.products': 'Mahsulotlar',
    'nav.batches': 'Xarid partiyalari',
    'nav.calculator': 'Kalkulyator',
    'nav.sales': 'Sotuvlar',
    'nav.inventory': 'Ombor va qoldiqlar',
    'nav.expenses': 'Xarajatlar',
    'nav.finance': 'Moliya va foyda',
    'nav.analytics': 'Tahlil',
    'nav.evaluation': 'Xaridni baholash',
    'nav.settings': 'Sozlamalar',
  },
} as const

export type Key = keyof (typeof dict)['ru']

export function t(key: Key, lang: Lang = 'ru'): string {
  return dict[lang][key] ?? dict.ru[key]
}
