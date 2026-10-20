/** UI-localization bridge for legacy Russian labels that have not yet been moved to i18n keys.
 * Keeps original text for instant and reversible language switching. */
const phrases: Record<string, string> = {
  'Загружаем данные…':'Maʼlumotlar yuklanmoqda…', 'Загрузка…':'Yuklanmoqda…',
  'Учёт закупок и продаж':'Xaridlar va sotuvlar hisobi',
  'Локальный режим (данные в браузере)':'Mahalliy rejim (maʼlumotlar brauzerda)',
  'Основная навигация':'Asosiy navigatsiya', 'Закрыть меню':'Menyuni yopish', 'Открыть меню':'Menyuni ochish',
  'Светлая тема':'Yorugʻ mavzu', 'Тёмная тема':'Qorongʻi mavzu',
  'Дашборд':'Boshqaruv paneli','Товары':'Mahsulotlar','Товар':'Mahsulot','Партии закупок':'Xarid partiyalari',
  'Партия':'Partiya','Партии':'Partiyalar','Калькулятор':'Kalkulyator','Продажи':'Sotuvlar',
  'Склад и остатки':'Ombor va qoldiqlar','Расходы':'Xarajatlar','Расход':'Xarajat',
  'Финансы и прибыль':'Moliya va foyda','Аналитика':'Tahlil','Оценка закупки':'Xaridni baholash',
  'Настройки':'Sozlamalar','Профиль':'Profil','Сохранить':'Saqlash','Сохраняем…':'Saqlanmoqda…',
  'Сохранено':'Saqlandi','Настройки сохранены':'Sozlamalar saqlandi','Отмена':'Bekor qilish','Удалить':'Oʻchirish',
  'Изменить':'Oʻzgartirish','Редактировать':'Tahrirlash','Добавить':'Qoʻshish','Создать':'Yaratish',
  'Поиск':'Qidirish','Поиск…':'Qidirish…','Название':'Nomi','Имя':'Ism','Название бизнеса':'Biznes nomi',
  'Статус':'Holat','Категория':'Toifa','Поставщик':'Yetkazib beruvchi','Дата':'Sana','Период':'Davr',
  'Количество':'Miqdor','Количество, шт.':'Miqdori, dona','Сумма':'Summa','Сумма *':'Summa *',
  'Валюта':'Valyuta','Курс':'Kurs','Курс к UZS':'UZS kursi','Комиссия':'Komissiya',
  'Комментарий':'Izoh','Примечание':'Izoh','Заметки':'Eslatmalar','Описание':'Tavsif',
  'Выручка':'Tushum','Прибыль':'Foyda','Убыток':'Zarar','Чистая прибыль':'Sof foyda',
  'Валовая прибыль':'Yalpi foyda','Операционная прибыль':'Operatsion foyda',
  'Себестоимость':'Tannarx','Себестоимость ед.':'Birlik tannarxi','Маржа':'Marja',
  'Маржинальность':'Rentabellik','Продано':'Sotilgan','Остаток':'Qoldiq','Осталось':'Qolgan',
  'Доступно':'Mavjud','Низкий остаток':'Kam qoldiq','Стоимость остатка':'Qoldiq qiymati',
  'Оплачено':'Toʻlangan','Оплата':'Toʻlov','Предоплата':'Oldindan toʻlov','Долг поставщику':'Yetkazib beruvchiga qarz',
  'Платёж поставщику':'Yetkazib beruvchiga toʻlov','Платёж':'Toʻlov','Возврат':'Qaytarish',
  'Поступление':'Kirim','Отгрузка':'Joʻnatish','Заказ':'Buyurtma','Заказано':'Buyurtma qilingan',
  'Получено':'Qabul qilingan','Брак':'Nuqsonli','Повреждён':'Shikastlangan',
  'Плановая выручка':'Rejalashtirilgan tushum','Плановая чистая прибыль':'Rejalashtirilgan sof foyda',
  'Полная стоимость партии':'Partiyaning umumiy qiymati',
  'Стоимость товара':'Mahsulot qiymati','Закупка товаров, CNY':'Mahsulot xaridi, CNY',
  'Закупка товаров, UZS (по курсу партии)':'Mahsulot xaridi, UZS (partiya kursi boʻyicha)',
  'Логистика':'Logistika','Тариф карго':'Kargo tarifi','Точка безубыточности':'Zararsizlik nuqtasi',
  'Срок окупаемости':'Oʻzini qoplash muddati','Окупаемость':'Oʻzini qoplash',
  'Денежный поток':'Pul oqimi','Вложено':'Kiritilgan mablagʻ','Нужный капитал':'Kerakli kapital',
  'Активный':'Faol','Активна':'Faol','В архив':'Arxivga','Архив':'Arxiv',
  'Проведён':'Amalga oshirilgan','Запланирован':'Rejalashtirilgan',
  'Да':'Ha','Нет':'Yoʻq','Назад':'Orqaga','Вперёд':'Oldinga','Выйти':'Chiqish',
  'Нет данных.':'Maʼlumot yoʻq.','Нет партий':'Partiyalar yoʻq',
  'Нет данных за выбранный период':'Tanlangan davr uchun maʼlumot yoʻq',
  'Ничего не найдено по запросу.':'Soʻrov boʻyicha hech narsa topilmadi.',
  'Страница не найдена.':'Sahifa topilmadi.', 'Повторить':'Qayta urinish',
  'Не удалось загрузить данные':'Maʼlumotlarni yuklab boʻlmadi',
  'Введите число':'Son kiriting','Введите сумму':'Summani kiriting',
  'Введите название':'Nomini kiriting','Введите курс':'Kursni kiriting',
  'Введите ставку':'Stavkani kiriting','Укажите дату':'Sanani koʻrsating',
  'Выберите товар':'Mahsulotni tanlang','Целое число':'Butun son',
  'Только целое число':'Faqat butun son','Только целое':'Faqat butun son',
  'Не может быть отрицательным':'Manfiy boʻlishi mumkin emas',
  'Не больше 100':'100 dan oshmasin','Минимум 1':'Kamida 1',
  'С даты':'Boshlanish sanasi','По дату':'Tugash sanasi',
  'Дни':'Kunlar','Недели':'Haftalar','Месяцы':'Oylar',
  'Сумма должна быть больше нуля':'Summa noldan katta boʻlishi kerak',
  'Добавьте хотя бы один товар':'Kamida bitta mahsulot qoʻshing',
  'Курс должен быть больше нуля':'Kurs noldan katta boʻlishi kerak',
  'Партия не найдена':'Partiya topilmadi','Партия удалена':'Partiya oʻchirildi',
  'Расход удалён':'Xarajat oʻchirildi','Платёж удалён':'Toʻlov oʻchirildi',
  'Статус обновлён':'Holat yangilandi','Себестоимость партии пересчитается.':'Partiya tannarxi qayta hisoblanadi.',
  'Отметить оплаченным':'Toʻlangan deb belgilash','Статус оплаты':'Toʻlov holati',
  'Вес единицы, г':'Birlik ogʻirligi, g','Комиссия Uzum, %':'Uzum komissiyasi, %',
  'Логистика Uzum и прочее':'Uzum logistikasi va boshqalar',
  'Упаковка и доп.':'Qadoqlash va qoʻshimcha',
  'Оформить возврат':'Qaytarishni rasmiylashtirish',
  'Основная валюта':'Asosiy valyuta','Узбекский сум':'Oʻzbek soʻmi',
  'Экспорт':'Eksport','Импорт':'Import','Скачать':'Yuklab olish',
  'Таблица':'Jadval','График':'Grafik','Детали':'Tafsilotlar',
  'Фильтр':'Filtr','Фильтры':'Filtrlar','Все':'Barchasi',
  'Сегодня':'Bugun','Вчера':'Kecha','Месяц':'Oy','Год':'Yil',
  'Реклама':'Reklama','Налоги':'Soliqlar','Налог':'Soliq',
  'Доход':'Daromad','Расчёт':'Hisob-kitob','Расчёты':'Hisob-kitoblar',
  'План':'Reja','Факт':'Haqiqiy','Цена':'Narx','Закупочная цена':'Xarid narxi',
  'Цена продажи':'Sotuv narxi','Ожидаемые продажи':'Kutilayotgan sotuvlar',
  'Шт.':'Dona','шт.':'dona','дн.':'kun',
}
const words: Record<string,string> = {
  'новый':'yangi','новая':'yangi','новое':'yangi','новые':'yangi',
  'добавить':'qoʻshish','удалить':'oʻchirish','сохранить':'saqlash',
  'товар':'mahsulot','товара':'mahsulotning','товаров':'mahsulotlar',
  'партия':'partiya','партии':'partiyaning','партий':'partiyalar',
  'продаж':'sotuvlar','продажи':'sotuvlar','закупки':'xaridlar','закупка':'xarid',
  'сумма':'summa','суммы':'summaning','расходы':'xarajatlar','расходов':'xarajatlar',
  'прибыль':'foyda','прибыли':'foydaning','доходы':'daromadlar',
  'данные':'maʼlumotlar','данных':'maʼlumotlar','выберите':'tanlang',
  'введите':'kiriting','укажите':'koʻrsating','нет':'yoʻq','есть':'bor',
  'количество':'miqdor','единицы':'birlik','единиц':'birlik',
  'цена':'narx','цены':'narxlar','стоимость':'qiymat',
  'себестоимость':'tannarx','остатки':'qoldiqlar','остаток':'qoldiq',
  'склад':'ombor','настройки':'sozlamalar','статус':'holat',
  'платежи':'toʻlovlar','платёж':'toʻlov','оплаты':'toʻlov',
  'возвраты':'qaytarishlar','возврат':'qaytarish',
  'поставщики':'yetkazib beruvchilar','поставщика':'yetkazib beruvchi',
  'категории':'toifalar','категория':'toifa','валюта':'valyuta',
  'название':'nomi','дата':'sana','курс':'kurs',
  'чистая':'sof','валовая':'yalpi','плановая':'rejalashtirilgan',
  'процент':'foiz','комиссия':'komissiya','логистика':'logistika',
  'общая':'umumiy','общий':'umumiy','всего':'jami','итого':'jami',
  'средняя':'oʻrtacha','средний':'oʻrtacha','оплачено':'toʻlangan',
  'получено':'olingan','заказано':'buyurtma qilingan','продано':'sotilgan',
  'доступно':'mavjud','активный':'faol','активные':'faol',
  'период':'davr','время':'vaqt','добавлено':'qoʻshildi',
  'успешно':'muvaffaqiyatli','ошибка':'xatolik','изменить':'oʻzgartirish',
  'не':'emas','для':'uchun','по':'boʻyicha','в':'ichida','и':'va',
}
const dictionary = Object.entries(phrases).sort((a,b)=>b[0].length-a[0].length)
const wordEntries = Object.entries(words).sort((a,b)=>b[0].length-a[0].length)
function matchCase(src:string,translated:string) { return src[0] === src[0]?.toUpperCase() ? translated[0].toUpperCase()+translated.slice(1) : translated }
export function translateRussian(value:string):string {
  if (!/[А-Яа-яЁё]/.test(value)) return value
  let result=value
  for(const [ru,uz] of dictionary) result=result.replaceAll(ru,uz)
  for(const [ru,uz] of wordEntries) result=result.replace(new RegExp(`(?<![А-Яа-яЁё])${ru}(?![А-Яа-яЁё])`,'gi'),m=>matchCase(m,uz))
  return result
}
const originals=new WeakMap<Text,string>()
const attrOriginals=new WeakMap<Element,Map<string,string>>()
const attributes=['placeholder','title','aria-label','alt','data-translation-version']
let observer:MutationObserver|null=null
let active=false
function transform(root:Node, uz:boolean) {
  if(root.nodeType===Node.TEXT_NODE) {
    const node=root as Text
    const current=node.data
    let original=originals.get(node)
    if(original===undefined){original=current;originals.set(node,original)}
    else if(current!==original && current!==translateRussian(original)) {original=current;originals.set(node,original)}
    const value=uz?translateRussian(original):original
    if(current!==value)node.data=value
    return
  }
  if(root.nodeType!==Node.ELEMENT_NODE && root.nodeType!==Node.DOCUMENT_NODE)return
  if(root instanceof Element) {
    if(root.closest('[data-no-translate],script,style,textarea,input[type="hidden"],code,pre'))return
    let m=attrOriginals.get(root)
    if(!m){m=new Map();attrOriginals.set(root,m)}
    for(const a of attributes) {
      if(a==='data-translation-version')continue
      const val=root.getAttribute(a)
      if(val===null)continue
      let orig=m.get(a)
      if(orig===undefined || (val!==orig && val!==translateRussian(orig))){orig=val;m.set(a,orig)}
      const translated=uz?translateRussian(orig):orig
      if(val!==translated)root.setAttribute(a,translated)
    }
  }
  for(const child of Array.from(root.childNodes)) transform(child,uz)
}
export function initUiTranslation(getLanguage:()=>string) {
  if(typeof document==='undefined')return ()=>{}
  active=true
  let pending=false
  const refresh=()=>{
    if(pending)return
    pending=true
    queueMicrotask(()=>{
      pending=false
      if(!active)return
      observer?.disconnect()
      transform(document.body,getLanguage()==='uz')
      observer?.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:attributes})
    })
  }
  observer=new MutationObserver(refresh)
  refresh()
  return ()=>{active=false;observer?.disconnect();observer=null}
}
export function refreshUiTranslation(){window.dispatchEvent(new Event('dashboard-language-refresh'))}
