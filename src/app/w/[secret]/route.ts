import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';

/**
 * Публичная страница-виджет (IMP-FE22-17): GET /w/<secret> отдаёт standalone
 * HTML с embedded чатом — vanilla JS без React/сборки, вставляется на сайт
 * через iframe (сниппет в «Каналах» → «Код для сайта»).
 *
 * Это программный endpoint (аналог api/*), НЕ страница студии: UI-строкой,
 * чтобы не тащить в хост-сайт React-бандл. Весь JS — без шаблонных подстановок
 * (никаких ` и ${ внутри), т.к. HTML лежит в template literal.
 *
 * Функционал: visitorId в localStorage (ключ bstudio.visitorId — общий с
 * демо-чатом студии), POST /api/webhook/demo/<secret> {text, conversationId},
 * поллинг GET ?conversationId&after каждые 4с (пауза на document.hidden),
 * плавающий лаунчер 56px (z-2147483647), «бот печатает», 429 с кулдауном,
 * приветствие новому посетителю (локальное, не сохраняется).
 */

export const dynamic = 'force-dynamic';

const WIDGET_HTML = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Чат поддержки</title>
<style>
  html, body { margin:0; padding:0; background:transparent; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; }
  .bs-launcher { position:fixed; right:16px; bottom:calc(16px + env(safe-area-inset-bottom, 0px)); width:56px; height:56px; border-radius:9999px; border:0; background:#0f172a; color:#fff; cursor:pointer; box-shadow:0 8px 24px rgba(15,23,42,.35); z-index:2147483647; display:flex; align-items:center; justify-content:center; padding:0; }
  .bs-launcher:focus-visible { outline:2px solid #0f172a; outline-offset:3px; }
  .bs-panel { position:fixed; right:16px; bottom:calc(80px + env(safe-area-inset-bottom, 0px)); width:360px; max-width:calc(100vw - 32px); height:480px; max-height:calc(100dvh - 96px - env(safe-area-inset-bottom, 0px)); background:#fff; color:#0f172a; border-radius:16px; border:1px solid #e2e8f0; box-shadow:0 16px 48px rgba(15,23,42,.22); display:none; flex-direction:column; overflow:hidden; z-index:2147483647; }
  .bs-panel.bs-open { display:flex; }
  .bs-head { background:#0f172a; color:#fff; padding:12px 14px; display:flex; align-items:center; gap:10px; flex:none; }
  .bs-avatar { width:34px; height:34px; border-radius:9999px; background:rgba(255,255,255,.15); display:flex; align-items:center; justify-content:center; flex:none; }
  .bs-title { font-size:14px; font-weight:600; line-height:1.25; }
  .bs-status { display:flex; align-items:center; gap:5px; font-size:11px; opacity:.85; margin-top:2px; }
  .bs-dot { width:7px; height:7px; border-radius:9999px; background:#4ade80; flex:none; }
  .bs-dot.bs-warn { background:#fbbf24; }
  .bs-msgs { flex:1 1 auto; overflow-y:auto; background:#f8fafc; padding:12px; display:flex; flex-direction:column; gap:8px; -webkit-overflow-scrolling:touch; }
  .bs-row { display:flex; }
  .bs-row.me { justify-content:flex-end; }
  .bs-bubble { max-width:85%; padding:8px 12px; border-radius:16px; font-size:14px; line-height:1.45; white-space:pre-wrap; overflow-wrap:anywhere; }
  .bs-bot { background:#fff; border:1px solid #e2e8f0; border-bottom-left-radius:6px; }
  .bs-me { background:#0f172a; color:#fff; border-bottom-right-radius:6px; }
  .bs-sys { align-self:center; display:flex; align-items:center; gap:5px; font-size:11px; color:#b45309; text-align:center; max-width:95%; }
  .bs-chips { display:flex; flex-wrap:wrap; gap:6px; }
  .bs-chip { border:1px solid #cbd5e1; background:#fff; color:#0f172a; border-radius:9999px; min-height:44px; padding:8px 14px; font-size:13px; cursor:pointer; font-family:inherit; }
  .bs-chip:hover { background:#f1f5f9; }
  .bs-chip:disabled { opacity:.5; cursor:default; }
  .bs-foot { flex:none; display:flex; gap:8px; padding:10px; padding-bottom:calc(10px + env(safe-area-inset-bottom, 0px)); border-top:1px solid #e2e8f0; background:#fff; }
  .bs-input { flex:1; min-width:0; border:1px solid #cbd5e1; border-radius:12px; padding:10px 12px; font-size:14px; font-family:inherit; outline:none; color:#0f172a; background:#fff; }
  .bs-input:focus { border-color:#0f172a; }
  .bs-input:disabled { opacity:.6; }
  .bs-send { flex:none; width:44px; height:44px; border:0; border-radius:12px; background:#0f172a; color:#fff; cursor:pointer; display:flex; align-items:center; justify-content:center; }
  .bs-send:disabled { opacity:.5; cursor:default; }
  .bs-dots { display:inline-flex; gap:4px; padding:4px 0; }
  .bs-dots span { width:6px; height:6px; border-radius:9999px; background:#94a3b8; animation:bsbounce 1.2s infinite ease-in-out; }
  .bs-dots span:nth-child(2) { animation-delay:.15s; }
  .bs-dots span:nth-child(3) { animation-delay:.3s; }
  .bs-skel { opacity:.5; animation:bsfade 1.4s infinite ease-in-out; }
  @keyframes bsbounce { 0%,80%,100% { transform:translateY(0); opacity:.5; } 40% { transform:translateY(-4px); opacity:1; } }
  @keyframes bsfade { 0%,100% { opacity:.35; } 50% { opacity:.7; } }
  @media (prefers-reduced-motion: reduce) { .bs-dots span, .bs-skel { animation:none; } }
  @media (max-width: 480px) {
    .bs-panel { left:8px; right:8px; width:auto; max-width:none; bottom:calc(76px + env(safe-area-inset-bottom, 0px)); height:calc(100dvh - 88px - env(safe-area-inset-bottom, 0px)); max-height:none; }
  }
  .bs-sr { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
</style>
</head>
<body>
<div id="bs-root"></div>
<script>
(function () {
  'use strict';
  var SECRET = decodeURIComponent((window.location.pathname.split('/')[2] || ''));
  var LS_VISITOR = 'bstudio.visitorId';
  var LS_VISITOR_LEGACY = 'botstudio_visitor';
  var LS_CONV = 'bstudio.wconv.' + SECRET;
  var WELCOME = 'Здравствуйте! Напишите ваш вопрос — бот ответит.';

  var CHAT_SVG = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>';
  var CLOSE_SVG = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>';
  var SEND_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z"></path><path d="M22 2 11 13"></path></svg>';
  var CLOCK_SVG = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l-2 4"></path></svg>';

  var root = document.getElementById('bs-root');
  root.innerHTML =
    '<button type="button" class="bs-launcher" id="bs-launcher" aria-label="Открыть чат" aria-expanded="false">' + CHAT_SVG + '</button>' +
    '<section class="bs-panel" id="bs-panel" role="dialog" aria-label="Чат поддержки">' +
      '<header class="bs-head">' +
        '<div class="bs-avatar">' + CHAT_SVG + '</div>' +
        '<div class="bs-title">Чат поддержки' +
          '<div class="bs-status"><span class="bs-dot" id="bs-dot" aria-hidden="true"></span><span id="bs-status">онлайн</span></div>' +
        '</div>' +
      '</header>' +
      '<div class="bs-msgs" id="bs-msgs" aria-live="polite"></div>' +
      '<form class="bs-foot" id="bs-form">' +
        '<input class="bs-input" id="bs-input" type="text" placeholder="Сообщение…" aria-label="Сообщение" autocomplete="off" maxlength="2000">' +
        '<button class="bs-send" id="bs-send" type="submit" aria-label="Отправить">' + SEND_SVG + '</button>' +
      '</form>' +
    '</section>';

  var launcher = document.getElementById('bs-launcher');
  var panel = document.getElementById('bs-panel');
  var msgs = document.getElementById('bs-msgs');
  var form = document.getElementById('bs-form');
  var input = document.getElementById('bs-input');
  var sendBtn = document.getElementById('bs-send');
  var statusText = document.getElementById('bs-status');
  var statusDot = document.getElementById('bs-dot');

  var messages = [];          // {id, role, text, buttons?}
  var convId = null;
  var visitorId = '';
  var open = false;
  var booted = false;
  var sending = false;
  var typing = false;
  var noticeText = null;      // системная строка (429 и т.п.)
  var cooldown = 0;
  var cdTimer = null;
  var pollTimer = null;

  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }

  function getVisitor() {
    // Тот же ключ, что у демо-чата студии (bstudio.visitorId) — один гость,
    // один externalUserId; legacy botstudio_visitor читаем для преемственности.
    var v = lsGet(LS_VISITOR) || lsGet(LS_VISITOR_LEGACY);
    if (!v) {
      v = Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
    lsSet(LS_VISITOR, v);
    return v;
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function bubbleRow(role, text) {
    var row = el('div', role === 'user' ? 'bs-row me' : 'bs-row');
    row.appendChild(el('div', role === 'user' ? 'bs-bubble bs-me' : 'bs-bubble bs-bot', text));
    return row;
  }

  function skeletonRows() {
    var frag = document.createDocumentFragment();
    var widths = ['60%', '40%', '50%'];
    for (var i = 0; i < 3; i++) {
      var row = el('div', i === 1 ? 'bs-row me' : 'bs-row');
      var b = el('div', 'bs-bubble bs-bot bs-skel');
      b.style.width = widths[i];
      b.innerHTML = '&nbsp;';
      row.appendChild(b);
      frag.appendChild(row);
    }
    return frag;
  }

  function typingRow() {
    var row = el('div', 'bs-row');
    var b = el('div', 'bs-bubble bs-bot');
    b.setAttribute('aria-hidden', 'true');
    b.innerHTML = '<span class="bs-dots"><span></span><span></span><span></span></span>';
    row.appendChild(b);
    row.appendChild(el('span', 'bs-sr', 'Бот печатает'));
    return row;
  }

  function noticeRow(text) {
    var row = el('div', 'bs-sys');
    row.setAttribute('role', 'status');
    row.innerHTML = CLOCK_SVG;
    row.appendChild(el('span', null, text));
    return row;
  }

  function render() {
    msgs.textContent = '';
    if (!booted) {
      msgs.appendChild(skeletonRows());
      msgs.scrollTop = msgs.scrollHeight;
      return;
    }
    if (messages.length === 0) {
      // Приветствие новому посетителю — локальное, в messages не пишется
      msgs.appendChild(bubbleRow('bot', WELCOME));
    }
    var i, m;
    for (i = 0; i < messages.length; i++) {
      m = messages[i];
      msgs.appendChild(bubbleRow(m.role, m.text));
    }
    if (noticeText) msgs.appendChild(noticeRow(noticeText));
    if (typing) msgs.appendChild(typingRow());
    // Чипы быстрых кнопок — из последнего сообщения бота с кнопками
    var chips = null;
    for (i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'bot' && messages[i].buttons && messages[i].buttons.length) {
        chips = messages[i].buttons;
        break;
      }
    }
    if (chips) {
      var wrap = el('div', 'bs-chips');
      for (i = 0; i < chips.length; i++) {
        (function (btn) {
          var c = el('button', 'bs-chip', btn.text);
          c.type = 'button';
          c.disabled = sending || cooldown > 0;
          c.addEventListener('click', function () { send(btn.text); });
          wrap.appendChild(c);
        })(chips[i]);
      }
      msgs.appendChild(wrap);
    }
    msgs.scrollTop = msgs.scrollHeight;
  }

  function setStatus(state) {
    if (state === 'unpublished') {
      statusText.textContent = 'Не опубликован';
      statusDot.className = 'bs-dot bs-warn';
    } else if (state === 'published') {
      statusText.textContent = 'Опубликован';
      statusDot.className = 'bs-dot';
    }
  }

  function refreshInput() {
    input.disabled = cooldown > 0;
    sendBtn.disabled = cooldown > 0;
    input.placeholder = cooldown > 0 ? 'Подождите ' + cooldown + 'с…' : 'Сообщение…';
  }

  function startCooldown(sec) {
    cooldown = sec;
    if (cdTimer) clearInterval(cdTimer);
    cdTimer = setInterval(function () {
      cooldown -= 1;
      if (cooldown <= 0) { clearInterval(cdTimer); cdTimer = null; cooldown = 0; }
      refreshInput();
      render(); // обновить disabled у чипов
    }, 1000);
    refreshInput();
  }

  function lastMsgId() {
    return messages.length ? messages[messages.length - 1].id : '';
  }

  async function poll() {
    if (!convId || document.hidden || sending || !open) return;
    try {
      var res = await fetch('/api/webhook/demo/' + SECRET + '?conversationId=' + encodeURIComponent(convId) + '&after=' + encodeURIComponent(lastMsgId()));
      if (!res.ok) return;
      var d = await res.json();
      if (d && d.messages && d.messages.length > messages.length) {
        messages = d.messages;
        typing = false;
        render();
      }
    } catch (e) { /* тихо: следующий тик повторит */ }
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(poll, 4000);
    // Возврат на вкладку — немедленный тик (document.hidden проверяется в poll)
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) poll();
    });
  }

  async function send(text) {
    if (!text || sending || cooldown > 0) return;
    sending = true;
    typing = true;
    noticeText = null;
    messages.push({ id: 'u' + Date.now(), role: 'user', text: text });
    input.value = '';
    sendBtn.disabled = true;
    render();
    try {
      var res = await fetch('/api/webhook/demo/' + SECRET, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text, conversationId: convId || undefined, visitorId: visitorId || undefined })
      });
      var d = {};
      try { d = await res.json(); } catch (e) { d = {}; }
      typing = false;
      if (res.status === 429) {
        noticeText = (d && d.error) || 'Слишком часто, подождите минуту';
        startCooldown(60);
      } else if (!res.ok) {
        noticeText = (d && d.error) || 'Не удалось отправить';
        if (res.status === 409 && d && d.error && /публик|publish/i.test(d.error)) setStatus('unpublished');
      } else {
        convId = (d && d.conversationId) || convId;
        if (convId) lsSet(LS_CONV, convId);
        messages = (d && d.messages) || [];
        setStatus('published');
      }
    } catch (e) {
      typing = false;
      noticeText = 'Нет связи';
    }
    sending = false;
    render();
  }

  launcher.addEventListener('click', function () {
    open = !open;
    panel.classList.toggle('bs-open', open);
    launcher.setAttribute('aria-expanded', open ? 'true' : 'false');
    launcher.setAttribute('aria-label', open ? 'Закрыть чат' : 'Открыть чат');
    launcher.innerHTML = open ? CLOSE_SVG : CHAT_SVG;
    if (open) {
      render();
      try { input.focus(); } catch (e) {}
    }
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    send((input.value || '').trim());
  });

  (async function boot() {
    visitorId = getVisitor();
    convId = lsGet(LS_CONV);
    render(); // скелетон на время восстановления
    if (convId) {
      try {
        var res = await fetch('/api/webhook/demo/' + SECRET + '?conversationId=' + encodeURIComponent(convId) + '&take=50');
        if (res.ok) {
          var d = await res.json();
          messages = (d && d.messages) || [];
        }
      } catch (e) { /* начнём новый диалог */ }
    }
    booted = true;
    render();
    startPolling();
  })();
})();
</script>
</body>
</html>`;

type Params = { params: Promise<{ secret: string }> };

/**
 * GET /w/<secret> — страница-виджет для вставки через iframe.
 * Канал проверяется по secret (как у demo-вебхука): только существующий
 * web-канал получает HTML, остальным — 404. no-store: статус канала/бота
 * может измениться, прокси не должны кэшировать страницу.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { secret } = await params;
  const channel = await db.channel.findUnique({
    where: { secret },
    select: { id: true, type: true },
  });
  if (!channel || channel.type !== 'web') {
    return new NextResponse('Not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  return new NextResponse(WIDGET_HTML, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
