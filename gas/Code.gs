/**
 * 國三忠 家庭日 電子相簿 — Google Apps Script 後端
 * 照片/影片都存放在部署者（lei6912@gmail.com）的 Google 雲端硬碟資料夾。
 *
 * 部署步驟（只需做一次）：
 *  1. 到 https://script.google.com 新增專案，把本檔全部內容貼上，存檔。
 *  2. 上方函式選單選「setup」→ 按「執行」→ 依指示授權（會建立相簿資料夾）。
 *  3. 右上「部署」→「新增部署作業」→ 類型「網頁應用程式」
 *       執行身分：我　／　誰可以存取：所有人 → 部署 → 複製「網頁應用程式網址」。
 *  4. 把網址填進網站的 config.js（或交給 Claude 幫你更新）。
 *
 * 選用：設定上傳通關密語 → 專案設定 → 指令碼屬性 → 新增 UPLOAD_KEY。
 */

var FOLDER_NAME = '國三忠 家庭日 電子相簿 2026.11.08';
var MAX_BYTES = 2 * 1024 * 1024 * 1024; // 單檔上限 2GB

/** 在編輯器手動執行一次：建立資料夾並完成授權 */
function setup() {
  var folder = getFolder_();
  Logger.log('相簿資料夾：' + folder.getName());
  Logger.log('資料夾網址：' + folder.getUrl());
  Logger.log('完成！接著請「部署 → 新增部署作業 → 網頁應用程式」。');
}

function getFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('FOLDER_ID');
  var folder = null;
  if (id) {
    try { folder = DriveApp.getFolderById(id); if (folder.isTrashed()) folder = null; } catch (e) { folder = null; }
  }
  if (!folder) {
    folder = DriveApp.createFolder(FOLDER_NAME);
    props.setProperty('FOLDER_ID', folder.getId());
    // 讓照片可被相簿網頁顯示（知道連結者可檢視；資料夾內新增的檔案會繼承）
    try { folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  }
  return folder;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || 'list';
    if (action === 'list') return json_(listFiles_());
    if (action === 'ping') return json_({ ok: true, needKey: !!PropertiesService.getScriptProperties().getProperty('UPLOAD_KEY') });
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function listFiles_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('list');
  if (cached) return JSON.parse(cached);

  var folder = getFolder_();
  var token = ScriptApp.getOAuthToken();
  var files = [];
  var pageToken = '';
  do {
    var url = 'https://www.googleapis.com/drive/v3/files?pageSize=1000' +
      '&q=' + encodeURIComponent("'" + folder.getId() + "' in parents and trashed=false and (mimeType contains 'image/' or mimeType contains 'video/')") +
      '&fields=' + encodeURIComponent('nextPageToken,files(id,name,mimeType,createdTime,description,size,imageMediaMetadata(time,width,height,rotation),videoMediaMetadata(width,height,durationMillis))') +
      (pageToken ? '&pageToken=' + pageToken : '');
    var res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('Drive list failed: ' + res.getContentText());
    var data = JSON.parse(res.getContentText());
    (data.files || []).forEach(function (f) {
      var meta = f.imageMediaMetadata || f.videoMediaMetadata || {};
      var w = meta.width, h = meta.height;
      if (f.imageMediaMetadata && (meta.rotation === 1 || meta.rotation === 3)) { var t = w; w = h; h = t; }
      files.push({
        id: f.id,
        name: f.name,
        type: f.mimeType.indexOf('video/') === 0 ? 'video' : 'image',
        mime: f.mimeType,
        taken: exifTime_(meta.time) || f.createdTime,
        uploaded: f.createdTime,
        by: f.description || '',
        w: w || 0,
        h: h || 0,
        dur: meta.durationMillis ? Number(meta.durationMillis) : 0
      });
    });
    pageToken = data.nextPageToken || '';
  } while (pageToken);

  files.sort(function (a, b) { return a.taken < b.taken ? -1 : a.taken > b.taken ? 1 : 0; });
  var out = { ok: true, count: files.length, files: files, folderUrl: folder.getUrl() };
  try { cache.put('list', JSON.stringify(out), 30); } catch (e) {}
  return out;
}

// "2026:11:08 10:23:11" -> "2026-11-08T10:23:11"
function exifTime_(t) {
  if (!t) return '';
  var m = String(t).match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  return m ? m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6] + '+08:00' : '';
}

function checkKey_(key) {
  var need = PropertiesService.getScriptProperties().getProperty('UPLOAD_KEY');
  if (need && String(key || '').trim() !== need.trim()) throw new Error('BAD_KEY');
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.action === 'init') return json_(initUpload_(body));
    if (body.action === 'chunk') return json_(uploadChunk_(body));
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

/** 建立 Drive 可續傳上傳工作階段（session URL 只留在伺服器端快取） */
function initUpload_(b) {
  checkKey_(b.key);
  var mime = String(b.mimeType || '');
  if (!/^(image|video)\//.test(mime)) throw new Error('只接受照片或影片');
  var size = Number(b.size);
  if (!(size > 0) || size > MAX_BYTES) throw new Error('檔案大小不符');

  var folder = getFolder_();
  var by = String(b.uploader || '').slice(0, 40);
  var meta = { name: String(b.name || 'upload').slice(0, 200), parents: [folder.getId()], mimeType: mime };
  if (by) meta.description = by;

  var res = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id', {
    method: 'post',
    contentType: 'application/json; charset=UTF-8',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(size) },
    payload: JSON.stringify(meta),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('init failed: ' + res.getContentText());
  var headers = res.getAllHeaders();
  var location = headers.Location || headers.location;
  var uid = Utilities.getUuid();
  CacheService.getScriptCache().put('up_' + uid, JSON.stringify({ url: location, size: size }), 21600);
  return { ok: true, uploadId: uid };
}

function uploadChunk_(b) {
  var cache = CacheService.getScriptCache();
  var raw = cache.get('up_' + b.uploadId);
  if (!raw) throw new Error('上傳工作階段已過期，請重新上傳');
  var sess = JSON.parse(raw);
  var bytes = Utilities.base64Decode(b.data);
  var start = Number(b.start);
  var end = start + bytes.length - 1;

  var res = UrlFetchApp.fetch(sess.url, {
    method: 'put',
    contentType: 'application/octet-stream',
    headers: { 'Content-Range': 'bytes ' + start + '-' + end + '/' + sess.size },
    payload: bytes,
    muteHttpExceptions: true,
    followRedirects: false
  });
  var code = res.getResponseCode();
  if (code === 308) return { ok: true, done: false, next: end + 1 };
  if (code === 200 || code === 201) {
    var f = JSON.parse(res.getContentText());
    try { DriveApp.getFileById(f.id).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
    cache.remove('up_' + b.uploadId);
    cache.remove('list');
    return { ok: true, done: true, id: f.id };
  }
  throw new Error('chunk failed (' + code + '): ' + res.getContentText().slice(0, 300));
}
