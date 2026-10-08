// IMP-24-BE-13: совмещение точки заявки/жалобы с КП реестра MyTKO.
//
// Два независимых признака совпадения:
//  - по координатам: haversine-дистанция до КП ≤ radiusM (по умолчанию 250 м);
//  - по адресу: пересечение значимых токенов нормализованных адресов
//    (≥ 0.5 доли токенов адреса заявки и ≥ 2 токенов, либо lkCode целиком
//    входит в адрес).
// Итоговый score = max(coordScore, addrScore * 0.9) — координаты весят больше,
// текстовое совпадение слегка дисконтируется. Реестр берётся из кэша
// getAreasCached (TTL 5 мин) — ~11k записей, перебор в памяти.

import { getAreasCached, normText } from '@/lib/mytko';
import type { AreaMatchCandidate } from '@/lib/studio-types';

const DEFAULT_RADIUS_M = 250;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;

/**
 * Расстояние между точками по формуле гаверсинуса, метры.
 * (Земля — сфера R=6 371 000 м; для городских дистанций точность достаточна.)
 */
export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Значимые токены адреса: нормализация (lowercase, ё→е, без пунктуации) →
 * слова ≥ 4 символов + числа/номера домов (начинаются с цифры любой длины).
 * Дубликаты схлопываются — пересечение считается по множествам.
 */
function addressTokens(raw: string | null | undefined): string[] {
  const s = normText(raw ?? '');
  if (!s) return [];
  return [...new Set(s.split(' ').filter((w) => w && (/^\d/.test(w) || w.length >= 4)))];
}

/**
 * Кандидаты КП реестра бота для точки/адреса: сортировка по score (desc),
 * только score > 0, top limit (по умолчанию 5).
 * distanceM — целые метры (null, если у КП или точки нет координат).
 */
export async function matchAreasFor(
  botId: string,
  point: { lat?: number | null; lng?: number | null; address?: string | null },
  opts?: { limit?: number; radiusM?: number }
): Promise<AreaMatchCandidate[]> {
  // IMP-24-REV-3: cap радиуса согласован с areas-роутом (?radius cap 2000) —
  // иначе астрономический radius пометит «byCoord» весь реестр
  const radiusM = Math.min(
    opts?.radiusM && opts.radiusM > 0 ? opts.radiusM : DEFAULT_RADIUS_M,
    2000
  );
  const limit = Math.min(Math.max(1, Math.floor(opts?.limit ?? DEFAULT_LIMIT)), MAX_LIMIT);

  const lat = typeof point.lat === 'number' && Number.isFinite(point.lat) ? point.lat : null;
  const lng = typeof point.lng === 'number' && Number.isFinite(point.lng) ? point.lng : null;
  const hasPoint = lat != null && lng != null;

  const reqTokens = addressTokens(point.address);
  const reqNorm = normText(point.address ?? '');

  const areas = await getAreasCached(botId);
  const candidates: AreaMatchCandidate[] = [];

  for (const a of areas) {
    let coordScore = 0;
    let byCoord = false;
    let distanceM: number | null = null;
    if (hasPoint && a.lat != null && a.lng != null) {
      const d = haversineM(lat as number, lng as number, a.lat, a.lng);
      distanceM = Math.round(d);
      if (d <= radiusM) {
        byCoord = true;
        coordScore = 1 - d / radiusM;
      }
    }

    let addrScore = 0;
    let byAddress = false;
    if (reqTokens.length) {
      const areaSet = new Set(addressTokens(a.address));
      let inter = 0;
      for (const t of reqTokens) if (areaSet.has(t)) inter += 1;
      addrScore = inter / reqTokens.length;
      if (a.lkCode && reqNorm.includes(a.lkCode.toLowerCase())) {
        byAddress = true; // код КП целиком в адресе заявки — совпадение по адресу
      } else if (addrScore >= 0.5 && inter >= 2) {
        byAddress = true;
      }
    }

    const score = Math.max(coordScore, addrScore * 0.9);
    if (score <= 0) continue;
    candidates.push({
      lkCode: a.lkCode,
      address: a.address,
      lat: a.lat,
      lng: a.lng,
      distanceM,
      score: Math.round(score * 1000) / 1000,
      byCoord,
      byAddress,
    });
  }

  // score desc; тайбрейки — ближайшая точка, затем код КП (детерминированный порядок)
  candidates.sort((x, y) => {
    if (y.score !== x.score) return y.score - x.score;
    const dx = x.distanceM ?? Number.POSITIVE_INFINITY;
    const dy = y.distanceM ?? Number.POSITIVE_INFINITY;
    if (dx !== dy) return dx - dy;
    return x.lkCode < y.lkCode ? -1 : x.lkCode > y.lkCode ? 1 : 0;
  });

  return candidates.slice(0, limit);
}
