from flask import Flask, render_template, jsonify, request, session
import random
import uuid
import csv
import os
from datetime import datetime, timedelta

app = Flask(__name__)
app.secret_key = 'super-mega-lucky-box-2024'  # セッション用秘密鍵

class BingoCard:
    def __init__(self, card_id, card_data):
        self.card_id = card_id
        
        # 新フォーマット対応
        if isinstance(card_data, dict):
            # 新フォーマット
            self.size = card_data['size']
            self.display_grid = card_data['display_grid']
            raw_merged_groups = card_data.get('merged_groups', [])
            self.row_bonuses = card_data.get('row_bonuses', [])
            self.col_bonuses = card_data.get('col_bonuses', [])
            self.numbers = card_data['display_grid']  # 後方互換性
        else:
            # 旧フォーマット（後方互換性）
            self.size = [3, 3]
            self.display_grid = card_data
            raw_merged_groups = []
            self.row_bonuses = ['lightning', 'moon', 'star']
            self.col_bonuses = ['star', 'lightning', 'moon']
            self.numbers = card_data

        if isinstance(self.size, (list, tuple)) and len(self.size) >= 2:
            rows, cols = self.size[0], self.size[1]
        else:
            rows = cols = int(self.size)

        self.row_bonuses = self._normalize_bonus_definitions(self.row_bonuses, rows)
        self.col_bonuses = self._normalize_bonus_definitions(self.col_bonuses, cols)

        # 統合マス情報を初期化
        self._initialize_merged_groups(raw_merged_groups)

        # マーク状態を動的に初期化
        rows, cols = self.size
        self.marked = [[False for _ in range(cols)] for _ in range(rows)]

        # 統合マスのマーク状態を再計算
        self._recalculate_group_marked_states()

        # 発動済みボーナスを記録
        self.activated_bonuses = set()  # ('row', 0) や ('col', 1) の形式で記録
    
    def _initialize_merged_groups(self, raw_groups):
        """統合マス情報を整形して保持"""
        self.merged_groups_info = []
        self.cell_to_group = {}
        self.merged_group_display_values = []

        for idx, group in enumerate(raw_groups):
            if isinstance(group, dict):
                cells = group.get('cells', [])
                display_value = group.get('display_value', group.get('value'))
            else:
                cells = group
                display_value = None

            normalized_cells = []
            for cell in cells:
                if isinstance(cell, (list, tuple)) and len(cell) >= 2:
                    row, col = cell[0], cell[1]
                elif isinstance(cell, dict):
                    row = cell.get('row')
                    col = cell.get('col')
                else:
                    continue

                if row is None or col is None:
                    continue

                coord = (row, col)
                normalized_cells.append(coord)
                self.cell_to_group[coord] = idx

            self.merged_groups_info.append({
                'cells': normalized_cells,
                'display_value': display_value
            })
            self.merged_group_display_values.append(display_value)

        # 互換性のための簡易アクセス
        self.merged_groups = [info['cells'] for info in self.merged_groups_info]

    def _recalculate_group_marked_states(self):
        """統合マスの現在のマーク状態を更新"""
        self.group_marked = []
        for info in self.merged_groups_info:
            if not info['cells']:
                self.group_marked.append(False)
            else:
                self.group_marked.append(all(self._is_cell_marked(r, c) for r, c in info['cells']))

    def _is_cell_marked(self, row, col):
        return 0 <= row < len(self.marked) and 0 <= col < len(self.marked[row]) and self.marked[row][col]

    def _mark_group(self, group_index):
        """指定された統合マス全体をマーク"""
        if group_index < 0 or group_index >= len(self.merged_groups_info):
            return False

        changed = False
        for row, col in self.merged_groups_info[group_index]['cells']:
            if not self._is_cell_marked(row, col):
                self.marked[row][col] = True
                changed = True

        self.group_marked[group_index] = True
        return changed

    def _unmark_group(self, group_index):
        """指定された統合マス全体のマークを解除"""
        if group_index < 0 or group_index >= len(self.merged_groups_info):
            return False

        changed = False
        for row, col in self.merged_groups_info[group_index]['cells']:
            if self._is_cell_marked(row, col):
                self.marked[row][col] = False
                changed = True

        self.group_marked[group_index] = False
        return changed

    def mark_number(self, number):
        """指定された数字をマーク（動的サイズ対応・統合マス対応）"""
        rows, cols = self.size
        for i in range(rows):
            for j in range(cols):
                if self.numbers[i][j] == number and not self._is_cell_marked(i, j):
                    group_index = self.cell_to_group.get((i, j))
                    if group_index is not None:
                        if self._mark_group(group_index):
                            return True
                        return False
                    self.marked[i][j] = True
                    return True
        return False
    
    def unmark_number(self, number):
        """指定された数字のマークを解除（動的サイズ対応・統合マス対応）"""
        rows, cols = self.size
        for i in range(rows):
            for j in range(cols):
                if self.numbers[i][j] == number and self._is_cell_marked(i, j):
                    group_index = self.cell_to_group.get((i, j))
                    if group_index is not None:
                        if self._unmark_group(group_index):
                            return True
                        return False
                    self.marked[i][j] = False
                    return True
        return False
    
    def _normalize_bonus_definitions(self, bonuses, expected_length):
        """行列ごとのボーナス定義をリスト化"""
        if not isinstance(bonuses, list):
            bonuses = []

        normalized = []
        for idx in range(expected_length):
            entry = bonuses[idx] if idx < len(bonuses) else None
            normalized.append(self._normalize_bonus_entry(entry))
        return normalized

    def _normalize_bonus_entry(self, entry):
        """ボーナス定義をフラットな文字列リストに正規化"""
        if entry is None:
            return []
        if isinstance(entry, (list, tuple, set)):
            result = []
            for item in entry:
                result.extend(self._normalize_bonus_entry(item))
            return result
        value = str(entry).strip()
        return [value] if value else []

    def check_completed_lines(self):
        """完成した行・列をチェック（動的サイズ対応）"""
        completed = []
        rows, cols = self.size
        
        # 行をチェック
        for i in range(rows):
            row_complete = True
            seen_groups = set()
            for j in range(cols):
                group_index = self.cell_to_group.get((i, j))
                if group_index is not None:
                    if group_index in seen_groups:
                        continue
                    seen_groups.add(group_index)
                    if not self.group_marked[group_index]:
                        row_complete = False
                        break
                else:
                    if not self._is_cell_marked(i, j):
                        row_complete = False
                        break
            if row_complete:
                completed.append(('row', i))
        
        # 列をチェック
        for j in range(cols):
            col_complete = True
            seen_groups = set()
            for i in range(rows):
                group_index = self.cell_to_group.get((i, j))
                if group_index is not None:
                    if group_index in seen_groups:
                        continue
                    seen_groups.add(group_index)
                    if not self.group_marked[group_index]:
                        col_complete = False
                        break
                else:
                    if not self._is_cell_marked(i, j):
                        col_complete = False
                        break
            if col_complete:
                completed.append(('col', j))
        
        return completed
    
    def get_line_bonuses(self, completed_lines):
        """完成した列のボーナスを取得（未発動のもののみ）"""
        bonuses = []
        new_activations = []
        
        for line_type, index in completed_lines:
            line_key = (line_type, index)
            
            # 既に発動済みのボーナスはスキップ
            if line_key in self.activated_bonuses:
                continue
                
            # 新しく完成した列のボーナスを追加
            if line_type == 'row' and index < len(self.row_bonuses):
                bonuses.extend(self.row_bonuses[index])
                new_activations.append(line_key)
            elif line_type == 'col' and index < len(self.col_bonuses):
                bonuses.extend(self.col_bonuses[index])
                new_activations.append(line_key)
        
        # 発動済みリストに追加
        for activation in new_activations:
            self.activated_bonuses.add(activation)
            print(f"ボーナス発動記録: {activation}")
        
        return bonuses
    
    def is_complete(self):
        """カード全体が完成しているかチェック（動的サイズ対応）"""
        rows, cols = self.size
        for i in range(rows):
            for j in range(cols):
                group_index = self.cell_to_group.get((i, j))
                if group_index is not None:
                    if not self.group_marked[group_index]:
                        return False
                else:
                    if not self._is_cell_marked(i, j):
                        return False
        return True

