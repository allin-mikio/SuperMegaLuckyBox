/*
 * スタッフモード / ユーザーモードの切り替え
 *
 *  - 画面の流れ: タイトル画面 → スタッフモード ←→ ユーザーモード
 *    タイトル画面は、初回起動時とオールリセット後に表示する（スタッフモードに入るまで続く）
 *  - 起動直後は、タイトル画面でなければユーザーモード（スタッフモードの状態は保存しない）
 *  - スタッフモードへ入る: 画面右上のバージョン表示（ver.x.xx.xx）を長押し → 暗証番号を入力
 *    （タイトル画面にも同じバージョン表示があり、同じ操作で入る）
 *  - スタッフモードから戻る: ①帯の「ユーザーモード(謎解きパート / ビンゴパート)に戻る」ボタン（手動。戻る先を選ぶ）
 *                            ②一定時間操作がなければ自動で戻る（スタッフモードに入る前のパートへ）
 *  - スタッフ専用の部品は、HTML側で class="staff-only" を付けたもの
 *    （ユーザーモードでは非表示。表示の切り替えは CSS: body.staff-mode）
 *
 * 注意: 暗証番号はこのファイル（公開されるソース）に書かれるため、誤操作を防ぐためのものであり、
 *       悪意のある利用者を防ぐ仕組みではない。
 */
