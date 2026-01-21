// ホスト画面JS
document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    let roomCode = null;
    let currentRules = {};
    let roomState = 'WAITING';
    let isConnected = false;

    // DOM要素
    const setupScreen = document.getElementById('setupScreen');
    const mainScreen = document.getElementById('mainScreen');
    const createSection = document.getElementById('createSection');
    const roomCreatedSection = document.getElementById('roomCreatedSection');
    const createRoomBtn = document.getElementById('createRoomBtn');

    // Socket接続エラーハンドリング
    socket.on('connect', () => {
        console.log('✅ サーバーに接続しました');
        isConnected = true;
        createRoomBtn.disabled = false;
        createRoomBtn.textContent = 'ルームを作成';
    });

    socket.on('connect_error', (error) => {
        console.error('❌ サーバー接続エラー:', error);
        isConnected = false;
        createRoomBtn.disabled = true;
        createRoomBtn.textContent = '⚠️ サーバーに接続できません';
        alert('サーバーに接続できません。\n\nサーバーを起動してください:\ncd server && npm install && npm start');
    });

    socket.on('disconnect', () => {
        console.log('🔌 サーバーから切断されました');
        isConnected = false;
    });

    // ルーム作成
    document.getElementById('createRoomBtn').addEventListener('click', () => {
        if (!isConnected) {
            alert('サーバーに接続されていません');
            return;
        }

        socket.emit('createRoom', (result) => {
            roomCode = result.roomCode;

            // ルームコード表示
            document.getElementById('displayRoomCode').textContent = roomCode;
            document.getElementById('displayPin').textContent = result.pin;

            // 参加URL生成
            const shareUrl = `${window.location.origin}/join/${roomCode}`;
            document.getElementById('shareUrl').value = shareUrl;

            // QRコード生成
            QRCode.toCanvas(document.getElementById('qrCode'), shareUrl, {
                width: 150,
                margin: 1,
                color: {
                    dark: '#000000',
                    light: '#ffffff'
                }
            });

            createSection.classList.add('hidden');
            roomCreatedSection.classList.remove('hidden');
        });
    });

    // URLコピー
    document.getElementById('copyUrlBtn').addEventListener('click', () => {
        const urlInput = document.getElementById('shareUrl');
        urlInput.select();
        navigator.clipboard.writeText(urlInput.value).then(() => {
            document.getElementById('copyUrlBtn').textContent = '✓ コピーしました';
            setTimeout(() => {
                document.getElementById('copyUrlBtn').textContent = '📋 コピー';
            }, 2000);
        });
    });

    // ホスト認証
    document.getElementById('enterHostBtn').addEventListener('click', () => {
        const pin = document.getElementById('pinInput').value;

        socket.emit('hostAuth', { roomCode, pin }, (result) => {
            if (result.success) {
                setupScreen.classList.add('hidden');
                mainScreen.classList.remove('hidden');

                document.getElementById('headerRoomCode').textContent = roomCode;
                currentRules = result.gameState.rules;
                updateUI(result.gameState, result.players);
                updateSettingsUI();
            } else {
                alert('PINが正しくありません');
            }
        });
    });

    // PIN入力でEnter
    document.getElementById('pinInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('enterHostBtn').click();
        }
    });

    // 解放ボタン
    document.getElementById('openBtn').addEventListener('click', () => {
        socket.emit('openBuzz', { roomCode }, (result) => {
            if (!result.success) {
                console.error('Open failed:', result.error);
            }
        });
    });

    // 正解ボタン
    document.getElementById('correctBtn').addEventListener('click', () => {
        socket.emit('judge', { roomCode, result: 'correct' }, (result) => {
            if (!result.success) {
                console.error('Judge failed:', result.error);
            }
        });
    });

    // 誤答ボタン
    document.getElementById('wrongBtn').addEventListener('click', () => {
        socket.emit('judge', { roomCode, result: 'wrong' }, (result) => {
            if (!result.success) {
                console.error('Judge failed:', result.error);
            }
        });
    });

    // 次へボタン
    document.getElementById('nextBtn').addEventListener('click', () => {
        socket.emit('nextRound', { roomCode }, (result) => {
            if (!result.success) {
                console.error('Next failed:', result.error);
            }
        });
    });

    // Undoボタン
    document.getElementById('undoBtn').addEventListener('click', () => {
        socket.emit('undo', { roomCode }, (result) => {
            if (!result.success) {
                alert('これ以上戻せません');
            }
        });
    });

    // 設定トグル
    document.getElementById('settingsToggle').addEventListener('click', () => {
        document.getElementById('settingsOverlay').classList.add('active');
    });

    document.getElementById('closeSettings').addEventListener('click', () => {
        document.getElementById('settingsOverlay').classList.remove('active');
    });

    // 設定オプション選択
    document.querySelectorAll('.setting-option').forEach(btn => {
        btn.addEventListener('click', () => {
            const setting = btn.dataset.setting;
            let value = btn.dataset.value;

            // 型変換
            if (value === 'true') value = true;
            else if (value === 'false') value = false;
            else if (!isNaN(value)) value = parseInt(value);

            // UI更新
            btn.parentElement.querySelectorAll('.setting-option').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // サーバーに送信
            currentRules[setting] = value;
            socket.emit('updateRules', { roomCode, rules: { [setting]: value } });
        });
    });

    // Socket.io イベント受信
    socket.on('roomStateUpdate', (data) => {
        roomState = data.roomState;
        updateStateUI(data);
    });

    socket.on('buzzLocked', (data) => {
        showWinner(data.winner);
    });

    socket.on('playersUpdate', (data) => {
        updatePlayerList(data.players);
    });

    socket.on('judgeResult', (data) => {
        // 判定結果の表示（必要に応じて）
    });

    socket.on('undoApplied', () => {
        // Undo通知
    });

    socket.on('rulesUpdate', (data) => {
        currentRules = data.rules;
        updateSettingsUI();
    });

    // UI更新関数
    function updateUI(gameState, players) {
        roomState = gameState.roomState;
        document.getElementById('roundNumber').textContent = gameState.roundNumber;
        updateStateUI(gameState);
        updatePlayerList(players);
    }

    function updateStateUI(data) {
        const badge = document.getElementById('roomStateBadge');
        const openBtn = document.getElementById('openBtn');
        const judgeButtons = document.getElementById('judgeButtons');
        const winnerDisplay = document.getElementById('winnerDisplay');
        const waitingDisplay = document.getElementById('waitingDisplay');

        // ラウンド番号更新
        if (data.roundNumber) {
            document.getElementById('roundNumber').textContent = data.roundNumber;
        }

        // 状態バッジ更新
        badge.className = 'badge';
        switch (data.roomState) {
            case 'WAITING':
                badge.classList.add('badge-waiting');
                badge.textContent = 'WAITING';
                openBtn.disabled = false;
                judgeButtons.classList.add('hidden');
                winnerDisplay.classList.add('hidden');
                waitingDisplay.classList.remove('hidden');
                break;
            case 'OPEN':
                badge.classList.add('badge-open');
                badge.textContent = 'OPEN';
                openBtn.disabled = true;
                judgeButtons.classList.add('hidden');
                winnerDisplay.classList.add('hidden');
                waitingDisplay.classList.add('hidden');
                break;
            case 'LOCKED':
                badge.classList.add('badge-locked');
                badge.textContent = 'LOCKED';
                openBtn.disabled = true;
                judgeButtons.classList.remove('hidden');
                waitingDisplay.classList.add('hidden');
                if (data.winner) {
                    showWinner(data.winner);
                }
                break;
        }
    }

    function showWinner(winner) {
        const winnerDisplay = document.getElementById('winnerDisplay');
        winnerDisplay.classList.remove('hidden');
        document.getElementById('winnerName').textContent = winner.displayName;
        document.getElementById('reactionTime').textContent = winner.reactionTime;
    }

    function updatePlayerList(players) {
        const playerList = document.getElementById('playerList');
        document.getElementById('playerCount').textContent = players.length;

        if (players.length === 0) {
            playerList.innerHTML = '<p class="text-muted">参加者を待っています...</p>';
            return;
        }

        // スコア順にソート
        const sorted = [...players].sort((a, b) => b.score - a.score);

        playerList.innerHTML = sorted.map(p => {
            const qualityClass = `quality-${p.connectionQuality}`;
            const offlineClass = p.connectionStatus === 'offline' ? 'offline' : '';

            return `
                <div class="player-item ${offlineClass}">
                    <div class="connection-quality ${qualityClass}">
                        <span class="quality-dot"></span>
                    </div>
                    <span class="player-name">${escapeHtml(p.displayName)}</span>
                    <span class="player-score">${p.score}pt</span>
                </div>
            `;
        }).join('');
    }

    function updateSettingsUI() {
        document.querySelectorAll('.setting-option').forEach(btn => {
            const setting = btn.dataset.setting;
            let value = btn.dataset.value;

            if (value === 'true') value = true;
            else if (value === 'false') value = false;
            else if (!isNaN(value)) value = parseInt(value);

            if (currentRules[setting] === value) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
});