class LuckyBoxGame:
    def __init__(self):
        self.cards = []  # 使用中のビンゴカード（アクティブ）
        self.completed_cards = []  # コンプリート済みカード
        self.lightning_tokens = 4  # 雷トークン数
        self.moon_tokens = 0  # 月トークン数
        self.star_tokens = 0  # 星トークン数
        self.score = 0  # 得点
        self.score_details = {
            'completed_points': 0,
            'active_black_cells': 0,
            'active_points': 0,
            'total': 0
        }
        self.round_num = 1  # 現在のラウンド
        # シンプルなUndo実装（Redo機能なし）
        self.history = []  # 操作履歴
        self.available_cards = {}  # 利用可能なビンゴカード
        self.cards_by_round = {}  # ラウンド別カード構成
        self.load_bingo_cards()
        self.update_score()
        
        # ゲーム開始時は履歴に保存しない
        print(f"ゲーム初期化完了: 履歴数={len(self.history)}")
    
    def serialize_card(self, card):
        """カード状態を辞書化して保存/レスポンス用に利用"""
        merged_groups_simple = []
        merged_group_details = []
        for info in card.merged_groups_info:
            cells = [[r, c] for (r, c) in info['cells']]
            merged_groups_simple.append([cell[:] for cell in cells])
            merged_group_details.append({
                'cells': [cell[:] for cell in cells],
                'display_value': info.get('display_value')
            })

        return {
            'card_id': card.card_id,
            'size': card.size,
            'display_grid': [row[:] for row in card.display_grid],
            'merged_groups': merged_groups_simple,
            'merged_group_details': merged_group_details,
            'row_bonuses': [bonus_list[:] for bonus_list in card.row_bonuses],
            'col_bonuses': [bonus_list[:] for bonus_list in card.col_bonuses],
            'numbers': [row[:] for row in card.numbers],
            'marked': [row[:] for row in card.marked],
            'group_marked': card.group_marked[:],
            'merged_group_display_values': card.merged_group_display_values[:],
            'activated_bonuses': [list(bonus) if isinstance(bonus, tuple) else bonus for bonus in card.activated_bonuses],
            'completed_lines': card.check_completed_lines(),
            'is_complete': card.is_complete()
        }

    def deserialize_card(self, card_state):
        """保存状態からBingoCardインスタンスを復元"""
        card_id = card_state['card_id']
        merged_groups_state = card_state.get('merged_groups', [])
        merged_group_details_state = card_state.get('merged_group_details', [])
        merged_group_display_values = card_state.get('merged_group_display_values', [])

        card_data = {
            'size': card_state.get('size', [3, 3]),
            'display_grid': card_state.get('display_grid', card_state.get('numbers', [])),
            'merged_groups': self._normalize_merged_groups(merged_group_details_state, merged_groups_state, merged_group_display_values),
            'row_bonuses': card_state.get('row_bonuses', []),
            'col_bonuses': card_state.get('col_bonuses', [])
        }

        card = BingoCard(card_id, card_data)

        if 'marked' in card_state:
            rows, cols = card.size
            for i in range(rows):
                for j in range(cols):
                    if i < len(card_state['marked']) and j < len(card_state['marked'][i]):
                        card.marked[i][j] = card_state['marked'][i][j]

        if 'group_marked' in card_state and isinstance(card_state['group_marked'], list):
            for idx, value in enumerate(card_state['group_marked']):
                if idx < len(card.group_marked):
                    card.group_marked[idx] = bool(value)

        if 'activated_bonuses' in card_state:
            card.activated_bonuses = set()
            for entry in card_state['activated_bonuses']:
                if isinstance(entry, (list, tuple)) and len(entry) == 2:
                    card.activated_bonuses.add(tuple(entry))
                elif isinstance(entry, str):
                    if entry.startswith('row_'):
                        try:
                            idx = int(entry[4:])
                            card.activated_bonuses.add(('row', idx))
                        except ValueError:
                            pass
                    elif entry.startswith('col_'):
                        try:
                            idx = int(entry[4:])
                            card.activated_bonuses.add(('col', idx))
                        except ValueError:
                            pass

        card._recalculate_group_marked_states()
        return card

    def _normalize_merged_groups(self, details_state, groups_state, display_values):
        """シリアライズされた統合マス情報から復元"""
        if details_state:
            return details_state

        if not groups_state:
            return []
        normalized = []
        display_values = display_values or []
        for idx, group in enumerate(groups_state):
            if isinstance(group, dict):
                normalized.append(group)
            else:
                normalized.append({
                    'cells': group,
                    'display_value': display_values[idx] if idx < len(display_values) else None
                })
        return normalized

    def load_bingo_cards(self):
        """ビンゴカードを新フォーマットで読み込み"""
        # ラウンド別カード構成
        self.cards_by_round = {
            'tutorial': ['Tutorial'],
            'round1': ['G11', 'GX6', 'GX5', 'G22', 'G33', 'G34'],
            'round2': ['BX5', 'B11', 'B22', 'BX6', 'B23', 'B34'],
            'round3': ['R11', 'RX2'],
            'round4': ['Last', 'LastSP']
        }
        
        # 新フォーマットのカードデータ
        sample_cards = {
            #チュートリアル
            'Tutorial': {
                'card_id': 'Tutorial',
                'size': [3, 3],
                'display_grid': [[3, 1, 2], [1, 2, 3], [4, 6, 5]],
                'merged_groups': [],
                'row_bonuses': ['wildcard', 'star', ['lightning', 'lightning']],
                'col_bonuses': ['number_2', 'moon', 'number_6']
            },
            #ラウンド1
            'G11': {
                'card_id': 'G11',
                'size': [3, 3],
                'display_grid': [[1, 2, 3], [2, 3, 1], [7, 8, 9]],
                'merged_groups': [],
                'row_bonuses': ['number_6', 'number_5', 'number_4'],
                'col_bonuses': ['number_9', 'moon', 'number_8']
            },
            'GX6': {
                'card_id': 'GX6',
                'size': [3, 3],
                'display_grid': [[1, 2, 3], [4, 5, 6], [5, 6, 4]],
                'merged_groups': [],
                'row_bonuses': ['number_7', 'number_9', 'number_8'],
                'col_bonuses': ['number_2', 'number_1', ['lightning', 'lightning']]
            },
            'GX5': {
                'card_id': 'GX5',
                'size': [3, 3],
                'display_grid': [[1, 2, 3], [2, 3, 1], [4, 5, 6]],
                'merged_groups': [],
                'row_bonuses': ['number_7', 'number_8', 'number_9'],
                'col_bonuses': ['moon', 'star', 'star']
            },
            'G22': {
                'card_id': 'G22',
                'size': [3, 3],
                'display_grid': [[4, 5, 6], [6, 4, 5], [7, 8, 9]],
                'merged_groups': [],
                'row_bonuses': ['number_3', 'number_2', 'number_1'],
                'col_bonuses': ['moon', 'star', 'moon']
            },
            'G33': {
                'card_id': 'G33',
                'size': [3, 3],
                'display_grid': [[1, 2, 3], [7, 8, 9], [9, 7, 8]],
                'merged_groups': [],
                'row_bonuses': ['number_6', 'number_4', 'number_5'],
                'col_bonuses': ['number_3', 'star', 'number_1']
            },
            'G34': {
                'card_id': 'G34',
                'size': [3, 3],
                'display_grid': [[4, 5, 6], [7, 8, 9], [9, 7, 8]],
                'merged_groups': [],
                'row_bonuses': ['number_3', 'number_2', 'number_1'],
                'col_bonuses': [['lightning', 'lightning'], 'moon', ['lightning', 'lightning']]
            },
            #ラウンド2
            'BX5': {
                'card_id': 'BX5',
                'size': [3, 3],
                'display_grid': [[1, 2, 3], [2, 3, 1], [7, 8, 9]],
                'merged_groups': [],
                'row_bonuses': ['number_4', 'number_6', 'number_5'],
                'col_bonuses': ['number_9', 'number_7', 'number_8']
            },
            'B11': {
                'card_id': 'B11',
                'size': [3, 3],
                'display_grid': [[1, 2, 3], [3, 1, 2], [4, 5, 6]],
                'merged_groups': [],
                'row_bonuses': ['number_9', 'wildcard', 'lightning'],
                'col_bonuses': ['star', 'star', 'lightning']
            },
            'B22': {
                'card_id': 'B22',
                'size': [3, 3],
                'display_grid': [[4, 5, 6], [6, 4, 5], [7, 8, 9]],
                'merged_groups': [],
                'row_bonuses': ['number_3', 'number_2', 'number_1'],
                'col_bonuses': ['number_8', 'number_9', 'number_7']
            },
            'BX6': {
                'card_id': 'BX6',
                'size': [3, 3],
                'display_grid': [[4, 5, 6], [7, 8, 9], [8, 9, 7]],
                'merged_groups': [],
                'row_bonuses': ['number_1', 'number_2', 'number_3'],
                'col_bonuses': ['number_6', 'number_4', 'number_5']
            },
            'B23': {
                'card_id': 'B23',
                'size': [3, 3],
                'display_grid': [[1, 2, 3], [4, 5, 6], [5, 6, 4]],
                'merged_groups': [],
                'row_bonuses': ['lightning', 'wildcard', 'number_7'],
                'col_bonuses': ['moon', 'moon', 'lightning']
            },
            'B34': {
                'card_id': 'B34',
                'size': [3, 3],
                'display_grid': [[1, 2, 3], [7, 8, 9], [9, 7, 8]],
                'merged_groups': [],
                'row_bonuses': ['lightning', 'number_6', 'wildcard'],
                'col_bonuses': ['star', 'lightning', ['lightning', 'lightning']]
            },
            #ラウンド3
            'R11': {
                'card_id': 'R11',
                'size': [4, 4],
                'display_grid': [
                    [3, 1, 2, 3],
                    [4, 0, 0, 5],
                    [9, 0, 0, 6],
                    [3, 8, 7, 3]
                ],
                'merged_groups': [
                    {
                        'display_value': 0,
                        'cells': [
                            [1, 1], [1, 2],
                            [2, 1], [2, 2]
                        ]
                    }
                ],
                'row_bonuses': [
                    ['moon', 'moon'],
                    'wildcard',
                    'wildcard',
                    ['lightning', 'lightning', 'lightning', 'lightning']
                ],
                'col_bonuses': [
                    ['star', 'star'],
                    'wildcard',
                    'wildcard',
                    ['lightning', 'lightning', 'lightning', 'lightning']
                ]
            },
            'RX2': {
                'card_id': 'RX2',
                'size': [4, 4],
                'display_grid': [
                    [1, 2, 3, 4],
                    [5, 6, 0, 0],
                    [0, 0, 0, 0],
                    [0, 0, 7, 8]
                ],
                'merged_groups': [
                    {
                        'display_value': 0,
                        'cells': [
                            [1, 2], [1, 3],
                            [2, 2], [2, 3]
                        ]
                    },
                    {
                        'display_value': 0,
                        'cells': [
                            [2, 0], [2, 1],
                            [3, 0], [3, 1]
                        ]
                    }
                ],
                'row_bonuses': [
                    'wildcard',
                    'star',
                    'star',
                    'moon'
                ],
                'col_bonuses': [
                    'moon',
                    'wildcard',
                    ['lightning', 'lightning'],
                    ['lightning', 'lightning']
                ]
            },
            #ラウンド4
            'Last': {
                'card_id': 'Last',
                'size': [5, 5],
                'display_grid': [
                    [6, 3, 4, 2, 5],
                    [1, 0, 5, 0, 4],
                    [0, 9, 0, 7, 0],
                    [7, 0, 6, 0, 3],
                    [8, 2, 9, 1, 8]
                ],
                'merged_groups': [],
                'row_bonuses': [
                    'wildcard',
                    'wildcard',
                    ['wildcard', 'wildcard'],
                    'wildcard',
                    'wildcard'
                ],
                'col_bonuses': [
                    'wildcard',
                    ['star', 'star'],
                    ['wildcard', 'wildcard'],
                    ['moon', 'moon'],
                    'wildcard'
                ]
            },
            'LastSP': {
                'card_id': 'LastSP',
                'size': [5, 5],
                'display_grid': [
                    [6, 3, 4, 2, 5],
                    [1, 0, 5, 0, 4],
                    [0, 9, 0, 7, 0],
                    [7, 0, 6, 0, 3],
                    [8, 2, 9, 1, 8]
                ],
                'merged_groups': [
                    {
                        'display_value': 0,
                        'cells': [
                            [1, 1], [1, 2], [1, 3],
                            [2, 1], [2, 2], [2, 3],
                            [3, 1], [3, 2], [3, 3]
                        ]
                    }
                ],
                'row_bonuses': [
                    'wildcard',
                    'wildcard',
                    ['wildcard', 'wildcard'],
                    'wildcard',
                    'wildcard'
                ],
                'col_bonuses': [
                    'wildcard',
                    ['star', 'star'],
                    ['wildcard', 'wildcard'],
                    ['moon', 'moon'],
                    'wildcard'
                ]
            }
        }
        
        for card_id, card_data in sample_cards.items():
            self.available_cards[card_id] = card_data
    
    def get_cards_by_round(self, round_name):
        """指定されたラウンドのカード一覧を取得"""
        if round_name not in self.cards_by_round:
            return []
        
        round_card_ids = self.cards_by_round[round_name]
        result = []
        for card_id in round_card_ids:
            if card_id not in self.available_cards:
                continue
            if '_' in card_id:
                label = card_id.split('_', 1)[1]
            else:
                label = card_id
            result.append({
                'card_id': card_id,
                'display_name': f"カード {label}"
            })
        return result
    
    def add_card(self, card_id):
        """指定されたIDのビンゴカードを追加"""
        if card_id not in self.available_cards:
            print(f"カード追加失敗: 存在しないカードID {card_id}")
            return False
        
        # 重複チェック: 既に同じカードIDが追加されているかチェック
        for existing_card in self.cards + self.completed_cards:
            if existing_card.card_id == card_id:
                print(f"カード追加失敗: {card_id} は既に追加済みです")
                return False
        
        card_data = self.available_cards[card_id]
        card = BingoCard(card_id, card_data)
        self.cards.append(card)
        
        # 操作後の状態を保存
        self.save_state(f"カード追加: {card_id}")
        print(f"カード追加成功: {card_id}")
        return True
    
    def mark_cell(self, card_index, row, col):
        """指定されたセルを直接マーク"""
        if card_index < 0 or card_index >= len(self.cards):
            print(f"無効なカードインデックス: {card_index}")
            return False
        
        card = self.cards[card_index]
        rows, cols = card.size
        
        if row < 0 or row >= rows or col < 0 or col >= cols:
            print(f"無効な座標: row={row}, col={col}, カードサイズ: {rows}x{cols}")
            return False
        
        card_id = card.card_id
        number = card.numbers[row][col]
        
        # 既にマークされている場合は成功として扱う
        group_index = card.cell_to_group.get((row, col))

        if group_index is not None:
            print(f"統合マスをマーク: グループ{group_index}")
            changed = card._mark_group(group_index)
            if not changed:
                print(f"統合マス{group_index}は既にマーク済み")
            # スコアを更新して保存
            self.update_score()
            self.save_state(f"セル統合マス追加: {card_id}")
            return True

        if card.marked[row][col]:
            print(f"既にマーク済み: カード{card_index}[{row}][{col}] = {number} (成功として扱う)")
            return True
        
        # セルをマーク
        card.marked[row][col] = True
        print(f"セルマーク成功: カード{card_index}[{row}][{col}] = {number}")
        
        # ビンゴ判定とボーナス処理
        completed_lines = card.check_completed_lines()
        bonus_action = ""
        bonus_descriptions = []
        if completed_lines:
            bonuses = card.get_line_bonuses(completed_lines)
            if bonuses:
                self.process_bonuses(bonuses, card_id)

                token_labels = {
                    'lightning': '雷',
                    'moon': '月',
                    'star': '星',
                }

                token_counts = {'lightning': 0, 'moon': 0, 'star': 0, 'wildcard': 0}
                number_values = []
                other_counts = {}

                for bonus in bonuses:
                    if bonus in token_counts:
                        token_counts[bonus] += 1
                    elif bonus.startswith('number_'):
                        number_values.append(bonus.split('_', 1)[1])
                    else:
                        other_counts[bonus] = other_counts.get(bonus, 0) + 1

                for key, label in token_labels.items():
                    count = token_counts[key]
                    if count == 1:
                        bonus_descriptions.append(f"{label}+1")
                    elif count > 1:
                        bonus_descriptions.append(f"{label}+{count}")

                if token_counts['wildcard'] == 1:
                    bonus_descriptions.append('？獲得')
                elif token_counts['wildcard'] > 1:
                    bonus_descriptions.append(f"？×{token_counts['wildcard']}獲得")

                if number_values:
                    bonus_descriptions.append(f"{','.join(number_values)}獲得")

                for name, count in other_counts.items():
                    label = name
                    if count == 1:
                        bonus_descriptions.append(f"{label}獲得")
                    else:
                        bonus_descriptions.append(f"{label}×{count}獲得")

                if bonus_descriptions:
                    bonus_action = "、ビンゴ " + "、".join(bonus_descriptions)

        completion_action = ""
        if card.is_complete():
            completion_action = "、コンプリート"
            if card not in self.completed_cards:
                self.completed_cards.append(card)

        # スコアを更新し、操作後の状態を保存（1回だけ）
        self.update_score()
        self.save_state(f"{card_id}の{number}をマーク{bonus_action}{completion_action}")
        
        return True
    
    def process_bonuses(self, bonuses, card_id):
        """ボーナスを処理してトークンを追加（save_stateは呼び出さない）"""
        for bonus in bonuses:
            if bonus == 'lightning':
                self.lightning_tokens += 1
                print(f"[LIGHTNING] 雷トークン+1: {card_id} (合計: {self.lightning_tokens})")
            elif bonus == 'moon':
                self.moon_tokens += 1
                print(f"[MOON] 月トークン+1: {card_id} (合計: {self.moon_tokens})")
            elif bonus == 'star':
                self.star_tokens += 1
                print(f"[STAR] 星トークン+1: {card_id} (合計: {self.star_tokens})")
            elif bonus.startswith('number_'):
                number = bonus.split('_')[1]
                print(f"[NUMBER] 数字ボーナス: {number} - ユーザーがクリックで使用可能")
            elif bonus == 'wildcard':
                print(f"[WILDCARD] ワイルドカードボーナス - ユーザーがクリックで使用可能")
            else:
                print(f"[UNKNOWN] 不明なボーナス: {bonus}")
        # ボーナス処理自体では状態を保存しない（呼び出し元で行う）
    
    def adjust_tokens(self, token_type, amount):
        """トークンを指定した量だけ調整（save_stateは呼び出さない）"""
        print(f"adjust_tokens開始: {token_type} {amount:+d}")
        
        # 現在の値を取得
        if token_type == 'lightning':
            self.lightning_tokens = max(0, self.lightning_tokens + amount)
            display_name = '雷'
        elif token_type == 'moon':
            self.moon_tokens = max(0, self.moon_tokens + amount)
            display_name = '月'
        elif token_type == 'star':
            self.star_tokens = max(0, self.star_tokens + amount)
            display_name = '星'
        else:
            print(f"ERROR: 無効なトークンタイプ: {token_type}")
            return False
        
        print(f"{display_name}トークン: {self.lightning_tokens if token_type == 'lightning' else self.moon_tokens if token_type == 'moon' else self.star_tokens}")
        self.update_score()
        return True

    def count_black_cells(self):
        """未コンプリートカードの黒塗りマス数をカウント（統合マスは1マス換算）"""
        total = 0
        for card in self.cards:
            if card.is_complete():
                continue

            counted_groups = set()
            merged_groups = getattr(card, 'merged_groups_info', [])
            group_marked = getattr(card, 'group_marked', [])

            for idx, group in enumerate(merged_groups):
                if idx < len(group_marked) and group_marked[idx]:
                    counted_groups.add(idx)
                    total += 1

            rows = len(card.marked)
            for row_index in range(rows):
                row_marks = card.marked[row_index]
                for col_index, is_marked in enumerate(row_marks):
                    if not is_marked:
                        continue

                    group_index = card.cell_to_group.get((row_index, col_index))
                    if group_index is not None:
                        if group_index in counted_groups:
                            continue
                        counted_groups.add(group_index)
                        total += 1
                    else:
                        total += 1

        return total

    def update_score(self):
        """現在のカード状態からスコアと詳細を再計算"""
        completed_points = len(self.completed_cards) * 10
        active_black_cells = self.count_black_cells()
        active_points = active_black_cells // 2
        total = completed_points + active_points

        self.score = total
        self.score_details = {
            'completed_points': completed_points,
            'active_black_cells': active_black_cells,
            'active_points': active_points,
            'bonus_points': 0,
            'total': total
        }
    
    def save_state(self, action_description="操作"):
        """現在の状態を履歴に保存する
        
        注意: 初期状態は履歴に保存しません。
        初期状態は履歴0の状態として扱われます。
        
        Args:
            action_description (str): この状態の説明（操作内容など）
        """
        try:
            print(f"\n=== save_state開始: カード数={len(self.cards)}, コンプリート数={len(self.completed_cards)}, 操作='{action_description}' ===")
            
            # 履歴がなければ初期化
            if not hasattr(self, 'history'):
                print("履歴が未初期化のため初期化します")
                self.history = []
            
            # 現在の状態を保存
            state = {
                'cards': [],
                'completed_cards': [],
                'lightning_tokens': self.lightning_tokens,
                'moon_tokens': self.moon_tokens,
                'star_tokens': self.star_tokens,
                'score': self.score,
                'score_details': self.score_details.copy(),
                'round_num': self.round_num,
                'action': action_description,
                'timestamp': datetime.now().isoformat()
            }

            # カードの状態をコピー
            for i, card in enumerate(self.cards):
                print(f"カード{i}の状態をコピー中: {card.card_id}")
                state['cards'].append(self.serialize_card(card))

            for i, card in enumerate(self.completed_cards):
                print(f"コンプリートカード{i}の状態をコピー中: {card.card_id}")
                state['completed_cards'].append(self.serialize_card(card))

            # 初期状態（カード0枚、トークン初期値）の場合は履歴に保存しない
            is_initial_state = (len(self.cards) == 0 and 
                              len(self.completed_cards) == 0 and 
                              self.lightning_tokens == 4 and 
                              self.moon_tokens == 0 and 
                              self.star_tokens == 0 and
                              self.score == 0 and
                              self.round_num == 1)
            
            if is_initial_state:
                print("初期状態のため履歴には保存しません")
                return
                
            # 履歴に追加
            self.history.append(state)
            print(f"状態を履歴に保存: '{action_description}' (履歴数: {len(self.history)})")
            
            # 履歴が多すぎる場合は古いものを削除
            if len(self.history) > 50:
                removed = len(self.history) - 50
                self.history = self.history[-50:]
                print(f"履歴が50件を超えたため、古い履歴を{removed}件削除しました")
                
        except Exception as e:
            print(f"save_stateエラー: {e}")
            print(f"Exception type: {type(e)}")
            import traceback
            print(f"Traceback: {traceback.format_exc()}")
            raise e
    
    def undo(self):
        """操作を取り消し（シンプル方式）
        
        履歴が1つの場合：その履歴を削除して初期状態に戻す
        履歴が0の場合：何もしない（UI側でボタンを無効にすべき）
        
        戻り値:
            bool: Undoが実行されたかどうか
        """
        print(f"\n=== Undo実行開始（シンプル方式） ===")
        print(f"実行前: 履歴数={len(self.history) if hasattr(self, 'history') else 0}")
        
        # 履歴がなければ何もしない（UI側でボタンを無効にすべき）
        if not hasattr(self, 'history') or not self.history:
            print("Undo不可: 履歴がありません")
            return False
            
        # 履歴の詳細を出力（デバッグ用）
        for i, entry in enumerate(self.history):
            marker = " ← 現在" if i == len(self.history) - 1 else ""
            print(f"  {i}: {entry.get('action', '不明')} (カード数: {len(entry.get('cards', []))}) {marker}")
        
        # 最新の履歴を削除
        removed_state = self.history.pop()
        print(f"削除した履歴: {removed_state.get('action', '不明')}")
        
        # 履歴が残っていればその状態に、なければ初期状態に
        if self.history:
            target_state = self.history[-1]
            print(f"復元対象: {target_state.get('action', '不明')} (カード数: {len(target_state.get('cards', []))})")
            self.restore_state(target_state)
        else:
            print("履歴が0件になったので初期状態に戻します")
            self.reset_to_initial()  # 初期状態にリセット（履歴は空のまま）
        
        print(f"Undo成功: 履歴数={len(self.history)}")
        print(f"復元後のカード数: {len(self.cards)}, コンプリート数: {len(self.completed_cards)}")
        print(f"=== Undo実行完了 ===\n")
        return True
    
    def restore_state(self, state):
        """指定された状態を復元"""
        print(f"restore_state開始: 復元対象のカード数={len(state.get('cards', []))}")
        
        # ゲーム状態を復元
        self.current_number = state.get('current_number')
        self.current_lightning_used = state.get('current_lightning_used', 0)  # 雷使用情報を復元
        self.lightning_tokens = state.get('lightning_tokens', 4)
        self.moon_tokens = state.get('moon_tokens', 0)
        self.star_tokens = state.get('star_tokens', 0)
        self.score = state.get('score', 0)
        self.round_num = state.get('round_num', 1)
        score_details_state = state.get('score_details') if isinstance(state, dict) else None
        if isinstance(score_details_state, dict):
            self.score_details = {
                'completed_points': score_details_state.get('completed_points', 0),
                'active_black_cells': score_details_state.get('active_black_cells', 0),
                'active_points': score_details_state.get('active_points', 0),
                'bonus_points': score_details_state.get('bonus_points', 0),
                'total': score_details_state.get('total', self.score)
            }
        else:
            self.score_details = {
                'completed_points': 0,
                'active_black_cells': 0,
                'active_points': 0,
                'bonus_points': 0,
                'total': self.score
            }
        self.number_history = state.get('number_history', []).copy()  # 数字履歴を復元
        
        # カードをクリアして再作成
        self.cards = []
        self.completed_cards = []

        for card_state in state.get('cards', []):
            try:
                card = self.deserialize_card(card_state)
                self.cards.append(card)
                marked_count = sum(1 for row in card.marked for cell in row if cell)
                print(f"カードを復元: {card.card_id} (マーク数: {marked_count})")

            except Exception as e:
                print(f"カードの復元中にエラー: {e}")
                import traceback
                print(f"Traceback: {traceback.format_exc()}")
        
        for card_state in state.get('completed_cards', []):
            try:
                card = self.deserialize_card(card_state)
                self.completed_cards.append(card)
                print(f"コンプリートカードを復元: {card.card_id}")
            except Exception as e:
                print(f"コンプリートカードの復元中にエラー: {e}")
                import traceback
                print(f"Traceback: {traceback.format_exc()}")

        self.update_score()
        print(f"状態復元完了: カード数={len(self.cards)}, コンプリート数={len(self.completed_cards)}, 数字={self.current_number}, 雷={self.lightning_tokens}")
        print(f"スコア: {self.score}, ラウンド: {self.round_num}")
    
    def redo(self):
        """操作をやり直し（正しい履歴管理版）"""
        print(f"=== Redo実行開始 ===")
        print(f"履歴数: {len(self.history)}, 現在のインデックス: {self.history_index}")
        
        # Redo可能かチェック（最新状態より前にいる必要がある）
        if self.history_index >= len(self.history) - 1:
            print("Redo不可: すでに最新状態です")
            return False
        
        # インデックスを一つ後ろに移動
        self.history_index += 1
        
        # 指定されたインデックスの状態を復元
        if 0 <= self.history_index < len(self.history):
            target_state = self.history[self.history_index]
            self.restore_state(target_state)
            print(f"Redo成功: インデックス={self.history_index}, 履歴数={len(self.history)}")
            return True
        
        print("Redo失敗: 無効なインデックス")
        return False
    
    def reset_to_initial(self):
        """ゲームを初期状態にリセット（オールクリア時にも使用）
        
        注意: このメソッドは初期状態を履歴に保存しません。
        初期状態は履歴0の状態として扱われます。
        """
        print(f"=== オールリセット実行開始 ===")
        print(f"リセット前: カード数={len(self.cards)}, コンプリート数={len(self.completed_cards)}")
        
        # ゲーム状態を初期化（__init__メソッドと同様）
        self.cards = []
        self.completed_cards = []
        self.lightning_tokens = 4  # 雷トークン数
        self.moon_tokens = 0  # 月トークン数
        self.star_tokens = 0  # 星トークン数
        self.score = 0  # 得点
        self.score_details = {
            'completed_points': 0,
            'active_black_cells': 0,
            'active_points': 0,
            'total': 0
        }
        self.round_num = 1  # 現在のラウンド
        
        # 履歴を完全にクリア（初期状態は履歴に含めない）
        self.history = []
        
        self.update_score()
        print(f"リセット完了: カード数={len(self.cards)}, コンプリート数={len(self.completed_cards)}, 履歴数={len(self.history)}")
        return True
    
    def get_game_state(self):
        """現在のゲーム状態を取得"""
        print(f"=== get_game_state開始 ===")
        try:
            cards_data = []
            completed_cards_data = []
            print(f"処理対象カード数: {len(self.cards)}, コンプリートカード数: {len(self.completed_cards)}")
            for i, card in enumerate(self.cards):
                print(f"カード{i}処理開始: {card.card_id}")
                try:
                    completed_lines = card.check_completed_lines()
                    is_complete = card.is_complete()
                    print(f"カード {card.card_id}: completed_lines={completed_lines}, is_complete={is_complete}")
                
                    cards_data.append({
                        'card_id': card.card_id,
                        'size': card.size,
                        'display_grid': card.display_grid,
                        'merged_groups': card.merged_groups,
                        'row_bonuses': card.row_bonuses,
                        'col_bonuses': card.col_bonuses,
                        'numbers': card.numbers,  # 後方互換性
                        'marked': card.marked,
                        'completed_lines': completed_lines,
                        'is_complete': is_complete
                    })
                except Exception as e:
                    print(f"ERROR in get_game_state for card {card.card_id}: {e}")
                    import traceback
                    print(f"Traceback: {traceback.format_exc()}")
                    raise e

            for i, card in enumerate(self.completed_cards):
                try:
                    completed_cards_data.append(self.serialize_card(card))
                except Exception as e:
                    print(f"ERROR in get_game_state for completed card {card.card_id}: {e}")
                    import traceback
                    print(f"Traceback: {traceback.format_exc()}")
                    raise e
            
            # 履歴状態をデバッグ出力（シンプル版）
            # 履歴が1つ以上あればUndo可能
            can_undo = len(self.history) > 0
            can_redo = False  # Redo機能は廃止
            print(f"履歴状態: 履歴数={len(self.history)}, Undo可能={can_undo}, Redo可能={can_redo}")
            
            # 履歴情報を直接配列で返す（フロントエンドが期待する形式）
            history_data = []
            for i, state in enumerate(self.history):
                history_data.append({
                    'action': state.get('action', '不明な操作'),
                    'timestamp': state.get('timestamp', ''),
                    'cards': state.get('cards', []),  # カードデータも含める
                    'completed_cards': state.get('completed_cards', []),
                    'lightning_tokens': state.get('lightning_tokens', 4),
                    'moon_tokens': state.get('moon_tokens', 0),
                    'star_tokens': state.get('star_tokens', 0)
                })
            print(f"履歴データ作成完了: {len(history_data)}件")
            
            # 利用可能なカードリストを計算（追加済みカードを除外）
            added_card_ids = [card.card_id for card in self.cards] + [card.card_id for card in self.completed_cards]
            available_cards = {}
            
            # デバッグ用ログ
            print(f"追加済みカードID: {added_card_ids}")
            print(f"利用可能なカード一覧: {list(self.available_cards.keys())}")
            
            for card_id, card_data in self.available_cards.items():
                if card_id not in added_card_ids:
                    # カードデータが辞書形式であることを確認
                    if not isinstance(card_data, dict):
                        print(f"警告: カード {card_id} のデータが辞書形式ではありません。スキップします。")
                        continue
                        
                    # 必要なフィールドが存在するか確認
                    if 'display_grid' not in card_data:
                        print(f"警告: カード {card_id} に display_grid がありません。スキップします。")
                        continue
                        
                    # カード情報をコピー
                    available_cards[card_id] = {
                        'card_id': card_id,
                        'size': card_data.get('size', [3, 3]),
                        'display_grid': card_data.get('display_grid', []),
                        'merged_groups': card_data.get('merged_groups', []),
                        'row_bonuses': card_data.get('row_bonuses', []),
                        'col_bonuses': card_data.get('col_bonuses', []),
                        'numbers': card_data.get('numbers', card_data.get('display_grid', []))
                    }
            
            # デバッグ用ログ
            print(f"利用可能として返すカード: {list(available_cards.keys())}")
            result = {
                'cards': cards_data,
                'completed_cards': completed_cards_data,
                'lightning_tokens': self.lightning_tokens,
                'moon_tokens': self.moon_tokens,
                'star_tokens': self.star_tokens,
                'score': self.score,
                'score_details': (self.score_details.copy() if hasattr(self, 'score_details') else {
                    'completed_points': 0,
                    'active_black_cells': 0,
                    'active_points': 0,
                    'bonus_points': 0,
                    'total': self.score
                }),
                'round_num': self.round_num,
                'can_undo': can_undo,
                'can_redo': can_redo,
                'available_cards': available_cards,  # 利用可能カードリストを追加
                'history': history_data  # 直接配列で返す（シンプル方式ではhistory_index不要）
            }
            print(f"get_game_state完了: カード数={len(cards_data)}, 履歴数={len(history_data)}")
            return result
            
        except Exception as e:
            print(f"ERROR in get_game_state: {e}")
            import traceback
            print(f"Traceback: {traceback.format_exc()}")
            raise e

