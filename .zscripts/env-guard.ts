/**
 * Env Guard — защита секретов .env.local от платформенных перезаписей.
 *
 * Прецедент (worklog, op-map-mytko-secret, 20.10): платформенный снапшот
 * периодически восстанавливает контейнер и ПЕРЕЗАПИСЫВАЕТ .env.local
 * (4 обнуления БД + минимум 2 перезаписи .env.local — инцидент worklog:1164).
 * APP_SECRET существовал ТОЛЬКО в .env.local → был утрачен безвозвратно,
 * зашифрованный им пароль MyTKO стал нерасшифровываемым, GET /orders
 * падал 500, «пропала карта».
 *
 * Что делает:
 *   1. APP_SECRET:
 *      • отсутствует в .env.local, а бэкап db/secrets/app-secret.bak есть
 *        → восстанавливает значение из бэкапа (тихая самопочинка);
 *      • отсутствует и бэкапа нет → генерирует НОВЫЙ, пишет в .env.local
 *        И в бэкап, громко предупреждает (старые enc:v1-пароли нерасшифруемы);
 *      • присутствует → зеркалит в бэкап (бэкап = отражение текущего значения).
 *   2. GITHUB_TOKEN (нужен скрипту пуша): восстанавливает из бэкапа /
 *      зеркалит в бэкап; НИКОГДА не генерирует (при потере обоих — предупреждение).
 *      ЛИМИТАЦИЯ (волна 31): сам бэкап токена в git НЕ попадает — GitHub push
 *      protection отклоняет коммит с PAT (прецедент: push 362a877 без него).
 *      Токен защищён от перезаписи .env.local в пределах живого контейнера;
 *      полная пересборка контейнера из git теряет токен — запросить у владельца.
 *
 * Безопасность: значения НИКОГДА не печатаются в логи. Бэкап APP_SECRET лежит в
 * git-трекаемом db/secrets/ — ПОБЕДЫ над повторной потерей важнее строгости:
 * репозиторий приватный и уже содержит снапшоты БД (worklog, db-empty-guard).
 *
 * Вызывается из .zscripts/dev.sh ПЕРЕД db-empty-guard (секрет нужен при старте
 * Next.js, который читает .env.local на буте). Отдельный запуск:
 *   bun .zscripts/env-guard.ts
 */
import crypto from 'node:crypto';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dir, '..');
const ENV_LOCAL = path.join(ROOT, '.env.local');
const SECRETS_DIR = path.join(ROOT, 'db', 'secrets');
const BACKUP_APP = path.join(SECRETS_DIR, 'app-secret.bak');
const BACKUP_GH = path.join(SECRETS_DIR, 'github-token.bak');

function log(msg: string): void {
  console.log(`[env-guard ${new Date().toISOString()}] ${msg}`);
}

/** Значение ключа из содержимого .env.local: null — строки нет, '' — строка пустая.
 *  31-REV P2-2: дубли ключа — dotenv берёт ПОСЛЕДНЮЮ строку, мы первую — предупеждаем. */
function readEnvKey(content: string, key: string): string | null {
  const matches = content.match(new RegExp(`^${key}=(.*)$`, 'gm'));
  if (!matches || matches.length === 0) return null;
  if (matches.length > 1) {
    log(`ВНИМАНИЕ: в .env.local ${matches.length} строк ${key}= — берётся первая, а dotenv берёт последнюю; уберите дубли`);
  }
  return matches[0].slice(key.length + 1).trim();
}

/** Вставить/заменить ключ в .env.local, сохранив остальные строки.
 *  31-REV P2-1: replacer-ФУНКЦИЯ вместо строки — иначе спец-последовательности
 *  ($&, $1…) в значении интерпретируются и портят файл/бэкап. */
function upsertEnvKey(content: string, key: string, value: string): string {
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(content)) return content.replace(re, () => `${key}=${value}`);
  const sep = content === '' || content.endsWith('\n') ? '' : '\n';
  return `${content}${sep}${key}=${value}\n`;
}

