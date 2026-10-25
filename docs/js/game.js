console.log('game.js ファイルが読み込まれました');

class LuckyBoxUI {
    constructor() {
        this.gameState = null;
        this.currentRound = 'tutorial';  // デフォルトラウンド
        this.manualBonusStates = new Map();
        // 選択中の数字・？ボーナス { key, values }。選択中だけ、押せるマスを明示し、それ以外のマスは押せない
        this.bonusSelection = null;
        // ラウンド1〜4の「パート」: 'puzzle' = 謎解きパート / 'bingo' = ビンゴパート（チュートリアル・全ラウンド終了後も 'bingo'）。
        // 流れ: スタッフモード → ユーザーモード(謎解き) → スタッフモード → ユーザーモード(ビンゴ) → …（ラウンド終了で次の謎解きへ）。
        // スタッフモードに入っても、パートは変えない（無操作で自動で戻るときは、入る前のパートへ戻る。手動なら、帯のボタンで選ぶ）。
        // 謎解きパートのユーザーモードは、バージョン表示以外の全てのタップを無効にする（CSS: body.puzzle-part）
        this.part = 'bingo';
        // ビンゴパート（ユーザーモード）の流れ: ① 司会の読み上げ番号を選ぶ → ② 盤面のその数字を1マスだけタップ
        //   → ③ 数字・？のボーナスが有効になったら、すぐ使い切る → ①へ。選んだ読み上げ番号（'0'〜'9'）。未選択は null。保存しない
        this.calledNumber = null;
        // ② で「使う」と決めた雷の数（0〜4）。盤面のマスをタップした時点で、その数だけ雷トークンを減らす。保存しない
        this.lightningReserved = 0;
        // 番号カードに 0 を出すか（ふだんは 1〜9。モード表示を5回タップすると true になり、以降は保存されて 0〜9）
        this.showZero = false;
        this.setupEventListeners();
        this.setupStaffHistoryGuard();
        this.stickerEdit = null; // シール編集中の状態 { cardId, tool, message }
        this.setupTeamSelect();
        this.setupScoreInputs();
        this.setupScoreSubmit();
        this.setupTokenHud();
        this.setupCallPanel();
        this.setupAutoComplete();
        // スタッフモードに入ったら、ボーナスの選択（自動選択を含む）は解除する。スタッフモードでは、流れの制限をかけない。
        // 出たら、いまの状態から流れを組み立て直す
        document.addEventListener('staffmodechange', (event) => {
            if (event.detail.on) this.bonusSelection = null;
            this.updateBingoFlow();
        });
        // スタッフモードを終えたら、シール編集も終える
        document.addEventListener('staffmodechange', (event) => {
            if (!event.detail.on && this.stickerEdit) {
                this.stickerEdit = null;
                if (this.gameState) this.updateDisplay();
            }
        });
        // 「ユーザーモード(○○パート)に戻る」で選んだパートへ戻る（staff.js が、ユーザーモードへ戻る直前に知らせる）
        document.addEventListener('staffexitpart', (event) => {
            this._setPart(event.detail.part);
            this.renderTokenHud();
        });
        this.initializeGame();
    }

    // パートの表示名
    static get PART_LABELS() {
        return { puzzle: '謎解きパート', bingo: 'ビンゴパート' };
    }

    /* ---------------- 自動 Complete（試験機能） ----------------
     * カードが全マス黒（Complete ボタンが出ている）で、かつボーナス欄がすべてグレー（使用済み）になったら、
     * AUTO_COMPLETE_MS ミリ秒後に、自動で Complete ボタンと同じ処理（コンプリート欄へ移動）をする。
     * 移すのは、ビンゴパートの「① 番号待ち」のときだけ（ボーナス処理中・盤面タップの途中・スタッフモードでは移さない）。
     * 待っているあいだに条件が崩れたら（Undo など）取りやめる。
     * 移るときは、カードがコンプリート欄へ飛ぶアニメーションを付ける（flyCardToCompleted）。
     * 戻したい（無効にしたい）ときは、AUTO_COMPLETE_MS を 0 にする。アニメーションだけ消すなら AUTO_COMPLETE_ANIM_MS を 0 にする。
     */
    static get AUTO_COMPLETE_MS() {
        return 500;
    }

