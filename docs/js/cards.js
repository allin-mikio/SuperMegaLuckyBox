// カード定義（tools/export_cards.py で app.py から生成）
// カードの内容を変更する場合はこのファイルを編集し、js/version.js のバージョンも更新すること。
window.LUCKYBOX_CARDS = {
  cardsByRound: {"tutorial": ["Tutorial"], "round1": ["G123", "G456", "G789a", "G789b", "G123x", "G456x"], "round2": ["B123", "B456", "B789", "B123x", "B789x"], "round3": ["R789", "R4X4a", "R4X4b"], "round4": ["Last", "LastSP"]},
  cards: {
    "Tutorial": {
      "card_id": "Tutorial",
      "size": [3, 3],
      "display_grid": [[3, 1, 2], [1, 2, 3], [4, 6, 5]],
      "merged_groups": [],
      "row_bonuses": ["wildcard", "star", ["lightning", "lightning"]],
      "col_bonuses": ["number_2", "moon", "number_6"]
    },
    "G123": {
      "card_id": "G123",
      "size": [3, 3],
      "display_grid": [[1, 2, 3], [2, 3, 1], [7, 8, 9]],
      "merged_groups": [],
      "row_bonuses": ["number_6", "number_5", "number_4"],
      "col_bonuses": ["star", "moon", "star"]
    },
    "G456": {
      "card_id": "G456",
      "size": [3, 3],
      "display_grid": [[4, 5, 6], [6, 4, 5], [7, 8, 9]],
      "merged_groups": [],
      "row_bonuses": ["number_3", "number_2", "number_1"],
      "col_bonuses": ["moon", "star", "moon"]
    },
    "G789a": {
      "card_id": "G789a",
      "size": [3, 3],
      "display_grid": [[1, 2, 3], [7, 8, 9], [9, 7, 8]],
      "merged_groups": [],
      "row_bonuses": ["number_6", "number_4", "number_5"],
      "col_bonuses": ["star", "star", ["lightning", "lightning"]]
    },
    "G789b": {
      "card_id": "G789b",
      "size": [3, 3],
      "display_grid": [[4, 5, 6], [7, 8, 9], [9, 7, 8]],
      "merged_groups": [],
      "row_bonuses": ["number_3", "number_2", "number_1"],
      "col_bonuses": [["lightning", "lightning"], "moon", ["lightning", "lightning"]]
    },
    "G123x": {
      "card_id": "G123x",
      "size": [3, 3],
      "display_grid": [[1, 2, 3], [2, 3, 1], [4, 5, 6]],
      "merged_groups": [],
      "row_bonuses": ["number_7", "number_8", "number_9"],
      "col_bonuses": ["number_5", "number_6", "number_4"]
    },
    "G456x": {
      "card_id": "G456x",
      "size": [3, 3],
      "display_grid": [[1, 2, 3], [4, 5, 6], [5, 6, 4]],
      "merged_groups": [],
      "row_bonuses": ["number_7", "number_9", "number_8"],
      "col_bonuses": ["number_3", "number_1", "number_2"]
    },
    "B123": {
      "card_id": "B123",
      "size": [3, 3],
      "display_grid": [[1, 2, 3], [3, 1, 2], [4, 5, 6]],
      "merged_groups": [],
      "row_bonuses": ["wildcard", "number_9", "lightning"],
      "col_bonuses": ["star", "star", "lightning"]
    },
    "B456": {
      "card_id": "B456",
      "size": [3, 3],
      "display_grid": [[1, 2, 3], [4, 5, 6], [5, 6, 4]],
      "merged_groups": [],
      "row_bonuses": ["lightning", "wildcard", "number_7"],
      "col_bonuses": ["moon", "moon", "lightning"]
    },
    "B789": {
      "card_id": "B789",
      "size": [3, 3],
      "display_grid": [[1, 2, 3], [7, 8, 9], [9, 7, 8]],
      "merged_groups": [],
      "row_bonuses": ["number_8", "lightning", "wildcard"],
      "col_bonuses": ["star", "lightning", ["lightning", "lightning"]]
    },
    "B123x": {
      "card_id": "B123x",
      "size": [3, 3],
      "display_grid": [[1, 2, 3], [2, 3, 1], [7, 8, 9]],
      "merged_groups": [],
      "row_bonuses": ["moon", "moon", "moon"],
      "col_bonuses": ["moon", "moon", "wildcard"]
    },
    "B789x": {
      "card_id": "B789x",
      "size": [3, 3],
      "display_grid": [[4, 5, 6], [6, 4, 5], [8, 9, 7]],
      "merged_groups": [],
      "row_bonuses": ["moon", "wildcard", "moon"],
      "col_bonuses": ["star", ["lightning", "lightning"], "star"]
    },
    "R789": {
      "card_id": "R789",
      "size": [3, 3],
      "display_grid": [[4, 5, 6], [7, 8, 9], [8, 9, 7]],
      "merged_groups": [],
      "row_bonuses": ["star", "star", "star"],
      "col_bonuses": ["wildcard", "star", "star"]
    },
    "R4X4a": {
      "card_id": "R4X4a",
      "size": [4, 4],
      "display_grid": [[3, 1, 2, 3], [4, 0, 0, 5], [9, 0, 0, 6], [3, 8, 7, 3]],
      "merged_groups": [{"display_value": 0, "cells": [[1, 1], [1, 2], [2, 1], [2, 2]]}],
      "row_bonuses": [
        ["moon", "moon"],
        "wildcard",
        "wildcard",
        ["lightning", "lightning", "lightning", "lightning"]
      ],
      "col_bonuses": [
        ["star", "star"],
        "wildcard",
        "wildcard",
        ["lightning", "lightning", "lightning", "lightning"]
      ]
    },
    "R4X4b": {
      "card_id": "R4X4b",
      "size": [4, 4],
      "display_grid": [[1, 2, 3, 4], [5, 6, 0, 0], [0, 0, 0, 0], [0, 0, 7, 8]],
      "merged_groups": [
        {"display_value": 0, "cells": [[1, 2], [1, 3], [2, 2], [2, 3]]},
        {"display_value": 0, "cells": [[2, 0], [2, 1], [3, 0], [3, 1]]}
      ],
      "row_bonuses": ["wildcard", "star", "star", "moon"],
      "col_bonuses": [
        "moon",
        "wildcard",
        ["lightning", "lightning"],
        ["lightning", "lightning"]
      ]
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