function readBackup(file: string): string | null {
  try {
    // 31-REV P2-5: только первая строка — multiline-значение в .bak протекло бы
    // в .env.local переноса́ми строк и сломало бы файл
    const v = fs.readFileSync(file, 'utf8').split('\n')[0].trim();
    return v || null;
  } catch {
    return null;
  }
}

function writeBackup(file: string, value: string): void {
  fs.mkdirSync(SECRETS_DIR, { recursive: true });
  fs.writeFileSync(file, `${value}\n`, { mode: 0o600 });
}

/**
 * Синхронизация одного ключа env↔бэкап.
 * Возвращает действие, выполненное над .env.local (для сводки).
 */
function guardKey(key: string, envContent: string, backupFile: string, canGenerate: boolean): {
  content: string;
  action: string;
} {
  const current = readEnvKey(envContent, key);
  const backup = readBackup(backupFile);

  // 1. Ключа нет (или пустой) — восстанавливаем из бэкапа
  if (!current) {
    if (backup) {
      log(`${key}: ОТСУТСТВУЕТ в .env.local — восстанавливаю из бэкапа ${path.basename(backupFile)}`);
      return { content: upsertEnvKey(envContent, key, backup), action: 'restored' };
    }
    if (canGenerate) {
      const fresh = crypto.randomBytes(32).toString('hex');
      writeBackup(backupFile, fresh);
      log(
        `${key}: ОТСУТСТВУЕТ и бэкапа нет — сгенерирован НОВЫЙ (записан в .env.local и в бэкап). ` +
          'ВНИМАНИЕ: зашифрованные им ранее данные (пароль MyTKO) станут нерасшифровываемыми — введите пароль заново в настройках интеграции.'
      );
      return { content: upsertEnvKey(envContent, key, fresh), action: 'generated' };
    }
    log(`${key}: ОТСУТСТВУЕТ и бэкапа нет — продолжаю без него (функции, которым он нужен, деградируют)`);
    return { content: envContent, action: 'missing' };
  }

  // 2. Ключ есть — бэкап должен быть его зеркалом
  if (!backup) {
    writeBackup(backupFile, current);
    log(`${key}: бэкап создан (${path.basename(backupFile)})`);
    return { content: envContent, action: 'backed-up' };
  }
  if (backup !== current) {
    // осознанная ротация секрет человеком — бэкап следует за env
    writeBackup(backupFile, current);
    log(
      `${key}: значение в .env.local отличается от бэкапа — бэкап синхронизирован. ` +
        'ВНИМАНИЕ: если это ротация — зашифрованные прежним значением данные (пароль MyTKO, enc:v1) станут нерасшифровываемыми — введите пароль заново в настройках интеграции.' // 31-REV P2-4
    );
    return { content: envContent, action: 're-synced' };
  }
  log(`${key}: OK`);
  return { content: envContent, action: 'ok' };
}

function main(): void {
  let envContent = '';
  try {
    envContent = fs.readFileSync(ENV_LOCAL, 'utf8');
  } catch {
    log('.env.local отсутствует — будет создан');
  }

  let created = false;
  const app = guardKey('APP_SECRET', envContent, BACKUP_APP, true);
  envContent = app.content;
  const gh = guardKey('GITHUB_TOKEN', envContent, BACKUP_GH, false);
  envContent = gh.content;

  if (app.action !== 'ok' || gh.action !== 'ok' || !fs.existsSync(ENV_LOCAL)) {
    fs.writeFileSync(ENV_LOCAL, envContent);
    // 31-REV P2-3: mode в writeFileSync действует только на СОЗДАНИЕ файла —
    // на существующий .env.local права надо выставлять явно
    fs.chmodSync(ENV_LOCAL, 0o600);
    created = true;
    log('.env.local записан (0600)');
  }
  log(`готово (APP_SECRET: ${app.action}; GITHUB_TOKEN: ${gh.action}${created ? '; .env.local создан/обновлён' : ''})`);
}

main();