(function () {
  'use strict';

  // 暗証番号を変更する場合は、ここを書き換える（数字。桁数は自由。入力欄の桁数もこの長さに合わせる）
  const STAFF_PIN = '413';
  // バージョン表示の長押し時間（ミリ秒）
  const LONG_PRESS_MS = 600;
  // スタッフモードで無操作が続いたときに、自動でユーザーモードへ戻るまでの時間（ミリ秒）
  const config = { idleMs: 1 * 60 * 1000 };

  const body = document.body;
  // 長押しする場所（右上のバージョン表示。本体側とタイトル画面側の両方）
  const badges = document.querySelectorAll('.version-badge');
  const titleScreen = document.getElementById('title-screen');
  const banner = document.getElementById('staff-banner');
  const countdown = document.getElementById('staff-countdown');
  const overlay = document.getElementById('staff-pin-overlay');
  const form = document.getElementById('staff-pin-form');
  const pinInput = document.getElementById('staff-pin-input');
  const pinError = document.getElementById('staff-pin-error');
  const pinCancel = document.getElementById('staff-pin-cancel');

  // 入力できる桁数は、暗証番号の長さに合わせる（HTML側には書かない）
  pinInput.maxLength = STAFF_PIN.length;

  let isStaff = false;
  let deadline = 0;
  let tickTimer = null;

  /* ---------------- タイトル画面 ----------------
   *  初期化時（初回起動）・オールリセット時に表示する。
   *  タイトル画面 → （バージョン長押し + 暗証番号）→ スタッフモード ←→ ユーザーモード
   *  スタッフモードに入るまでは、再読み込みしてもタイトル画面のまま。
   */
  const TITLE_KEY = 'luckybox.title.v1'; // 'pending' = 表示する / 'done' = 表示済み

  function readTitleFlag() {
    try {
      return window.localStorage.getItem(TITLE_KEY);
    } catch (err) {
      return null;
    }
  }

  function writeTitleFlag(value) {
    try {
      window.localStorage.setItem(TITLE_KEY, value);
    } catch (err) {
      // 保存できなくても動作は続ける
    }
  }

  function setTitleVisible(on) {
    titleScreen.hidden = !on;
    body.classList.toggle('title-active', on);
    if (on) window.scrollTo(0, 0);
  }

  function shouldShowTitleAtStartup() {
    const flag = readTitleFlag();
    if (flag === 'pending') return true;
    if (flag === 'done') return false;
    // 記録がないとき: 保存済みのゲームが無い（初回起動）場合だけ表示する。
    // すでに進行中のゲームがある端末を更新したときに、いきなりタイトルが出ないようにする。
    try {
      return !window.LuckyBoxEngine.getApi().restored;
    } catch (err) {
      return false;
    }
  }

  function showTitle() {
    setStaffMode(false);
    closePinDialog();
    writeTitleFlag('pending');
    setTitleVisible(true);
  }

  /* ---------------- モード切り替え ---------------- */
  function setStaffMode(on) {
    const changed = isStaff !== on;
    isStaff = on;
    body.classList.toggle('staff-mode', on);
    banner.hidden = !on;
    // 入った/出たことを他のスクリプト（game.js）へ知らせる
    if (changed) {
      document.dispatchEvent(new CustomEvent('staffmodechange', { detail: { on } }));
    }

    if (on) {
      resetIdleDeadline();
      updateCountdown();
      tickTimer = setInterval(tick, 500);
    } else {
      clearInterval(tickTimer);
      tickTimer = null;
      countdown.textContent = '';
    }
  }

  /* ---------------- 無操作タイマー ---------------- */
  function resetIdleDeadline() {
    deadline = Date.now() + config.idleMs;
  }

  function updateCountdown() {
    const remaining = Math.max(0, deadline - Date.now());
    const sec = Math.ceil(remaining / 1000);
    const mm = Math.floor(sec / 60);
    const ss = String(sec % 60).padStart(2, '0');
    countdown.textContent = `無操作であと ${mm}:${ss} で自動的に戻ります`;
  }

  function tick() {
    // 端末のスリープ中はタイマーが止まるが、時刻で判定するので復帰時に正しく戻る
    if (Date.now() >= deadline) {
      setStaffMode(false);
      return;
    }
    updateCountdown();
  }

  ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach((type) => {
    document.addEventListener(
      type,
      () => {
        if (isStaff) resetIdleDeadline();
      },
      { capture: true, passive: true }
    );
  });

  // 戻るボタンは2つ（謎解きパート / ビンゴパート）。戻る先のパートを game.js へ知らせてから、ユーザーモードへ戻る
  document.querySelectorAll('[data-exit-part]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('staffexitpart', { detail: { part: btn.dataset.exitPart } }));
      setStaffMode(false);
    });
  });

  /* ---------------- 暗証番号ダイアログ ---------------- */
  // 長押しが成立した直後は、まだ指が画面に触れている。
  // タブレットのブラウザは「ユーザーの操作（指を離す・タップする）」の中で focus() しないと
  // ソフトウェアキーボードを出さないので、指を離した瞬間にもう一度フォーカスする。
  let focusOnNextRelease = false;

  function focusPinInput() {
    // 一度外してからフォーカスし直す（すでにフォーカス済みだとキーボードが出ない端末があるため）
    pinInput.blur();
    pinInput.focus();
  }

  function openPinDialog() {
    if (isStaff) return;
    pinInput.value = '';
    pinError.hidden = true;
    overlay.hidden = false;
    pinInput.focus(); // PCでは、これだけで入力できる状態になる
    focusOnNextRelease = true;
  }

  // 指（マウス）を離したとき、ダイアログが開いていればキーボードを出す
  document.addEventListener(
    'pointerup',
    () => {
      if (focusOnNextRelease && !overlay.hidden) {
        focusOnNextRelease = false;
        focusPinInput();
      }
    },
    true
  );

  // キーボードが閉じてしまったときは、ダイアログの空き部分をタップすれば出せる
  overlay.addEventListener('click', (event) => {
    if (event.target === pinCancel) return;
    pinInput.focus();
  });

  function closePinDialog() {
    focusOnNextRelease = false;
    overlay.hidden = true;
    pinInput.value = '';
    pinError.hidden = true;
    pinInput.blur();
  }

  // 暗証番号を判定する（桁数がそろったら自動で呼ばれる。Enterキーでも呼ばれる）
  function checkPin() {
    if (overlay.hidden) return;
    if (pinInput.value === STAFF_PIN) {
      closePinDialog();
      // タイトル画面からの場合は、ここでタイトル画面を終える
      const fromTitle = !titleScreen.hidden;
      writeTitleFlag('done');
      setTitleVisible(false);
      setStaffMode(true);
      // 入った直後に、game.js が yes / no を聞く（タイトル画面から来たかどうかも知らせる）
      document.dispatchEvent(new CustomEvent('staffentered', { detail: { fromTitle } }));
    } else {
      pinError.hidden = false;
      pinInput.value = '';
      pinInput.focus();
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    checkPin();
  });

  pinInput.addEventListener('input', () => {
    // 数字以外は入力させない
    pinInput.value = pinInput.value.replace(/[^0-9]/g, '');
    pinError.hidden = true;
    // 桁数がそろったら、OKを押さなくても自動で判定する
    // （最後の1桁が「●」と表示されるのが見えるよう、少しだけ待つ）
    if (pinInput.value.length === STAFF_PIN.length) {
      setTimeout(checkPin, 150);
    }
  });

  pinCancel.addEventListener('click', closePinDialog);

  /* ---------------- バージョン表示の長押し ---------------- */
  let pressTimer = null;
  let pressStart = null;

  function cancelPress() {
    clearTimeout(pressTimer);
    pressTimer = null;
    pressStart = null;
  }

  badges.forEach((badge) => {
    badge.addEventListener('pointerdown', (event) => {
      if (isStaff) return;
      pressStart = { x: event.clientX, y: event.clientY };
      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => {
        pressTimer = null;
        openPinDialog();
      }, LONG_PRESS_MS);
    });

    badge.addEventListener('pointermove', (event) => {
      // 指が大きくずれたら（スクロール操作など）長押しではないとみなす
      if (!pressStart) return;
      const dx = event.clientX - pressStart.x;
      const dy = event.clientY - pressStart.y;
      if (dx * dx + dy * dy > 20 * 20) cancelPress();
    });

    ['pointerup', 'pointercancel', 'pointerleave'].forEach((type) => badge.addEventListener(type, cancelPress));

    // 長押し時の文字選択・コンテキストメニューを出さない
    badge.addEventListener('contextmenu', (event) => event.preventDefault());
  });

  /* ---------------- 公開（テスト・他スクリプト用） ---------------- */
  window.StaffMode = {
    isStaff: () => isStaff,
    exit: () => setStaffMode(false),
    // オールリセット後に game.js から呼ぶ。スタッフモードを終えてタイトル画面へ戻る
    showTitle,
    isTitleShown: () => !titleScreen.hidden,
    config,
  };

  // 起動時: 初回起動、またはリセット後でスタッフモードに入っていなければタイトル画面から始める
  if (shouldShowTitleAtStartup()) setTitleVisible(true);
})();
