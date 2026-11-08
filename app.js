/* 國三忠 家庭日 電子相簿 */
(() => {
  'use strict';
  const CFG = window.ALBUM_CONFIG || {};
  const qs = new URLSearchParams(location.search);
  if (qs.get('api')) localStorage.setItem('albumApi', qs.get('api'));
  let API = (CFG.apiUrl || localStorage.getItem('albumApi') || '').trim();
  const CHUNK = Math.round((CFG.chunkMB || 5) * 4) * 256 * 1024; // 256KB 的倍數

  const $ = (s) => document.querySelector(s);
  const state = { files: [], loaded: false, needKey: false, pf: null, portrait: null, lb: -1, filter: 'all', uploading: false, loadError: '' };

  /* ---------- 小工具 ---------- */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const rand = (seed) => { const x = Math.sin(seed * 9301 + 49297) * 233280; return x - Math.floor(x); };
  function fmtDate(f) {
    const d = new Date(f.taken || f.uploaded);
    if (isNaN(d)) return '';
    return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const fmtDur = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${pad(s % 60)}`; };
  const fmtSize = (b) => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  let toastTimer;
  function toast(msg, ms = 2800) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }
  function openOverlay(sel) { const el = $(sel); el.classList.add('open'); el.setAttribute('aria-hidden', 'false'); }
  function closeOverlay(sel) { const el = $(sel); el.classList.remove('open'); el.setAttribute('aria-hidden', 'true'); }
  const isOpen = (sel) => $(sel).classList.contains('open');

  /* ---------- 圖片網址（Google 雲端硬碟） ---------- */
  const urlA = (f, w) => f.src || `https://lh3.googleusercontent.com/d/${f.id}=w${w}`;
  const urlB = (f, w) => `https://drive.google.com/thumbnail?id=${f.id}&sz=w${w}`;
  function placeholder(f) {
    const label = f.type === 'video' ? '影片處理中' : '照片處理中';
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 300'><defs><radialGradient id='g' cx='.3' cy='.3'><stop offset='0' stop-color='#8fb4e0' stop-opacity='.7'/><stop offset='1' stop-color='#fffaf0'/></radialGradient></defs><rect width='400' height='300' fill='url(#g)'/>${f.type === 'video' ? '' : `<text x='200' y='160' text-anchor='middle' font-size='26' fill='#1f3f7a' font-family='serif'>${label}</text>`}</svg>`;
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }
  function setImg(img, f, w) {
    img.onload = () => img.classList.add('loaded');
    img.onerror = () => {
      if (!img.dataset.tried && !f.src) { img.dataset.tried = '1'; img.src = urlB(f, w); return; }
      img.onerror = null; img.closest('.frame,.tile')?.classList.add('fallback'); img.src = placeholder(f);
    };
    img.src = urlA(f, w);
  }

  /* ---------- 後端 API ---------- */
  async function apiGet(action) {
    const r = await fetch(`${API}${API.includes('?') ? '&' : '?'}action=${action}&t=${Date.now()}`);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'API 錯誤');
    return j;
  }
  async function apiPost(body) {
    const r = await fetch(API, { method: 'POST', body: JSON.stringify(body) }); // text/plain，避免 CORS 預檢
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || '上傳失敗');
    return j;
  }
  async function loadData() {
    if (!API) { state.files = []; state.loaded = true; updateCounts(); return; }
    try {
      const j = await apiGet('list');
      // 照片在前、影片在後；各自維持拍攝時間順序（sort 為穩定排序）
      state.files = (j.files || []).slice().sort((a, b) => (a.type === 'video') - (b.type === 'video'));
      state.loadError = '';
    } catch (e) {
      console.error(e); state.loadError = '讀取雲端相簿失敗，請稍後重新整理';
      toast(state.loadError, 4000);
    }
    state.loaded = true;
    updateCounts();
    apiGet('ping').then((j) => { state.needKey = !!j.needKey; $('#keyField').hidden = !state.needKey; }).catch(() => {});
  }
  function updateCounts() {
    const imgs = state.files.filter((f) => f.type === 'image').length;
    const vids = state.files.length - imgs;
    let t;
    if (!API) t = '（相簿尚未連接雲端硬碟）';
    else if (state.loadError) t = state.loadError;
    else if (!state.files.length) t = '還沒有照片，歡迎成為第一位分享的人！';
    else t = `共 ${imgs} 張照片${vids ? `・${vids} 段影片` : ''}`;
    $('#splashCount').textContent = t;
    $('#gridCount').textContent = state.files.length ? `（${state.files.length}）` : '';
  }

  /* ---------- 書頁 ---------- */
  const brushSVG = `<svg class="brush-line" viewBox="0 0 200 10" preserveAspectRatio="none"><path d="M2 7 C 50 1, 120 2, 198 5"/></svg>`;
  function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; }
  function wash(i) {
    const w = 45 + rand(i) * 30, h = 30 + rand(i + 1) * 25;
    const l = rand(i + 2) > .5 ? -15 : 100 - w + 15, t = rand(i + 3) > .5 ? -12 : 100 - h + 12;
    return `<div class="wash c${i % 4}" style="width:${w}%;height:${h}%;left:${l}%;top:${t}%"></div>`;
  }
  function coverPage() {
    return el(`<div class="page hard cover-page" data-density="hard"><div class="page-inner">
      <img src="assets/cover.jpg" alt="封面合照">
      <p class="cover-title">電子相簿</p>
      ${brushSVG}
      <p class="cover-sub">${esc(CFG.subtitle || '')}</p>
      <p class="cover-date">${esc(CFG.date || '')}</p>
    </div></div>`);
  }
  function introPage(n) {
    const imgs = state.files.filter((f) => f.type === 'image').length, vids = state.files.length - imgs;
    let body;
    if (!API) body = `<p>相簿尚未連接 Google 雲端硬碟。</p><button class="btn btn-ghost page-btn" data-act="setup">連接雲端硬碟</button>`;
    else if (!state.loaded) body = `<p>正在從雲端整理照片…</p>`;
    else body = `<p>這一天，我們在<span class="em">${esc(CFG.place || '')}</span><br>一起流汗、一起大笑。</p>
      <p>${state.files.length ? `收錄 <span class="em">${imgs}</span> 張照片${vids ? `、<span class="em">${vids}</span> 段影片` : ''}` : '還沒有照片'}</p>
      <p class="small muted">點照片可放大，影片點一下即可播放</p>
      <button class="btn btn-primary page-btn" data-act="upload">＋ 分享我的照片</button>`;
    return el(`<div class="page text-page" data-density="soft" data-idx="1">${wash(97)}<div class="page-inner">
      <h3>${esc(CFG.title || '')}</h3>${brushSVG}${body}</div><span class="page-no">${n}</span></div>`);
  }
  function mediaPage(f, i, idx) {
    let r = f.w && f.h ? f.w / f.h : (f.type === 'video' ? 16 / 9 : 4 / 3);
    r = Math.min(2.2, Math.max(.5, r));
    const rot = ((rand(i * 7) - .5) * 3).toFixed(2);
    const video = f.type === 'video'
      ? `<span class="play-badge"><svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z"/></svg></span>${f.dur ? `<span class="dur-badge">${fmtDur(f.dur)}</span>` : ''}` : '';
    return el(`<div class="page" data-density="soft" data-idx="${idx}">${wash(i)}<div class="page-inner">
      <div class="media-area"><button class="frame" data-i="${i}" style="--r:${r.toFixed(4)};--rot:${rot}deg" aria-label="放大檢視">
        <span class="tape t${i % 3}"></span><img alt="" data-i="${i}">${video}</button></div>
      <div class="caption"><span>${esc(fmtDate(f))}</span><span class="by">${f.by ? '📷 ' + esc(f.by) : ''}</span></div>
    </div><span class="page-no">${idx}</span></div>`);
  }
  function textPage(idx, html) {
    return el(`<div class="page text-page" data-density="soft" data-idx="${idx}">${wash(idx + 50)}<div class="page-inner">${html}</div><span class="page-no">${idx}</span></div>`);
  }
  function backCover() {
    return el(`<div class="page hard text-page" data-density="hard"><div class="page-inner">
      <svg class="heart" viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>
      <h3>謝謝每一位家人</h3>${brushSVG}
      <p>${esc(CFG.subtitle || '')}</p><p class="cover-date">${esc(CFG.date || '')}</p>
    </div></div>`);
  }
  function buildPages() {
    const pages = [coverPage(), introPage(1)];
    state.files.forEach((f, i) => pages.push(mediaPage(f, i, i + 2)));
    if (API && state.loaded && !state.files.length) {
      pages.push(textPage(2, `<h3>等你來分享</h3>${brushSVG}<p>按右上角「上傳」，<br>把今天的照片放進相簿吧！</p><button class="btn btn-primary page-btn" data-act="upload">＋ 上傳照片 / 影片</button>`));
    }
    const endIdx = pages.length;
    pages.push(textPage(endIdx, `<h3>未完待續…</h3>${brushSVG}<p>還有更多精彩畫面嗎？</p><button class="btn btn-primary page-btn" data-act="upload">＋ 上傳照片 / 影片</button><button class="btn btn-ghost page-btn" data-act="grid">一鍵展開全部</button>`));
    if (pages.length % 2 === 0) pages.push(textPage(pages.length, ''));
    pages.push(backCover());
    return pages;
  }

  function buildBook(startPage = 0) {
    const wrap = $('#bookWrap');
    if (state.pf) { try { state.pf.destroy(); } catch (e) {} state.pf = null; }
    wrap.innerHTML = '';
    const book = document.createElement('div');
    book.className = 'book';
    wrap.appendChild(book);
    const pages = buildPages();
    pages.forEach((p) => book.appendChild(p));
    const W = wrap.clientWidth, H = wrap.clientHeight;
    state.portrait = W < H * 1.05;
    startPage = Math.max(0, Math.min(startPage, pages.length - 1));
    const pf = new St.PageFlip(book, {
      width: 700, height: 800, size: 'stretch',
      minWidth: state.portrait ? Math.ceil(W / 2) + 40 : 120, maxWidth: 1600,
      minHeight: 160, maxHeight: 2000,
      showCover: true, usePortrait: true, autoSize: true,
      drawShadow: true, maxShadowOpacity: 0.45, flippingTime: 850,
      mobileScrollSupport: false, clickEventForward: true, swipeDistance: 20,
      showPageCorners: true, startPage
    });
    pf.loadFromHTML(book.querySelectorAll('.page'));
    pf.on('flip', onPageChange);
    pf.on('changeOrientation', onPageChange);
    pf.on('init', onPageChange);
    state.pf = pf;
    book.addEventListener('click', onBookClick);
    onPageChange();
  }

  function onPageChange() {
    const pf = state.pf; if (!pf) return;
    const i = pf.getCurrentPageIndex(), n = pf.getPageCount(), inner = n - 2;
    let label;
    if (i === 0) label = '封面';
    else if (i >= n - 1) label = '封底';
    else if (pf.getOrientation() === 'landscape' && i + 1 <= inner) label = `${i}–${i + 1}　/　${inner} 頁`;
    else label = `${i}　/　${inner} 頁`;
    $('#pageInfo').textContent = label;
    $('#prevPage').disabled = i <= 0;
    $('#nextPage').disabled = i >= n - 1;
    // 只載入附近的照片
    document.querySelectorAll('#bookWrap img[data-i]').forEach((img) => {
      if (img.getAttribute('src')) return;
      const p = +img.closest('.page').dataset.idx;
      if (p >= i - 3 && p <= i + 6) setImg(img, state.files[+img.dataset.i], 1600);
    });
  }

  function onBookClick(e) {
    const frame = e.target.closest('.frame');
    if (frame) { openLightbox(+frame.dataset.i); return; }
    const act = e.target.closest('[data-act]');
    if (act) doAction(act.dataset.act);
  }
  function doAction(a) {
    if (a === 'upload') openUpload();
    else if (a === 'grid') openGrid();
    else if (a === 'setup') openOverlay('#setupDialog');
  }

  /* ---------- 一鍵展開 ---------- */
  function buildGrid() {
    const g = $('#grid'); g.innerHTML = '';
    if (!state.files.length) { g.innerHTML = `<div class="grid-empty">${API ? '還沒有照片或影片，按「上傳」來分享吧！' : '相簿尚未連接雲端硬碟'}</div>`; return; }
    const frag = document.createDocumentFragment();
    state.files.forEach((f, i) => {
      const b = el(`<button class="tile" data-i="${i}" data-type="${f.type}" aria-label="${esc(f.name)}"><img alt="" loading="lazy">${f.type === 'video' ? `<span class="play-badge"><svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z"/></svg></span>${f.dur ? `<span class="dur-badge">${fmtDur(f.dur)}</span>` : ''}` : ''}</button>`);
      setImg(b.querySelector('img'), f, 480);
      frag.appendChild(b);
    });
    g.appendChild(frag);
    applyFilter();
  }
  function applyFilter() {
    document.querySelectorAll('.grid-filters .chip').forEach((c) => c.classList.toggle('active', c.dataset.filter === state.filter));
    document.querySelectorAll('#grid .tile').forEach((t) => t.classList.toggle('hide', state.filter !== 'all' && t.dataset.type !== state.filter));
  }
  function openGrid() {
    if ($('#grid').dataset.built !== String(state.files.length)) { buildGrid(); $('#grid').dataset.built = String(state.files.length); }
    openOverlay('#gridView');
  }

  /* ---------- 大圖 / 影片 ---------- */
  function visibleList() {
    if (isOpen('#gridView') && state.filter !== 'all') return state.files.map((f, i) => i).filter((i) => state.files[i].type === state.filter);
    return state.files.map((f, i) => i);
  }
  function openLightbox(i) { state.lb = i; renderLightbox(); openOverlay('#lightbox'); }
  function renderLightbox() {
    const f = state.files[state.lb]; if (!f) return;
    const body = $('#lbBody'); body.innerHTML = '';
    if (f.type === 'image') {
      const img = new Image(); img.alt = f.name; setImg(img, f, 2400); body.appendChild(img);
    } else if (f.src) {
      const v = document.createElement('video'); v.src = f.src; v.controls = true; v.style.maxHeight = '100%'; v.style.maxWidth = '100%'; body.appendChild(v);
    } else {
      const fr = document.createElement('iframe');
      fr.src = `https://drive.google.com/file/d/${f.id}/preview`;
      fr.allow = 'autoplay; fullscreen'; fr.allowFullscreen = true;
      if (f.h > f.w) fr.classList.add('portrait');
      body.appendChild(fr);
    }
    const list = visibleList(), pos = list.indexOf(state.lb);
    $('#lbCaption').textContent = `${pos + 1} / ${list.length}　${fmtDate(f)}${f.by ? '　📷 ' + f.by : ''}${f.type === 'video' ? '　（剛上傳的影片需數分鐘處理才能播放）' : ''}`;
    $('#lbDownload').href = f.src || `https://drive.google.com/uc?export=download&id=${f.id}`;
    $('#lbPrev').disabled = pos <= 0; $('#lbNext').disabled = pos >= list.length - 1;
  }
  function lbStep(d) {
    const list = visibleList(), pos = list.indexOf(state.lb), np = pos + d;
    if (np < 0 || np >= list.length) return;
    state.lb = list[np]; renderLightbox();
  }
  function closeLightbox() { closeOverlay('#lightbox'); $('#lbBody').innerHTML = ''; }

  /* ---------- 上傳 ---------- */
  let queue = [];
  const EXT = /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?|mp4|mov|m4v|webm|avi|3gp|mkv)$/i;
  function guessMime(file) {
    if (file.type) return file.type;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    return ({ heic: 'image/heic', heif: 'image/heif', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', mov: 'video/quicktime', mp4: 'video/mp4', m4v: 'video/mp4', '3gp': 'video/3gpp', avi: 'video/x-msvideo', mkv: 'video/x-matroska', webm: 'video/webm' })[ext] || 'application/octet-stream';
  }
  function openUpload() {
    if (!API) { openOverlay('#setupDialog'); return; }
    $('#upName').value = localStorage.getItem('albumName') || '';
    $('#upKey').value = localStorage.getItem('albumKey') || '';
    $('#keyField').hidden = !state.needKey;
    openOverlay('#uploadDialog');
  }
  function addFiles(list) {
    if (state.uploading) return;
    for (const file of list) {
      const mime = guessMime(file);
      if (!/^(image|video)\//.test(mime) && !EXT.test(file.name)) continue;
      if (queue.some((q) => q.file.name === file.name && q.file.size === file.size)) continue;
      queue.push({ file, mime, status: 'wait', progress: 0 });
    }
    renderQueue();
  }
  function renderQueue() {
    const ul = $('#uploadList'); ul.innerHTML = '';
    queue.forEach((q) => {
      const isImg = q.mime.startsWith('image/') && !/hei[cf]/.test(q.mime);
      const li = el(`<li class="${q.status === 'done' ? 'done' : q.status === 'err' ? 'err' : ''}">
        ${isImg ? '<img class="thumb" alt="">' : `<span class="thumb">${q.mime.startsWith('video/') ? '🎬' : '🖼️'}</span>`}
        <span class="name">${esc(q.file.name)}</span>
        <span class="stat">${q.status === 'done' ? '✓ 完成' : q.status === 'err' ? '✗ ' + esc(q.err || '失敗') : q.status === 'up' ? Math.round(q.progress * 100) + '%' : fmtSize(q.file.size)}</span>
        <span class="bar"><i style="width:${q.status === 'done' ? 100 : q.progress * 100}%"></i></span></li>`);
      if (isImg) { if (!q.thumb) q.thumb = URL.createObjectURL(q.file); li.querySelector('img').src = q.thumb; }
      q.li = li; ul.appendChild(li);
    });
    const pending = queue.filter((q) => q.status === 'wait' || q.status === 'err');
    const total = pending.reduce((s, q) => s + q.file.size, 0);
    $('#startUpload').disabled = state.uploading || !pending.length;
    $('#startUpload').textContent = state.uploading ? '上傳中…' : pending.length ? `開始上傳（${pending.length} 個，${fmtSize(total)}）` : '開始上傳';
    if (!state.uploading) $('#uploadNote').textContent = queue.some((q) => q.mime.startsWith('video/')) ? '影片檔較大，上傳時請保持此頁面開啟、螢幕不要關閉。' : '';
  }
  function updateItem(q) {
    if (!q.li) return;
    q.li.querySelector('.stat').textContent = q.status === 'done' ? '✓ 完成' : q.status === 'err' ? '✗ ' + (q.err || '失敗') : Math.round(q.progress * 100) + '%';
    q.li.querySelector('.bar i').style.width = (q.status === 'done' ? 100 : q.progress * 100) + '%';
    q.li.className = q.status === 'done' ? 'done' : q.status === 'err' ? 'err' : '';
  }
  function readB64(blob) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result).split(',')[1] || '');
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(blob);
    });
  }
  async function withRetry(fn, tries = 3) {
    let last;
    for (let k = 0; k < tries; k++) {
      try { return await fn(); } catch (e) {
        last = e;
        if (/BAD_KEY|只接受|大小不符|過期/.test(e.message)) throw e;
        await new Promise((r) => setTimeout(r, 1500 * (k + 1)));
      }
    }
    throw last;
  }
  async function uploadOne(q, uploader, key) {
    q.status = 'up'; q.progress = 0; updateItem(q);
    const init = await withRetry(() => apiPost({ action: 'init', name: q.file.name, mimeType: q.mime, size: q.file.size, uploader, key }));
    let start = 0, res;
    while (start < q.file.size) {
      const end = Math.min(start + CHUNK, q.file.size);
      const data = await readB64(q.file.slice(start, end));
      const s = start;
      res = await withRetry(() => apiPost({ action: 'chunk', uploadId: init.uploadId, start: s, data }));
      start = res.done ? q.file.size : (res.next ?? end);
      q.progress = start / q.file.size; updateItem(q);
    }
    q.status = 'done'; q.id = res && res.id; updateItem(q);
  }
  async function startUpload() {
    const uploader = $('#upName').value.trim();
    const key = $('#upKey').value.trim();
    localStorage.setItem('albumName', uploader);
    if (key) localStorage.setItem('albumKey', key);
    if (state.needKey && !key) { toast('請輸入上傳通關密語'); $('#upKey').focus(); return; }
    state.uploading = true; renderQueue();
    const ids = [];
    let fails = 0;
    for (const q of queue) {
      if (q.status === 'done') continue;
      try {
        await uploadOne(q, uploader, key);
        ids.push(q.id);
      } catch (e) {
        q.status = 'err'; q.err = /BAD_KEY/.test(e.message) ? '通關密語不正確' : e.message.slice(0, 40); updateItem(q); fails++;
        if (/BAD_KEY/.test(e.message)) { state.needKey = true; $('#keyField').hidden = false; localStorage.removeItem('albumKey'); break; }
      }
      $('#uploadNote').textContent = `已完成 ${queue.filter((x) => x.status === 'done').length} / ${queue.length}`;
    }
    state.uploading = false; renderQueue();
    if (ids.length) {
      toast(`上傳完成 ${ids.length} 個檔案，謝謝分享！${fails ? `（${fails} 個失敗）` : ''}`, 3500);
      await refreshAfterUpload(ids);
    } else if (fails) toast('上傳失敗，請檢查網路後再試一次', 3500);
  }
  async function refreshAfterUpload(ids) {
    await loadData();
    $('#grid').dataset.built = '';
    if ($('#album').classList.contains('active')) {
      const idx = state.files.findIndex((f) => ids.includes(f.id));
      buildBook(idx >= 0 ? idx + 2 : 0);
    }
    if (queue.every((q) => q.status === 'done')) setTimeout(() => { closeOverlay('#uploadDialog'); queue = []; renderQueue(); }, 900);
  }

  /* ---------- 畫面切換 ---------- */
  function showAlbum() {
    $('#splash').classList.remove('active');
    $('#album').classList.add('active');
    requestAnimationFrame(() => {
      buildBook(state.pf ? state.pf.getCurrentPageIndex() : 0);
      if (innerHeight > innerWidth) {
        $('#fsLandscape').hidden = !(document.documentElement.requestFullscreen && screen.orientation && screen.orientation.lock);
        openOverlay('#rotateHint');
      } else toast('左右滑動、或點書頁邊緣即可翻頁', 3200);
    });
  }
  function showCover() {
    if (document.body.classList.contains('immersive')) exitImmersive();
    $('#album').classList.remove('active');
    $('#splash').classList.add('active');
  }

  /* ---------- 事件 ---------- */
  $('#openBook').addEventListener('click', showAlbum);
  $('#toCover').addEventListener('click', showCover);
  $('#prevPage').addEventListener('click', () => state.pf && state.pf.flipPrev());
  $('#nextPage').addEventListener('click', () => state.pf && state.pf.flipNext());
  $('#openGrid').addEventListener('click', openGrid);
  $('#closeGrid').addEventListener('click', () => closeOverlay('#gridView'));
  $('#openUpload').addEventListener('click', openUpload);
  $('#closeUpload').addEventListener('click', () => { if (state.uploading && !confirm('還在上傳中，確定要關閉嗎？（上傳會繼續在背景進行）')) return; closeOverlay('#uploadDialog'); });
  $('#closeSetup').addEventListener('click', () => closeOverlay('#setupDialog'));
  $('#dismissRotate').addEventListener('click', () => closeOverlay('#rotateHint'));
  $('#fsLandscape').addEventListener('click', () => { closeOverlay('#rotateHint'); enterImmersive(true); });

  /* ---------- 全螢幕觀賞 ---------- */
  const DE = document.documentElement;
  const canFS = !!(DE.requestFullscreen || DE.webkitRequestFullscreen);
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
  const isStandalone = () => navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  function relayout() {
    clearTimeout(relayout.t);
    relayout.t = setTimeout(() => { if ($('#album').classList.contains('active') && state.pf) buildBook(state.pf.getCurrentPageIndex()); }, 320);
  }
  async function enterImmersive(landscape) {
    document.body.classList.add('immersive');
    if (canFS && !fsEl()) {
      try { if (DE.requestFullscreen) await DE.requestFullscreen({ navigationUI: 'hide' }); else DE.webkitRequestFullscreen(); } catch (e) {}
    }
    if (landscape) {
      try { await screen.orientation.lock('landscape'); } catch (e) { toast('此裝置不支援自動轉向，請手動將手機轉為橫向'); }
    } else if (!canFS && !isStandalone()) {
      let seen = false; try { seen = !!localStorage.getItem('fsTip'); localStorage.setItem('fsTip', '1'); } catch (e) {}
      if (!seen) toast('小技巧：Safari 按「分享 → 加入主畫面」，從主畫面開啟就沒有網址列，畫面更大', 6000);
    }
    relayout();
  }
  function exitImmersive() {
    document.body.classList.remove('immersive');
    try { screen.orientation.unlock(); } catch (e) {}
    if (fsEl()) { try { const p = (document.exitFullscreen || document.webkitExitFullscreen).call(document); if (p && p.catch) p.catch(() => {}); } catch (e) {} }
    relayout();
  }
  $('#openFull').addEventListener('click', () => enterImmersive(false));
  $('#exitFull').addEventListener('click', exitImmersive);
  ['fullscreenchange', 'webkitfullscreenchange'].forEach((t) => document.addEventListener(t, () => {
    // 使用者用系統手勢 / Esc 離開全螢幕時，一併恢復工具列
    if (!fsEl() && document.body.classList.contains('immersive')) { document.body.classList.remove('immersive'); relayout(); }
  }));
  document.querySelectorAll('.grid-filters .chip').forEach((c) => c.addEventListener('click', () => { state.filter = c.dataset.filter; applyFilter(); }));
  $('#grid').addEventListener('click', (e) => { const t = e.target.closest('.tile'); if (t) openLightbox(+t.dataset.i); });
  $('#lbClose').addEventListener('click', closeLightbox);
  $('#lbPrev').addEventListener('click', () => lbStep(-1));
  $('#lbNext').addEventListener('click', () => lbStep(1));
  $('#lbToBook').addEventListener('click', () => {
    const i = state.lb; closeLightbox(); closeOverlay('#gridView');
    if (!$('#album').classList.contains('active')) showAlbum();
    setTimeout(() => { if (state.pf) { state.pf.turnToPage(i + 2); onPageChange(); } }, 80);
  });
  // 大圖滑動切換
  let tx = null;
  $('#lightbox').addEventListener('touchstart', (e) => { tx = e.touches[0].clientX; }, { passive: true });
  $('#lightbox').addEventListener('touchend', (e) => {
    if (tx === null) return; const dx = e.changedTouches[0].clientX - tx; tx = null;
    if (Math.abs(dx) > 50) lbStep(dx < 0 ? 1 : -1);
  });

  // 上傳：選檔 / 拖曳
  $('#fileInput').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  const dz = $('#dropzone');
  ['dragenter', 'dragover'].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
  $('#startUpload').addEventListener('click', startUpload);
  $('#clearUpload').addEventListener('click', () => { if (state.uploading) return; queue = []; renderQueue(); });
  window.addEventListener('beforeunload', (e) => { if (state.uploading) { e.preventDefault(); e.returnValue = ''; } });

  // 連接雲端
  $('#saveApi').addEventListener('click', async () => {
    const v = $('#apiInput').value.trim();
    if (!/^https:\/\/script\.google(usercontent)?\.com\/.+/.test(v)) { toast('網址格式不正確，應為 https://script.google.com/macros/s/…/exec'); return; }
    API = v; localStorage.setItem('albumApi', v);
    closeOverlay('#setupDialog'); toast('連接中…');
    await loadData(); $('#grid').dataset.built = '';
    if ($('#album').classList.contains('active')) buildBook(0);
    if (!state.loadError) toast('已連接雲端硬碟 ✓');
  });

  // 鍵盤
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (isOpen('#lightbox')) {
      if (e.key === 'ArrowLeft') lbStep(-1); else if (e.key === 'ArrowRight') lbStep(1); else if (e.key === 'Escape') closeLightbox();
      return;
    }
    if (e.key === 'Escape') {
      const open = ['#gridView', '#uploadDialog', '#setupDialog', '#rotateHint'].filter(isOpen);
      if (open.length) open.forEach((s) => !state.uploading && closeOverlay(s));
      else if (document.body.classList.contains('immersive')) exitImmersive();
      return;
    }
    if (!$('#album').classList.contains('active') || !state.pf) return;
    if (e.key === 'f' || e.key === 'F') { document.body.classList.contains('immersive') ? exitImmersive() : enterImmersive(false); return; }
    if (e.key === 'ArrowLeft') state.pf.flipPrev(); else if (e.key === 'ArrowRight') state.pf.flipNext();
  });

  // 轉向：直/橫切換時重排書本
  let rt;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      const landscape = innerWidth > innerHeight;
      if (landscape && isOpen('#rotateHint')) { closeOverlay('#rotateHint'); toast('👍 橫式觀賞，翻頁更有感'); }
      if (!$('#album').classList.contains('active') || !state.pf) return;
      const wrap = $('#bookWrap');
      const portrait = wrap.clientWidth < wrap.clientHeight * 1.05;
      if (portrait !== state.portrait) buildBook(state.pf.getCurrentPageIndex());
    }, 250);
  });

  /* ---------- 啟動 ---------- */
  loadData().then(() => {
    if ($('#album').classList.contains('active')) buildBook(state.pf ? state.pf.getCurrentPageIndex() : 0);
  });
})();
