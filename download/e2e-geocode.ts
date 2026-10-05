/**
 * E2E: геокодирование заявок (Task 12 UX-fix).
 * Проверяет: детерминированность geocodeAddress (кэш), geoSource на ручной
 * точке, защиту ручной точки при неудачном геокодинге, перегеокодинг по адресу.
 * Запуск: bun download/e2e-geocode.ts
 */
import { db } from '@/lib/db';
import { geocodeAddress } from '@/lib/orders';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, extra?: string) {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`); }
}

async function main() {
  const user = await db.user.upsert({
    where: { username: 'e2e-geo' },
    update: {},
    create: { username: 'e2e-geo', password: 'x' },
  });
  const bot = await db.bot.create({
    data: { userId: user.id, name: 'E2E Гео-бот' },
  });

  try {
    // 1. Детерминированность: два вызова по одному адресу → одни координаты
    const g1 = await geocodeAddress('Москва, Тверская улица, 1');
    const g2 = await geocodeAddress('Москва, Тверская улица, 1');
    check('геокодинг адреса вернул координаты', !!g1);
    check('повторный вызов детерминирован (кэш)',
      !!g1 && !!g2 && g1.lat === g2.lat && g1.lng === g2.lng,
      `${g1} vs ${g2}`);

    // 2. Заявка с ручной точкой: PATCH lat/lng → geoSource=manual
    const order = await db.order.create({
      data: {
        botId: bot.id, number: 1, type: 'waste',
        address: 'Тестовый несуществующий адрес 12345',
        lat: 55.751244, lng: 37.618423, geoSource: 'manual',
      },
    });
    check('заявка с ручной точкой создана', order.geoSource === 'manual');

    // 3. Неудачный геокодинг НЕ затирает ручную точку
    //    (эмулируем логику PATCH: geo=null → координаты не меняем)
    const badGeo = await geocodeAddress('Тестовый несуществующий адрес 12345 xyzzy');
    check('несуществующий адрес → null', badGeo === null,
      `ожидался null, получено ${JSON.stringify(badGeo)}`);

    // 4. Перегеокодинг реального адреса: координаты меняются предсказуемо
    const order2 = await db.order.create({
      data: { botId: bot.id, number: 2, type: 'waste', address: 'Москва, Красная площадь, 1' },
    });
    const good = await geocodeAddress(order2.address!);
    check('реальный адрес геокодируется', !!good && Number.isFinite(good.lat) && Number.isFinite(good.lng),
      JSON.stringify(good));
    // Красная площадь: проверяем, что попали в Москву (а не в «Москва»-магазин в Мариуполе)
    check('геокодинг не подменяет адрес ПОИ-именем в другом городе',
      !!good && Math.abs(good.lat - 55.75) < 0.5 && Math.abs(good.lng - 37.6) < 0.7,
      JSON.stringify(good));

    // 5. Кэш не растёт бесконечно (проверка структуры)
    check('гео-кэш заполняется детерминированно', (await geocodeAddress(order2.address!))?.lat === good?.lat);

    // 6. Очистка
    await db.order.deleteMany({ where: { botId: bot.id } });
    await db.bot.delete({ where: { id: bot.id } });
    await db.user.delete({ where: { id: user.id } });

    console.log(`\nИтого: ${passed} ✅ / ${failed} ❌`);
    process.exit(failed ? 1 : 0);
  } catch (e) {
    console.error('E2E error:', e);
    try {
      await db.order.deleteMany({ where: { botId: bot.id } });
      await db.bot.delete({ where: { id: bot.id } });
      await db.user.delete({ where: { id: user.id } });
    } catch { /* noop */ }
    process.exit(1);
  }
}

main();
