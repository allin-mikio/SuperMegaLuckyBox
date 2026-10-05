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

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('sw.js')
      .then((registration) => {
        // 起動のたびに更新を確認（オフライン時は失敗しても問題なし）
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
