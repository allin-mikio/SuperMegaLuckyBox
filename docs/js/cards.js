// カード定義（tools/export_cards.py で app.py から生成）
// カードの内容を変更する場合はこのファイルを編集し、js/version.js のバージョンも更新すること。
window.LUCKYBOX_CARDS = {
  cardsByRound: {"tutorial": ["Tutorial"], "round1": ["G11", "GX6", "GX5", "G22", "G33", "G34"], "round2": ["BX5", "B11", "B22", "BX6", "B23", "B34"], "round3": ["R11", "RX2"], "round4": ["Last", "LastSP"]},
  cards: {
    "Tutorial": {
      "card_id": "Tutorial",
      "size": [3, 3],
      "display_grid": [[3, 1, 2], [1, 2, 3], [4, 6, 5]],
      "merged_groups": [],
      "row_bonuses": ["wildcard", "star", ["lightning", "lightning"]],
      "col_bonuses": ["number_2", "moon", "number_6"]
    },
    "G11": {
      "card_id": "G11",
      "size": [3, 3],
      "display_grid": [[1, 2, 3], [2, 3, 1], [7, 8, 9]],
      "merged_groups": [],
      "row_bonuses": ["number_6", "number_5", "number_4"],
      "col_bonuses": ["number_9", "moon", "number_8"]
    },
    "GX6": {
      "card_id": "GX6",
      "size": [3, 3],
      "display_grid": [[1, 2, 3], [4, 5, 6], [5, 6, 4]],
      "merged_groups": [],
      "row_bonuses": ["number_7", "number_9", "number_8"],
      "col_bonuses": ["number_2", "number_1", ["lightning", "lightning"]]
    },
    "GX5": {
      "card_id": "GX5",
      "size": [3, 3],
      "display_grid": [[1, 2, 3], [2, 3, 1], [4, 5, 6]],
      "merged_groups": [],
      "row_bonuses": ["number_7", "number_8", "number_9"],
      "col_bonuses": ["moon", "star", "star"]
    },
    "G22": {
      "card_id": "G22",
      "size": [3, 3],
      "display_grid": [[4, 5, 6], [6, 4, 5], [7, 8, 9]],
      "merged_groups": [],
      "row_bonuses": ["number_3", "number_2", "number_1"],
      "col_bonuses": ["moon", "star", "moon"]
    },
    "G33": {
      "card_id": "G33",
      "size": [3, 3],
      "display_grid": [[1, 2, 3], [7, 8, 9], [9, 7, 8]],
      "merged_groups": [],
      "row_bonuses": ["number_6", "number_4", "number_5"],
      "col_bonuses": ["number_3", "star", "number_1"]
    },
    "G34": {
      "card_id": "G34",
      "size": [3, 3],
      "display_grid": [[4, 5, 6], [7, 8, 9], [9, 7, 8]],
      "merged_groups": [],
      "row_bonuses": ["number_3", "number_2", "number_1"],
      "col_bonuses": [["lightning", "lightning"], "moon", ["lightning", "lightning"]]
    },
    "BX5": {
      "card_id": "BX5",
      "size": [3, 3],
      "display_grid": [[1, 2, 3], [2, 3, 1], [7, 8, 9]],
      "merged_groups": [],
      "row_bonuses": ["number_4", "number_6", "number_5"],
      "col_bonuses": ["number_9", "number_7", "number_8"]
    },
    "B11": {
      "card_id": "B11",
      "size": [3, 3],
      "display_grid": [[1, 2, 3], [3, 1, 2], [4, 5, 6]],
      "merged_groups": [],
      "row_bonuses": ["number_9", "wildcard", "lightning"],
      "col_bonuses": ["star", "star", "lightning"]
    },
    "B22": {
      "card_id": "B22",
      "size": [3, 3],
      "display_grid": [[4, 5, 6], [6, 4, 5], [7, 8, 9]],
      "merged_groups": [],
      "row_bonuses": ["number_3", "number_2", "number_1"],
      "col_bonuses": ["number_8", "number_9", "number_7"]
    },
    "BX6": {
      "card_id": "BX6",
      "size": [3, 3],
      "display_grid": [[4, 5, 6], [7, 8, 9], [8, 9, 7]],
      "merged_groups": [],
      "row_bonuses": ["number_1", "number_2", "number_3"],
      "col_bonuses": ["number_6", "number_4", "number_5"]
    },
    "B23": {
      "card_id": "B23",
      "size": [3, 3],
      "display_grid": [[1, 2, 3], [4, 5, 6], [5, 6, 4]],
      "merged_groups": [],
      "row_bonuses": ["lightning", "wildcard", "number_7"],
      "col_bonuses": ["moon", "moon", "lightning"]
    },
    "B34": {
      "card_id": "B34",
      "size": [3, 3],
      "display_grid": [[1, 2, 3], [7, 8, 9], [9, 7, 8]],
      "merged_groups": [],
      "row_bonuses": ["lightning", "number_6", "wildcard"],
      "col_bonuses": ["star", "lightning", ["lightning", "lightning"]]
    },
    "R11": {
      "card_id": "R11",
      "size": [4, 4],
      "display_grid": [[3, 1, 2, 3], [4, 0, 0, 5], [9, 0, 0, 6], [3, 8, 7, 3]],
      "merged_groups": [{"display_value": 0, "cells": [[1, 1], [1, 2], [2, 1], [2, 2]]}],
      "row_bonuses": [["moon", "moon"], "wildcard", "wildcard", ["lightning", "lightning", "lightning", "lightning"]],
      "col_bonuses": [["star", "star"], "wildcard", "wildcard", ["lightning", "lightning", "lightning", "lightning"]]
    },
    "RX2": {
      "card_id": "RX2",
      "size": [4, 4],
      "display_grid": [[1, 2, 3, 4], [5, 6, 0, 0], [0, 0, 0, 0], [0, 0, 7, 8]],
      "merged_groups": [{"display_value": 0, "cells": [[1, 2], [1, 3], [2, 2], [2, 3]]}, {"display_value": 0, "cells": [[2, 0], [2, 1], [3, 0], [3, 1]]}],
      "row_bonuses": ["wildcard", "star", "star", "moon"],
      "col_bonuses": ["moon", "wildcard", ["lightning", "lightning"], ["lightning", "lightning"]]
    },
    "Last": {
      "card_id": "Last",
      "size": [5, 5],
      "display_grid": [[6, 3, 4, 2, 5], [1, 0, 5, 0, 4], [0, 9, 0, 7, 0], [7, 0, 6, 0, 3], [8, 2, 9, 1, 8]],
      "merged_groups": [],
      "row_bonuses": ["wildcard", "wildcard", ["wildcard", "wildcard"], "wildcard", "wildcard"],
      "col_bonuses": ["wildcard", ["star", "star"], ["wildcard", "wildcard"], ["moon", "moon"], "wildcard"]
    },
    "LastSP": {
      "card_id": "LastSP",
      "size": [5, 5],
      "display_grid": [[6, 3, 4, 2, 5], [1, 0, 5, 0, 4], [0, 9, 0, 7, 0], [7, 0, 6, 0, 3], [8, 2, 9, 1, 8]],
      "merged_groups": [{"display_value": 0, "cells": [[1, 1], [1, 2], [1, 3], [2, 1], [2, 2], [2, 3], [3, 1], [3, 2], [3, 3]]}],
      "row_bonuses": ["wildcard", "wildcard", ["wildcard", "wildcard"], "wildcard", "wildcard"],
      "col_bonuses": ["wildcard", ["star", "star"], ["wildcard", "wildcard"], ["moon", "moon"], "wildcard"]
    }
  }
};
