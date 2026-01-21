// プレイヤー画面JS
document.addEventListener('DOMContentLoaded', async () => {
    const socket = io();

    let roomCode = null;
    let playerToken = localStorage.getItem('buzzer_player_token');
    let displayName = null;
    let myScore = 0;
    let playerState = 'READY';
    let roomState = 'WAITING';
    let namesData = null;

    // DOM要素
    const joinScreen = document.getElementById('joinScreen');
    const mainScreen = document.getElementById('mainScreen');
    const roomCodeSection = document.getElementById('roomCodeSection');
    const nameSection = document.getElementById('nameSection');
    const roomCodeInput = document.getElementById('roomCodeInput');
    const buzzerBtn = document.getElementById('buzzerBtn');
    const resultOverlay = document.getElementById('resultOverlay');

    // URLからルームコード取得
    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get('room');

    if (roomFromUrl) {
        roomCodeInput.value = roomFromUrl.toUpperCase();
        // 自動でルーム確認
        setTimeout(() => {
            document.getElementById('checkRoomBtn').click();
        }, 300);
    }

    // 名前データ読み込み
    try {
        const response = await fetch('/data/names.json');
        namesData = await response.json();
    } catch (e) {
        console.error('Failed to load names data:', e);
    }

    // ルームコード入力
    roomCodeInput.addEventListener('input', (e) => {
        e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });

    // ルーム確認
    document.getElementById('checkRoomBtn').addEventListener('click', () => {
        roomCode = roomCodeInput.value.trim().toUpperCase();

        if (roomCode.length !== 6) {
            alert('ルームコードは6文字です');
            return;
        }

        // 既存トークンがあれば再接続試行
        if (playerToken) {
            tryReconnect();
        } else {
            showNameSelection();
        }
    });

    // 再接続試行
    function tryReconnect() {
        socket.emit('joinRoom', {
            roomCode,
            token: playerToken,
            displayName: 'reconnecting'
        }, (result) => {
            if (result.success) {
                // 再接続成功
                displayName = result.displayName;
                myScore = result.score;
                playerState = result.playerState;
                playerToken = result.playerToken;
                localStorage.setItem('buzzer_player_token', playerToken);

                enterGame(result.gameState, result.top5);
            } else {
                // 再接続失敗、新規参加へ
                playerToken = null;
                localStorage.removeItem('buzzer_player_token');
                showNameSelection();
            }
        });
    }

    // 名前選択表示
    function showNameSelection() {
        roomCodeSection.classList.add('hidden');
        nameSection.classList.remove('hidden');

        generateNameOptions();
    }

    // 名前オプション生成
    function generateNameOptions() {
        if (!namesData) {
            document.getElementById('loadingNames').innerHTML = '<p>名前データの読み込みに失敗しました</p>';
            return;
        }

        const options = [];
        for (let i = 0; i < 5; i++) {
            const modifier = namesData.modifiers[Math.floor(Math.random() * namesData.modifiers.length)];
            const character = namesData.characters[Math.floor(Math.random() * namesData.characters.length)];
            options.push(modifier + character);
        }

        const nameOptions = document.getElementById('nameOptions');
        nameOptions.innerHTML = options.map(name => `
            <button class="name-option" data-name="${escapeHtml(name)}">${escapeHtml(name)}</button>
        `).join('');

        // イベントリスナー追加
        nameOptions.querySelectorAll('.name-option').forEach(btn => {
            btn.addEventListener('click', () => selectName(btn.dataset.name));
        });

        document.getElementById('loadingNames').classList.add('hidden');
        nameOptions.classList.remove('hidden');
        document.getElementById('shuffleNamesBtn').style.display = 'block';
    }

    // シャッフルボタン
    document.getElementById('shuffleNamesBtn').addEventListener('click', () => {
        document.getElementById('nameOptions').innerHTML = '';
        document.getElementById('loadingNames').classList.remove('hidden');
        document.getElementById('nameOptions').classList.add('hidden');

        setTimeout(generateNameOptions, 300);
    });

    // 名前選択
    function selectName(name) {
        displayName = name;

        socket.emit('joinRoom', {
            roomCode,
            token: null,
            displayName
        }, (result) => {
            if (result.success) {
                playerToken = result.playerToken;
                displayName = result.displayName;
                myScore = result.score;
                playerState = result.playerState;
                localStorage.setItem('buzzer_player_token', playerToken);

                enterGame(result.gameState, result.top5);
            } else {
                alert('参加に失敗しました: ' + result.error);
            }
        });
    }

    // ゲームに入る
    function enterGame(gameState, top5) {
        joinScreen.classList.add('hidden');
        mainScreen.classList.remove('hidden');

        document.getElementById('myName').textContent = displayName;
        document.getElementById('myScore').textContent = myScore;

        roomState = gameState.roomState;
        updateRoundNumber(gameState.roundNumber);
        updateRanking(top5);
        updateBuzzerState();

        // Ping開始
        startPingLoop();
    }

    // 早押しボタン
    buzzerBtn.addEventListener('click', () => {
        if (buzzerBtn.disabled) return;
        if (playerState !== 'READY' || roomState !== 'OPEN') return;

        // 即座にUIフィードバック
        buzzerBtn.classList.add('pressed');
        playerState = 'PRESSED';
        updateBuzzerState();

        socket.emit('buzz', { roomCode, token: playerToken }, (result) => {
            if (result.success) {
                if (result.isWinner) {
                    buzzerBtn.classList.remove('pressed');
                    buzzerBtn.classList.add('winner');
                }
            }
        });
    });

    // Socket.io イベント受信
    socket.on('roomStateUpdate', (data) => {
        roomState = data.roomState;
        updateRoundNumber(data.roundNumber);

        if (data.roomState === 'OPEN') {
            // 新しい解放、状態リセット
            if (playerState === 'LOCKED_LOST' || playerState === 'PRESSED') {
                playerState = 'READY';
            }
            buzzerBtn.classList.remove('pressed', 'winner', 'locked');
        } else if (data.roomState === 'WAITING') {
            playerState = 'READY';
            buzzerBtn.classList.remove('pressed', 'winner', 'locked');
        }

        updateBuzzerState();
    });

    socket.on('buzzLocked', (data) => {
        if (data.winner.displayName === displayName) {
            buzzerBtn.classList.add('winner');
        } else if (playerState === 'READY') {
            playerState = 'LOCKED_LOST';
            buzzerBtn.classList.add('locked');
        }
        updateBuzzerState();
    });

    socket.on('judgeResult', (data) => {
        if (data.player === displayName) {
            // 自分の結果
            showResult(data.result === 'correct');
            if (data.result === 'correct') {
                myScore += data.points;
            } else {
                myScore -= data.points;
            }
            document.getElementById('myScore').textContent = myScore;
        }

        // 誤答で再解放された場合
        if (data.action === 'reopened' && playerState !== 'LOCKED_PENALTY_THIS') {
            playerState = 'READY';
            buzzerBtn.classList.remove('pressed', 'winner', 'locked');
        }
    });

    socket.on('playersUpdate', (data) => {
        // 自分のスコアも更新
        const me = data.players.find(p => p.displayName === displayName);
        if (me) {
            myScore = me.score;
            document.getElementById('myScore').textContent = myScore;
        }
    });

    socket.on('rankingUpdate', (data) => {
        updateRanking(data.top5);
    });

    socket.on('undoApplied', () => {
        // Undo適用、リセット
        buzzerBtn.classList.remove('pressed', 'winner', 'locked');
    });

    socket.on('hostDisconnected', () => {
        document.getElementById('statusText').textContent = 'ホストが切断されました...';
    });

    socket.on('hostConnected', () => {
        updateBuzzerState();
    });

    // 切断時
    socket.on('disconnect', () => {
        document.getElementById('statusText').textContent = '接続が切れました...';
        document.getElementById('statusText').className = 'status-text status-locked';
        buzzerBtn.disabled = true;
    });

    socket.on('connect', () => {
        // 再接続時
        if (roomCode && playerToken) {
            socket.emit('joinRoom', {
                roomCode,
                token: playerToken,
                displayName: displayName || 'reconnecting'
            }, (result) => {
                if (result.success) {
                    displayName = result.displayName;
                    myScore = result.score;
                    playerState = result.playerState;
                    roomState = result.gameState.roomState;

                    document.getElementById('myName').textContent = displayName;
                    document.getElementById('myScore').textContent = myScore;
                    updateBuzzerState();
                }
            });
        }
    });

    // UI更新関数
    function updateBuzzerState() {
        const statusText = document.getElementById('statusText');
        const buzzerText = document.getElementById('buzzerText');

        statusText.className = 'status-text';

        switch (roomState) {
            case 'WAITING':
                statusText.textContent = '待機中...';
                statusText.classList.add('status-waiting');
                buzzerBtn.disabled = true;
                buzzerText.textContent = 'WAIT';
                break;
            case 'OPEN':
                if (playerState === 'READY') {
                    statusText.textContent = '🔥 早押しスタート！';
                    statusText.classList.add('status-open');
                    buzzerBtn.disabled = false;
                    buzzerText.textContent = 'PUSH!';
                } else if (playerState === 'LOCKED_PENALTY_THIS') {
                    statusText.textContent = 'ペナルティ中...';
                    statusText.classList.add('status-locked');
                    buzzerBtn.disabled = true;
                    buzzerText.textContent = '🚫';
                } else {
                    statusText.textContent = '押しました！';
                    statusText.classList.add('status-pressed');
                    buzzerBtn.disabled = true;
                }
                break;
            case 'LOCKED':
                if (playerState === 'PRESSED' || buzzerBtn.classList.contains('winner')) {
                    statusText.textContent = '🎉 先着！判定を待っています...';
                    statusText.classList.add('status-winner');
                } else {
                    statusText.textContent = '他の人が先着しました';
                    statusText.classList.add('status-locked');
                }
                buzzerBtn.disabled = true;
                break;
        }
    }

    function updateRoundNumber(round) {
        document.getElementById('roundNumber').textContent = round;
    }

    function updateRanking(top5) {
        const list = document.getElementById('rankingList');

        if (!top5 || top5.length === 0) {
            list.innerHTML = '<li class="text-muted">まだランキングはありません</li>';
            return;
        }

        list.innerHTML = top5.map((p, i) => {
            const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
            const highlight = p.displayName === displayName ? 'highlight' : '';

            return `
                <li class="ranking-item ${highlight}">
                    <span class="ranking-rank ${rankClass}">${p.rank}</span>
                    <span class="ranking-name">${escapeHtml(p.displayName)}</span>
                    <span class="ranking-score">${p.score}pt</span>
                </li>
            `;
        }).join('');
    }

    function showResult(isCorrect) {
        const overlay = document.getElementById('resultOverlay');
        const content = document.getElementById('resultContent');
        const icon = document.getElementById('resultIcon');
        const text = document.getElementById('resultText');

        content.className = 'result-content';

        if (isCorrect) {
            content.classList.add('result-correct');
            icon.textContent = '⭕';
            icon.style.color = 'var(--accent-green)';
            text.textContent = '正解！';
            text.style.color = 'var(--accent-green)';
        } else {
            content.classList.add('result-wrong');
            icon.textContent = '❌';
            icon.style.color = 'var(--accent-red)';
            text.textContent = '不正解...';
            text.style.color = 'var(--accent-red)';
        }

        overlay.classList.add('active');

        setTimeout(() => {
            overlay.classList.remove('active');
        }, 1500);
    }

    // Ping (RTT計測)
    function startPingLoop() {
        setInterval(() => {
            if (!roomCode || !playerToken) return;

            socket.emit('ping', {
                roomCode,
                token: playerToken,
                timestamp: Date.now()
            }, (result) => {
                updateConnectionQuality(result.quality);
            });
        }, 5000);
    }

    function updateConnectionQuality(quality) {
        const container = document.getElementById('connectionQuality');
        const text = document.getElementById('qualityText');

        container.className = 'connection-quality';
        container.classList.add(`quality-${quality}`);

        switch (quality) {
            case 'good':
                text.textContent = '良好';
                break;
            case 'warning':
                text.textContent = '注意';
                break;
            case 'poor':
                text.textContent = '不安定';
                break;
        }
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
});
