// PWA 対応: Service Worker の登録、更新通知、保存領域の永続化要求
(function () {
  'use strict';

  // 端末のストレージ不足時でも保存データが自動削除されにくくなるよう、永続化を要求する
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().then((granted) => {
      console.log(`ストレージの永続化: ${granted ? '許可' : '未許可'}`);
    }).catch(() => {});
  }

  if (!('serviceWorker' in navigator)) {
    console.warn('この環境は Service Worker 非対応のため、オフライン起動はできません');
    return;
  }

  const banner = document.getElementById('update-banner');
  const reloadBtn = document.getElementById('update-reload-btn');
  let waitingWorker = null;

  function showUpdateBanner(worker) {
    waitingWorker = worker;
    if (banner) banner.hidden = false;
  }

  if (reloadBtn) {
    reloadBtn.addEventListener('click', () => {
      if (waitingWorker) {
        waitingWorker.postMessage({ type: 'SKIP_WAITING' });
      } else {
        window.location.reload();
      }
    });
  }

  // 新しいService Workerに切り替わったら再読み込み（状態は保存済みなので、続きから再開される）
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    // 初回インストール時（以前のcontrollerなし）は再読み込み不要
    if (!window.__hadController) return;
    reloading = true;
    window.location.reload();
  });
  window.__hadController = !!navigator.serviceWorker.controller;

  // 更新の確認。ホーム画面のアプリ（特に iPad）は、閉じても終了せず、バックグラウンドから戻るだけのことが多く、
  // その場合は load が起きないので、「画面が前面に戻ったとき」にも確認する（間隔をあけた定期確認はしない）。
  // 短時間に何度も呼ばないよう、前回の確認から 30 秒以内は無視する
  let swRegistration = null;
  let lastCheck = 0;
  function checkForUpdate() {
    if (!swRegistration) return;
    const now = Date.now();
    if (now - lastCheck < 30 * 1000) return;
    lastCheck = now;
    swRegistration.update().catch(() => {}); // オフライン時は失敗しても問題なし
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate();
  });
  // ブラウザの「戻る／進む」キャッシュから復元されたときも確認する
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) checkForUpdate();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      // updateViaCache: 'none' … sw.js だけでなく、sw.js が読み込む version.js も、ブラウザの HTTP キャッシュを通さず、
      // 毎回サーバーの最新を確認する（GitHub Pages のキャッシュ期間のあいだ、古い version.js で「変更なし」と
      // 判定されるのを防ぐ）
      .register('sw.js', { updateViaCache: 'none' })
      .then((registration) => {
        swRegistration = registration;
        // 起動のたびに更新を確認（オフライン時は失敗しても問題なし）
        lastCheck = Date.now();
        registration.update().catch(() => {});

        if (registration.waiting && navigator.serviceWorker.controller) {
          showUpdateBanner(registration.waiting);
        }

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdateBanner(installing);
            }
          });
        });
      })
      .catch((err) => console.error('Service Worker の登録に失敗しました:', err));
  });
})();
