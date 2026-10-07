/*
 * スーパーメガラッキーボックス ゲームエンジン（スタンドアローン版）
 *
 * app.py（Flask版）の BingoCard / LuckyBoxGame / 各APIハンドラを、
 * ブラウザ内で動くように JavaScript へ移植したもの。
 * 挙動は Flask 版と同一になるように作ってある（tests/ で出力の一致を検証）。
 *
 *  - LocalApi.call(endpoint, data) が Flask の /api/* と同じ形式のJSONを返す
 *  - 操作のたびに localStorage へ保存し、再起動後も続きから再開できる
 */
(function (global) {
  'use strict';

  const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
  const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const cellKey = (row, col) => `${row},${col}`;
  const bonusKey = (type, index) => `${type}:${index}`;

  /*
   * シール（統合マス）の設定。ラウンド4の「Last」だけが対象。
   * 現実で貼ったシールと同じ盤面を、スタッフがアプリ上で作る（貼れるのは、プレイ前＝黒マスが1つもないときだけ）。
   *   ・シールは正方形で、3x3 は1枚まで、2x2 は4枚まで（重ならない範囲で、どこにでも置ける）
   *   ・シールの下に隠れた元の数字は使わない。シールのマスには、選んだチームの文字を表示する
   *   ・行・列のボーナスは、シールの有無にかかわらず元のカードのまま
   */
  const STICKER_CONFIG = {
    cards: ['Last'],
    max: { 3: 1, 2: 4 },
    teams: ['x', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'], // 先頭が初期値（チーム未選択）
  };
  const DEFAULT_TEAM = STICKER_CONFIG.teams[0];

  /* ------------------------------------------------------------------ */
  /* BingoCard                                                           */
  /* ------------------------------------------------------------------ */
  class BingoCard {
    constructor(cardId, cardData) {
      this.card_id = cardId;
      this.size = cardData.size;
      this.display_grid = cardData.display_grid;
      const rawMergedGroups = cardData.merged_groups || [];
      let rowBonuses = cardData.row_bonuses || [];
      let colBonuses = cardData.col_bonuses || [];
      this.numbers = cardData.display_grid;

      let rows;
      let cols;
      if (Array.isArray(this.size) && this.size.length >= 2) {
        rows = this.size[0];
        cols = this.size[1];
      } else {
        rows = cols = parseInt(this.size, 10);
      }

      this.row_bonuses = this._normalizeBonusDefinitions(rowBonuses, rows);
      this.col_bonuses = this._normalizeBonusDefinitions(colBonuses, cols);

      this._initializeMergedGroups(rawMergedGroups);

      this.marked = [];
      for (let i = 0; i < rows; i++) {
        this.marked.push(new Array(cols).fill(false));
      }

      this._recalculateGroupMarkedStates();

      // 発動済みボーナス（'row:0' / 'col:1' 形式のキー -> [type, index]）
      this.activated_bonuses = new Map();
    }

    _initializeMergedGroups(rawGroups) {
      this.merged_groups_info = [];
      this.cell_to_group = new Map();
      this.merged_group_display_values = [];

      rawGroups.forEach((group, idx) => {
        let cells;
        let displayValue = null;
        if (isPlainObject(group)) {
          cells = group.cells || [];
          if (Object.prototype.hasOwnProperty.call(group, 'display_value')) {
            displayValue = group.display_value;
          } else if (group.value !== undefined) {
            displayValue = group.value;
          }
        } else {
          cells = group;
        }
        if (displayValue === undefined) displayValue = null;

        const normalizedCells = [];
        for (const cell of cells) {
          let row;
          let col;
          if (Array.isArray(cell) && cell.length >= 2) {
            row = cell[0];
            col = cell[1];
          } else if (isPlainObject(cell)) {
            row = cell.row;
            col = cell.col;
          } else {
            continue;
          }
          if (row === undefined || row === null || col === undefined || col === null) continue;
          normalizedCells.push([row, col]);
          this.cell_to_group.set(cellKey(row, col), idx);
        }

        this.merged_groups_info.push({ cells: normalizedCells, display_value: displayValue });
        this.merged_group_display_values.push(displayValue);
      });

      this.merged_groups = this.merged_groups_info.map((info) => info.cells);
    }

    // 統合マス（シール）に表示する文字を付け替える（シールだけのカード用。左上のマスに表示される）
    relabelStickers(label) {
      this.merged_groups_info.forEach((info, idx) => {
        info.display_value = label;
        this.merged_group_display_values[idx] = label;
        if (!info.cells.length) return;
        const [row, col] = info.cells[0];
        this.display_grid[row][col] = label;
        this.numbers[row][col] = label;
      });
    }

    _recalculateGroupMarkedStates() {
      this.group_marked = this.merged_groups_info.map((info) => {
        if (!info.cells.length) return false;
        return info.cells.every(([r, c]) => this._isCellMarked(r, c));
      });
    }

    _isCellMarked(row, col) {
      return row >= 0 && row < this.marked.length && col >= 0 && col < this.marked[row].length && !!this.marked[row][col];
    }

    _markGroup(groupIndex) {
      if (groupIndex < 0 || groupIndex >= this.merged_groups_info.length) return false;
      let changed = false;
      for (const [row, col] of this.merged_groups_info[groupIndex].cells) {
        if (!this._isCellMarked(row, col)) {
          this.marked[row][col] = true;
          changed = true;
        }
      }
      this.group_marked[groupIndex] = true;
      return changed;
    }

    _normalizeBonusDefinitions(bonuses, expectedLength) {
      if (!Array.isArray(bonuses)) bonuses = [];
      const normalized = [];
      for (let idx = 0; idx < expectedLength; idx++) {
        const entry = idx < bonuses.length ? bonuses[idx] : null;
        normalized.push(this._normalizeBonusEntry(entry));
      }
      return normalized;
    }

    _normalizeBonusEntry(entry) {
      if (entry === null || entry === undefined) return [];
      if (Array.isArray(entry)) {
        const result = [];
        for (const item of entry) result.push(...this._normalizeBonusEntry(item));
        return result;
      }
      const value = String(entry).trim();
      return value ? [value] : [];
    }

    checkCompletedLines() {
      const completed = [];
      const [rows, cols] = this.size;

      for (let i = 0; i < rows; i++) {
        let rowComplete = true;
        const seenGroups = new Set();
        for (let j = 0; j < cols; j++) {
          const groupIndex = this.cell_to_group.get(cellKey(i, j));
          if (groupIndex !== undefined) {
            if (seenGroups.has(groupIndex)) continue;
            seenGroups.add(groupIndex);
            if (!this.group_marked[groupIndex]) {
              rowComplete = false;
              break;
            }
          } else if (!this._isCellMarked(i, j)) {
            rowComplete = false;
            break;
          }
        }
        if (rowComplete) completed.push(['row', i]);
      }

      for (let j = 0; j < cols; j++) {
        let colComplete = true;
        const seenGroups = new Set();
        for (let i = 0; i < rows; i++) {
          const groupIndex = this.cell_to_group.get(cellKey(i, j));
          if (groupIndex !== undefined) {
            if (seenGroups.has(groupIndex)) continue;
            seenGroups.add(groupIndex);
            if (!this.group_marked[groupIndex]) {
              colComplete = false;
              break;
            }
          } else if (!this._isCellMarked(i, j)) {
            colComplete = false;
            break;
          }
        }
        if (colComplete) completed.push(['col', j]);
      }

      return completed;
    }

    getLineBonuses(completedLines) {
      const bonuses = [];
      const newActivations = [];

      for (const [lineType, index] of completedLines) {
        const key = bonusKey(lineType, index);
        if (this.activated_bonuses.has(key)) continue;

        if (lineType === 'row' && index < this.row_bonuses.length) {
          bonuses.push(...this.row_bonuses[index]);
          newActivations.push([lineType, index]);
        } else if (lineType === 'col' && index < this.col_bonuses.length) {
          bonuses.push(...this.col_bonuses[index]);
          newActivations.push([lineType, index]);
        }
      }

      for (const [lineType, index] of newActivations) {
        this.activated_bonuses.set(bonusKey(lineType, index), [lineType, index]);
      }
      return bonuses;
    }

    isComplete() {
      const [rows, cols] = this.size;
      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
          const groupIndex = this.cell_to_group.get(cellKey(i, j));
          if (groupIndex !== undefined) {
            if (!this.group_marked[groupIndex]) return false;
          } else if (!this._isCellMarked(i, j)) {
            return false;
          }
        }
      }
      return true;
    }
  }

  /* ------------------------------------------------------------------ */
  /* LuckyBoxGame                                                        */
  /* ------------------------------------------------------------------ */
  class LuckyBoxGame {
    constructor(cardsDefinition) {
      const def = cardsDefinition || global.LUCKYBOX_CARDS;
      if (!def) throw new Error('カード定義 (LUCKYBOX_CARDS) が読み込まれていません');

      this.cards = [];
      this.completed_cards = [];
      this.lightning_tokens = 4;
      this.moon_tokens = 0;
      this.star_tokens = 0;
      this.score = 0;
      this.score_details = { completed_points: 0, active_black_cells: 0, active_points: 0, total: 0 };
      this.round_num = 1;
      // 画面でタップして「使用済み（グレー）」にしたボーナス欄のキー（例: "G11:row:0"）。
      // 操作履歴の各スナップショットにも含めるので、Undo すると、そのときの使用状態に戻る。
      this.bonus_states = [];
      // このタブレットのチーム（シールに表示する文字）。スタッフモードで選ぶ
      this.team = DEFAULT_TEAM;
      this.history = [];
      this.available_cards = clone(def.cards);
      this.cards_by_round = clone(def.cardsByRound);
      this.updateScore();
    }

    /* ---- カードの保存・復元 ---- */
    serializeCard(card) {
      return {
        card_id: card.card_id,
        size: clone(card.size),
        display_grid: clone(card.display_grid),
        merged_groups: card.merged_groups_info.map((info) => clone(info.cells)),
        merged_group_details: card.merged_groups_info.map((info) => ({
          cells: clone(info.cells),
          display_value: info.display_value,
        })),
        row_bonuses: clone(card.row_bonuses),
        col_bonuses: clone(card.col_bonuses),
        numbers: clone(card.numbers),
        marked: clone(card.marked),
        group_marked: clone(card.group_marked),
        merged_group_display_values: clone(card.merged_group_display_values),
        activated_bonuses: Array.from(card.activated_bonuses.values()).map((b) => [b[0], b[1]]),
        completed_lines: card.checkCompletedLines(),
        is_complete: card.isComplete(),
      };
    }

    deserializeCard(cardState) {
      const cardId = cardState.card_id;
      const mergedGroupsState = cardState.merged_groups || [];
      const detailsState = cardState.merged_group_details || [];
      const displayValues = cardState.merged_group_display_values || [];

      const cardData = {
        size: clone(cardState.size || [3, 3]),
        display_grid: clone(cardState.display_grid || cardState.numbers || []),
        merged_groups: clone(this._normalizeMergedGroups(detailsState, mergedGroupsState, displayValues)),
        row_bonuses: clone(cardState.row_bonuses || []),
        col_bonuses: clone(cardState.col_bonuses || []),
      };

      const card = new BingoCard(cardId, cardData);

      if (cardState.marked) {
        const [rows, cols] = card.size;
        for (let i = 0; i < rows; i++) {
          for (let j = 0; j < cols; j++) {
            if (i < cardState.marked.length && j < cardState.marked[i].length) {
              card.marked[i][j] = !!cardState.marked[i][j];
            }
          }
        }
      }

      if (Array.isArray(cardState.group_marked)) {
        cardState.group_marked.forEach((value, idx) => {
          if (idx < card.group_marked.length) card.group_marked[idx] = !!value;
        });
      }

      if (cardState.activated_bonuses) {
        card.activated_bonuses = new Map();
        for (const entry of cardState.activated_bonuses) {
          if (Array.isArray(entry) && entry.length === 2) {
            card.activated_bonuses.set(bonusKey(entry[0], entry[1]), [entry[0], entry[1]]);
          } else if (typeof entry === 'string') {
            const m = /^(row|col)_(\d+)$/.exec(entry);
            if (m) card.activated_bonuses.set(bonusKey(m[1], Number(m[2])), [m[1], Number(m[2])]);
          }
        }
      }

      card._recalculateGroupMarkedStates();
      return card;
    }

    _normalizeMergedGroups(detailsState, groupsState, displayValues) {
      if (detailsState && detailsState.length) return detailsState;
      if (!groupsState || !groupsState.length) return [];
      return groupsState.map((group, idx) => {
        if (isPlainObject(group)) return group;
        return { cells: group, display_value: idx < displayValues.length ? displayValues[idx] : null };
      });
    }

    /* ---- カード一覧 ---- */
    getCardsByRound(roundName) {
      if (!Object.prototype.hasOwnProperty.call(this.cards_by_round, roundName)) return [];
      const result = [];
      for (const cardId of this.cards_by_round[roundName]) {
        if (!Object.prototype.hasOwnProperty.call(this.available_cards, cardId)) continue;
        const label = cardId.includes('_') ? cardId.split('_').slice(1).join('_') : cardId;
        result.push({ card_id: cardId, display_name: `カード ${label}` });
      }
      return result;
    }

    addCard(cardId) {
      if (!Object.prototype.hasOwnProperty.call(this.available_cards, cardId)) return false;
      for (const existing of this.cards.concat(this.completed_cards)) {
        if (existing.card_id === cardId) return false;
      }
      const card = new BingoCard(cardId, this.available_cards[cardId]);
      this.cards.push(card);
      this.saveState(`カード追加: ${cardId}`);
      return true;
    }

    // 全マスが埋まったカードを、カレントのプール（this.cards）から外して、コンプリートのプールへ移す。
    // 全マスが埋まった時点で、すでに completed_cards には入っている（markCell）ので、
    // ここでは「カレントから消す」のが主な仕事。得点（コンプリート×10点）は変わらない。
    completeCard(cardIndex) {
      if (!Number.isInteger(cardIndex) || cardIndex < 0 || cardIndex >= this.cards.length) return false;
      const card = this.cards[cardIndex];
      if (!card.isComplete()) return false;

      this.cards.splice(cardIndex, 1);
      if (!this.completed_cards.some((c) => c.card_id === card.card_id)) this.completed_cards.push(card);

      this.updateScore();
      this.saveState(`カード完了（コンプリートへ移動）: ${card.card_id}`);
      return true;
    }

    // シールの貼り方を設定する。stickers は [{row, col, size}]（row, col は左上のマス、size は 2 か 3）。
    // 成功したら null、できないときは理由の文字列を返す。
    setStickers(cardIndex, stickers) {
      if (!Number.isInteger(cardIndex) || cardIndex < 0 || cardIndex >= this.cards.length) {
        return 'カードが見つかりません';
      }
      const card = this.cards[cardIndex];
      if (!STICKER_CONFIG.cards.includes(card.card_id)) return 'このカードにはシールを貼れません';
      if (card.marked.some((rowMarks) => rowMarks.some(Boolean))) {
        return '黒マスがあるため、シールを変更できません';
      }

      const [rows, cols] = card.size;
      const used = Array.from({ length: rows }, () => new Array(cols).fill(false));
      const counts = {};
      const normalized = [];
      for (const s of stickers) {
        const size = Number(s && s.size);
        const row = Number(s && s.row);
        const col = Number(s && s.col);
        if (!Object.prototype.hasOwnProperty.call(STICKER_CONFIG.max, size)) return 'シールの大きさが正しくありません';
        if (!Number.isInteger(row) || !Number.isInteger(col)) return 'シールの位置が正しくありません';
        if (row < 0 || col < 0 || row + size > rows || col + size > cols) return 'シールが盤面からはみ出します';
        counts[size] = (counts[size] || 0) + 1;
        if (counts[size] > STICKER_CONFIG.max[size]) return `${size}x${size} のシールは、あと貼れません`;
        for (let r = row; r < row + size; r++) {
          for (let c = col; c < col + size; c++) {
            if (used[r][c]) return '他のシールと重なっています';
            used[r][c] = true;
          }
        }
        normalized.push({ row, col, size });
      }
      normalized.sort((a, b) => (a.row - b.row) || (a.col - b.col));

      // 元の盤面（カード定義）を土台に、シールの左上のマスの表示を label に置き換える
      const base = this.available_cards[card.card_id].display_grid;
      const grid = clone(base);
      const groups = normalized.map(({ row, col, size }) => {
        const cells = [];
        for (let r = row; r < row + size; r++) {
          for (let c = col; c < col + size; c++) cells.push([r, c]);
        }
        grid[row][col] = this.team;
        return { display_value: this.team, cells };
      });

      card.display_grid = grid;
      card.numbers = grid;
      card._initializeMergedGroups(groups);
      card._recalculateGroupMarkedStates();

      this.updateScore();
      this.saveState(`シール編集: ${card.card_id}`);
      return null;
    }

    // チーム（シールに表示する文字）を設定する。すでに貼ってあるシールの文字も付け替える。
    // 成功したら null、できないときは理由の文字列を返す。
    setTeam(team) {
      if (!STICKER_CONFIG.teams.includes(team)) return 'チームが正しくありません';
      if (team === this.team) return null;

      this.team = team;
      for (const card of this.cards.concat(this.completed_cards)) {
        if (STICKER_CONFIG.cards.includes(card.card_id)) card.relabelStickers(team);
      }
      // チームは Undo の対象外（操作履歴には残さない）。保存は、呼び出し側（LocalApi）が行う
      return null;
    }

    /* ---- セル操作 ---- */
    markCell(cardIndex, row, col) {
      if (cardIndex < 0 || cardIndex >= this.cards.length) return false;

      const card = this.cards[cardIndex];
      const [rows, cols] = card.size;
      if (row < 0 || row >= rows || col < 0 || col >= cols) return false;

      const cardId = card.card_id;
      const number = card.numbers[row][col];

      const groupIndex = card.cell_to_group.get(cellKey(row, col));
      let actionLabel = null;
      if (groupIndex !== undefined) {
        // 統合マス: グループ全体をマークしたあと、通常のマスと同じく
        // ビンゴ判定・ボーナス処理・コンプリート判定を行う（以下の共通処理へ進む）
        if (!card._markGroup(groupIndex)) return true; // すでにマーク済み
        actionLabel = `セル統合マス追加: ${cardId}`;
      } else {
        if (card.marked[row][col]) return true;
        card.marked[row][col] = true;
      }

      const completedLines = card.checkCompletedLines();
      let bonusAction = '';
      const bonusDescriptions = [];
      if (completedLines.length) {
        const bonuses = card.getLineBonuses(completedLines);
        if (bonuses.length) {
          this.processBonuses(bonuses, cardId);

          const tokenLabels = [['lightning', '雷'], ['moon', '月'], ['star', '星']];
          const tokenCounts = { lightning: 0, moon: 0, star: 0, wildcard: 0 };
          const numberValues = [];
          const otherCounts = new Map();

          for (const bonus of bonuses) {
            if (Object.prototype.hasOwnProperty.call(tokenCounts, bonus)) {
              tokenCounts[bonus] += 1;
            } else if (bonus.startsWith('number_')) {
              numberValues.push(bonus.split('_').slice(1).join('_'));
            } else {
              otherCounts.set(bonus, (otherCounts.get(bonus) || 0) + 1);
            }
          }

          for (const [key, label] of tokenLabels) {
            const count = tokenCounts[key];
            if (count === 1) bonusDescriptions.push(`${label}+1`);
            else if (count > 1) bonusDescriptions.push(`${label}+${count}`);
          }

          if (tokenCounts.wildcard === 1) bonusDescriptions.push('？獲得');
          else if (tokenCounts.wildcard > 1) bonusDescriptions.push(`？×${tokenCounts.wildcard}獲得`);

          if (numberValues.length) bonusDescriptions.push(`${numberValues.join(',')}獲得`);

          for (const [name, count] of otherCounts) {
            bonusDescriptions.push(count === 1 ? `${name}獲得` : `${name}×${count}獲得`);
          }

          if (bonusDescriptions.length) bonusAction = `、ビンゴ ${bonusDescriptions.join('、')}`;
        }
      }

      let completionAction = '';
      if (card.isComplete()) {
        completionAction = '、コンプリート';
        if (!this.completed_cards.includes(card)) this.completed_cards.push(card);
      }

      this.updateScore();
      this.saveState(`${actionLabel || `${cardId}の${number}をマーク`}${bonusAction}${completionAction}`);
      return true;
    }

    processBonuses(bonuses) {
      for (const bonus of bonuses) {
        if (bonus === 'lightning') this.lightning_tokens += 1;
        else if (bonus === 'moon') this.moon_tokens += 1;
        else if (bonus === 'star') this.star_tokens += 1;
        // number_* / wildcard はユーザーが画面上で使用するため、ここでは何もしない
      }
    }

    adjustTokens(tokenType, amount) {
      if (tokenType === 'lightning') this.lightning_tokens = Math.max(0, this.lightning_tokens + amount);
      else if (tokenType === 'moon') this.moon_tokens = Math.max(0, this.moon_tokens + amount);
      else if (tokenType === 'star') this.star_tokens = Math.max(0, this.star_tokens + amount);
      else return false;
      this.updateScore();
      return true;
    }

    /* ---- スコア ---- */
    countBlackCells() {
      let total = 0;
      for (const card of this.cards) {
        if (card.isComplete()) continue;

        const countedGroups = new Set();
        card.merged_groups_info.forEach((group, idx) => {
          if (idx < card.group_marked.length && card.group_marked[idx]) {
            countedGroups.add(idx);
            total += 1;
          }
        });

        card.marked.forEach((rowMarks, rowIndex) => {
          rowMarks.forEach((isMarked, colIndex) => {
            if (!isMarked) return;
            const groupIndex = card.cell_to_group.get(cellKey(rowIndex, colIndex));
            if (groupIndex !== undefined) {
              if (countedGroups.has(groupIndex)) return;
              countedGroups.add(groupIndex);
              total += 1;
            } else {
              total += 1;
            }
          });
        });
      }
      return total;
    }

    updateScore() {
      const completedPoints = this.completed_cards.length * 10;
      const activeBlackCells = this.countBlackCells();
      const activePoints = Math.floor(activeBlackCells / 2);
      const total = completedPoints + activePoints;

      this.score = total;
      this.score_details = {
        completed_points: completedPoints,
        active_black_cells: activeBlackCells,
        active_points: activePoints,
        bonus_points: 0,
        total: total,
      };
    }

    /* ---- 履歴 / Undo ---- */
    _buildState(actionDescription) {
      return {
        cards: this.cards.map((c) => this.serializeCard(c)),
        completed_cards: this.completed_cards.map((c) => this.serializeCard(c)),
        lightning_tokens: this.lightning_tokens,
        moon_tokens: this.moon_tokens,
        star_tokens: this.star_tokens,
        score: this.score,
        score_details: Object.assign({}, this.score_details),
        round_num: this.round_num,
        bonus_states: this.bonus_states.slice(),
        team: this.team,
        action: actionDescription,
        timestamp: new Date().toISOString(),
      };
    }

    saveState(actionDescription = '操作') {
      const state = this._buildState(actionDescription);

      // 初期状態（カード0枚、トークン初期値）の場合は履歴に保存しない
      const isInitialState =
        this.cards.length === 0 &&
        this.completed_cards.length === 0 &&
        this.lightning_tokens === 4 &&
        this.moon_tokens === 0 &&
        this.star_tokens === 0 &&
        this.score === 0 &&
        this.round_num === 1;
      if (isInitialState) return;

      this.history.push(state);
      if (this.history.length > 50) {
        // 先頭が「土台」（clearHistory が置いたもの）なら、それは残して、新しい49件を残す
        this.history =
          this.history[0] && this.history[0].baseline
            ? [this.history[0]].concat(this.history.slice(-49))
            : this.history.slice(-50);
      }
    }

    // 操作履歴（Undo用）を消し、「現在の状態」を Undo の限界（土台）にする。
    // これ以降の操作は Undo できるが、この状態より前には戻れない（盤面ごと消えることもない）。
    clearHistory() {
      const base = this._buildState('スタッフ操作を確定');
      base.baseline = true;
      this.history = [base];
    }

    // いま Undo できるか（履歴が空、または一番新しいものが「土台」なら不可）
    canUndo() {
      const last = this.history[this.history.length - 1];
      return !!last && !last.baseline;
    }

    undo() {
      if (!this.canUndo()) return false;
      this.history.pop();
      if (this.history.length) {
        this.restoreState(this.history[this.history.length - 1]);
      } else {
        this.resetToInitial();
      }
      return true;
    }

    restoreState(state) {
      this.lightning_tokens = state.lightning_tokens !== undefined ? state.lightning_tokens : 4;
      this.moon_tokens = state.moon_tokens !== undefined ? state.moon_tokens : 0;
      this.star_tokens = state.star_tokens !== undefined ? state.star_tokens : 0;
      this.score = state.score !== undefined ? state.score : 0;
      this.round_num = state.round_num !== undefined ? state.round_num : 1;
      this.bonus_states = Array.isArray(state.bonus_states) ? state.bonus_states.slice() : [];

      this.cards = [];
      this.completed_cards = [];
      for (const cardState of state.cards || []) {
        this.cards.push(this.deserializeCard(cardState));
      }
      for (const cardState of state.completed_cards || []) {
        this.completed_cards.push(this.deserializeCard(cardState));
      }
      // シールの文字は、いまのチームに合わせる（Undo しても、チームは戻らない）
      for (const card of this.cards.concat(this.completed_cards)) {
        if (STICKER_CONFIG.cards.includes(card.card_id)) card.relabelStickers(this.team);
      }
      this.updateScore();
    }

    resetToInitial() {
      this.cards = [];
      this.completed_cards = [];
      this.lightning_tokens = 4;
      this.moon_tokens = 0;
      this.star_tokens = 0;
      this.score = 0;
      this.score_details = { completed_points: 0, active_black_cells: 0, active_points: 0, total: 0 };
      this.round_num = 1;
      this.bonus_states = [];
      this.history = [];
      this.updateScore();
      return true;
    }

    /* ---- 画面向けの状態 ---- */
    getGameState() {
      const cardsData = this.cards.map((card) => ({
        card_id: card.card_id,
        size: card.size,
        display_grid: card.display_grid,
        merged_groups: card.merged_groups,
        row_bonuses: card.row_bonuses,
        col_bonuses: card.col_bonuses,
        numbers: card.numbers,
        marked: card.marked,
        completed_lines: card.checkCompletedLines(),
        is_complete: card.isComplete(),
      }));

      const completedCardsData = this.completed_cards.map((card) => this.serializeCard(card));

      const canUndo = this.canUndo();

      // 「土台」は内部用なので、画面の操作履歴には出さない
      const historyData = this.history.filter((state) => !state.baseline).map((state) => ({
        action: state.action !== undefined ? state.action : '不明な操作',
        timestamp: state.timestamp !== undefined ? state.timestamp : '',
        cards: state.cards || [],
        completed_cards: state.completed_cards || [],
        lightning_tokens: state.lightning_tokens !== undefined ? state.lightning_tokens : 4,
        moon_tokens: state.moon_tokens !== undefined ? state.moon_tokens : 0,
        star_tokens: state.star_tokens !== undefined ? state.star_tokens : 0,
      }));

      const addedCardIds = this.cards.concat(this.completed_cards).map((c) => c.card_id);
      const availableCards = {};
      for (const [cardId, cardData] of Object.entries(this.available_cards)) {
        if (addedCardIds.includes(cardId)) continue;
        if (!isPlainObject(cardData) || !('display_grid' in cardData)) continue;
        availableCards[cardId] = {
          card_id: cardId,
          size: cardData.size || [3, 3],
          display_grid: cardData.display_grid || [],
          merged_groups: cardData.merged_groups || [],
          row_bonuses: cardData.row_bonuses || [],
          col_bonuses: cardData.col_bonuses || [],
          numbers: cardData.numbers || cardData.display_grid || [],
        };
      }

      // 画面側が後で書き換えても内部状態に影響しないよう、複製して返す
      return clone({
        cards: cardsData,
        completed_cards: completedCardsData,
        lightning_tokens: this.lightning_tokens,
        moon_tokens: this.moon_tokens,
        star_tokens: this.star_tokens,
        score: this.score,
        score_details: this.score_details,
        round_num: this.round_num,
        can_undo: canUndo,
        can_redo: false,
        available_cards: availableCards,
        history: historyData,
      });
    }

    /* ---- 永続化用 ---- */
    exportPersisted() {
      return {
        version: 1,
        current: this._buildState('current'),
        history: clone(this.history),
      };
    }

    importPersisted(payload) {
      try {
        if (!payload || payload.version !== 1 || !payload.current || !Array.isArray(payload.history)) {
          return false;
        }
        // チームは、Undo やオールリセットの影響を受けない設定なので、保存データから直接戻す
        if (STICKER_CONFIG.teams.includes(payload.current.team)) this.team = payload.current.team;
        this.restoreState(payload.current);
        this.history = clone(payload.history);
        return true;
      } catch (err) {
        console.error('保存データの復元に失敗しました:', err);
        return false;
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* 永続化（localStorage、2スロット交互書き込み + チェックサム）          */
  /* ------------------------------------------------------------------ */
  // 文字列の簡易ハッシュ（cyrb53）。破損検知用。
  function cyrb53(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }

  class StateStore {
    constructor(storage, keyPrefix = 'luckybox.state') {
      this.storage = storage;
      this.keys = [`${keyPrefix}.a`, `${keyPrefix}.b`];
      this.seq = 0;
      this.lastSavedAt = null;
      this.lastError = null;
      this.memory = {};
    }

    _read(key) {
      return this.storage ? this.storage.getItem(key) : (this.memory[key] || null);
    }

    _write(key, value) {
      if (this.storage) this.storage.setItem(key, value);
      else this.memory[key] = value;
    }

    load() {
      let best = null;
      for (const key of this.keys) {
        try {
          const raw = this._read(key);
          if (!raw) continue;
          const wrapper = JSON.parse(raw);
          if (!wrapper || typeof wrapper.data !== 'string') continue;
          if (cyrb53(wrapper.data) !== wrapper.sum) continue; // 破損
          if (!best || wrapper.seq > best.seq) best = wrapper;
        } catch (err) {
          // このスロットは使えない（もう一方を使う）
        }
      }
      if (!best) return null;
      this.seq = best.seq;
      this.lastSavedAt = best.savedAt || null;
      try {
        return JSON.parse(best.data);
      } catch (err) {
        return null;
      }
    }

    save(payload) {
      try {
        const data = JSON.stringify(payload);
        const seq = this.seq + 1;
        const savedAt = new Date().toISOString();
        const wrapper = JSON.stringify({ v: 1, seq, savedAt, sum: cyrb53(data), data });
        this._write(this.keys[seq % 2], wrapper);
        this.seq = seq;
        this.lastSavedAt = savedAt;
        this.lastError = null;
        return true;
      } catch (err) {
        this.lastError = err;
        console.error('状態の保存に失敗しました:', err);
        return false;
      }
    }

    clear() {
      for (const key of this.keys) {
        try {
          if (this.storage) this.storage.removeItem(key);
          else delete this.memory[key];
        } catch (err) {
          // 無視
        }
      }
      this.seq = 0;
    }
  }

  /* ------------------------------------------------------------------ */
  /* LocalApi: Flask の /api/* と同じ形式のレスポンスを返す                */
  /* ------------------------------------------------------------------ */
  const MUTATING = new Set(['add_card', 'mark_cell', 'undo', 'redo', 'reset', 'adjust_tokens', 'clear_history', 'set_bonus_states', 'complete_card', 'set_stickers', 'set_team']);

  function defaultStorage() {
    try {
      const s = global.localStorage;
      const probe = '__luckybox_probe__';
      s.setItem(probe, '1');
      s.removeItem(probe);
      return s;
    } catch (err) {
      return null; // localStorage が使えない（保存不可）
    }
  }

  class LocalApi {
    constructor(options = {}) {
      this.storage = options.storage !== undefined ? options.storage : defaultStorage();
      this.cards = options.cards || global.LUCKYBOX_CARDS;
      this.store = new StateStore(this.storage);
      this.storageAvailable = !!this.storage;
      this.restored = false;
      this.listeners = [];
      // 状態を変えた操作に成功した回数（保存はしない）。
      // 「スタッフモード中に何か操作したか」を、画面側が前後の差で調べるために使う。
      this.mutationCount = 0;

      this.game = new LuckyBoxGame(this.cards);
      const payload = this.store.load();
      if (payload) {
        const candidate = new LuckyBoxGame(this.cards);
        if (candidate.importPersisted(payload)) {
          this.game = candidate;
          this.restored = true;
        }
      }
    }

    onSaveStatus(listener) {
      this.listeners.push(listener);
    }

    saveStatus() {
      return {
        ok: this.storageAvailable && !this.store.lastError,
        storageAvailable: this.storageAvailable,
        savedAt: this.store.lastSavedAt,
        error: this.store.lastError ? String(this.store.lastError) : null,
      };
    }

    _persist() {
      this.store.save(this.game.exportPersisted());
      const status = this.saveStatus();
      this.listeners.forEach((fn) => {
        try {
          fn(status);
        } catch (err) {
          console.error(err);
        }
      });
    }

    // 「使用済み」のボーナス欄のキー一覧（画面の描画用。ゲーム状態 getGameState とは別にしてある）
    getBonusStates() {
      return this.game.bonus_states.slice();
    }

    // 現在のチーム（画面の描画用。ゲーム状態 getGameState とは別にしてある）
    getTeam() {
      return this.game.team;
    }

    call(endpoint, data = null) {
      let result;
      try {
        result = this._handle(endpoint, data);
      } catch (err) {
        console.error(`API処理エラー (${endpoint}):`, err);
        result = { success: false, error: String(err && err.message ? err.message : err) };
      }
      if (MUTATING.has(endpoint) && result && result.success) {
        this.mutationCount += 1;
        this._persist();
      }
      return result;
    }

    _handle(endpoint, data) {
      const game = this.game;

      if (endpoint === 'get_state' || endpoint === 'game_state') {
        return game.getGameState();
      }

      if (endpoint.startsWith('cards_by_round/')) {
        const roundName = decodeURIComponent(endpoint.slice('cards_by_round/'.length));
        return { success: true, round: roundName, cards: game.getCardsByRound(roundName) };
      }

      if (endpoint === 'add_card') {
        if (!data || (isPlainObject(data) && Object.keys(data).length === 0)) {
          return { success: false, error: 'No data received' };
        }
        const cardId = data.card_id;
        if (!cardId) return { success: false, error: 'No card_id provided' };
        if (game.addCard(cardId)) {
          return { success: true, game_state: game.getGameState() };
        }
        const existing = game.cards.map((c) => c.card_id);
        const message = existing.includes(cardId)
          ? `${cardId} は既に追加済みです`
          : `カード ${cardId} の追加に失敗しました`;
        return { success: false, error: message };
      }

      if (endpoint === 'mark_cell') {
        const d = data || {};
        if (d.card_index == null || d.row == null || d.col == null) {
          return { success: false, error: '必要なパラメータが不足しています' };
        }
        const success = game.markCell(d.card_index, d.row, d.col);
        return { success, game_state: game.getGameState() };
      }

      if (endpoint === 'set_team') {
        const error = game.setTeam(data && data.team);
        if (error) return { success: false, error };
        return { success: true, game_state: game.getGameState() };
      }

      if (endpoint === 'set_stickers') {
        const d = data || {};
        if (d.card_index == null || !Array.isArray(d.stickers)) {
          return { success: false, error: '必要なパラメータが不足しています' };
        }
        const error = game.setStickers(Number(d.card_index), d.stickers);
        if (error) return { success: false, error, game_state: game.getGameState() };
        return { success: true, game_state: game.getGameState() };
      }

      if (endpoint === 'complete_card') {
        const d = data || {};
        if (d.card_index == null) return { success: false, error: '必要なパラメータが不足しています' };
        const success = game.completeCard(Number(d.card_index));
        return { success, game_state: game.getGameState() };
      }

      if (endpoint === 'undo') {
        const success = game.undo();
        return { success, game_state: game.getGameState() };
      }

      // 操作履歴（Undo用）だけを全部消す。現在の盤面・得点・トークンはそのまま。
      // スタッフモードを終えるとき、スタッフの操作をユーザーが Undo で取り消せないようにするために使う。
      if (endpoint === 'clear_history') {
        game.clearHistory();
        return { success: true, game_state: game.getGameState() };
      }

      // 「使用済み」にしたボーナス欄のキー一覧を保存する（操作履歴は増やさない）。
      // 直後の操作（盤面のマスをタップなど）のスナップショットに含まれるので、
      // その操作を Undo すると、ボーナス欄の使用状態も一緒に戻る。
      //
      // ただし data.record が true のとき（月・星のボーナス欄）は、その切り替え自体を操作履歴に1件として残す。
      // こうすると、Undo はその切り替えだけを取り消し、盤面のマスは元に戻らない。
      if (endpoint === 'set_bonus_states') {
        const used = data && Array.isArray(data.used) ? data.used : null;
        if (!used) return { success: false, error: 'used が配列ではありません' };
        const clean = used.filter((k) => typeof k === 'string');

        if (data.record) {
          // 直前のスナップショットより前に、履歴に残していない切り替え（数字ボーナス欄など）があれば、
          // それも別の1件として先に残す（月・星の Undo で、それらまで巻き戻らないようにする）
          const last = game.history[game.history.length - 1];
          const lastStates = last && Array.isArray(last.bonus_states) ? last.bonus_states : [];
          const sameSet = (a, b) => a.length === b.length && a.every((k) => b.includes(k));
          if (!sameSet(game.bonus_states, lastStates)) game.saveState('ボーナス欄の使用状態を更新');

          game.bonus_states = clean;
          game.saveState(String(data.label || 'ボーナス欄の使用状態を変更'));
        } else {
          game.bonus_states = clean;
        }
        return { success: true, game_state: game.getGameState() };
      }

      if (endpoint === 'reset') {
        const success = game.resetToInitial();
        // チームは、オールリセットの影響を受けない（この端末のチームとして残す）
        return { success, game_state: game.getGameState() };
      }

      if (endpoint === 'adjust_tokens') {
        const d = data || {};
        const tokenType = d.token_type;
        const amount = d.amount;
        if (!tokenType || amount == null) {
          return { success: false, error: '必要なパラメータが不足しています', game_state: game.getGameState() };
        }
        const names = { lightning: '雷', moon: '月', star: '星' };
        if (!Object.prototype.hasOwnProperty.call(names, tokenType)) {
          return { success: false, error: `無効なトークンタイプ: ${tokenType}`, game_state: game.getGameState() };
        }
        const oldValue = game[`${tokenType}_tokens`];
        const newValue = Math.max(0, oldValue + amount);
        const success = game.adjustTokens(tokenType, amount);
        if (success) {
          const signed = amount >= 0 ? `+${amount}` : `${amount}`;
          game.saveState(`${names[tokenType]}トークン ${signed} (${oldValue}→${newValue})`);
        }
        return { success, game_state: game.getGameState() };
      }

      return { success: false, error: `不明なエンドポイント: ${endpoint}` };
    }
  }

  /* ------------------------------------------------------------------ */
  /* 画面状態（選択中ラウンド、ボーナスの使用済み表示）の保存             */
  /* ------------------------------------------------------------------ */
  const UI_KEY = 'luckybox.ui.v1';

  const uiState = {
    load() {
      try {
        const raw = global.localStorage.getItem(UI_KEY);
        return raw ? JSON.parse(raw) : {};
      } catch (err) {
        return {};
      }
    },
    save(state) {
      try {
        global.localStorage.setItem(UI_KEY, JSON.stringify(state));
      } catch (err) {
        // 画面状態は失われても致命的ではない
      }
    },
  };

  let sharedApi = null;
  function getApi() {
    if (!sharedApi) sharedApi = new LocalApi();
    return sharedApi;
  }

  global.LuckyBoxEngine = { BingoCard, LuckyBoxGame, LocalApi, StateStore, cyrb53, uiState, getApi, STICKER_CONFIG };
})(typeof window !== 'undefined' ? window : globalThis);
