// 雷機能のヘルパー関数

// 雷による数字変化の選択肢を表示
async function selectLightningNumber(options) {
    return new Promise((resolve) => {
        if (options.length === 1) {
            resolve(options[0]);
            return;
        }
        
        const message = `雷の効果で以下の数字から選択してください:\n${options.join(', ')}`;
        const choice = prompt(message + '\n\n選択する数字を入力してください:');
        
        if (choice === null) {
            resolve(null); // キャンセル
            return;
        }
        
        const selectedNumber = parseInt(choice);
        if (options.includes(selectedNumber)) {
            resolve(selectedNumber);
        } else {
            alert('無効な選択です。');
            resolve(null);
        }
    });
}

// 雷による数字変化の選択肢を計算
function calculateLightningOptions(originalNumber, lightningCount) {
    if (lightningCount === 0) {
        return [originalNumber];
    }
    
    const options = [];
    
    // プラス方向
    for (let i = 1; i <= lightningCount; i++) {
        let result = originalNumber + i;
        while (result > 9) result = result - 9;
        options.push(result);
    }
    
    // マイナス方向
    for (let i = 1; i <= lightningCount; i++) {
        let result = originalNumber - i;
        while (result < 1) result = result + 9;
        options.push(result);
    }
    
    // 元の数字も含めて重複を除去
    options.push(originalNumber);
    return [...new Set(options)].sort((a, b) => a - b);
}