    setupAutoComplete() {
        const container = document.getElementById('cards-container');
        if (!container || LuckyBoxUI.AUTO_COMPLETE_MS <= 0) return;
        this._autoCompleteTimers = new Map(); // カードID → タイマー
        this._autoCompleteDone = new Set();   // 自動で移したカードID（Undo で戻ったとき、すぐまた移さないため）
        // 盤面の描き直し・ボーナス欄の色の変化は、どの経路でもここに集まる。確認だけの軽い処理なので、そのつど呼ぶ
        new MutationObserver(() => this.checkAutoComplete()).observe(container, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class']
        });
    }

    // いま画面にあるカードのうち、自動 Complete の条件を満たしているカードのID
    findAutoCompleteReady() {
        const ready = [];
        const all = new Set();
        document.querySelectorAll('#cards-container .bingo-card').forEach((cardEl) => {
            const id = cardEl.dataset.cardId;
            all.add(id);
            const ok = !!cardEl.querySelector('.complete-btn') &&
                Array.from(cardEl.querySelectorAll('.bonus-cell')).every((el) => el.classList.contains('used'));
            if (ok) ready.push(id);
        });
        return { ready, all };
    }

    // 自動 Complete をしてよい場面か: 流れの制限がかかるビンゴパート（ユーザーモード）で、
    // ① 番号待ち（有効なボーナスがなく、ボーナス選択中でもなく、読み上げ番号も未選択）のとき
    isAutoCompleteTiming() {
        // （マスの処理中かどうかは、ここでは見ない。処理中に見ると、処理が終わったあとに確認し直す機会がなく、いつまでも移らないため。
        //   処理中に実行時刻が来たときは、runAutoComplete が少し待つ）
        if (!this.flowEnforced()) return false;
        return !this.bonusSelection && this.getPendingBonuses().length === 0 && this.calledNumber === null;
    }

    checkAutoComplete() {
        if (!this._autoCompleteTimers) return;
        const { ready, all } = this.findAutoCompleteReady();
        const readySet = new Set(ready);
        // 移すのは、ビンゴパートの「① 番号待ち」のときだけ（ボーナスや盤面タップの途中では移さない）
        const waiting = this.isAutoCompleteTiming();

        // 条件が崩れたカード（や、番号待ちでなくなったとき）: 待ちを取りやめる
        this._autoCompleteTimers.forEach((timer, id) => {
            if (!waiting || !readySet.has(id)) {
                clearTimeout(timer);
                this._autoCompleteTimers.delete(id);
            }
        });
        // 自動で移したカードが、Undo で戻ったあとに条件が崩れたら、また自動の対象に戻す
        this._autoCompleteDone.forEach((id) => {
            if (all.has(id) && !readySet.has(id)) this._autoCompleteDone.delete(id);
        });
        if (!waiting) return;

        ready.forEach((id) => {
            if (this._autoCompleteTimers.has(id) || this._autoCompleteDone.has(id)) return;
            this._autoCompleteTimers.set(id, setTimeout(() => this.runAutoComplete(id), LuckyBoxUI.AUTO_COMPLETE_MS));
        });
    }

    // 移動アニメーションの長さ（ミリ秒）。0 にするとアニメーションなし
    static get AUTO_COMPLETE_ANIM_MS() {
        return 1100;
    }

    // 移動アニメーション: 盤面にあったカードの「コピー」を、元の位置からコンプリート欄の新しい位置へ飛ばす。
    // 本物のカードは、これまでどおり一瞬で移る（コピーは見た目だけ。動かすのは transform / opacity だけなので軽い）。
    // コンプリート欄が画面の外にあるときは、画面の下の端へ向かって小さくなりながら消える。
    flyCardToCompleted(clone, from, cardId) {
        const duration = LuckyBoxUI.AUTO_COMPLETE_ANIM_MS;
        const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!clone || !from || duration <= 0 || reduce || typeof clone.animate !== 'function') return;

        const target = document.querySelector(`#completed-cards-container .bingo-card[data-card-id="${cardId}"]`);
        if (!target) return;
        const to = target.getBoundingClientRect();
        const vh = window.innerHeight;
        const onScreen = to.bottom > 0 && to.top < vh;

        let toCx = to.left + to.width / 2;
        let toCy = to.top + to.height / 2;
        if (!onScreen) toCy = to.top >= vh ? vh - 24 : 24; // 画面の外: 近いほうの端へ向かう
        const scale = onScreen && from.width ? to.width / from.width : 0.3;
        const dx = toCx - (from.left + from.width / 2);
        const dy = toCy - (from.top + from.height / 2);

        Object.assign(clone.style, {
            position: 'fixed',
            left: `${from.left}px`,
            top: `${from.top}px`,
            width: `${from.width}px`,
            height: `${from.height}px`,
            margin: '0',
            zIndex: '800',
            pointerEvents: 'none',
            willChange: 'transform, opacity',
            transformOrigin: 'center center'
        });
        // カードの幅の上限（--card-max）は、盤面欄の中にあるときだけ決まる。コピーは body の直下なので、元の幅をそのまま上限にする
        clone.style.setProperty('--card-max', `${from.width}px`);
        clone.removeAttribute('data-card-index');
        clone.setAttribute('aria-hidden', 'true');
        clone.querySelectorAll('[onclick]').forEach((el) => el.removeAttribute('onclick'));
        document.body.appendChild(clone);

        // 画面内に着地するときは、本物のカードを飛行中だけ隠す（着地した瞬間に入れ替わって見える）
        if (onScreen) target.style.visibility = 'hidden';
        const finish = () => {
            clone.remove();
            target.style.visibility = '';
        };
        const anim = clone.animate([
            { transform: 'translate(0, 0) scale(1)', opacity: 1 },
            { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: onScreen ? 1 : 0.15 }
        ], { duration, easing: 'cubic-bezier(0.4, 0, 0.3, 1)', fill: 'forwards' });
        anim.onfinish = finish;
        anim.oncancel = finish;
    }

    async runAutoComplete(cardId) {
        this._autoCompleteTimers.delete(cardId);
        // 操作の途中（マスの処理中・シール編集中）は、少し待ってからやり直す
        if (this.isMarkingCell || (this.stickerEdit && this.stickerEdit.cardId === cardId)) {
            this._autoCompleteTimers.set(cardId, setTimeout(() => this.runAutoComplete(cardId), 500));
            return;
        }
        if (!this.isAutoCompleteTiming() || !this.findAutoCompleteReady().ready.includes(cardId)) return;
        const cards = (this.gameState && this.gameState.cards) || [];
        const index = cards.findIndex((card) => card.card_id === cardId);
        if (index < 0) return;
        this._autoCompleteDone.add(cardId);

        // 移動アニメーション用に、移る前のカードの位置と見た目（コピー）を控えておく
        const cardEl = document.querySelector(`#cards-container .bingo-card[data-card-id="${cardId}"]`);
        const from = cardEl ? cardEl.getBoundingClientRect() : null;
        const clone = cardEl ? cardEl.cloneNode(true) : null;

        const moved = await this.completeCard(index);
        if (moved) this.flyCardToCompleted(clone, from, cardId);
        else this._autoCompleteDone.delete(cardId);
    }

    // パートの見た目を反映する。保存はしない。
    //   ・画面のロック（謎解きパートのとき）
    //   ・スタッフモードの帯の「ユーザーモード(○○パート)に戻る」2つのボタン:
    //     スタッフモードに入る前のパート（this.part。スタッフモード中は変えない）のほうに白い枠を付ける。
    //     無操作で自動で戻るときは、そのパートへ戻る。謎解きパートのボタンは、ラウンド1〜4のときだけ出す
    _applyPartDom() {
        document.body.classList.toggle('puzzle-part', this.part === 'puzzle');
        const round = this.gameState ? (this.gameState.round_num ?? 1) : 0;
        const hasPuzzle = round >= 1 && round <= 4;
        const puzzleBtn = document.getElementById('staff-exit-puzzle-btn');
        const bingoBtn = document.getElementById('staff-exit-btn');
        const autoPuzzle = this.part === 'puzzle' && hasPuzzle;
        if (puzzleBtn) {
            puzzleBtn.hidden = !hasPuzzle;
            puzzleBtn.classList.toggle('is-auto', autoPuzzle);
        }
        if (bingoBtn) bingoBtn.classList.toggle('is-auto', !autoPuzzle);
    }

    /* ---------------- ビンゴパートの流れ（① 番号 → ② 盤面 → ③ ボーナス） ---------------- */

    isStaffNow() {
        return document.body.classList.contains('staff-mode');
    }

    // 流れの制限をかける場面か: ユーザーモードのビンゴパート（チュートリアル〜ラウンド4）。スタッフモードでは制限しない
    flowEnforced() {
        if (!this.gameState || this.isStaffNow() || this.part !== 'bingo') return false;
        const round = this.gameState.round_num ?? 1;
        return round >= 0 && round <= 4;
    }

    // 有効になっている（まだ使っていない）数字・？のボーナス欄。盤面とコンプリート欄の両方から探す
    getPendingBonuses() {
        return Array.from(document.querySelectorAll('.bonus-cell.available[data-bonus-values]'))
            .filter((el) => !el.dataset.tokenOnly);
    }

    // 盤面（カレントのカード）の、まだ黒くないマスのうち、values で押せるものがあるか
    hasOpenCellFor(values) {
        return Array.from(document.querySelectorAll('#cards-container .bingo-cell:not(.marked)'))
            .some((cell) => this.isBonusTargetValue(cell.dataset.value, values));
    }

    hasBonusTarget(el) {
        return this.hasOpenCellFor(el.dataset.bonusValues.split(','));
    }

    // 番号カードを並べる。ふだんは 1〜9、隠しスイッチ（this.showZero）のあとは 0〜9
    renderCallNumbers() {
        const numbers = document.getElementById('call-numbers');
        if (!numbers) return;
        const start = this.showZero ? 0 : 1;
        numbers.innerHTML = Array.from({ length: 10 - start }, (_, i) => start + i).map((n) =>
            `<button type="button" class="call-num" data-num="${n}" aria-label="読み上げ番号 ${n}">${n}</button>`
        ).join('');
    }

    // 雷を k 個使ったときに押せる数字。1〜9 の輪（9 の次は 1、1 の前は 9）の上で、読み上げ番号 ±k。
    //   雷1個: ±1 / 2個: ±2 / 3個: ±3（読み上げ番号そのものは含まない）。4個: すべてのマス（0・アルファベットも。？と同じ）。
    //   0 は輪に含まない（0 には雷の効果なし）
    lightningValues(number, k) {
        if (!k) return [number];
        if (k >= 4) return ['?'];
        if (number === '0') return [number];
        const n = Number(number);
        const up = ((n - 1 + k) % 9) + 1;
        const down = ((((n - 1 - k) % 9) + 9) % 9) + 1;
        return [String(up), String(down)];
    }

    // いま ② 盤面のタップ待ち（読み上げ番号を選んだ後で、有効なボーナスが無い）か
    isBoardPhase() {
        return this.calledNumber !== null && this.getPendingBonuses().length === 0;
    }

    // 画面の「番号カード」を作り、操作を受ける
    setupCallPanel() {
        const numbers = document.getElementById('call-numbers');
        if (numbers) {
            this.renderCallNumbers();
            numbers.addEventListener('click', (event) => {
                const btn = event.target.closest('.call-num');
                if (!btn || btn.disabled || !this.flowEnforced()) return;
                // ボーナスを使い切るまでは、次の番号は選べない
                if (this.getPendingBonuses().length) return;
                // もう一度タップすると選択を取り消し。別の番号をタップすると選び直し
                this.calledNumber = this.calledNumber === btn.dataset.num ? null : btn.dataset.num;
                this.lightningReserved = 0; // 番号を変えたら、雷の使用予定は取り消し（トークンはまだ減っていない）
                this.updateBingoFlow();
            });
        }
        // 隠しスイッチ: モード表示の文字を、2秒以内の間隔で5回タップすると、番号カードが 0〜9 の表示になる（以降はずっと 0〜9）
        const modeEl = document.getElementById('flow-mode');
        if (modeEl) {
            let taps = 0;
            let lastTap = 0;
            modeEl.addEventListener('click', () => {
                if (this.showZero) return;
                const now = Date.now();
                taps = now - lastTap <= 2000 ? taps + 1 : 1;
                lastTap = now;
                if (taps >= 5) {
                    taps = 0;
                    this.showZero = true;
                    this.saveUiState();
                    this.renderCallNumbers();
                    this.updateBingoFlow();
                    this.nudgeFlow();
                }
            });
        }
        const cancelBtn = document.getElementById('flow-cancel-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                this.calledNumber = null;
                this.lightningReserved = 0;
                this.updateBingoFlow();
            });
        }
        const skipBtn = document.getElementById('flow-skip-btn');
        if (skipBtn) {
            skipBtn.addEventListener('click', () => {
                // 使える空きマスがないボーナスは、スキップ（使用済みにする）。操作履歴に残り、Undo で戻せる
                this.getPendingBonuses()
                    .filter((el) => !this.hasBonusTarget(el))
                    .forEach((el) => this.toggleBonus(el));
                this.updateBingoFlow();
            });
        }
    }

    // 流れの状態を、いまの盤面から組み立てて、画面（モード表示・番号カード・ボタン・強調）に反映する
    updateBingoFlow() {
        const panel = document.getElementById('call-panel');
        if (!panel) return;
        const enforced = this.flowEnforced();
        panel.hidden = !enforced;
        if (!enforced) {
            this.lightningReserved = 0;
            this.renderLightningTray();
            this.applyBonusHighlight();
            this.checkAutoComplete();
            return;
        }

        // ③ 有効なボーナスがあれば、即時に使い切る。
        // 有効になったボーナスマスは黄赤で点滅し、タップすると緑（選択）になって、押せる盤面のマスが強調される
        const pending = this.getPendingBonuses();
        const withTarget = pending.filter((el) => this.hasBonusTarget(el));
        const noTarget = pending.filter((el) => !withTarget.includes(el));

        let phase;
        if (pending.length) phase = 'bonus';
        else phase = this.calledNumber === null ? 'wait' : 'board';

        // 雷の使用予定は、② のあいだだけ。持っている数（と最大4個）を超えないようにする
        const tokens = Math.max(0, this.gameState.lightning_tokens || 0);
        this.lightningReserved = phase === 'board' ? Math.min(this.lightningReserved, tokens, 4) : 0;
        this.renderLightningTray();

        let text;
        let cls;
        if (phase === 'wait') {
            text = '① ビンゴマスの数字を決定してください';
            cls = 'is-wait';
        } else if (phase === 'board') {
            const k = this.lightningReserved;
            const values = this.lightningValues(this.calledNumber, k);
            const hasCell = this.hasOpenCellFor(values);
            if (k === 0) {
                text = hasCell
                    ? `② 盤面の「${this.calledNumber}」を1マスタップ`
                    : `② 「${this.calledNumber}」の空きマスがありません（${tokens > 0 ? '雷を使うか、' : ''}右のボタンで戻る）`;
            } else if (k >= 4) {
                text = hasCell
                    ? '② 雷4個: すべてのマスから1マスタップ'
                    : '② 押せる空きマスがありません（右のボタンで戻る）';
            } else {
                const label = values.length > 1 && values[0] !== values[1] ? `「${values[0]}」「${values[1]}」` : `「${values[0]}」`;
                text = hasCell
                    ? `② 雷${k}個: ${label}から1マスタップ`
                    : `② 雷${k}個: ${label}の空きマスがありません（雷を増やすか、右のボタンで戻る）`;
            }
            cls = 'is-board';
        } else {
            if (this.bonusSelection) text = '③ ボーナス: 強調されたマスをタップ';
            else if (withTarget.length) text = `③ ボーナス: 点滅しているボーナスマスをタップ（残り ${pending.length} 個）`;
            else text = '③ ボーナス: 使える空きマスがありません（スキップしてください）';
            cls = 'is-bonus';
        }
        const modeEl = document.getElementById('flow-mode');
        if (modeEl) {
            if (modeEl.textContent !== text) modeEl.textContent = text;
            modeEl.className = `flow-mode ${cls}`;
        }

        // 番号カード: ボーナス処理中は押せない。選択中の番号は強調
        document.querySelectorAll('#call-numbers .call-num').forEach((btn) => {
            btn.disabled = phase === 'bonus';
            btn.classList.toggle('is-selected', phase === 'board' && btn.dataset.num === this.calledNumber);
        });

        const cancelBtn = document.getElementById('flow-cancel-btn');
        if (cancelBtn) cancelBtn.hidden = phase !== 'board';
        const skipBtn = document.getElementById('flow-skip-btn');
        if (skipBtn) skipBtn.hidden = !(phase === 'bonus' && noTarget.length > 0);

        this.applyBonusHighlight();
        // 流れの状態（番号待ちかどうか）が変わったので、自動 Complete の条件も確認し直す
        this.checkAutoComplete();
    }

    // 押せないマスをタップしたとき、モード表示を一瞬ゆらして、いまの操作を知らせる
    nudgeFlow() {
        const modeEl = document.getElementById('flow-mode');
        if (!modeEl) return;
        modeEl.classList.remove('is-nudge');
        void modeEl.offsetWidth; // アニメーションを最初からやり直す
        modeEl.classList.add('is-nudge');
    }

    // パートを切り替えて、画面に反映し、保存する（HUD の再描画は呼び出し側）
    _setPart(part) {
        this.part = part === 'puzzle' ? 'puzzle' : 'bingo';
        this._applyPartDom();
        this.saveUiState();
    }

    // スタッフモード中に何か操作した場合、スタッフモードを終えるときに操作履歴（Undo用）を全部消す。
    // スタッフが行った操作（カード追加・トークン増減など）を、ユーザーが Undo で取り消せないようにするため。
    // 何も操作せず見ただけで戻った場合は、履歴を消さない（ユーザーの Undo を残す）。
    setupStaffHistoryGuard() {
        let countAtEnter = null;

        document.addEventListener('staffmodechange', async (event) => {
            const api = window.LuckyBoxEngine.getApi();

            if (event.detail.on) {
                countAtEnter = api.mutationCount;
                return;
            }

            const operated = countAtEnter !== null && api.mutationCount !== countAtEnter;
            countAtEnter = null;
            if (!operated) return;

            const result = await this.apiCall('clear_history', {});
            if (result && result.success) {
                this.gameState = result.game_state;
                this.updateDisplay();
            }
        });
    }
    
    async initializeGame() {
        try {
            console.log('ゲーム初期化を開始します');
            
            // 前回の画面状態（選択中ラウンド、ボーナスの使用済み表示）を復元し、フッターを初期化
            this.restoreUiState();
            this.setupFooter();
            
            // ゲーム状態を読み込み
            try {
                console.log('ゲーム状態を読み込み中...');
                const success = await this.loadGameState();
                console.log('ゲーム状態の読み込みが完了しました:', success ? '成功' : '失敗');
                if (success) {
                    this.updateDisplay();
                }
            } catch (error) {
                console.error('ゲーム状態の読み込み中にエラーが発生しました:', error);
                throw error;
            }
            
            // ラウンドカードを読み込み
            try {
                console.log('ラウンドカードを読み込み中...');
                await this.loadRoundCards();
                console.log('ラウンドカードの読み込みが完了しました');
            } catch (error) {
                console.error('ラウンドカードの読み込み中にエラーが発生しました:', error);
                throw error;
            }
            
            console.log('ゲーム初期化が完了しました');
        } catch (error) {
            console.error('ゲーム初期化中にエラーが発生しました:', error);
            if (error.stack) {
                console.error('エラースタック:', error.stack);
            }
        }
    }

    async loadGameState() {
        try {
            console.log('ゲーム状態読み込み開始');
            
            const result = await this.apiCall('get_state');
            if (result) {
                this.gameState = result;

                // コンプリートカード用コンテナを確保
                this.completedCards = result.completed_cards || [];
                console.log('コンプリートカード:', this.completedCards);

                // 手動トグル状態は restoreUiState() で復元済みのため、ここではクリアしない
                // （ブラウザ/端末を再起動しても続きから再開できるようにするため）

                // トークンボタンの状態を更新
                this.updateTokenButtonStates();

                return true;
            } else {
                console.error('ゲーム状態の取得に失敗しました: レスポンスが空です');
                return false;
            }
        } catch (error) {
            console.error('ゲーム状態の読み込み中にエラーが発生しました:', error);
            if (error.stack) {
                console.error('エラースタック:', error.stack);
            }
            return false;
        }
    }

    // イベントリスナーが既に設定されているかどうかを追跡するフラグ
    eventListenersInitialized = false;
    
    setupEventListeners() {
        // 既にイベントリスナーが設定されている場合は何もしない
        if (this.eventListenersInitialized) {
            console.log('イベントリスナーは既に設定済みです');
            return;
        }
        
        console.log('イベントリスナー設定開始');
        
        // カード追加ボタン
        const addCardBtn = document.getElementById('add-card-btn');
        if (addCardBtn) {
            // 既存のイベントリスナーを削除
            const newAddCardBtn = addCardBtn.cloneNode(true);
            addCardBtn.parentNode.replaceChild(newAddCardBtn, addCardBtn);
            
            newAddCardBtn.addEventListener('click', () => {
                console.log('カード追加ボタンクリック');
                this.addCard();
            });
        }

        // ラウンド選択のイベントリスナー設定
        const roundSelect = document.getElementById('round-select');
        if (roundSelect) {
            // 既存のイベントリスナーを削除
            const newRoundSelect = roundSelect.cloneNode(true);
            roundSelect.parentNode.replaceChild(newRoundSelect, roundSelect);
            
            newRoundSelect.addEventListener('change', (e) => {
                console.log('ラウンド選択変更:', e.target.value);
                this.currentRound = e.target.value;
                this.updateRoundSelectColor();
                this.saveUiState();
                this.loadRoundCards();
            });
        }
        this.updateRoundSelectColor();

        // Undo/Resetボタン
        const resetBtn = document.getElementById('reset-btn');
        
        // Undoボタンは複数配置（ビンゴカード見出し横 + 操作ボタン欄）
        document.querySelectorAll('.undo-btn').forEach(undoBtn => {
            // 既存のイベントリスナーを削除
            const newUndoBtn = undoBtn.cloneNode(true);
            undoBtn.parentNode.replaceChild(newUndoBtn, undoBtn);
            
            newUndoBtn.addEventListener('click', () => {
                this.undo();
            });
        });
        
        if (resetBtn) {
            // 既存のイベントリスナーを削除
            const newResetBtn = resetBtn.cloneNode(true);
            resetBtn.parentNode.replaceChild(newResetBtn, resetBtn);
            
            newResetBtn.addEventListener('click', () => {
                console.log('Resetボタンクリック');
                this.reset();
            });
        }

        // トークンボタンの設定
        this.setupTokenButtons();
        this.setupLightningTray();
        
        // セルクリックイベントの設定
        this.setupCellClickEvents();
        
        // イベントリスナー設定完了
        this.eventListenersInitialized = true;
        console.log('イベントリスナー設定完了');
    }

    // カードのセルクリックイベントを設定
    setupCellClickEvents() {
        console.log('セルクリックイベント設定開始');
        
        // 既存のイベントリスナーを削除
        document.removeEventListener('click', this.handleCellClick);
        
        // 新しいイベントリスナーを追加
        this.handleCellClick = (event) => {
            const cell = event.target.closest('.card-cell:not(.marked)');
            if (!cell) return;
            
            const cardElement = cell.closest('.bingo-card');
            if (!cardElement) return;
            
            const cardIndex = parseInt(cardElement.dataset.cardIndex, 10);
            const row = parseInt(cell.dataset.row, 10);
            const col = parseInt(cell.dataset.col, 10);
            
            if (isNaN(cardIndex) || isNaN(row) || isNaN(col)) {
                console.error('無効なカードまたはセルインデックスです');
                return;
            }
            
            this.markCell(cardIndex, row, col);
        };
        
        // イベントリスナーを追加
        document.addEventListener('click', this.handleCellClick);
        console.log('セルクリックイベント設定完了');
    }
    
    // 雷トークンの表示（Bingo Cards 見出しの右）。
    // 持っている数だけ⚡を並べ、ユーザーが使うときに⚡をタップすると1つ減る（使用の宣言自体はアプリの管理外）。
    // 個数と、スタッフ用の「−／＋」（数え間違いの修正用）は、見出しの左の枠（#token-hud と同じ作り）にある。
    setupLightningTray() {
        const tray = document.getElementById('lightning-tray');
        if (!tray) return;

        tray.addEventListener('click', (event) => {
            const token = event.target.closest('.lightning-token');
            if (!token) return;

            // ビンゴパートの流れの中: 雷は ② 盤面のタップ待ちのときだけ使える。
            // タップで「使う雷」を1つ増やす（最大4個）。使う予定の雷をもう一度タップすると1つ戻す。
            // トークンが実際に減るのは、盤面のマスをタップした時点
            if (this.flowEnforced()) {
                if (!this.isBoardPhase()) {
                    this.nudgeFlow();
                    return;
                }
                if (token.classList.contains('is-reserved')) {
                    this.lightningReserved = Math.max(0, this.lightningReserved - 1);
                } else if (this.lightningReserved < 4) {
                    this.lightningReserved += 1;
                }
                this.renderLightningTray();
                this.updateBingoFlow();
                return;
            }

            // それ以外（スタッフモードなど）: タップで1つ減る
            this.adjustTokens('lightning', -1);
        });
    }

    renderLightningTray() {
        const tray = document.getElementById('lightning-tray');
        if (!tray || !this.gameState) return;

        const count = Math.max(0, this.gameState.lightning_tokens || 0);
        // 数が変わっていなければ作り直さない（画面のちらつき・スクロール位置のずれを避ける）
        // ② で「使う」と決めた雷（先頭から数えて reserved 個）は、強調して表示する
        const reserved = Math.min(this.lightningReserved || 0, count);
        const renderKey = `${count}:${reserved}`;
        if (this._lightningShown === renderKey && tray.childElementCount) return;
        this._lightningShown = renderKey;

        // 個数の表示と「−／＋」は、見出しの左の枠（星・月と同じ作り）に移した。ここはアイコンだけ
        const icon = this.getBonusIcon('lightning');
        tray.innerHTML = Array.from({ length: count }, (_, i) => {
            const isReserved = i < reserved;
            return `<button type="button" class="lightning-token${isReserved ? ' is-reserved' : ''}" aria-label="${isReserved ? '雷の使用を取り消す' : '雷を使う'}">${icon}</button>`;
        }).join('');
    }

    /* ---------------- 星・月の表示（ユーザーモードでも見える）とラウンド終了 ---------------- */
    // 星: いまのラウンドの獲得数（ラウンド終了で 0 に戻る）。月: 獲得数の合計。
    // スタッフモードでは、謎解きパートで増えた分を入力する「−／＋」と、「ラウンド終了」ボタンも出る。
    setupTokenHud() {
        const starIcon = document.getElementById('hud-star-icon');
        const moonIcon = document.getElementById('hud-moon-icon');
        const lightningIcon = document.getElementById('hud-lightning-icon');
        if (starIcon) starIcon.innerHTML = this.getBonusIcon('star');
        if (moonIcon) moonIcon.innerHTML = this.getBonusIcon('moon');
        if (lightningIcon) lightningIcon.innerHTML = this.getBonusIcon('lightning');

        // 星・月・雷の「−／＋」と「ラウンド終了」は、置き場所が分かれている（HUD・進捗の右・Bingo Cards 見出し）ので、
        // document でまとめて受ける
        document.addEventListener('click', (event) => {
            const adjustBtn = event.target.closest('[data-hud-adjust]');
            if (adjustBtn) {
                this.adjustTokens(adjustBtn.dataset.hudAdjust, Number(adjustBtn.dataset.amount));
                return;
            }
            if (event.target.closest('#round-end-btn')) {
                this.endRound();
            }
        });
    }

    renderTokenHud() {
        if (!this.gameState) return;
        const star = this.gameState.star_tokens || 0;
        const moon = this.gameState.moon_tokens || 0;
        const lightning = Math.max(0, this.gameState.lightning_tokens || 0);
        // round_num: 0 = チュートリアル中、1〜4 = ラウンド1〜4、5 = 全ラウンド終了
        const round = this.gameState.round_num ?? 1;
        const finished = round > 4;
        const tutorial = round === 0;

        const setText = (id, value) => {
            const el = document.getElementById(id);
            if (el && el.textContent !== String(value)) el.textContent = value;
        };
        setText('hud-star-count', star);
        setText('hud-moon-count', moon);
        setText('hud-lightning-count', lightning);
        // 進捗が変わったら（「ラウンド終了」・Undo など）、カード追加のリストも、その進捗のカードに切り替える
        // （例: 「ラウンド2 終了」を押すと、ラウンド3カードのリストになる）。最初の表示では切り替えない
        if (this._progressRound !== undefined && this._progressRound !== round) {
            this.syncRoundListToProgress(round);
            // 「ラウンド終了」でラウンド1〜4に入ったら、そのラウンドは謎解きパートから始まる。
            // それ以外（Undo で戻った・オールリセット・全ラウンド終了）は、ビンゴパート扱い（ロックしない）
            const advanced = round > this._progressRound;
            this._setPart(advanced && round >= 1 && round <= 4 ? 'puzzle' : 'bingo');
        } else if (this._progressRound === undefined && this.part === 'puzzle' && (round < 1 || round > 4)) {
            // 保存されたパートが、いまの進捗と合わないとき（リセット後など）は、ロックを外す
            this._setPart('bingo');
        }
        this._progressRound = round;
        this._applyPartDom(); // 戻るボタン（謎解きパートの有無・強調）を、いまの進捗に合わせる
        // 再起動後に復元した選択が「チュートリアル」のまま、チュートリアルが終わっている場合は、進捗のリストに直す
        if (round >= 1 && this.currentRound === 'tutorial') {
            this.syncRoundListToProgress(round);
        }
        this.updateTutorialOption(round);

        // Scores の送信ボタンに、終えたラウンドを表示する（例: ラウンド2を終えたあとは「ラウンド2結果送信」）
        const submitBtn = document.getElementById('score-submit-btn');
        if (submitBtn) {
            const finishedRound = Math.min(Math.max(round - 1, 0), 4);
            const label = finishedRound >= 1 ? `ラウンド${finishedRound}結果送信` : '結果送信';
            if (submitBtn.textContent !== label) submitBtn.textContent = label;
        }

        // 進捗（Undo の右）: チュートリアル → ラウンド1〜4 → 全ラウンド終了
        // 先頭にチーム名を付ける（例: 「チームB 全ラウンド終了」）。チームの変更は updateDisplay → ここで反映される
        const team = window.LuckyBoxEngine.getApi().getTeam();
        const progress = finished ? '全ラウンド終了' : (tutorial ? 'チュートリアル' : `ラウンド${round}`);
        // ラウンド1〜4では、パート（謎解き / ビンゴ）も表示する
        const partHtml = (!finished && !tutorial)
            ? `<span class="progress-part is-${this.part}">${LuckyBoxUI.PART_LABELS[this.part]}</span>`
            : '';
        const progressEl = document.getElementById('progress-label');
        if (progressEl) {
            const html = `<span class="progress-team">チーム${team}</span><span class="progress-step${(!finished && !tutorial) ? ` is-round${round}` : ''}">${progress}</span>${partHtml}`;
            if (progressEl.dataset.html !== html) {
                progressEl.dataset.html = html;
                progressEl.innerHTML = html;
            }
        }
        const endBtn = document.getElementById('round-end-btn');
        if (endBtn) {
            endBtn.disabled = finished;
            endBtn.textContent = finished ? 'ラウンド終了済み' : (tutorial ? 'ラウンド0(チュートリアル)終了' : `ラウンド${round} 終了`);
        }
        const starMinus = document.querySelector('[data-hud-adjust="star"][data-amount="-1"]');
        const moonMinus = document.querySelector('[data-hud-adjust="moon"][data-amount="-1"]');
        if (starMinus) starMinus.disabled = star <= 0;
        if (moonMinus) moonMinus.disabled = moon <= 0;
        const lightningMinus = document.querySelector('[data-hud-adjust="lightning"][data-amount="-1"]');
        if (lightningMinus) lightningMinus.disabled = lightning <= 0;
    }

    // 「チュートリアルカード」の選択肢は、チュートリアル中（オールリセット後〜チュートリアル終了まで）だけ出す。
    // 一覧から外すときは option を取り除く（iOS などは hidden が効かないため）。Undo で戻れば再び出る
    updateTutorialOption(round) {
        const roundSelect = document.getElementById('round-select');
        if (!roundSelect) return;
        const existing = roundSelect.querySelector('option[value="tutorial"]');
        if (round >= 1) {
            if (existing) {
                this._tutorialOption = existing;
                existing.remove();
            }
        } else if (!existing) {
            const option = this._tutorialOption || new Option('チュートリアルカード', 'tutorial');
            roundSelect.insertBefore(option, roundSelect.firstChild);
            roundSelect.value = this.currentRound;
        }
    }

    // ラウンド選択欄の色を、いま選んでいるラウンドの色（LBカードの帯と同じ）にする。色は CSS の data-round で決まる
    updateRoundSelectColor() {
        const roundSelect = document.getElementById('round-select');
        if (roundSelect) roundSelect.dataset.round = this.currentRound || roundSelect.value;
    }

    // 進捗（0 = チュートリアル、1〜4 = ラウンド、5 = 全ラウンド終了）に対応するカードのリストへ切り替える
    syncRoundListToProgress(round) {
        const name = round <= 0 ? 'tutorial' : `round${Math.min(round, 4)}`;
        if (this.currentRound === name) return;
        this.currentRound = name;
        const roundSelect = document.getElementById('round-select');
        if (roundSelect) roundSelect.value = name;
        this.updateRoundSelectColor();
        this.saveUiState();
        this.loadRoundCards();
    }

    // 「ラウンド終了」: いまのラウンドの星の数を記録して、星を 0 に戻し、次のラウンドへ進める（Undo で戻せる）
    async endRound() {
        if (!this.gameState) return;
        const round = this.gameState.round_num ?? 1;
        if (round > 4) return;
        const star = this.gameState.star_tokens || 0;
        const message = round === 0
            ? 'チュートリアルを終了しますか？\n雷 0・月 1・星 0 にして、ラウンド1を始めます。'
            : `ラウンド${round}を終了しますか？\n星 ${star}個を記録して、星を 0 に戻し、Scores をスプシに送信します。`;
        if (this._endingRound || !confirm(message)) return;

        this._endingRound = true;
        // 前回の送信結果の表示は、ここで消す
        clearTimeout(this._roundEndStatusTimer);
        const prevStatus = document.getElementById('round-end-status');
        if (prevStatus) {
            prevStatus.textContent = '';
            prevStatus.classList.remove('is-error');
        }
        try {
            const result = await this.apiCall('end_round', {});
            if (result && result.success && result.game_state) {
                this.gameState = result.game_state;
                // チュートリアル終了では、チュートリアルカードが盤面から消えるので、カードも描き直す
                this.updateDisplay();
                this.updateUiAfterHistoryOnly();
            } else {
                alert(`ラウンド終了に失敗しました: ${(result && result.error) || '不明なエラー'}`);
                return;
            }

            // ラウンド1〜4の終了後は、更新された Scores をそのままスプシへ送信する（チュートリアル終了では送らない）
            if (round >= 1) {
                await this.submitScoreToSheet();
                const statusEl = document.getElementById('score-submit-status');
                // 送信の結果は、ボタンのそばにも表示する
                const nearStatus = document.getElementById('round-end-status');
                if (nearStatus && statusEl) {
                    const isError = statusEl.classList.contains('is-error');
                    nearStatus.textContent = statusEl.textContent;
                    nearStatus.classList.toggle('is-error', isError);
                    // 送信完了のメッセージは、5秒後に消す（失敗のメッセージは、気づけるよう残す）
                    clearTimeout(this._roundEndStatusTimer);
                    if (!isError) {
                        this._roundEndStatusTimer = setTimeout(() => {
                            nearStatus.textContent = '';
                            nearStatus.classList.remove('is-error');
                        }, 5000);
                    }
                }
                if (statusEl && statusEl.classList.contains('is-error')) {
                    alert(`ラウンド${round}は終了しましたが、スプシへの送信に失敗しました。\n${statusEl.textContent}\n（Scores の「結果送信」で再送信できます）`);
                }
            }
        } finally {
            this._endingRound = false;
        }
    }

    // トークンボタンの設定
    setupTokenButtons() {
        console.log('トークンボタン設定開始');
        
        // 雷トークンボタン
        const lightningPlusBtn = document.getElementById('lightning-plus');
        const lightningMinusBtn = document.getElementById('lightning-minus');
        
        if (lightningPlusBtn) {
            // 既存のイベントリスナーを削除
            const newBtn = lightningPlusBtn.cloneNode(true);
            lightningPlusBtn.parentNode.replaceChild(newBtn, lightningPlusBtn);
            
            newBtn.addEventListener('click', () => {
                this.adjustTokens('lightning', 1);
            });
        }
        
        if (lightningMinusBtn) {
            // 既存のイベントリスナーを削除
            const newBtn = lightningMinusBtn.cloneNode(true);
            lightningMinusBtn.parentNode.replaceChild(newBtn, lightningMinusBtn);
            
            newBtn.addEventListener('click', () => {
                this.adjustTokens('lightning', -1);
            });
        }

        // 月トークンボタン
        const moonPlusBtn = document.getElementById('moon-plus');
        const moonMinusBtn = document.getElementById('moon-minus');
        
        if (moonPlusBtn) {
            // 既存のイベントリスナーを削除
            const newBtn = moonPlusBtn.cloneNode(true);
            moonPlusBtn.parentNode.replaceChild(newBtn, moonPlusBtn);
            
            newBtn.addEventListener('click', () => {
                this.adjustTokens('moon', 1);
            });
        }
        
        if (moonMinusBtn) {
            // 既存のイベントリスナーを削除
            const newBtn = moonMinusBtn.cloneNode(true);
            moonMinusBtn.parentNode.replaceChild(newBtn, moonMinusBtn);
            
            newBtn.addEventListener('click', () => {
                this.adjustTokens('moon', -1);
            });
        }

        // 星トークンボタン
        const starPlusBtn = document.getElementById('star-plus');
        const starMinusBtn = document.getElementById('star-minus');
        
        if (starPlusBtn) {
            // 既存のイベントリスナーを削除
            const newBtn = starPlusBtn.cloneNode(true);
            starPlusBtn.parentNode.replaceChild(newBtn, starPlusBtn);
            
            newBtn.addEventListener('click', () => {
                this.adjustTokens('star', 1);
            });
        }
        
        if (starMinusBtn) {
            // 既存のイベントリスナーを削除
            const newBtn = starMinusBtn.cloneNode(true);
            starMinusBtn.parentNode.replaceChild(newBtn, starMinusBtn);
            
            newBtn.addEventListener('click', () => {
                this.adjustTokens('star', -1);
            });
        }
        
        console.log('トークンボタン設定完了');
        
        // 初期状態でボタンの有効/無効を設定
        this.updateTokenButtonStates();
    }

    updateTokenButtonStates() {
        if (!this.gameState) return;
        
        const lightningTokens = this.gameState.lightning_tokens || 0;
        const moonTokens = this.gameState.moon_tokens || 0;
        const starTokens = this.gameState.star_tokens || 0;
        const canUndo = this.gameState.can_undo || false;
        
        const lightningMinusBtn = document.getElementById('lightning-minus');
        const moonMinusBtn = document.getElementById('moon-minus');
        const starMinusBtn = document.getElementById('star-minus');
        const undoBtns = document.querySelectorAll('.undo-btn');
        
        // Undoボタンの状態を更新（全Undoボタン共通）
        undoBtns.forEach(undoBtn => {
            undoBtn.disabled = !canUndo;
            if (canUndo) {
                undoBtn.style.background = 'white';
                undoBtn.style.color = '#667eea';
                undoBtn.style.borderColor = '#667eea';
                undoBtn.style.opacity = '1';
                undoBtn.style.cursor = 'pointer';
            } else {
                undoBtn.style.background = '#f0f0f0';
                undoBtn.style.color = '#ccc';
                undoBtn.style.borderColor = '#ccc';
                undoBtn.style.opacity = '0.5';
                undoBtn.style.cursor = 'not-allowed';
            }
        });
        
        if (lightningMinusBtn) {
            lightningMinusBtn.disabled = lightningTokens <= 0;
            if (lightningTokens <= 0) {
                lightningMinusBtn.style.background = '#f0f0f0';
                lightningMinusBtn.style.color = '#ccc';
                lightningMinusBtn.style.borderColor = '#ccc';
                lightningMinusBtn.style.opacity = '0.5';
            } else {
                lightningMinusBtn.style.background = 'white';
                lightningMinusBtn.style.color = '#667eea';
                lightningMinusBtn.style.borderColor = '#667eea';
                lightningMinusBtn.style.opacity = '1';
            }
        }
        if (moonMinusBtn) {
            moonMinusBtn.disabled = moonTokens <= 0;
            if (moonTokens <= 0) {
                moonMinusBtn.style.background = '#f0f0f0';
                moonMinusBtn.style.color = '#ccc';
                moonMinusBtn.style.borderColor = '#ccc';
                moonMinusBtn.style.opacity = '0.5';
            } else {
                moonMinusBtn.style.background = 'white';
                moonMinusBtn.style.color = '#667eea';
                moonMinusBtn.style.borderColor = '#667eea';
                moonMinusBtn.style.opacity = '1';
            }
        }
        if (starMinusBtn) {
            starMinusBtn.disabled = starTokens <= 0;
            if (starTokens <= 0) {
                starMinusBtn.style.background = '#f0f0f0';
                starMinusBtn.style.color = '#ccc';
                starMinusBtn.style.borderColor = '#ccc';
                starMinusBtn.style.opacity = '0.5';
            } else {
                starMinusBtn.style.background = 'white';
                starMinusBtn.style.color = '#667eea';
                starMinusBtn.style.borderColor = '#667eea';
                starMinusBtn.style.opacity = '1';
            }
        }
    }

    async adjustTokens(tokenType, amount) {
        try {
            // フロントエンドの状態を即座に更新（盤面は変わらないので全面描き直しはしない）
            const currentValue = this.gameState[`${tokenType}_tokens`] || 0;
            const newValue = currentValue + amount;
            
            if (newValue < 0) {
                return;
            }
            
            this.gameState[`${tokenType}_tokens`] = newValue;
            this.updateTokensDisplay();
            
            const result = await this.apiCall('adjust_tokens', {
                token_type: tokenType,
                amount: amount
            });
            
            if (result && result.game_state) {
                this.gameState = result.game_state;
                // 得点欄（星・月・雷の個数）も自動で変わるので、スコア表示も更新する
                this.updateDisplays();
                this.updateUiAfterHistoryOnly();
            } else {
                console.error('トークン調整失敗: レスポンスが空です');
                this.gameState[`${tokenType}_tokens`] = currentValue;
                this.updateTokensDisplay();
                alert('トークン調整に失敗しました');
            }
        } catch (error) {
            console.error('トークン調整エラー:', error);
            alert(`エラーが発生しました: ${error.message}`);
        }
    }

    // 履歴だけが増えた操作向け。カード盤面は触らないので全面更新しない。
    updateUiAfterHistoryOnly() {
        this.updateTokenButtonStates();
        requestAnimationFrame(() => this.updateHistoryDisplay());
    }

    async loadRoundCards() {
        try {
            console.log(`ラウンドカード読み込み開始: ${this.currentRound}`);
            
            // 有効なラウンドかチェック
            const validRounds = ['tutorial', 'round1', 'round2', 'round3', 'round4'];
            if (!validRounds.includes(this.currentRound)) {
                console.log(`無効なラウンドです: ${this.currentRound}`);
                this.updateCardSelect([]);
                return;
            }
            
            const result = await this.apiCall(`cards_by_round/${this.currentRound}`);
            
            if (result && result.success) {
                console.log(`ラウンド ${this.currentRound} のカード数: ${result.cards ? result.cards.length : 0}`);
                this.updateCardSelect(result.cards || []);
            } else {
                const errorMsg = result ? result.error : '無効なレスポンス';
                console.error('ラウンドカード読み込み失敗:', errorMsg);
                this.updateCardSelect([]);
            }
        } catch (error) {
            console.error('ラウンドカード読み込みエラー:', error);
            this.updateCardSelect([]);
        }
    }

    updateCardSelect(cards) {
        const cardSelect = document.getElementById('card-id');
        if (!cardSelect) return;
        const addBtn = document.getElementById('add-card-btn');
        
        // 現在追加されているカードのIDを取得
        // （盤面にあるカードと、コンプリートのプールに移ったカードは、追加できない）
        const addedCardIds = this.gameState
            ? (this.gameState.cards || []).concat(this.gameState.completed_cards || []).map(card => card.card_id)
            : [];
        // 今後は使わないカード。ラウンド4は Last 1枚だけを登録し、シールを貼って変化させる
        const hiddenCardIds = ['LastSP'];
        
        cardSelect.innerHTML = '';
        
        // 追加済みを除いた有効カード。先頭がデフォルト選択になる
        const available = cards.filter((card) =>
            !addedCardIds.includes(card.card_id) && !hiddenCardIds.includes(card.card_id)
        );
        available.forEach((card) => {
            const option = document.createElement('option');
            option.value = card.card_id;
            option.textContent = card.display_name;
            cardSelect.appendChild(option);
        });
        
        if (available.length === 0) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = '[追加可能なカードがありません]';
            cardSelect.appendChild(option);
            cardSelect.disabled = true;
            if (addBtn) addBtn.disabled = true;
        } else {
            cardSelect.disabled = false;
            cardSelect.selectedIndex = 0;
            if (addBtn) addBtn.disabled = false;
        }
    }

    // サーバーへ送る代わりに、ブラウザ内のゲームエンジン(engine.js)を呼び出す
    async apiCall(endpoint, data = null) {
        try {
            return window.LuckyBoxEngine.getApi().call(endpoint, data);
        } catch (error) {
            console.error(`API呼び出しエラー (${endpoint}):`, error);
            throw error;
        }
    }

    async addCard() {
        try {
            console.log('カード追加処理開始');
            
            const cardSelect = document.getElementById('card-id');
            const cardId = cardSelect.value;
            
            if (!cardId) {
                alert('追加可能なカードがありません');
                return;
            }
            
            const result = await this.apiCall('add_card', { card_id: cardId });
            
            if (result.success) {
                this.gameState = result.game_state;
                this.updateDisplay();
                // 追加済みを除いたリストを作り直し、先頭をデフォルト選択にする
                await this.loadRoundCards();
            } else {
                console.error('カード追加失敗:', result.error);
                alert(`カード追加失敗: ${result.error}`);
            }
        } catch (error) {
            console.error('カード追加エラー:', error);
            alert(`エラーが発生しました: ${error.message}`);
        }
    }

    /* ---------------- チーム選択（シールに表示する文字） ---------------- */
    setupTeamSelect() {
        const select = document.getElementById('team-select');
        if (!select) return;

        select.innerHTML = '';
        for (const team of window.LuckyBoxEngine.STICKER_CONFIG.teams) {
            const option = document.createElement('option');
            option.value = team;
            option.textContent = team;
            select.appendChild(option);
        }
        select.value = window.LuckyBoxEngine.getApi().getTeam();

        select.addEventListener('change', async () => {
            const result = await this.apiCall('set_team', { team: select.value });
            if (result && result.game_state) this.gameState = result.game_state;
            this.updateDisplay();
        });
    }

    // 選択欄を、エンジンの現在のチームに合わせる（Undo・リセット・再読み込みのあとも正しく表示するため）
    syncTeamSelect() {
        const select = document.getElementById('team-select');
        if (select) select.value = window.LuckyBoxEngine.getApi().getTeam();
    }

    /* ---------------- 得点欄のスタッフ入力（星・雷・月） ---------------- */
    setupScoreInputs() {
        const starIcon = document.getElementById('score-star-icon');
        const lightningIcon = document.getElementById('score-lightning-icon');
        const moonIcon = document.getElementById('score-moon-icon');
        if (starIcon) starIcon.innerHTML = this.getBonusIcon('star');
        if (lightningIcon) lightningIcon.innerHTML = this.getBonusIcon('lightning');
        if (moonIcon) moonIcon.innerHTML = this.getBonusIcon('moon');

        const countIds = [
            'score-star-r1', 'score-star-r2', 'score-star-r3', 'score-star-r4',
            'score-lightning-count', 'score-moon-count',
        ];
        const exIds = [
            'score-star-r1-ex', 'score-star-r2-ex', 'score-star-r3-ex', 'score-star-r4-ex',
            'score-lightning-ex', 'score-moon-ex',
        ];

        countIds.forEach((id) => {
            const select = document.getElementById(id);
            if (!select || select.options.length) return;
            for (let n = 0; n <= 99; n++) {
                const option = document.createElement('option');
                option.value = String(n);
                option.textContent = String(n);
                select.appendChild(option);
            }
        });

        // 星の Ex は R4 でしか取れないので、R1〜R3 のチェックは押せなくする（位置はそろえたまま、うすく表示）
        ['score-star-r1-ex', 'score-star-r2-ex', 'score-star-r3-ex'].forEach((id) => {
            const box = document.getElementById(id);
            if (!box) return;
            box.disabled = true;
            box.title = '星の Ex はラウンド4のみ';
            const label = box.closest('.score-ex-check');
            if (label) label.classList.add('is-disabled');
        });

        // 個数（星・雷・月）は、獲得したぶんを自動で数えて表示する（スタッフが直すときは、画面上の「−／＋」で増減する）。
        // ここでスタッフが入力するのは Ex の有無だけ
        countIds.forEach((id) => {
            const select = document.getElementById(id);
            if (select) {
                select.disabled = true;
                select.title = '自動で数えています（星・月の「−／＋」、雷の「＋」で増減）';
            }
        });

        const save = async () => {
            const result = await this.apiCall('set_score_inputs', {
                star_ex: [1, 2, 3, 4].map((r) => document.getElementById(`score-star-r${r}-ex`).checked),
                lightning_ex: document.getElementById('score-lightning-ex').checked,
                moon_ex: document.getElementById('score-moon-ex').checked,
            });
            if (result && result.game_state) this.gameState = result.game_state;
            this.updateDisplay();
        };

        countIds.concat(exIds).forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', save);
        });
    }

    /* ---------------- Scores → スプシ送信 ---------------- */
    setupScoreSubmit() {
        const btn = document.getElementById('score-submit-btn');
        if (!btn || btn.dataset.bound === '1') return;
        btn.dataset.bound = '1';
        btn.addEventListener('click', () => this.submitScoreToSheet());
    }

    setScoreSubmitStatus(message, isError) {
        const el = document.getElementById('score-submit-status');
        if (!el) return;
        el.textContent = message || '';
        el.classList.toggle('is-error', !!isError);
    }

    buildScoreSyncPayload() {
        const details = (this.gameState && this.gameState.score_details) || {};
        const moon = details.moon || {};
        const team = window.LuckyBoxEngine.getApi().getTeam();
        const cfg = window.SCORE_SYNC || {};
        // Scores列: A team / B 盤面 / C トークン / E 月Ex / F 月数 / K updated_at
        // D・G・H・I（総合・順位・月点）はスプシ数式（MoonPts）
        return {
            team,
            sheet: cfg.SHEET_NAME || 'Scores',
            start_row: Number(cfg.START_ROW) || 2,
            board: details.board_points ?? 0,
            token: details.bonus_points ?? 0,
            moon_ex: !!moon.ex,
            moon: moon.count || 0,
            updated_at: this.formatScoreSyncTime(new Date()),
        };
    }

    // 例: 10/12 15:50（端末ローカル時刻）
    formatScoreSyncTime(date) {
        const d = date instanceof Date ? date : new Date(date);
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    async submitScoreToSheet() {
        const cfg = window.SCORE_SYNC || {};
        const url = (cfg.WEB_APP_URL || '').trim();
        const btn = document.getElementById('score-submit-btn');
        if (!url) {
            this.setScoreSubmitStatus('送信先 URL 未設定（score-sync.js の WEB_APP_URL）', true);
            return;
        }
        // ライブラリ URL や /exec 以外は Web アプリとして呼べない
        if (url.includes('/macros/library/') || !/\/macros\/s\/[^/]+\/exec\/?$/.test(url.split('?')[0])) {
            this.setScoreSubmitStatus(
                'URL不正: デプロイ「ウェブアプリ」の末尾 /exec のURLを入れてください',
                true
            );
            return;
        }

        const payload = this.buildScoreSyncPayload();
        if (!payload.team) {
            this.setScoreSubmitStatus('チームが未選択です', true);
            return;
        }

        if (btn) btn.disabled = true;
        this.setScoreSubmitStatus(`送信中…（チーム ${payload.team}）`, false);

        try {
            // 一部端末では POST が CORS で落ちるため、失敗したら GET ?payload= にフォールバック
            let parsed = null;
            let lastError = null;
            try {
                parsed = await this.postScoreSync(url, payload);
            } catch (postErr) {
                lastError = postErr;
                console.warn('score sync POST failed, try GET', postErr);
            }
            if (!parsed) {
                try {
                    parsed = await this.getScoreSync(url, payload);
                    lastError = null;
                } catch (getErr) {
                    lastError = getErr;
                    console.warn('score sync GET failed', getErr);
                }
            }
            if (!parsed) {
                if (lastError) throw lastError;
                this.setScoreSubmitStatus(
                    '送信失敗: 応答が不正（Apps Script を新バージョンで再デプロイし /exec で JSON 確認）',
                    true
                );
                return;
            }
            if (parsed.ok === false) {
                this.setScoreSubmitStatus(`送信失敗: ${parsed.error || 'unknown'}`, true);
                return;
            }
            const row = parsed.row ? `（行 ${parsed.row}）` : '';
            this.setScoreSubmitStatus(`送信完了: チーム ${payload.team}${row}`, false);
        } catch (error) {
            console.error('score sync error:', error);
            const tip = /Failed to fetch/i.test(String(error && error.message))
                ? '（Apps Script を「編集→新バージョン」で再デプロイ。/exec で JSON 確認。新しいデプロイなら URL も更新）'
                : '';
            this.setScoreSubmitStatus(`送信失敗: ${error.message || error}${tip}`, true);
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    async postScoreSync(url, payload) {
        // Apps Script は application/json だとプリフライトで落ちやすい → text/plain
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload),
            redirect: 'follow',
        });
        return this.parseScoreSyncResponse(res);
    }

    async getScoreSync(url, payload) {
        const endpoint = new URL(url);
        endpoint.searchParams.set('payload', JSON.stringify(payload));
        const res = await fetch(endpoint.toString(), {
            method: 'GET',
            redirect: 'follow',
        });
        return this.parseScoreSyncResponse(res);
    }

    async parseScoreSyncResponse(res) {
        const text = await res.text();
        try {
            return JSON.parse(text);
        } catch (_) {
            return null;
        }
    }

    syncScoreInputs() {
        const details = (this.gameState && this.gameState.score_details) || {};
        const star = details.star || {};
        const lightning = details.lightning || {};
        const moon = details.moon || {};
        const rounds = Array.isArray(star.rounds) ? star.rounds : [];
        const setVal = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.value = String(value);
        };
        const setCheck = (id, on) => {
            const el = document.getElementById(id);
            if (el) el.checked = !!on;
        };
        const setText = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        };
        for (let i = 0; i < 4; i++) {
            const round = rounds[i] || {};
            setVal(`score-star-r${i + 1}`, round.count || 0);
            setCheck(`score-star-r${i + 1}-ex`, round.ex);
            setText(`score-star-r${i + 1}-pts`, `${round.points || 0}点`);
        }
        setVal('score-lightning-count', lightning.count || 0);
        setVal('score-moon-count', moon.count || 0);
        setCheck('score-lightning-ex', lightning.ex);
        setCheck('score-moon-ex', moon.ex);
    }

    /* ---------------- シール編集（ラウンド4の Last） ---------------- */
    // 現実で貼ったシールと同じ盤面を、スタッフがアプリ上で作る。
    //   「シール編集」→ 3x3 / 2x2 を選ぶ → 貼る位置の左上のマスをタップ（貼ったシールをタップすると外す）→「完了」

    // カードの統合マス（シール）の一覧 [{row, col, size}] を、盤面の情報から求める
    getStickers(card) {
        return (card.merged_groups || [])
            .filter((group) => Array.isArray(group) && group.length)
            .map((group) => {
                const rows = group.map((cell) => cell[0]);
                const cols = group.map((cell) => cell[1]);
                const row = Math.min(...rows);
                const col = Math.min(...cols);
                return { row, col, size: Math.max(...rows) - row + 1 };
            });
    }

    createStickerTools(card, editing) {
        const config = window.LuckyBoxEngine.STICKER_CONFIG;
        if (!config.cards.includes(card.card_id)) return '';

        if (!editing) {
            return `
                <div class="sticker-tools staff-only">
                    <button type="button" class="sticker-btn" onclick="window.luckyBoxUI.startStickerEdit('${card.card_id}')">シール編集</button>
                </div>`;
        }

        const stickers = this.getStickers(card);
        const left = (size) => config.max[size] - stickers.filter((s) => s.size === size).length;
        const tool = this.stickerEdit.tool;
        const message = this.stickerEdit.message
            ? `<div class="sticker-msg">${this.stickerEdit.message}</div>`
            : '';
        return `
            <div class="sticker-tools staff-only editing">
                <span class="sticker-title">シール編集中</span>
                <button type="button" class="sticker-btn${tool === 3 ? ' active' : ''}" onclick="window.luckyBoxUI.setStickerTool(3)">3x3（あと${left(3)}枚）</button>
                <button type="button" class="sticker-btn${tool === 2 ? ' active' : ''}" onclick="window.luckyBoxUI.setStickerTool(2)">2x2（あと${left(2)}枚）</button>
                <button type="button" class="sticker-btn done" onclick="window.luckyBoxUI.endStickerEdit()">完了</button>
                <div class="sticker-help">貼る位置の左上のマスをタップ。貼ったシール（${window.LuckyBoxEngine.getApi().getTeam()}）をタップすると外れます。</div>
                ${message}
            </div>`;
    }

    startStickerEdit(cardId) {
        const card = (this.gameState.cards || []).find((c) => c.card_id === cardId);
        if (!card) return;
        if ((card.marked || []).some((rowMarks) => rowMarks.some(Boolean))) {
            alert('黒マスがあるため、シールを変更できません。');
            return;
        }
        this.stickerEdit = { cardId, tool: 3, message: '' };
        this.updateDisplay();
    }

    setStickerTool(size) {
        if (!this.stickerEdit) return;
        this.stickerEdit.tool = size;
        this.stickerEdit.message = '';
        this.updateDisplay();
    }

    endStickerEdit() {
        this.stickerEdit = null;
        this.updateDisplay();
    }

    // シール編集中にマスをタップしたとき（markCell から呼ばれる）
    async handleStickerTap(cardIndex, row, col) {
        const card = this.gameState.cards[cardIndex];
        if (!card) return;
        const [rows, cols] = card.size;
        const stickers = this.getStickers(card);

        // すでにシールがある場所なら、そのシールを外す
        const hit = stickers.findIndex((s) =>
            row >= s.row && row < s.row + s.size && col >= s.col && col < s.col + s.size);
        let next;
        if (hit >= 0) {
            next = stickers.filter((_, i) => i !== hit);
        } else {
            // タップしたマスを左上として貼る。盤面の端でははみ出さないよう、内側へずらす
            const size = this.stickerEdit.tool;
            next = stickers.concat([{
                row: Math.min(row, rows - size),
                col: Math.min(col, cols - size),
                size
            }]);
        }

        const result = await this.apiCall('set_stickers', { card_index: cardIndex, stickers: next });
        if (result && result.success) {
            this.stickerEdit.message = '';
        } else {
            this.stickerEdit.message = (result && result.error) || 'シールを変更できませんでした';
        }
        if (result && result.game_state) this.gameState = result.game_state;
        this.updateDisplay();
    }

    // 「Complete」ボタン: カードをカレントのプールから外して、コンプリートのプールへ移す
    // 移せたら true
    async completeCard(cardIndex) {
        try {
            const result = await this.apiCall('complete_card', { card_index: cardIndex });
            if (result && result.success) {
                this.gameState = result.game_state;
                this.updateDisplay();
                return true;
            }
            console.error('コンプリート移動失敗:', result);
            alert(`Complete に失敗しました: ${result && result.error ? result.error : '全マスが埋まっていません'}`);
        } catch (error) {
            console.error('コンプリート移動エラー:', error);
            alert(`エラーが発生しました: ${error.message}`);
        }
        return false;
    }

    async undo() {
        try {
            // 気軽に押せないよう、戻す内容を見せて確認する。履歴の一番新しい操作が、いま戻される操作
            const history = (this.gameState && this.gameState.history) || [];
            const last = history[history.length - 1];
            const label = last && last.action ? String(last.action) : '';
            const message = label
                ? `【${label}】を取り消して戻します。\nよろしいですか？`
                : '直前の操作を取り消して戻します。\nよろしいですか？';
            if (!confirm(message)) return;

            // Undo のあとは、読み上げ番号の選択を解除して、① 番号待ちから始める
            this.calledNumber = null;
            const beforeKey = this.cardMembershipKey();
            const result = await this.apiCall('undo', {});
            
            if (result && result.success) {
                this.gameState = result.game_state;
                const afterKey = this.cardMembershipKey();
                this.loadBonusStates();
                if (beforeKey === afterKey && this.refreshActiveCardsInPlace()) {
                    // カード構成が同じ（マスUndoなど）→ 選択リスト再構築も全面innerHTMLも避ける
                    this.updateDisplays();
                    requestAnimationFrame(() => this.updateHistoryDisplay());
                } else {
                    this.syncTeamSelect();
                    this.updateCardsDisplay();
                    this.updateDisplays();
                    requestAnimationFrame(() => this.updateHistoryDisplay());
                    await this.loadRoundCards();
                }
            } else {
                console.error('Undo失敗:', result);
                const errorMsg = result ? result.error : 'レスポンスが無効です';
                alert(`Undo失敗: ${errorMsg}`);
            }
        } catch (error) {
            console.error('Undoエラー:', error);
            alert(`エラーが発生しました: ${error.message}`);
        }
    }

    // 盤面／コンプリートに載っているカードIDの集合（Undo 後に選択リスト更新が要るかの判定用）
    cardMembershipKey() {
        if (!this.gameState) return '';
        const active = (this.gameState.cards || []).map((c) => c.card_id);
        const done = (this.gameState.completed_cards || []).map((c) => c.card_id);
        return `${active.join(',')}|${done.join(',')}`;
    }

    // アクティブカードを1枚ずつ差し替える。失敗したら false（呼び出し側で全面更新）
    refreshActiveCardsInPlace() {
        const cards = (this.gameState && this.gameState.cards) || [];
        if (!cards.length) return false;
        for (let i = 0; i < cards.length; i++) {
            if (!this.replaceActiveCard(i)) return false;
        }
        return true;
    }

    async reset(confirmed = false) {
        try {
            console.log('Reset処理開始');
            this.stickerEdit = null;
            
            if (!confirmed) {
                if (!confirm('本当にゲームをリセットしますか？\nすべての進行状況が失われます。')) {
                    return;
                }
                // 2回目の確認（誤操作防止）
                if (!confirm('【最終確認】\nすべてのカード・トークン・得点が消えて、タイトル画面に戻ります。\n本当にオールリセットしてよろしいですか？')) {
                    return;
                }
                confirmed = true;
            }
            
            const result = await this.apiCall('reset', {});
            
            if (result.success) {
                console.log('Reset成功');
                // 前回の「使用済み」表示が次のゲームに残らないよう、手動トグル状態も消す
                this.manualBonusStates.clear();
                this.calledNumber = null;
                this.bonusSelection = null;
                // オールリセットで、番号カードは 1〜9 の表示に戻る（0 は、モード表示の5回タップでまた出せる）
                this.showZero = false;
                this.renderCallNumbers();
                this.gameState = result.game_state;

                // リセット後は、最初の状態として「カード Tutorial」を追加し、ラウンドの選択を「チュートリアル」にする
                this.currentRound = 'tutorial';
                const roundSelect = document.getElementById('round-select');
                if (roundSelect) {
                    roundSelect.value = this.currentRound;
                }
                this.updateRoundSelectColor();
                this.saveUiState();

                const addResult = await this.apiCall('add_card', { card_id: 'Tutorial' });
                if (addResult && addResult.success) {
                    this.gameState = addResult.game_state;
                } else {
                    console.error('リセット後の Tutorial 追加に失敗:', addResult);
                }

                this.updateDisplay();
                await this.loadRoundCards();

                // オールリセット後は、スタッフモードを終えてタイトル画面へ戻る
                if (window.StaffMode && typeof window.StaffMode.showTitle === 'function') {
                    window.StaffMode.showTitle();
                }
            } else {
                console.error('Reset失敗:', result.error);
                alert(`Reset失敗: ${result.error}`);
            }
        } catch (error) {
            console.error('Resetエラー:', error);
            alert(`エラーが発生しました: ${error.message}`);
        }
    }

    async markCell(cardIndex, row, col) {
        // シール編集中のカードのマスをタップしたときは、マークではなくシールの貼り外しにする
        const tappedCard = this.gameState && this.gameState.cards && this.gameState.cards[cardIndex];
        if (this.stickerEdit && tappedCard && tappedCard.card_id === this.stickerEdit.cardId) {
            await this.handleStickerTap(cardIndex, row, col);
            return;
        }

        // 数字・？のボーナスを選択中、またはビンゴパートの流れの中（読み上げ番号の選択前・ボーナス選択前も含む）は、
        // 明示されたマス（bonus-target）以外は押せない
        const enforced = this.flowEnforced();
        if (this.bonusSelection || enforced) {
            const cardEl = document.querySelector(`#cards-container .bingo-card[data-card-index="${cardIndex}"]`);
            const cellEl = cardEl && cardEl.querySelector(`.bingo-cell[data-row="${row}"][data-col="${col}"]`);
            if (!cellEl || !cellEl.classList.contains('bonus-target')) {
                if (enforced) this.nudgeFlow();
                return;
            }
        }

        // 既に処理中の場合は何もしない
        if (this.isMarkingCell) {
            return;
        }
        
        this.isMarkingCell = true;

        // 選択中のボーナスがあれば、このマスを押した時点で「使用済み」にする。
        // マスのマークより先に保存して、Undo でマスと一緒に元へ戻るようにする
        const consumedBonusKey = this.consumeBonusSelection();
        // 読み上げ番号のマスをタップしたとき（ボーナスではないとき）は、番号の選択を終える（1回の読み上げにつき1マス）
        const consumedCalled = (!consumedBonusKey && enforced && this.calledNumber !== null) ? this.calledNumber : null;
        // ② で使うと決めた雷。マスのマークが成功したあとに、その数だけトークンを減らす
        const usedLightning = consumedCalled !== null ? this.lightningReserved : 0;
        if (consumedCalled !== null) {
            this.calledNumber = null;
            this.lightningReserved = 0;
        }

        // 弱い端末向け: エンジン処理の前に黒塗りを見せて、タップ感を先に返す
        this.paintCellOptimistic(cardIndex, row, col);
        await new Promise((resolve) => requestAnimationFrame(resolve));
        
        try {
            const result = await this.apiCall('mark_cell', {
                card_index: cardIndex,
                row: row,
                col: col
            });
            
            if (result && result.success === true) {
                this.gameState = result.game_state;
                this.updateAfterMark(cardIndex);
                // 使った雷のぶん、トークンを減らす（操作履歴にも残る）
                if (usedLightning > 0) await this.adjustTokens('lightning', -usedLightning);
            } else {
                // 楽観更新を取り消すため、盤面を正式状態で描き直す
                this.revertBonusConsume(consumedBonusKey);
                if (consumedCalled !== null) {
                    this.calledNumber = consumedCalled;
                    this.lightningReserved = usedLightning;
                }
                this.updateDisplay();
                const errorMsg = result ? (result.error || '不明なエラー') : 'レスポンスが無効です';
                console.error(`セルマーク失敗: ${errorMsg}`);
                alert(`セルのマークに失敗しました: ${errorMsg}`);
            }
        } catch (error) {
            this.revertBonusConsume(consumedBonusKey);
            if (consumedCalled !== null) {
                this.calledNumber = consumedCalled;
                this.lightningReserved = usedLightning;
            }
            this.updateDisplay();
            console.error('セルマークエラー:', error);
            alert(`エラーが発生しました: ${error.message}`);
        } finally {
            this.isMarkingCell = false;
            this.checkAutoComplete(); // 処理が終わったので、自動 Complete の条件を確認し直す
        }
    }

    // タップしたマス（統合マスなら代表マス）を、エンジン結果を待たずに黒くする
    paintCellOptimistic(cardIndex, row, col) {
        const cardEl = document.querySelector(`.bingo-card[data-card-index="${cardIndex}"]`);
        if (!cardEl) return;
        const cell = cardEl.querySelector(`.bingo-cell[data-row="${row}"][data-col="${col}"]`);
        if (!cell || cell.classList.contains('marked')) return;
        cell.classList.add('marked');
        cell.removeAttribute('onclick');
    }

    // マスマーク後の画面更新（全カード再構築を避け、触ったカードだけ差し替える）
    updateAfterMark(cardIndex) {
        this.loadBonusStates();
        if (this._redrawCompletedAfterMark || !this.replaceActiveCard(cardIndex)) {
            this._redrawCompletedAfterMark = false;
            this.updateCardsDisplay();
        }
        // 得点・雷トレイは必要。履歴は次フレーム
        this.updateDisplays();
        requestAnimationFrame(() => this.updateHistoryDisplay());
    }

    // アクティブ枠内の1枚だけを差し替える。見つからなければ false（呼び出し側で全面更新）
    replaceActiveCard(cardIndex) {
        const card = this.gameState && this.gameState.cards && this.gameState.cards[cardIndex];
        if (!card) return false;
        const existing = document.querySelector(`#cards-container .bingo-card[data-card-index="${cardIndex}"]`);
        if (!existing) return false;

        const keepScrollY = window.scrollY;
        const wrap = document.createElement('div');
        wrap.innerHTML = this.createCardElement(card, cardIndex).trim();
        const next = wrap.firstElementChild;
        if (!next) return false;
        existing.replaceWith(next);
        this.applyBonusHighlight();
        if (window.scrollY !== keepScrollY) {
            window.scrollTo(0, keepScrollY);
        }
        return true;
    }

    updateDisplay() {
        // ボーナス欄の「使用済み」状態は、エンジンの現在の状態から読み直す（Undo 後も正しく戻るように）
        this.loadBonusStates();
        this.syncTeamSelect();
        
        this.updateCardsDisplay();
        this.updateDisplays();
        // 履歴DOMは操作の体感に効かないので後回し
        requestAnimationFrame(() => this.updateHistoryDisplay());
    }

    // カードIDごとの表示順位（ラウンド順 → cards.js の cardsByRound に書かれた順）
    getCardDisplayRankMap() {
        if (this._cardRankMap) return this._cardRankMap;
        const map = new Map();
        const byRound = (window.LUCKYBOX_CARDS && window.LUCKYBOX_CARDS.cardsByRound) || {};
        const roundOrder = ['tutorial', 'round1', 'round2', 'round3', 'round4'];
        let rank = 0;
        roundOrder.forEach((roundName) => {
            (byRound[roundName] || []).forEach((cardId) => {
                if (!map.has(cardId)) map.set(cardId, rank++);
            });
        });
        this._cardRankMap = map;
        return map;
    }

    // カードIDが属するラウンド名（tutorial / round1 〜 round4）。タイトルの帯の色分けに使う
    getCardRound(cardId) {
        const byRound = (window.LUCKYBOX_CARDS && window.LUCKYBOX_CARDS.cardsByRound) || {};
        return Object.keys(byRound).find((roundName) => (byRound[roundName] || []).includes(cardId)) || '';
    }

    updateCardsDisplay() {
        const activeContainer = document.getElementById('cards-container');
        const completedContainer = document.getElementById('completed-cards-container');

        if (!this.gameState) return;

        // アクティブカード描画
        if (activeContainer) {
            // iPad（Safari）では、カードを描き直した瞬間にページが短くなり、
            // 画面が勝手に上へスクロールすることがある。これを防ぐため、
            // 描き直しの間だけカード欄の高さを固定し、スクロール位置も元に戻す。
            const keepScrollY = window.scrollY;
            const keepHeight = activeContainer.offsetHeight;
            if (keepHeight > 0) {
                activeContainer.style.minHeight = `${keepHeight}px`;
            }

            if (!this.gameState.cards || this.gameState.cards.length === 0) {
                activeContainer.innerHTML = '<p class="no-cards">カードが追加されていません</p>';
            } else {
                // 表示順: ラウンド順 → 同一ラウンド内はカード選択リストの順。
                // 内部の登録順（Undo・保存データ・マスのタップ判定に使う番号）は変えず、
                // 表示の並びだけを変える（index は元の番号のまま渡す）。
                const rank = this.getCardDisplayRankMap();
                const ordered = this.gameState.cards
                    .map((card, index) => ({
                        card,
                        index,
                        rank: rank.has(card.card_id) ? rank.get(card.card_id) : Number.MAX_SAFE_INTEGER
                    }))
                    .sort((a, b) => (a.rank - b.rank) || (a.index - b.index));

                activeContainer.innerHTML = ordered.map(({ card, index }) =>
                    this.createCardElement(card, index)
                ).join('');
            }
            this.applyBonusHighlight();

            // スクロール位置を元に戻し、次の描画の後で高さの固定を外す
            if (window.scrollY !== keepScrollY) {
                window.scrollTo(0, keepScrollY);
            }
            setTimeout(() => {
                activeContainer.style.minHeight = '';
                if (window.scrollY !== keepScrollY && document.documentElement.scrollHeight - window.innerHeight >= keepScrollY) {
                    window.scrollTo(0, keepScrollY);
                }
            }, 50);
        }

        // コンプリートカード描画
        if (completedContainer) {
            // コンプリートのプールに入っていて、かつ「Complete」ボタンでカレントから外されたカードだけを表示する
            // （全マスが埋まっただけで、まだボタンを押していないカードは、盤面に残っている）
            const activeIds = new Set((this.gameState.cards || []).map((c) => c.card_id));
            // チュートリアルカードは、チュートリアル中（round_num 0）はコンプリートに表示する。
            // 「チュートリアル終了」を押したあと（round_num 1 以上）は非表示にする（Undo で戻せば再び表示される）
            const tutorialDone = (this.gameState.round_num || 0) >= 1;
            const cards = (this.gameState.completed_cards || [])
                .filter((c) => !activeIds.has(c.card_id) && !(tutorialDone && c.card_id === 'Tutorial'));
            this.completedCards = cards;

            if (!cards.length) {
                completedContainer.innerHTML = '<p class="no-cards">コンプリートカードはありません</p>';
            } else {
                completedContainer.innerHTML = cards.map((card) =>
                    this.createCardElement(card, null, { disableInteractions: true })
                ).join('');
            }
        }
    }

    createCardElement(card, cardIndex, options = {}) {
        const { disableInteractions = false } = options;

        // 新フォーマット対応: display_grid または numbers を使用
        const gridData = card.display_grid || card.numbers;
        const cardSize = card.size || [3, 3];
        const [rowCount, colCount] = Array.isArray(cardSize) ? cardSize : [cardSize, cardSize];
        const mergedGroups = card.merged_groups || [];
        const mergedGroupDetails = card.merged_group_details || card.merged_groups || [];

        const cellToGroup = new Map();
        mergedGroups.forEach((group, groupIndex) => {
            if (!Array.isArray(group)) return;
            group.forEach(cell => {
                if (Array.isArray(cell) && cell.length >= 2) {
                    const key = `${cell[0]}-${cell[1]}`;
                    cellToGroup.set(key, groupIndex);
                } else if (cell && typeof cell === 'object' && 'row' in cell && 'col' in cell) {
                    const key = `${cell.row}-${cell.col}`;
                    cellToGroup.set(key, groupIndex);
                }
            });
        });

        const groupToRepresentative = new Map();
        const representativeSet = new Set();
        mergedGroups.forEach((group, groupIndex) => {
            if (!Array.isArray(group) || group.length === 0) return;
            const rep = group[0];
            const key = `${rep[0]}-${rep[1]}`;
            groupToRepresentative.set(groupIndex, { row: rep[0], col: rep[1] });
            representativeSet.add(key);
        });

        const groupSpanCache = new Map();
        const getGroupSpan = (groupIndex) => {
            if (groupSpanCache.has(groupIndex)) {
                return groupSpanCache.get(groupIndex);
            }
            const group = mergedGroups[groupIndex];
            if (!Array.isArray(group) || group.length === 0) {
                const span = { rowStart: 1, rowSpan: 1, colStart: 1, colSpan: 1 };
                groupSpanCache.set(groupIndex, span);
                return span;
            }
            let minRow = Infinity, maxRow = -Infinity, minCol = Infinity, maxCol = -Infinity;
            group.forEach(cell => {
                let row, col;
                if (Array.isArray(cell) && cell.length >= 2) {
                    row = cell[0];
                    col = cell[1];
                } else if (cell && typeof cell === 'object') {
                    row = cell.row;
                    col = cell.col;
                }
                if (row === undefined || col === undefined) return;
                minRow = Math.min(minRow, row);
                maxRow = Math.max(maxRow, row);
                minCol = Math.min(minCol, col);
                maxCol = Math.max(maxCol, col);
            });
            const span = {
                rowStart: minRow + 1,
                rowSpan: maxRow - minRow + 1,
                colStart: minCol + 1,
                colSpan: maxCol - minCol + 1
            };
            groupSpanCache.set(groupIndex, span);
            return span;
        };

        const getGroupDisplayValue = (groupIndex) => {
            const detail = mergedGroupDetails[groupIndex];
            if (!detail) return null;
            if (typeof detail === 'object' && detail.display_value !== undefined) {
                return detail.display_value;
            }
            return null;
        };
        
        if (!gridData || !Array.isArray(gridData)) {
            console.error('gridDataが配列ではありません:', gridData);
            return `<div class="bingo-card error">カードデータエラー</div>`;
        }
        
        const rowBonuses = card.row_bonuses || [];
        const colBonuses = card.col_bonuses || [];
        const completedLines = card.completed_lines || [];
        
        // 完了した行と列を記録
        const completedRows = new Set();
        const completedCols = new Set();
        
        completedLines.forEach(([type, index]) => {
            if (type === 'row') completedRows.add(index);
            if (type === 'col') completedCols.add(index);
        });

        // メイングリッドを生成（統合マス対応）
        const mainGridCells = [];
        for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
            const row = Array.isArray(gridData[rowIndex]) ? gridData[rowIndex] : [];
            for (let colIndex = 0; colIndex < colCount; colIndex++) {
                const number = row[colIndex] !== undefined ? row[colIndex] : '';
                const key = `${rowIndex}-${colIndex}`;
                const groupIndex = cellToGroup.get(key);
                const isCellInGroup = groupIndex !== undefined;
                const representativeEntry = isCellInGroup ? groupToRepresentative.get(groupIndex) : null;
                const isGroupRepresentative = representativeEntry
                    ? representativeEntry.row === rowIndex && representativeEntry.col === colIndex
                    : false;

                if (isCellInGroup && !isGroupRepresentative) {
                    continue;
                }

                const isMarked = card.marked && card.marked[rowIndex] && card.marked[rowIndex][colIndex];
                const isGroupMarked = isCellInGroup && card.group_marked && card.group_marked[groupIndex];
                const effectiveMarked = isGroupMarked || isMarked;
                const markedClass = effectiveMarked ? 'marked' : '';
                const clickHandler = (disableInteractions || effectiveMarked || cardIndex === null)
                    ? ''
                    : `onclick="window.luckyBoxUI.markCell(${cardIndex}, ${rowIndex}, ${colIndex});"`;

                let cellStyle = `grid-row: ${rowIndex + 1}; grid-column: ${colIndex + 1};`;
                let displayNumber = number;
                let extraClass = '';
                if (isGroupRepresentative) {
                    const span = getGroupSpan(groupIndex);
                    // --span: 統合マスの大きさ（何マス分か）。中の文字は、これに比例して大きくする（card-look.css）
                    cellStyle = `grid-row: ${span.rowStart} / span ${span.rowSpan}; grid-column: ${span.colStart} / span ${span.colSpan}; --span: ${Math.min(span.rowSpan, span.colSpan)};`;
                    const groupDisplay = getGroupDisplayValue(groupIndex);
                    if (groupDisplay !== null && groupDisplay !== undefined) {
                        displayNumber = groupDisplay;
                    }
                    extraClass = ' merged-cell';
                }

                mainGridCells.push(`
                    <div class="bingo-cell ${markedClass}${extraClass}" 
                         style="${cellStyle}"
                         ${clickHandler}
                         data-row="${rowIndex}" 
                         data-col="${colIndex}"
                         data-value="${displayNumber}">
                        <div class="cell-content">
                            <span class="cell-number">${displayNumber}</span>
                        </div>
                    </div>
                `);
            }
        }

        const createBonusCell = ({ type, index, bonus }) => {
            const bonuses = Array.isArray(bonus) ? bonus : (bonus ? [bonus] : []);
            const bonusItems = this.flattenBonusItems(bonuses);
            let iconsHtml = this.formatBonusDisplay(bonuses);
            const bonusState = this.getBonusState(card, type, index);
            let bonusClass = bonusState === 'used' ? 'used'
                : ((type === 'row' ? completedRows : completedCols).has(index) ? 'available' : '');
            const bonusKey = `${card.card_id}:${type}:${index}`;
            // 数字・？を使える回数（「？2」のように複数あるマスは、その回数だけ使える）
            const slots = bonusItems.filter((item) => item === 'wildcard' || item.startsWith('number_')).length;

            if (bonusClass === 'available') {
                const initialClass = this.determineInitialBonusClass(bonusItems);
                if (initialClass !== 'available') {
                    bonusClass = initialClass;
                }
            }

            if (!bonusClass) {
                for (let k = 1; k <= Math.max(slots, 1); k += 1) this.manualBonusStates.delete(this.bonusSlotKey(bonusKey, k));
            } else if (slots >= 2) {
                // 複数回使えるマス: 使った回数が全部に達したらグレー。途中は「有効」のまま、残りの回数だけを表示する
                const usedCount = this.getBonusUseCount(bonusKey, slots);
                if (usedCount >= slots) {
                    bonusClass = 'used';
                } else {
                    bonusClass = 'available';
                    if (usedCount > 0) {
                        let toSkip = usedCount;
                        const remaining = bonusItems.filter((item) => {
                            if (toSkip > 0 && (item === 'wildcard' || item.startsWith('number_'))) {
                                toSkip -= 1;
                                return false;
                            }
                            return true;
                        });
                        iconsHtml = this.formatBonusDisplay(remaining);
                    }
                }
            } else {
                const manualState = this.manualBonusStates.get(bonusKey);
                if (manualState === 'used') {
                    bonusClass = 'used';
                } else if (manualState === 'available') {
                    bonusClass = 'available';
                }
            }
            const dataAttr = type === 'row'
                ? `data-row="${index}"`
                : `data-col="${index}"`;
            // ボーナス欄は、コンプリート済みのカードでも押せる（Complete のあとでも、残りのボーナスを使えるように）
            const clickHandler = `onclick="window.luckyBoxUI.toggleBonus(this)"`;
            // 数字・？のボーナスが「押せる」数字（？は全部）。星・月・雷だけのマスには付けない
            const selectValues = bonusItems
                .filter((item) => item === 'wildcard' || item.startsWith('number_'))
                .map((item) => (item === 'wildcard' ? '?' : item.slice('number_'.length)));
            const valuesAttr = selectValues.length
                ? `data-bonus-values="${selectValues.join(',')}" data-bonus-slots="${selectValues.length}"`
                : '';
            const tokenOnlyAttr = this.isTokenOnlyBonus(bonusItems) ? 'data-token-only="1"' : '';
            return `
                <div class="bonus-cell ${type}-bonus ${bonusClass}${this.isMoonStarBonus(bonusItems) ? ' bonus-pink' : ''}" 
                     ${valuesAttr}
                     ${tokenOnlyAttr}
                     data-card-index="${cardIndex !== null ? cardIndex : ''}" 
                     data-card-id="${card.card_id}"
                     data-bonus-key="${bonusKey}"
                     ${dataAttr}
                     ${clickHandler}>
                    ${iconsHtml}
                </div>
            `;
        };

        const colBonusStripHtml = colBonuses.length ? `
            <div class="col-bonus-strip" style="--grid-cols: ${colCount};">
                ${colBonuses.map((bonus, colIndex) =>
                    createBonusCell({ type: 'col', index: colIndex, bonus })
                ).join('')}
            </div>
        ` : '';

        const mainGridHtml = `
            <div class="bingo-grid main-grid" style="--grid-cols: ${colCount}; --grid-rows: ${rowCount};">
                ${mainGridCells.join('')}
            </div>
        `;

        const rowBonusColumnHtml = rowBonuses.map((bonus, rowIndex) =>
            createBonusCell({ type: 'row', index: rowIndex, bonus })
        ).join('');

        const rowBonusColumn = rowBonuses.length ? `
            <div class="row-bonus-column" style="--grid-rows: ${rowCount};">
                ${rowBonusColumnHtml}
            </div>
        ` : '';

        // 盤面の右下の空き（行ボーナスの列の下・列ボーナスの行の右）に、全マスが埋まったら「Complete」ボタンを出す。
        // 押すと、このカードはカレントのプールから消えて、コンプリートのプールへ移る。
        const completeSlot = (card.is_complete && !disableInteractions && cardIndex !== null) ? `
            <div class="complete-slot">
                <button type="button" class="complete-btn" onclick="window.luckyBoxUI.completeCard(${cardIndex})">Complete</button>
            </div>
        ` : '';

        // 認定シール（紙のLBカードの右下にある銀の丸）。チュートリアルとラウンド4のカードには付けない。
        // Complete ボタンと同じ場所（盤面の右下の空き）に置き、Complete ボタンが出たときは、その下になる。
        // 文字は「SN / カード名 / 認定」。カード名は、紙に合わせて、数字にはさまれた X を小文字にする（R4X4b → R4x4b）
        const cardRound = this.getCardRound(card.card_id);
        const sealCode = String(card.card_id).replace(/(\d)X(\d)/, '$1x$2');
        const sealSlot = (cardRound && cardRound !== 'tutorial' && cardRound !== 'round4') ? `
            <div class="seal-slot" aria-hidden="true">
                <div class="cert-seal">
                    <span class="cert-sn">SN</span>
                    <span class="cert-code">${sealCode}</span>
                    <span class="cert-text">認定</span>
                </div>
            </div>
        ` : '';

        // シール編集（ラウンド4の Last）。スタッフモードのときだけ見える
        const stickerEditing = !!(this.stickerEdit && this.stickerEdit.cardId === card.card_id);
        const stickerToolsHtml = (!disableInteractions && cardIndex !== null)
            ? this.createStickerTools(card, stickerEditing)
            : '';

        return `
            <div class="bingo-card size-${colCount}${disableInteractions ? ' completed-card' : ''}${stickerEditing ? ' sticker-editing' : ''}" data-round="${this.getCardRound(card.card_id)}" data-card-id="${card.card_id}" data-card-index="${cardIndex !== null ? cardIndex : ''}">
                <div class="card-header">LBカード ${card.card_id}</div>
                ${stickerToolsHtml}
                <div class="card-content">
                    <div class="bingo-board" style="--cols: ${colCount};">
                        ${mainGridHtml}
                        ${rowBonusColumn}
                        ${colBonusStripHtml}
                        ${sealSlot}
                        ${completeSlot}
                    </div>
                </div>
            </div>`;
    }


    createBonusDisplay(card, cardIndex) {
        // 安全性チェック
        if (!card) {
            console.error('createBonusDisplay: cardがnullまたはundefined');
            return '<div class="card-error">カードデータエラー</div>';
        }
        
        const gridData = card.display_grid || card.numbers || [];
        const rowBonuses = card.row_bonuses || [];
        const colBonuses = card.col_bonuses || [];
        const completedLines = card.completed_lines || [];
        
        // 完成した列を記録
        const completedRows = new Set();
        const completedCols = new Set();
        
        completedLines.forEach(([type, index]) => {
            if (type === 'row') completedRows.add(index);
            if (type === 'col') completedCols.add(index);
        });
        
        // グリッドデータの安全性チェック
        if (!Array.isArray(gridData) || gridData.length === 0) {
            console.error('createBonusDisplay: gridDataが無効', gridData);
            return '<div class="card-error">グリッドデータエラー</div>';
        }
        
        // グリッドHTMLを再生成（ボーナス表示用）
        const gridHtml = gridData.map((row, rowIndex) => {
            if (!Array.isArray(row)) {
                console.error(`行${rowIndex}が配列ではありません:`, row);
                return '';
            }
            
            const rowHtml = row.map((number, colIndex) => {
                const isMarked = card.marked && card.marked[rowIndex] && card.marked[rowIndex][colIndex];
                const markedClass = isMarked ? 'marked' : '';
                const bgColor = isMarked ? 'black' : 'white';
                const textColor = isMarked ? 'white' : 'black';
                const clickHandler = isMarked ? '' : `onclick="window.luckyBoxUI.markCell(${cardIndex}, ${rowIndex}, ${colIndex});"`;
                const cursor = isMarked ? 'default' : 'pointer';
                return `<div class="card-cell ${markedClass}" style="background: ${bgColor}; color: ${textColor}; cursor: ${cursor};" data-number="${number}" data-row="${rowIndex}" data-col="${colIndex}" ${clickHandler}>${number}</div>`;
            }).join('');
            
            // 行ボーナスを追加
            const rowBonus = rowBonuses[rowIndex] || '';
            const rowBonusIcon = this.getBonusIcon(rowBonus);
            const rowCompletedClass = completedRows.has(rowIndex) ? 'completed' : '';
            
            return `
                <div class="card-row">
                    <div class="row-cells">${rowHtml}</div>
                    <div class="row-bonus ${rowCompletedClass}">${rowBonusIcon}</div>
                </div>`;
        }).join('');
        
        // 列ボーナスを生成
        const colBonusHtml = colBonuses.map((bonus, colIndex) => {
            const bonusIcon = this.getBonusIcon(bonus);
            const colCompletedClass = completedCols.has(colIndex) ? 'completed' : '';
            return `<div class="col-bonus ${colCompletedClass}">${bonusIcon}</div>`;
        }).join('');
        
        return `
            <div class="card-with-bonuses">
                <div class="card-grid-container">
                    ${gridHtml}
                </div>
                <div class="col-bonuses-container">
                    ${colBonusHtml}
                    <div class="corner-spacer"></div>
                </div>
            </div>`;
    }

    getBonusIcon(bonus) {
        if (!bonus) return '';
        
        switch (bonus) {
            // 雷は、実物のカードに寄せて、緑の稲妻を SVG で描く
            case 'lightning': return '<svg viewBox="0 0 24 24" aria-label="雷" role="img"><defs><linearGradient id="bolt-green" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8FD19A"/><stop offset="1" stop-color="#2F8A44"/></linearGradient></defs><polygon points="14,1.5 4.5,13.5 10.5,13.5 8.5,22.5 19.5,9.5 13,9.5" fill="url(#bolt-green)" stroke="#2A6B3A" stroke-width="1" stroke-linejoin="round"/></svg>';
            // 月・星は、実物のカードに寄せて SVG で描く（赤い星に黒いふち、青い三日月）。色は絵そのものに入っている
            case 'moon': return '<svg viewBox="0 0 24 24" aria-label="月" role="img"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="#6F9BE0" stroke="#3F68B0" stroke-width="1.3" stroke-linejoin="round"/></svg>';
            case 'star': return '<svg viewBox="0 0 24 24" aria-label="星" role="img"><polygon points="12,2.2 14.9,8.6 21.9,9.3 16.6,14 18.2,20.9 12,17.3 5.8,20.9 7.4,14 2.1,9.3 9.1,8.6" fill="#E8141C" stroke="#000" stroke-width="1.8" stroke-linejoin="round"/></svg>';
            case 'wildcard': return '？';
            default:
                // 数字ボーナス (number_X 形式)
                if (bonus.startsWith('number_')) {
                    return bonus.split('_')[1];
                }
                return bonus;
        }
    }

    formatBonusDisplay(bonuses) {
        const list = Array.isArray(bonuses) ? bonuses.flat().map(b => (b ?? '').toString().trim()).filter(Boolean) : [];
        if (!list.length) return '';

        const tokenMap = {
            lightning: { icon: this.getBonusIcon('lightning'), count: 0 },
            moon: { icon: this.getBonusIcon('moon'), count: 0 },
            star: { icon: this.getBonusIcon('star'), count: 0 },
            wildcard: { icon: this.getBonusIcon('wildcard'), count: 0 },
        };
        const numbers = [];
        const others = new Map();

        list.forEach(value => {
            if (value in tokenMap) {
                tokenMap[value].count += 1;
            } else if (value.startsWith('number_')) {
                const numberValue = value.split('_')[1];
                if (numberValue) {
                    numbers.push(numberValue);
                }
            } else {
                const current = others.get(value) || { icon: this.getBonusIcon(value) || value, count: 0 };
                current.count += 1;
                others.set(value, current);
            }
        });

        const segments = [];

        Object.entries(tokenMap).forEach(([key, { icon, count }]) => {
            if (!count) return;
            segments.push({ text: icon, countText: count > 1 ? String(count) : '', type: key });
        });

        if (numbers.length) {
            segments.push({ text: numbers.join(','), countText: '', type: 'number' });
        }

        others.forEach(({ icon, count }, key) => {
            segments.push({ text: icon, countText: count > 1 ? `×${count}` : '', type: key });
        });

        // 個数（2個以上のとき）は、アイコンとは別の小さな文字にする（見た目は card-look.css の .bonus-count）
        return segments.map(({ text, countText, type }) => {
            const typeClass = type ? ` bonus-icon--${type}` : '';
            const countHtml = countText ? `<span class="bonus-count">${countText}</span>` : '';
            return `<span class="bonus-icon${typeClass}">${text}</span>${countHtml}`;
        }).join('');
    }

    flattenBonusItems(bonuses) {
        const stack = Array.isArray(bonuses) ? [...bonuses] : (bonuses ? [bonuses] : []);
        const result = [];

        while (stack.length) {
            const item = stack.shift();
            if (Array.isArray(item)) {
                stack.push(...item);
                continue;
            }
            if (item === null || item === undefined) {
                continue;
            }
            const normalized = String(item).trim();
            if (!normalized) {
                continue;
            }
            result.push(normalized.toLowerCase());
        }

        return result;
    }

    determineInitialBonusClass(bonusItems) {
        if (!Array.isArray(bonusItems) || !bonusItems.length) {
            return 'available';
        }

        // 雷・月・星だけのマスは、ビンゴの瞬間に個数が自動で増える（エンジンが数える）ので、
        // 揃った時点でグレー（獲得済み）にする。タップでは切り替えない。
        // 数字・？のマスは、ビンゴが揃ったら「有効（タップ待ち）」にし、ユーザーが使うときに選んでグレーにする。
        return this.isTokenOnlyBonus(bonusItems) ? 'used' : 'available';
    }

    // 雷・月・星だけのマスか（個数が自動で数えられるマス）
    isTokenOnlyBonus(bonusItems) {
        return Array.isArray(bonusItems) && bonusItems.length > 0
            && bonusItems.every(item => item === 'lightning' || item === 'moon' || item === 'star');
    }

    // 月・星だけのマスか（有効時に、数字などの黄緑ではなく薄いピンクで表示する）
    isMoonStarBonus(bonusItems) {
        return Array.isArray(bonusItems) && bonusItems.length > 0
            && bonusItems.every(item => item === 'moon' || item === 'star');
    }

    // ---- 画面状態の保存・復元（再起動後のレジューム用） ----
    restoreUiState() {
        const saved = window.LuckyBoxEngine.uiState.load();

        const validRounds = ['tutorial', 'round1', 'round2', 'round3', 'round4'];
        if (saved.currentRound && validRounds.includes(saved.currentRound)) {
            this.currentRound = saved.currentRound;
            const roundSelect = document.getElementById('round-select');
            if (roundSelect) {
                roundSelect.value = this.currentRound;
            }
            this.updateRoundSelectColor();
        }

        // パート（謎解き / ビンゴ）。再起動しても、謎解きパート中ならそのまま（ロックされた状態）で始まる
        this.part = saved.part === 'puzzle' ? 'puzzle' : 'bingo';
        this._applyPartDom();
        this.showZero = !!saved.showZero;
        this.renderCallNumbers();

        // ボーナス欄の使用状態は、エンジン側（Undo と一緒に戻る）に保存しているので、ここでは扱わない
        this.loadBonusStates();
    }

    saveUiState() {
        window.LuckyBoxEngine.uiState.save({
            part: this.part,
            showZero: this.showZero,
            currentRound: this.currentRound
        });
    }

    // ---- バージョン表示（右上）と保存エラー警告 ----
    setupFooter() {
        const versionEl = document.getElementById('app-version');
        if (versionEl && typeof APP_VERSION !== 'undefined') {
            versionEl.textContent = APP_VERSION;
        }
        const titleVersionEl = document.getElementById('title-version');
        if (titleVersionEl && typeof APP_VERSION !== 'undefined') {
            titleVersionEl.textContent = APP_VERSION;
        }

        const api = window.LuckyBoxEngine.getApi();
        this.updateSaveStatus(api.saveStatus());
        api.onSaveStatus((status) => this.updateSaveStatus(status));
    }

    updateSaveStatus(status) {
        const warnEl = document.getElementById('save-warning');

        if (warnEl) {
            if (!status.storageAvailable) {
                warnEl.textContent = '⚠ この端末では保存できません（シークレットモード等を確認）。再読み込みすると進行状況が消えます';
            } else if (!status.ok) {
                warnEl.textContent = '⚠ 保存に失敗しました。端末の空き容量を確認してください';
            } else {
                warnEl.textContent = '';
            }
            warnEl.hidden = !warnEl.textContent;
        }
    }
    updateTokensDisplay() {
        const lightningElement = document.getElementById('lightning-tokens');
        const moonElement = document.getElementById('moon-tokens');
        const starElement = document.getElementById('star-tokens');
        
        const lightningTokens = this.gameState.lightning_tokens || 0;
        const moonTokens = this.gameState.moon_tokens || 0;
        const starTokens = this.gameState.star_tokens || 0;
        
        if (lightningElement) lightningElement.textContent = lightningTokens;
        if (moonElement) moonElement.textContent = moonTokens;
        if (starElement) starElement.textContent = starTokens;
        
        // ボタンの有効/無効制御も更新
        this.updateTokenButtonStates();
        this.renderLightningTray();
        this.renderTokenHud();
    }

    updateHistoryDisplay() {
        const historyListElement = document.getElementById('history-list');
        const historyPositionElement = document.getElementById('history-position');
        if (!historyListElement || !this.gameState) return;

        const history = this.gameState.history || [];
        const currentPosition = this.gameState.history_position || 0;
        // スタッフ用リストが長すぎると DOM が重いので、新しい方から上限だけ描画
        const HISTORY_DISPLAY_LIMIT = 40;

        historyListElement.innerHTML = '';

        if (history.length === 0) {
            const noHistory = document.createElement('p');
            noHistory.className = 'no-history';
            noHistory.textContent = '履歴がありません';
            historyListElement.appendChild(noHistory);
            return;
        }

        const toDisplay = history.slice().reverse();
        const totalEntries = toDisplay.length;
        const visible = toDisplay.slice(0, HISTORY_DISPLAY_LIMIT);
        const frag = document.createDocumentFragment();

        visible.forEach((entry, index) => {
            const historyItem = document.createElement('div');
            historyItem.className = 'history-item';

            const historyText = document.createElement('span');
            historyText.className = 'history-text';
            const displayIndex = totalEntries - index;
            historyText.textContent = `${displayIndex}: ${this.formatHistoryEntry(entry)}`;
            historyItem.appendChild(historyText);

            if (index === currentPosition) {
                historyItem.classList.add('current');
            }

            frag.appendChild(historyItem);
        });

        if (totalEntries > HISTORY_DISPLAY_LIMIT) {
            const more = document.createElement('p');
            more.className = 'no-history';
            more.textContent = `…他 ${totalEntries - HISTORY_DISPLAY_LIMIT} 件`;
            frag.appendChild(more);
        }

        historyListElement.appendChild(frag);

        if (historyPositionElement) {
            const displayPosition = Math.max(1, totalEntries - currentPosition);
            historyPositionElement.textContent = `現在の位置: ${displayPosition}/${totalEntries}`;
        }
    }

    formatHistoryEntry(entry) {
        if (entry === null || entry === undefined) {
            return '';
        }

        if (typeof entry === 'number') {
            return String(entry);
        }

        if (typeof entry === 'string') {
            return this.cleanHistoryText(entry);
        }

        if (typeof entry === 'object') {
            if (entry.action) {
                return this.cleanHistoryText(entry.action);
            }

            if (entry.token_type && entry.amount !== undefined && entry.old_value !== undefined && entry.new_value !== undefined) {
                const tokenLabels = {
                    lightning: '雷',
                    moon: '月',
                    star: '星'
                };
                const label = tokenLabels[entry.token_type] || entry.token_type;
                const delta = entry.amount >= 0 ? `+${entry.amount}` : entry.amount;
                return `${label} ${delta} (${entry.old_value}→${entry.new_value})`;
            }

            if (entry.card_id) {
                return `カード追加: ${entry.card_id}`;
            }

            if (entry.message) {
                return this.cleanHistoryText(entry.message);
            }

            if (entry.number !== undefined) {
                return String(entry.number);
            }

            try {
                return this.cleanHistoryText(JSON.stringify(entry));
            } catch (err) {
                return '履歴データ';
            }
        }

        return String(entry);
    }

    cleanHistoryText(text) {
        if (!text) return '';
        let result = text;
        // remove surrounding brackets like [ ... ]
        const bracketMatch = result.match(/^\[(.*)]$/);
        if (bracketMatch) {
            result = bracketMatch[1];
        }
        result = result.replace(/トークン/g, '').trim();
        return result;
    }

    // スコアとトークン表示を更新するメソッド
    updateDisplays() {
        // スコア表示を更新
        const scoreTotalElement = document.getElementById('score-total');
        const scoreDetailElement = document.getElementById('score-detail-text');
        const scoreDetails = this.gameState.score_details || {};
        const completedPoints = scoreDetails.completed_points ?? 0;
        const activeBlackCells = scoreDetails.active_black_cells ?? 0;
        const activePoints = scoreDetails.active_points ?? Math.floor(activeBlackCells / 2);
        const totalScore = scoreDetails.total ?? this.gameState.score ?? 0;

        if (scoreTotalElement) {
            scoreTotalElement.textContent = totalScore;
        }

        if (scoreDetailElement) {
            scoreDetailElement.textContent = `コンプリート：${completedPoints}, 黒マス：${activeBlackCells} = ${totalScore}`;
        }

        const complete = scoreDetails.complete || {};
        const setText = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        };
        setText('score-c3-count', (complete[3] && complete[3].count) || 0);
        setText('score-c3-pts', (complete[3] && complete[3].points) || 0);
        setText('score-c4-count', (complete[4] && complete[4].count) || 0);
        setText('score-c4-pts', (complete[4] && complete[4].points) || 0);
        setText('score-c5-count', (complete[5] && complete[5].count) || 0);
        setText('score-c5-pts', (complete[5] && complete[5].points) || 0);
        setText('score-black-count', activeBlackCells);
        setText('score-black-pts', activePoints);
        const boardPoints = scoreDetails.board_points ?? (completedPoints + activePoints);
        const tokenPoints = scoreDetails.bonus_points ?? 0;
        setText('score-board-pts', boardPoints);
        setText('score-token-pts', tokenPoints);
        setText('score-final', totalScore);
        setText('score-star-pts', `${(scoreDetails.star && scoreDetails.star.points) || 0}点`);
        setText('score-lightning-pts', `${(scoreDetails.lightning && scoreDetails.lightning.points) || 0}点`);
        this.syncScoreInputs();

        // トークン表示を更新
        const updateTokenDisplay = (type) => {
            const element = document.getElementById(`${type}-tokens`);
            if (element) {
                element.textContent = this.gameState[`${type}_tokens`] || 0;
            }
        };
        
        ['lightning', 'moon', 'star'].forEach(updateTokenDisplay);
        
        // トークンボタンの状態を更新
        this.updateTokenButtonStates();
        this.renderLightningTray();
        this.renderTokenHud();
        // ビンゴパートの流れ（モード表示・番号カード・強調）。盤面の描画のあとに呼ばれるので、ここで組み立て直す
        this.updateBingoFlow();
    }

    // ボーナスの状態を取得
    getBonusState(card, type, index) {
        if (!card.used_bonuses) return '';
        const bonusKey = `${type}_${index}`;
        return card.used_bonuses[bonusKey] || '';
    }

    // ボーナス欄のタップ。
    //   ・グレー（使用済み）になったマスは、雷・月・星も、数字・？も、タップしても何も起きない（戻すときは Undo）
    //   ・雷・月・星だけのマスは、個数が自動で数えられ、揃うと自動でグレーになるので、タップでは何も起きない
    //   ・揃った数字・？のマスは、タップで「選択」（押せるマスを明示）／もう一度タップで選択を解除
    toggleBonus(element) {
        const bonusKey = element.dataset.bonusKey;
        if (!bonusKey || !element.classList.contains('available')) return;
        if (element.dataset.tokenOnly) return;

        if (element.dataset.bonusValues && this.toggleBonusSelection(element)) return;

        // 押せるマスが1つもないとき（数字・？を使える空きマスがない）だけ、タップで使用済み（グレー）にする。
        // この操作は操作履歴に1件として残し、Undo で元に戻せる
        // 「？2」のように複数回使えるマスは、残りの回数をすべて使用済みにする
        element.classList.remove('available');
        element.classList.add('used');
        const slots = Number(element.dataset.bonusSlots) || 1;
        for (let k = 1; k <= slots; k += 1) this.manualBonusStates.set(this.bonusSlotKey(bonusKey, k), 'used');
        const [cardId, type, index] = bonusKey.split(':');
        const place = `${type === 'row' ? '行' : '列'}${Number(index) + 1}`;
        this.saveBonusStates({ record: true, label: `ボーナス使用済み: ${cardId} ${place}` });
    }

    /* ---------------- 数字・？ボーナスの「押せるマス」 ---------------- */

    // マスの数字が、選択中のボーナスで押せるか（？は、0・アルファベットも含めて全部）
    isBonusTargetValue(cellValue, values) {
        if (!Array.isArray(values)) return false;
        return values.includes('?') || values.includes(String(cellValue).trim());
    }

    // 選択を切り替える。選択状態にした／解除したときは true。押せるマスがなくて何もしなかったときは false
    toggleBonusSelection(element) {
        const key = element.dataset.bonusKey;
        if (this.bonusSelection && this.bonusSelection.key === key) {
            // ビンゴパートの流れの中では、有効なボーナスは即時に使い切る仕様なので、選択の解除はできない
            if (this.flowEnforced()) return true;
            this.bonusSelection = null;
            this.applyBonusHighlight();
            return true;
        }

        const values = element.dataset.bonusValues.split(',');
        const hasTarget = Array.from(document.querySelectorAll('#cards-container .bingo-cell:not(.marked)'))
            .some((cell) => this.isBonusTargetValue(cell.dataset.value, values));
        if (!hasTarget) return false;

        this.bonusSelection = { key, values, slots: Number(element.dataset.bonusSlots) || 1 };
        this.applyBonusHighlight();
        return true;
    }

    // 複数回使えるボーナス欄（「？2」など）の、k 回目の使用を記録するキー。1回目は、これまでと同じキー
    bonusSlotKey(key, k) {
        return k <= 1 ? key : `${key}#${k}`;
    }

    // そのボーナス欄を、いま何回使っているか（最大 slots 回）
    getBonusUseCount(key, slots) {
        let count = 0;
        for (let k = 1; k <= Math.max(slots, 1); k += 1) {
            if (this.manualBonusStates.get(this.bonusSlotKey(key, k)) === 'used') count += 1;
        }
        return count;
    }

    // 選択状態を画面に反映する（押せるマス: bonus-target、押せないマス: bonus-locked、選択中のボーナス欄: bonus-selected）。
    // 盤面を描き直さず、いまの画面（マスの data-value）だけを見て更新する
    // 強調するマスの数字（？は全部）。ボーナス選択中はそのボーナスで押せる数字、
    // ビンゴパートの流れの中で読み上げ番号を選んだあと（ボーナス処理中でないとき）は、その番号だけ。それ以外は null
    getHighlightValues() {
        if (this.bonusSelection) return this.bonusSelection.values;
        if (this.flowEnforced() && this.isBoardPhase()) {
            return this.lightningValues(this.calledNumber, this.lightningReserved);
        }
        return null;
    }

    applyBonusHighlight() {
        const selection = this.bonusSelection;
        const values = this.getHighlightValues();
        const container = document.getElementById('cards-container');
        if (container) {
            container.classList.toggle('bonus-selecting', !!values);
            container.querySelectorAll('.bingo-cell').forEach((cell) => {
                cell.classList.remove('bonus-target', 'bonus-locked');
                if (!values || cell.classList.contains('marked')) return;
                cell.classList.add(this.isBonusTargetValue(cell.dataset.value, values) ? 'bonus-target' : 'bonus-locked');
            });
        }
        document.querySelectorAll('.bonus-cell').forEach((el) => {
            el.classList.toggle('bonus-selected', !!selection && el.dataset.bonusKey === selection.key);
        });
    }

    // 選択中のボーナスを「使用済み」にして、選択を終える。使用済みにしたボーナスのキーを返す（なければ null）
    consumeBonusSelection() {
        const selection = this.bonusSelection;
        if (!selection) return null;
        this.bonusSelection = null;

        // 複数回使えるマス（「？2」など）は、まだ使っていない次の1回分だけを使用済みにする。
        // 回数が残っているあいだは「有効」のまま（盤面の描き直しで、残りの回数の表示になる）
        const slots = selection.slots || 1;
        let usedKey = selection.key;
        for (let k = 1; k <= slots; k += 1) {
            const slotKey = this.bonusSlotKey(selection.key, k);
            if (this.manualBonusStates.get(slotKey) !== 'used') {
                usedKey = slotKey;
                break;
            }
        }
        this.manualBonusStates.set(usedKey, 'used');
        this.saveBonusStates();
        const fullyUsed = this.getBonusUseCount(selection.key, slots) >= slots;
        const el = document.querySelector(`.bonus-cell[data-bonus-key="${selection.key}"]`);
        if (el) {
            el.classList.remove('bonus-selected');
            if (fullyUsed) {
                el.classList.remove('available');
                el.classList.add('used');
            } else if (el.closest('#completed-cards-container')) {
                // コンプリート欄のカードは、マークのあとの差し替え対象ではないので、残り回数の表示のために全体を描き直す
                this._redrawCompletedAfterMark = true;
            }
        }
        this.applyBonusHighlight();
        return usedKey;
    }

    // マスのマークに失敗したとき、使用済みにしたボーナスを元に戻す
    revertBonusConsume(key) {
        if (!key) return;
        this.manualBonusStates.delete(key);
        this.saveBonusStates();
    }

    // 選択中のボーナスが、もう使えない状態（Undo・リセットなどで消えた／使用済みになった）なら、選択を解除する
    pruneBonusSelection() {
        const selection = this.bonusSelection;
        if (!selection) return;
        let valid = this.getBonusUseCount(selection.key, selection.slots || 1) < (selection.slots || 1) && !!this.gameState;
        if (valid) {
            const [cardId, type, index] = selection.key.split(':');
            const cards = (this.gameState.cards || []).concat(this.gameState.completed_cards || []);
            const card = cards.find((c) => c.card_id === cardId);
            valid = !!card && (card.completed_lines || []).some(([t, i]) => t === type && i === Number(index));
        }
        if (!valid) this.bonusSelection = null;
    }

    // 「使用済み」にしたボーナス欄の一覧は、ゲームエンジン側に保存する（Undo で戻すため）。
    // 画面側の manualBonusStates は、描画のたびにエンジンの値から作り直す。
    saveBonusStates(options = {}) {
        const used = [];
        this.manualBonusStates.forEach((value, key) => {
            if (value === 'used') used.push(key);
        });
        const result = window.LuckyBoxEngine.getApi().call('set_bonus_states', {
            used,
            record: !!options.record,
            label: options.label
        });
        // 月・星のトグルは見た目をすでに切り替え済み。盤面は変わらないので履歴と Undo だけ更新する
        if (options.record && result && result.success && result.game_state) {
            this.gameState = result.game_state;
            this.updateUiAfterHistoryOnly();
        }
    }

    loadBonusStates() {
        this.manualBonusStates.clear();
        window.LuckyBoxEngine.getApi().getBonusStates().forEach((key) => {
            this.manualBonusStates.set(key, 'used');
        });
        // 選択中のボーナスが使えなくなっていたら、選択を解除する（Undo・リセットの後など）
        this.pruneBonusSelection();
    }
}

// ページ読み込み完了時にUIを初期化
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM読み込み完了、UIを初期化します');
    window.luckyBoxUI = new LuckyBoxUI();
});
