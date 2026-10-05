/*
 * JS版エンジンのテスト。ブラウザ（ヘッドレス Edge/Chrome）で tests/run.html を開いて実行する。
 *
 * 1. Flask版が出力した操作列 (golden.js) を JS版に再生し、全ステップの応答が一致するか検証
 *    - 一定ステップごとに「保存 -> 新しいエンジンで復元」して続行し、再開しても挙動が変わらないことも検証
 * 2. 保存データの破損・片方のスロット欠損・保存不可環境のふるまいを検証
 */
(function () {
  const out = [];
  const log = (s) => out.push(s);
  let failures = 0;

  const { LocalApi, cyrb53, StateStore } = window.LuckyBoxEngine;

  function normalize(value) {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') {
      const res = {};
      for (const k of Object.keys(value).sort()) {
        if (k === 'timestamp') continue;
        let nv = normalize(value[k]);
        if (k === 'activated_bonuses' && Array.isArray(nv)) {
          nv = nv.slice().sort((a, b) => {
            const sa = JSON.stringify(a);
            const sb = JSON.stringify(b);
            return sa < sb ? -1 : sa > sb ? 1 : 0;
          });
        }
        res[k] = nv;
      }
      return res;
    }
    return value;
  }
  const canonical = (v) => JSON.stringify(normalize(v));

  class FakeStorage {
    constructor() { this.m = new Map(); this.failWrites = false; }
    getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
    setItem(k, v) {
      if (this.failWrites) throw new Error('QuotaExceededError');
      this.m.set(k, String(v));
    }
    removeItem(k) { this.m.delete(k); }
  }

  /* ---------------- 1. Flask版との一致 ---------------- */
  let totalSteps = 0;
  let resumes = 0;
  let firstMismatch = null;

  window.GOLDEN.forEach((seq, seqNo) => {
    const storage = new FakeStorage();
    let api = new LocalApi({ storage });
    seq.steps.forEach((step, stepNo) => {
      totalSteps++;

      // 7ステップごと（ずらしつつ）に、端末再起動を想定してエンジンを作り直す
      if ((stepNo + seqNo) % 7 === 3) {
        api = new LocalApi({ storage });
        resumes++;
      }

      const resp = api.call(step.ep, step.data);
      const canon = canonical(resp);
      const hash = cyrb53(canon);
      if (hash !== step.hash && !firstMismatch) {
        firstMismatch = { seqNo, name: seq.name, stepNo, step, canon };
      }
      if (hash !== step.hash) failures++;
    });
  });

  log(`[1] Flask版との一致: ${totalSteps} ステップ / ${window.GOLDEN.length} シーケンス / 途中再開 ${resumes} 回`);
  if (firstMismatch) {
    const m = firstMismatch;
    log(`  FAIL 最初の不一致: seq#${m.seqNo} "${m.name}" step#${m.stepNo} ${m.step.ep} ${JSON.stringify(m.step.data)}`);
    log(`  期待サマリ: ${JSON.stringify(m.step.sum)}`);
    log(`  実際のJSON: ${m.canon.slice(0, 1500)}`);
    log(`  不一致数: ${failures}`);
  } else {
    log('  OK 全ステップ一致');
  }

  /* ---------------- 2. 永続化の堅牢性 ---------------- */
  function check(name, cond) {
    if (cond) {
      log(`  OK ${name}`);
    } else {
      log(`  FAIL ${name}`);
      failures++;
    }
  }

  log('[2] 永続化の堅牢性');
  {
    const storage = new FakeStorage();
    const api = new LocalApi({ storage });
    check('初回起動は復元なし', api.restored === false);
    api.call('add_card', { card_id: 'Tutorial' });
    api.call('mark_cell', { card_index: 0, row: 0, col: 0 });
    api.call('adjust_tokens', { token_type: 'star', amount: 1 });
    const before = canonical(api.call('get_state'));

    const again = new LocalApi({ storage });
    check('再起動後に復元される', again.restored === true);
    check('復元後の状態が一致', canonical(again.call('get_state')) === before);

    // 最新スロットが壊れても、もう一方（1操作前）で復元できる
    const latestKey = storage.getItem(api.store.keys[0]) && JSON.parse(storage.getItem(api.store.keys[0])).seq >
      JSON.parse(storage.getItem(api.store.keys[1])).seq ? api.store.keys[0] : api.store.keys[1];
    storage.setItem(latestKey, '{"broken":');
    const fallback = new LocalApi({ storage });
    check('最新スロット破損でも1つ前の状態で復元', fallback.restored === true);
    const fb = fallback.call('get_state');
    check('1つ前の状態（星トークン調整前）に戻っている', fb.star_tokens === 0 && fb.cards.length === 1);

    // チェックサム不一致（中身の書き換え）も検知
    const s2 = new FakeStorage();
    const a2 = new LocalApi({ storage: s2 });
    a2.call('add_card', { card_id: 'Tutorial' });
    const key = a2.store.keys.find((k) => s2.getItem(k));
    const wrapper = JSON.parse(s2.getItem(key));
    wrapper.data = wrapper.data.replace('Tutorial', 'Tutorizl');
    s2.setItem(key, JSON.stringify(wrapper));
    const a3 = new LocalApi({ storage: s2 });
    check('チェックサム不一致は破棄され初期状態から開始', a3.restored === false && a3.call('get_state').cards.length === 0);

    // 両方壊れても落ちない
    const s3 = new FakeStorage();
    s3.setItem('luckybox.state.a', 'garbage');
    s3.setItem('luckybox.state.b', '{"v":1}');
    const a4 = new LocalApi({ storage: s3 });
    check('保存データが全滅しても起動できる', a4.restored === false && a4.call('get_state').lightning_tokens === 4);

    // オールリセットも保存される
    const s4 = new FakeStorage();
    const a5 = new LocalApi({ storage: s4 });
    a5.call('add_card', { card_id: 'Tutorial' });
    a5.call('reset', {});
    const a6 = new LocalApi({ storage: s4 });
    check('オールリセット後の再起動でも初期状態', a6.call('get_state').cards.length === 0 && a6.call('get_state').can_undo === false);

    // 保存に失敗しても操作は継続でき、状態通知でエラーが分かる
    const s5 = new FakeStorage();
    const a7 = new LocalApi({ storage: s5 });
    let lastStatus = null;
    a7.onSaveStatus((s) => { lastStatus = s; });
    s5.failWrites = true;
    const r = a7.call('add_card', { card_id: 'Tutorial' });
    check('保存失敗でも操作は成功する', r.success === true && a7.call('get_state').cards.length === 1);
    check('保存失敗が通知される', lastStatus && lastStatus.ok === false);

    // localStorage が使えない環境
    const a8 = new LocalApi({ storage: null });
    a8.call('add_card', { card_id: 'Tutorial' });
    check('保存先なしでも動作（メモリのみ）', a8.call('get_state').cards.length === 1 && a8.storageAvailable === false);
  }

  /* ---------------- 結果 ---------------- */
  log(failures === 0 ? 'RESULT: PASS' : `RESULT: FAIL (${failures})`);
  document.getElementById('out').textContent = out.join('\n');
  if (firstMismatch) {
    // 不一致調査用: 実際の正規化JSON全体（tests/diff_mismatch.py で期待値と比較する）
    const pre = document.createElement('pre');
    pre.id = 'mismatch';
    pre.textContent = JSON.stringify({ seqNo: firstMismatch.seqNo, stepNo: firstMismatch.stepNo, canon: firstMismatch.canon });
    document.body.appendChild(pre);
  }
})();
