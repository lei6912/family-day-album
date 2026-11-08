// 電子相簿設定
// apiUrl：Google Apps Script「網頁應用程式網址」（結尾是 /exec）
window.ALBUM_CONFIG = {
  apiUrl: 'https://script.google.com/macros/s/AKfycbxOZGTusNf-rmqepnWTMdRcf5xgHQZL4dbb-nXq5boxZj95DGX7ZdSQ5gZOh4E5oyxAlw/exec',
  title: '中正大學 國三忠 家庭日',
  subtitle: '福智國中 · 國三忠班',
  date: '2026.11.08',
  place: '國立中正大學',
  chunkMB: 5,
  // driveApiKey：Google Cloud「API 金鑰」（限 Drive API、限 lei6912.github.io）。
  // 填了之後影片改用手機內建播放器播放；留空則用 Google 雲端播放器。
  driveApiKey: ''
};