# ゲームインスタンス管理
games = {}  # セッションIDごとのゲーム状態を保存
last_activity = {}  # 最後のアクティビティ時刻

def cleanup_old_games():
    """古いゲームセッションを削除（30分以上非アクティブ）"""
    current_time = datetime.now()
    expired_sessions = []
    
    for session_id, last_time in last_activity.items():
        if current_time - last_time > timedelta(minutes=150):
            expired_sessions.append(session_id)
    
    for session_id in expired_sessions:
        if session_id in games:
            del games[session_id]
        if session_id in last_activity:
            del last_activity[session_id]
    
    print(f"クリーンアップ完了: {len(expired_sessions)}個の古いセッションを削除")

def get_user_game():
    """現在のユーザーのゲームインスタンスを取得または作成"""
    # セッションIDがない場合は新規作成
    if 'user_id' not in session:
        session['user_id'] = str(uuid.uuid4())
        print(f"新しいユーザー: {session['user_id']}")
    
    user_id = session['user_id']
    
    # ゲームインスタンスがない場合は新規作成
    if user_id not in games:
        games[user_id] = LuckyBoxGame()
        print(f"新しいゲーム作成: {user_id}")
    
    # 最後のアクティビティ時刻を更新
    last_activity[user_id] = datetime.now()
    
    # 定期的にクリーンアップ実行
    if len(games) > 100:  # 100ユーザー以上で実行
        cleanup_old_games()
    
    return games[user_id]

