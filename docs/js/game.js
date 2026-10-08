console.log('game.js ファイルが読み込まれました');

class LuckyBoxUI {
    constructor() {
        this.gameState = null;
        this.currentRound = 'tutorial';  // デフォルトラウンド
        this.manualBonusStates = new Map();
        this.setupEventListeners();
        this.setupStaffHistoryGuard();
        this.stickerEdit = null; // シール編集中の状態 { cardId, tool, message }
        this.setupTeamSelect();
        this.setupScoreInputs();
        // スタッフモードを終えたら、シール編集も終える
        document.addEventListener('staffmodechange', (event) => {
            if (!event.detail.on && this.stickerEdit) {
                this.stickerEdit = null;
                if (this.gameState) this.updateDisplay();
            }
        });
        this.initializeGame();
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
                this.saveUiState();
                this.loadRoundCards();
            });
        }

        // Undo/Resetボタン
        const resetBtn = document.getElementById('reset-btn');
        
        // Undoボタンは複数配置（ビンゴカード見出し横 + 操作ボタン欄）
        document.querySelectorAll('.undo-btn').forEach(undoBtn => {
            // 既存のイベントリスナーを削除
            const newUndoBtn = undoBtn.cloneNode(true);
            undoBtn.parentNode.replaceChild(newUndoBtn, undoBtn);
            
            newUndoBtn.addEventListener('click', () => {
                console.log('Undoボタンクリック');
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
            
            console.log(`カード${cardIndex}のセルをクリック: 行${row}, 列${col}`);
            this.markCell(cardIndex, row, col);
        };
        
        // イベントリスナーを追加
        document.addEventListener('click', this.handleCellClick);
        console.log('セルクリックイベント設定完了');
    }
    
    // 雷トークンの表示（Bingo Cards 見出しの右）。
    // 持っている数だけ⚡を並べ、ユーザーが使うときに⚡をタップすると1つ減る（使用の宣言自体はアプリの管理外）。
    // スタッフモードでは、末尾の「＋」で1つ増やせる（数え間違いの修正用）。
    setupLightningTray() {
        const tray = document.getElementById('lightning-tray');
        if (!tray) return;

        tray.addEventListener('click', (event) => {
            if (event.target.closest('.lightning-token')) {
                this.adjustTokens('lightning', -1);
            } else if (event.target.closest('.lightning-add')) {
                this.adjustTokens('lightning', 1);
            }
        });
    }

    renderLightningTray() {
        const tray = document.getElementById('lightning-tray');
        if (!tray || !this.gameState) return;

        const count = Math.max(0, this.gameState.lightning_tokens || 0);
        // 数が変わっていなければ作り直さない（画面のちらつき・スクロール位置のずれを避ける）
        if (this._lightningShown === count && tray.childElementCount) return;
        this._lightningShown = count;

        const icons = `<button type="button" class="lightning-token" aria-label="雷を1つ使う">${this.getBonusIcon('lightning')}</button>`.repeat(count);
        const add = '<button type="button" class="lightning-add staff-only" aria-label="雷を1つ増やす">＋</button>';
        tray.innerHTML = icons + add;
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
                console.log('雷トークン+1');
                this.adjustTokens('lightning', 1);
            });
        }
        
        if (lightningMinusBtn) {
            // 既存のイベントリスナーを削除
            const newBtn = lightningMinusBtn.cloneNode(true);
            lightningMinusBtn.parentNode.replaceChild(newBtn, lightningMinusBtn);
            
            newBtn.addEventListener('click', () => {
                console.log('雷トークン-1');
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
                console.log('月トークン+1');
                this.adjustTokens('moon', 1);
            });
        }
        
        if (moonMinusBtn) {
            // 既存のイベントリスナーを削除
            const newBtn = moonMinusBtn.cloneNode(true);
            moonMinusBtn.parentNode.replaceChild(newBtn, moonMinusBtn);
            
            newBtn.addEventListener('click', () => {
                console.log('月トークン-1');
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
                console.log('星トークン+1');
                this.adjustTokens('star', 1);
            });
        }
        
        if (starMinusBtn) {
            // 既存のイベントリスナーを削除
            const newBtn = starMinusBtn.cloneNode(true);
            starMinusBtn.parentNode.replaceChild(newBtn, starMinusBtn);
            
            newBtn.addEventListener('click', () => {
                console.log('星トークン-1');
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
            console.log(`トークン調整: ${tokenType} ${amount > 0 ? '+' : ''}${amount}`);
            
            // フロントエンドの状態を即座に更新
            const currentValue = this.gameState[`${tokenType}_tokens`] || 0;
            const newValue = currentValue + amount;
            
            // マイナスにならないようにする
            if (newValue < 0) {
                console.log('トークンは0未満にはできません');
                return;
            }
            
            // フロントエンドの状態を更新
            this.gameState[`${tokenType}_tokens`] = newValue;
            this.updateTokensDisplay();
            
            // サーバーに非同期で更新を送信
            const result = await this.apiCall('adjust_tokens', {
                token_type: tokenType,
                amount: amount
            });
            
            if (result && result.game_state) {
                console.log('トークン調整成功:', result);
                // サーバーからの応答でゲーム状態を更新
                this.gameState = result.game_state;
                // 表示を更新（履歴も含む）
                this.updateDisplay();
            } else {
                console.error('トークン調整失敗: レスポンスが空です');
                // ロールバック
                this.gameState[`${tokenType}_tokens`] = currentValue;
                this.updateTokensDisplay();
                alert('トークン調整に失敗しました');
            }
        } catch (error) {
            console.error('トークン調整エラー:', error);
            alert(`エラーが発生しました: ${error.message}`);
        }
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
        
        // 現在追加されているカードのIDを取得
        // （盤面にあるカードと、コンプリートのプールに移ったカードは、追加できない）
        const addedCardIds = this.gameState
            ? (this.gameState.cards || []).concat(this.gameState.completed_cards || []).map(card => card.card_id)
            : [];
        // 今後は使わないカード。ラウンド4は Last 1枚だけを登録し、シールを貼って変化させる
        const hiddenCardIds = ['LastSP'];
        
        // セレクトボックスをクリア
        cardSelect.innerHTML = '<option value="">-- カードを選択 --</option>';
        
        // カードオプションを追加（追加済みのカードは除外）
        let availableCardsCount = 0;
        cards.forEach(card => {
            if (!addedCardIds.includes(card.card_id) && !hiddenCardIds.includes(card.card_id)) {
                const option = document.createElement('option');
                option.value = card.card_id;
                option.textContent = card.display_name;
                cardSelect.appendChild(option);
                availableCardsCount++;
            }
        });
        
        // 追加可能なカードがない場合はメッセージを表示
        if (availableCardsCount === 0) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = '追加可能なカードがありません';
            option.disabled = true;
            cardSelect.appendChild(option);
        }
        
        console.log(`カードセレクト更新完了: 表示中 ${availableCardsCount}枚 / 全 ${cards.length}枚`);
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
                alert('カードを選択してください');
                return;
            }
            
            console.log(`選択されたカードID: ${cardId}`);
            
            const result = await this.apiCall('add_card', { card_id: cardId });
            
            if (result.success) {
                console.log('カード追加成功');
                this.gameState = result.game_state;
                this.updateDisplay();
                
                // セレクトボックスを更新して追加済みカードを非表示にする
                await this.loadRoundCards();
                
                // セレクトボックスをリセット
                cardSelect.value = '';
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

        ['score-star-count', 'score-lightning-count', 'score-moon-count'].forEach((id) => {
            const select = document.getElementById(id);
            if (!select || select.options.length) return;
            for (let n = 0; n <= 99; n++) {
                const option = document.createElement('option');
                option.value = String(n);
                option.textContent = String(n);
                select.appendChild(option);
            }
        });

        const save = async () => {
            const result = await this.apiCall('set_score_inputs', {
                star: Number(document.getElementById('score-star-count').value),
                lightning: Number(document.getElementById('score-lightning-count').value),
                moon: Number(document.getElementById('score-moon-count').value),
                star_ex: document.getElementById('score-star-ex').checked,
                lightning_ex: document.getElementById('score-lightning-ex').checked,
            });
            if (result && result.game_state) this.gameState = result.game_state;
            this.updateDisplay();
        };

        ['score-star-count', 'score-lightning-count', 'score-moon-count', 'score-star-ex', 'score-lightning-ex']
            .forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.addEventListener('change', save);
            });
    }

    syncScoreInputs() {
        const details = (this.gameState && this.gameState.score_details) || {};
        const star = details.star || {};
        const lightning = details.lightning || {};
        const moon = details.moon || {};
        const setVal = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.value = String(value);
        };
        const setCheck = (id, on) => {
            const el = document.getElementById(id);
            if (el) el.checked = !!on;
        };
        setVal('score-star-count', star.count || 0);
        setVal('score-lightning-count', lightning.count || 0);
        setVal('score-moon-count', moon.count || 0);
        setCheck('score-star-ex', star.ex);
        setCheck('score-lightning-ex', lightning.ex);
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
    async completeCard(cardIndex) {
        try {
            const result = await this.apiCall('complete_card', { card_index: cardIndex });
            if (result && result.success) {
                this.gameState = result.game_state;
                this.updateDisplay();
            } else {
                console.error('コンプリート移動失敗:', result);
                alert(`Complete に失敗しました: ${result && result.error ? result.error : '全マスが埋まっていません'}`);
            }
        } catch (error) {
            console.error('コンプリート移動エラー:', error);
            alert(`エラーが発生しました: ${error.message}`);
        }
    }

    async undo() {
        try {
            console.log('Undo処理開始');
            console.log('現在の履歴数:', this.gameState?.history?.length || 0);
            
            const result = await this.apiCall('undo', {});
            console.log('UndoAPIレスポンス:', result);
            
            if (result && result.success) {
                console.log('Undo成功');
                this.gameState = result.game_state;
                this.updateDisplay();
                await this.loadRoundCards();
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

    async reset(confirmed = false) {
        try {
            console.log('Reset処理開始');
            this.stickerEdit = null;
            
            if (!confirmed) {
                if (!confirm('本当にゲームをリセットしますか？\nすべての進行状況が失われます。')) {
                    return;
                }
                confirmed = true;
            }
            
            const result = await this.apiCall('reset', {});
            
            if (result.success) {
                console.log('Reset成功');
                // 前回の「使用済み」表示が次のゲームに残らないよう、手動トグル状態も消す
                this.manualBonusStates.clear();
                this.gameState = result.game_state;

                // リセット後は、最初の状態として「カード Tutorial」を追加し、ラウンドの選択を「チュートリアル」にする
                this.currentRound = 'tutorial';
                const roundSelect = document.getElementById('round-select');
                if (roundSelect) {
                    roundSelect.value = this.currentRound;
                }
                this.saveUiState();

                const addResult = await this.apiCall('add_card', { card_id: 'Tutorial' });
                if (addResult && addResult.success) {
                    this.gameState = addResult.game_state;
                } else {
                    console.error('リセット後の Tutorial 追加に失敗:', addResult);
                }

                this.updateDisplay();
                await this.loadRoundCards();
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

        // 既に処理中の場合は何もしない
        if (this.isMarkingCell) {
            console.log('既にセルマーク処理中です');
            return;
        }
        
        this.isMarkingCell = true;
        console.log(`セルマーク処理開始: カード${cardIndex}, 行${row}, 列${col}`);
        
        try {
            const result = await this.apiCall('mark_cell', {
                card_index: cardIndex,
                row: row,
                col: col
            });
            
            if (result && result.success === true) {
                console.log('セルマーク成功');
                this.gameState = result.game_state;
                this.updateDisplay();
            } else {
                console.error('セルマーク失敗:', result);
                const errorMsg = result ? (result.error || '不明なエラー') : 'レスポンスが無効です';
                console.error(`セルマーク失敗: ${errorMsg}`);
                alert(`セルのマークに失敗しました: ${errorMsg}`);
            }
        } catch (error) {
            console.error('セルマークエラー:', error);
            alert(`エラーが発生しました: ${error.message}`);
        } finally {
            this.isMarkingCell = false;
        }
    }

    updateDisplay() {
        console.log('表示更新開始');

        // ボーナス欄の「使用済み」状態は、エンジンの現在の状態から読み直す（Undo 後も正しく戻るように）
        this.loadBonusStates();
        this.syncTeamSelect();
        
        this.updateCardsDisplay();
        this.updateHistoryDisplay();
        this.updateDisplays();
        
        console.log('表示更新完了');
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
            console.log('updateCardsDisplay: gameState.cards =', this.gameState.cards);

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
                console.log('カード数:', this.gameState.cards.length);
                this.gameState.cards.forEach((card, index) => {
                    console.log(`カード${index}:`, card);
                });

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

                console.log('セルクリックイベント設定完了（onclick属性使用）');
            }

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
            const cards = (this.gameState.completed_cards || []).filter((c) => !activeIds.has(c.card_id));
            this.completedCards = cards;
            console.log('completed_cards:', cards);

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
        console.log(`createCardElement: カード${cardIndex}の詳細`);
        console.log('card:', card);
        
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
        
        console.log('gridData:', gridData);
        console.log('cardSize:', cardSize);
        console.log('card.marked:', card.marked);
        
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
                         data-col="${colIndex}">
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
            const iconsHtml = this.formatBonusDisplay(bonuses);
            const bonusState = this.getBonusState(card, type, index);
            let bonusClass = bonusState === 'used' ? 'used'
                : ((type === 'row' ? completedRows : completedCols).has(index) ? 'available' : '');
            const bonusKey = `${card.card_id}:${type}:${index}`;

            if (bonusClass === 'available') {
                const initialClass = this.determineInitialBonusClass(bonusItems);
                if (initialClass !== 'available') {
                    bonusClass = initialClass;
                }
            }

            if (!bonusClass) {
                this.manualBonusStates.delete(bonusKey);
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
            return `
                <div class="bonus-cell ${type}-bonus ${bonusClass}${this.isMoonStarBonus(bonusItems) ? ' bonus-pink' : ''}" 
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

        // シール編集（ラウンド4の Last）。スタッフモードのときだけ見える
        const stickerEditing = !!(this.stickerEdit && this.stickerEdit.cardId === card.card_id);
        const stickerToolsHtml = (!disableInteractions && cardIndex !== null)
            ? this.createStickerTools(card, stickerEditing)
            : '';

        return `
            <div class="bingo-card size-${colCount}${disableInteractions ? ' completed-card' : ''}${stickerEditing ? ' sticker-editing' : ''}" data-round="${this.getCardRound(card.card_id)}" data-card-index="${cardIndex !== null ? cardIndex : ''}">
                <div class="card-header">カード ${card.card_id}</div>
                ${stickerToolsHtml}
                <div class="card-content">
                    <div class="bingo-board" style="--cols: ${colCount};">
                        ${mainGridHtml}
                        ${rowBonusColumn}
                        ${colBonusStripHtml}
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
        
        console.log('ボーナス表示生成:', {
            cardId: card.card_id,
            gridData,
            rowBonuses,
            colBonuses,
            completedLines
        });
        
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
                const clickHandler = isMarked ? '' : `onclick="console.log('直接クリック検出:', this); window.luckyBoxUI.markCell(${cardIndex}, ${rowIndex}, ${colIndex});"`;
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

        // 雷だけのマスは、ビンゴの瞬間に雷が自動で増えるので、最初からグレー（使用済み）にする。
        // 月・星・数字・？のマスは、ビンゴが揃ったら「有効（タップ待ち）」にし、
        // 運営が現物を渡す／ユーザーが使うときにタップしてグレーにする。
        const allLightning = bonusItems.every(item => item === 'lightning');

        return allLightning ? 'used' : 'available';
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
        }

        // ボーナス欄の使用状態は、エンジン側（Undo と一緒に戻る）に保存しているので、ここでは扱わない
        this.loadBonusStates();
    }

    saveUiState() {
        window.LuckyBoxEngine.uiState.save({
            currentRound: this.currentRound
        });
    }

    // ---- バージョン表示（右上）と保存エラー警告 ----
    setupFooter() {
        const versionEl = document.getElementById('app-version');
        if (versionEl && typeof APP_VERSION !== 'undefined') {
            versionEl.textContent = APP_VERSION;
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
    }

    updateHistoryDisplay() {
        const historyListElement = document.getElementById('history-list');
        const historyPositionElement = document.getElementById('history-position');
        if (!historyListElement || !this.gameState) return;

        const history = this.gameState.history || [];
        const currentPosition = this.gameState.history_position || 0;

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

        toDisplay.forEach((entry, index) => {
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

            historyListElement.appendChild(historyItem);
        });

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
    }

    // ボーナスの状態を取得
    getBonusState(card, type, index) {
        if (!card.used_bonuses) return '';
        const bonusKey = `${type}_${index}`;
        return card.used_bonuses[bonusKey] || '';
    }

    // ボーナスセルの色をトグル（効果なし）
    toggleBonus(element) {
        const bonusKey = element.dataset.bonusKey;
        const hasAvailable = element.classList.contains('available');
        const hasUsed = element.classList.contains('used');

        if (!bonusKey || (!hasAvailable && !hasUsed)) {
            return;
        }

        if (hasAvailable) {
            element.classList.remove('available');
            element.classList.add('used');
            this.manualBonusStates.set(bonusKey, 'used');
        } else {
            element.classList.remove('used');
            element.classList.add('available');
            this.manualBonusStates.delete(bonusKey);
        }

        if (element.classList.contains('bonus-pink')) {
            // 月・星のボーナス欄: グレーにする／ピンクに戻す操作そのものを、操作履歴に1件として残す。
            // Undo は、この切り替えだけを取り消す（盤面のマスは戻らない）。
            const [cardId, type, index] = bonusKey.split(':');
            const place = `${type === 'row' ? '行' : '列'}${Number(index) + 1}`;
            const label = hasAvailable
                ? `ボーナス使用済み: ${cardId} ${place}`
                : `ボーナス未使用に戻す: ${cardId} ${place}`;
            this.saveBonusStates({ record: true, label });
        } else {
            // 数字・？のボーナス欄: 履歴には残さず、次の盤面の操作（マスのタップ）と一緒に Undo で戻る
            this.saveBonusStates();
        }
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
        // 履歴に残した場合は、Undo ボタンや操作履歴の表示も更新する
        if (options.record && result && result.success && result.game_state) {
            this.gameState = result.game_state;
            this.updateDisplay();
        }
    }

    loadBonusStates() {
        this.manualBonusStates.clear();
        window.LuckyBoxEngine.getApi().getBonusStates().forEach((key) => {
            this.manualBonusStates.set(key, 'used');
        });
    }
}

// ページ読み込み完了時にUIを初期化
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM読み込み完了、UIを初期化します');
    window.luckyBoxUI = new LuckyBoxUI();
});