@app.route('/')
def index():
    """メインページを表示"""
    return render_template('index.html')

@app.route('/api/game_state')
def get_game_state():
    """現在のゲーム状態を取得"""
    game = get_user_game()
    state = game.get_game_state()
    state['user_id'] = session.get('user_id', 'unknown')[:8]
    return jsonify(state)

@app.route('/api/get_state')
def get_state():
    """現在のゲーム状態を取得（旧エンドポイント互換）"""
    return get_game_state()  # 既存の関数を呼び出す

@app.route('/api/add_card', methods=['POST'])
def add_card():
    """ビンゴカードを追加"""
    print(f"\n=== API呼び出し: add_card ===")
    print(f"Request method: {request.method}")
    print(f"Request headers: {dict(request.headers)}")
    print(f"Request data: {request.get_data()}")
    
    try:
        game = get_user_game()
        print(f"Game instance: {game}")
        
        data = request.json
        print(f"JSON data: {data}")
        
        if not data:
            print("ERROR: No JSON data received")
            return jsonify({'success': False, 'error': 'No data received'})
        
        card_id = data.get('card_id')
        print(f"Card ID: {card_id}")
        
        if not card_id:
            print("ERROR: No card_id provided")
            return jsonify({'success': False, 'error': 'No card_id provided'})
        
        success = game.add_card(card_id)
        print(f"カード追加結果: {success}")
        
        if success:
            try:
                game_state = game.get_game_state()
                print(f"Game state取得成功")
                
                result = {
                    'success': True,
                    'game_state': game_state
                }
            except Exception as e:
                print(f"ERROR in get_game_state: {e}")
                import traceback
                print(f"Traceback: {traceback.format_exc()}")
                return jsonify({'success': False, 'error': f'Game state error: {str(e)}'})
        else:
            # 重複チェック
            existing_cards = [card.card_id for card in game.cards]
            if card_id in existing_cards:
                error_message = f"{card_id} は既に追加済みです"
            else:
                error_message = f"カード {card_id} の追加に失敗しました"
            
            result = {
                'success': False,
                'error': error_message
            }
        print(f"Response: {result}")
        print("=== add_card API処理完了 ===\n")
        
        return jsonify(result)
        
    except Exception as e:
        print(f"ERROR in add_card: {e}")
        print(f"Exception type: {type(e)}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/mark_cell', methods=['POST'])
def mark_cell():
    """指定されたセルをマーク"""
    try:
        print(f"\n=== API呼び出し: mark_cell ===")
        game = get_user_game()
        data = request.json
        print(f"Request data: {data}")
        
        card_index = data.get('card_index')
        row = data.get('row')
        col = data.get('col')
        
        if card_index is None or row is None or col is None:
            print("ERROR: 必要なパラメータが不足")
            return jsonify({'success': False, 'error': '必要なパラメータが不足しています'})
        
        success = game.mark_cell(card_index, row, col)
        print(f"セルマーク結果: {success}")
        
        game_state = game.get_game_state()
        result = {
            'success': success,
            'game_state': game_state
        }
        print("=== mark_cell API処理完了 ===\n")
        
        return jsonify(result)
        
    except Exception as e:
        print(f"ERROR in mark_cell: {e}")
        print(f"Exception type: {type(e)}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/undo', methods=['POST'])
def undo():
    """直前の操作を取り消す"""
    try:
        print(f"\n=== API呼び出し: undo ===")
        game = get_user_game()
        print(f"Game instance: {game}")
        
        success = game.undo()
        print(f"Undo結果: {success}")
        
        game_state = game.get_game_state()
        print(f"Undo後のゲーム状態: カード数={len(game_state['cards'])}")
        
        result = {
            'success': success,
            'game_state': game_state
        }
        print(f"Undo Response: {result['success']}")
        print("=== undo API処理完了 ===\n")
        
        return jsonify(result)
        
    except Exception as e:
        print(f"ERROR in undo: {e}")
        print(f"Exception type: {type(e)}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/redo', methods=['POST'])
def redo():
    """操作をやり直し"""
    print(f"\n=== API呼び出し: redo ===")
    try:
        game = get_user_game()
        print(f"Game instance: {game}")
        
        success = game.redo()
        print(f"Redo結果: {success}")
        
        game_state = game.get_game_state()
        print(f"Redo後のゲーム状態: カード数={len(game_state['cards'])}")
        
        result = {
            'success': success,
            'game_state': game_state
        }
        print(f"Redo Response: {result['success']}")
        print("=== redo API処理完了 ===\n")
        
        return jsonify(result)
        
    except Exception as e:
        print(f"ERROR in redo: {e}")
        print(f"Exception type: {type(e)}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/reset', methods=['POST'])
def reset_game():
    """ゲームを初期状態にリセット"""
    print(f"\n=== API呼び出し: reset ===")
    try:
        game = get_user_game()
        print(f"Game instance: {game}")
        
        success = game.reset_to_initial()
        print(f"Reset結果: {success}")
        
        game_state = game.get_game_state()
        print(f"Reset後のゲーム状態: カード数={len(game_state['cards'])}")
        
        result = {
            'success': success,
            'game_state': game_state
        }
        print(f"Reset Response: {result['success']}")
        print("=== reset API処理完了 ===\n")
        
        return jsonify(result)
        
    except Exception as e:
        print(f"ERROR in reset: {e}")
        print(f"Exception type: {type(e)}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/adjust_tokens', methods=['POST'])
def adjust_tokens():
    """トークンを調整"""
    try:
        print(f"\n=== API呼び出し: adjust_tokens ===")
        game = get_user_game()
        data = request.get_json()
        
        token_type = data.get('token_type')
        amount = data.get('amount')
        
        print(f"リクエストデータ: token_type={token_type}, amount={amount}")
        
        if not token_type or amount is None:
            error_msg = '必要なパラメータが不足しています'
            print(f"ERROR: {error_msg}")
            return jsonify({
                'success': False,
                'error': error_msg,
                'game_state': game.get_game_state()
            }), 400
        
        # 変更前の値を取得
        if token_type == 'lightning':
            old_value = game.lightning_tokens
            new_value = max(0, old_value + amount)
            display_name = '雷'
        elif token_type == 'moon':
            old_value = game.moon_tokens
            new_value = max(0, old_value + amount)
            display_name = '月'
        elif token_type == 'star':
            old_value = game.star_tokens
            new_value = max(0, old_value + amount)
            display_name = '星'
        else:
            error_msg = f'無効なトークンタイプ: {token_type}'
            print(f"ERROR: {error_msg}")
            return jsonify({
                'success': False,
                'error': error_msg,
                'game_state': game.get_game_state()
            }), 400
        
        # トークン調整を実行
        success = game.adjust_tokens(token_type, amount)
        
        if success:
            # 状態を保存（成功時のみ）
            action_description = f"{display_name}トークン {amount:+d} ({old_value}→{new_value})"
            game.save_state(action_description)
        
        # 更新後のゲーム状態を取得
        game_state = game.get_game_state()
        
        result = {
            'success': success,
            'game_state': game_state
        }
        
        print(f"トークン調整結果: {success}")
        print(f"現在の履歴数: {len(game.history)}")
        print("=== adjust_tokens API処理完了 ===\n")
        
        return jsonify(result)
        
    except Exception as e:
        error_msg = f"トークン調整中にエラーが発生しました: {str(e)}"
        print(f"ERROR in adjust_tokens: {error_msg}")
        print(f"Exception type: {type(e)}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        
        # エラー時も現在のゲーム状態を返す
        game = get_user_game()
        return jsonify({
            'success': False,
            'error': error_msg,
            'game_state': game.get_game_state() if game else None
        }), 500

@app.route('/api/stats')
def get_stats():
    """サーバー統計情報を取得"""
    print(f"\n=== API呼び出し: stats ===")
    
    # アクティブなゲーム数を取得
    active_games = 0
    for game in games.values():
        # ゲームオブジェクトが有効かどうかを確認
        if hasattr(game, 'get_game_state'):
            active_games += 1
    
    stats = {
        'active_games': active_games,
        'server_time': datetime.now().isoformat()
    }
    
    print(f"Stats情報: {stats}")
    print(f"=== stats API完了 ===\n")
    return jsonify(stats)
    
    return jsonify(stats)

@app.route('/api/cards_by_round/<round_name>')
def get_cards_by_round(round_name):
    """指定されたラウンドのカード一覧を取得"""
    print(f"\n=== API呼び出し: cards_by_round/{round_name} ===")
    
    try:
        print(f"1. ユーザーゲームを取得します...")
        game = get_user_game()
        print(f"2. ゲームオブジェクトを取得しました: {type(game)}")
        
        print(f"3. カード一覧を取得します...")
        cards = game.get_cards_by_round(round_name)
        print(f"4. カード一覧を取得しました: {cards}")
        
        print(f"ラウンド {round_name} のカード数: {len(cards)}")
        print(f"カード一覧: {[card['card_id'] for card in cards] if cards else 'なし'}")
        
        return jsonify({
            'success': True,
            'round': round_name,
            'cards': cards
        })
        
    except Exception as e:
        print(f"ERROR in cards_by_round: {e}")
        import traceback
        traceback.print_exc()  # スタックトレースを詳細に出力
        return jsonify({
            'success': False, 
            'error': str(e),
            'traceback': traceback.format_exc()
        })

# すべてのリクエストをログ出力
@app.before_request
def log_request_info():
    print(f"\n=== リクエスト受信 ===")
    print(f"Method: {request.method}")
    print(f"URL: {request.url}")
    print(f"Path: {request.path}")
    print(f"Headers: {dict(request.headers)}")
    if request.method == 'POST':
        print(f"Data: {request.get_data()}")
    print("=== リクエスト情報終了 ===\n")

if __name__ == '__main__':
    # 外部公開時はデバッガが露出しないよう、デフォルトは debug 無効。
    # 開発時のみ FLASK_DEBUG=1 で有効化する。
    debug_mode = os.environ.get('FLASK_DEBUG', '0') == '1'
    app.run(host='0.0.0.0', port=5001, debug=debug_mode, threaded=True)
