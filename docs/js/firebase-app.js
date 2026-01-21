// Firebase設定（speedbottun プロジェクト）

const firebaseConfig = {
    apiKey: "AIzaSyDYG4inoWVhzdW2wrqL0LtR8HwEAIyEzCQ",
    authDomain: "speedbottun.firebaseapp.com",
    databaseURL: "https://speedbottun-default-rtdb.firebaseio.com",
    projectId: "speedbottun",
    storageBucket: "speedbottun.firebasestorage.app",
    messagingSenderId: "867697396230",
    appId: "1:867697396230:web:17be5e915c05ada9ccd187"
};

// Firebase初期化
firebase.initializeApp(firebaseConfig);
const database = firebase.database();

// アプリバージョン
const APP_VERSION = 'v1.3.3'; // v1.3.3に更新（nextRound状態管理修正）
window.APP_VERSION = APP_VERSION; // グローバルスコープでRoomManagerを使えるようにする

document.addEventListener('DOMContentLoaded', () => {
    // フッター追加
    const footer = document.createElement('footer');
    footer.style.textAlign = 'center';
    footer.style.padding = '20px';
    footer.style.opacity = '0.6';
    footer.style.fontSize = '0.8rem';
    footer.style.marginTop = 'auto';
    footer.innerHTML = `Buzzer Quiz App ${window.APP_VERSION}`;

    // 特定のコンテナがあればそこに追加、なければbody末尾
    const container = document.querySelector('.host-container, .player-container, .setup-card, .join-card');
    if (container) {
        // containerがflex columnの場合、最後に追加すれば下にくる
        container.appendChild(footer);
    } else {
        document.body.appendChild(footer);
    }
});

// ユーティリティ関数
function generateRoomCode() {
    // 6桁の数字
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function generatePin() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

function generateToken() {
    return 'player_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// デフォルトルール
const DEFAULT_RULES = {
    penaltyType: 'thisRound',
    correctPoints: 1,
    wrongPoints: 0,
    minScore: 0,
    allowNegative: false,
    wrongAction: 'reopen'
};

// ルーム管理クラス
class RoomManager {
    constructor() {
        this.roomCode = null;
        this.roomRef = null;
        this.listeners = [];
    }

    // ルーム作成
    async createRoom() {
        let code;
        let exists = true;

        // ユニークなコードを生成
        while (exists) {
            code = generateRoomCode();
            const snapshot = await database.ref(`rooms/${code}`).once('value');
            exists = snapshot.exists();
        }

        const pin = generatePin();
        const room = {
            roomCode: code,
            hostPin: pin,
            rules: DEFAULT_RULES,
            roundNumber: 1,
            roomState: 'WAITING',
            canAdvance: false,
            openTimestamp: null,
            winner: null,
            players: {},
            createdAt: firebase.database.ServerValue.TIMESTAMP
        };

        await database.ref(`rooms/${code}`).set(room);
        this.roomCode = code;
        this.roomRef = database.ref(`rooms/${code}`);

        return { roomCode: code, pin };
    }

    // ルーム参加
    async joinRoom(roomCode) {
        const snapshot = await database.ref(`rooms/${roomCode}`).once('value');
        if (!snapshot.exists()) {
            throw new Error('ROOM_NOT_FOUND');
        }

        this.roomCode = roomCode;
        this.roomRef = database.ref(`rooms/${roomCode}`);
        return snapshot.val();
    }

    // ホスト認証
    async verifyPin(roomCode, pin) {
        const snapshot = await database.ref(`rooms/${roomCode}/hostPin`).once('value');
        return snapshot.val() === pin;
    }

    // プレイヤー追加
    async addPlayer(playerToken, displayName) {
        const playerRef = this.roomRef.child(`players/${playerToken}`);
        const snapshot = await playerRef.once('value');

        if (snapshot.exists()) {
            // 再接続
            await playerRef.update({
                connectionStatus: 'online',
                lastSeen: firebase.database.ServerValue.TIMESTAMP
            });
            return snapshot.val();
        }

        // 新規参加 - 同名チェック
        const playersSnapshot = await this.roomRef.child('players').once('value');
        const players = playersSnapshot.val() || {};
        const existingNames = Object.values(players).map(p => p.displayName);

        let finalName = displayName;
        let counter = 2;
        while (existingNames.includes(finalName)) {
            finalName = `${displayName}#${counter}`;
            counter++;
        }

        const player = {
            playerToken,
            displayName: finalName,
            score: 0,
            playerState: 'READY',
            penaltyNextRound: false,
            connectionStatus: 'online',
            lastSeen: firebase.database.ServerValue.TIMESTAMP
        };

        await playerRef.set(player);
        return player;
    }

    // プレイヤー切断
    async disconnectPlayer(playerToken) {
        await this.roomRef.child(`players/${playerToken}`).update({
            connectionStatus: 'offline',
            lastSeen: firebase.database.ServerValue.TIMESTAMP
        });
    }

    // ルーム状態監視
    onRoomUpdate(callback) {
        const listener = this.roomRef.on('value', (snapshot) => {
            callback(snapshot.val());
        });
        this.listeners.push({ ref: this.roomRef, event: 'value', listener });
    }

    // 早押し解放
    async openBuzz(forceClearPenalty = true) {
        await this.roomRef.update({
            roomState: 'OPEN',
            canAdvance: false,
            openTimestamp: firebase.database.ServerValue.TIMESTAMP,
            winner: null,
            buzzQueue: null
        });

        const playersSnapshot = await this.roomRef.child('players').once('value');
        const players = playersSnapshot.val() || {};
        const updates = {};

        for (const token in players) {
            const p = players[token];
            if (forceClearPenalty) {
                // 全員解除 / 手動ボタン
                updates[`players/${token}/playerState`] = 'READY';
                updates[`players/${token}/penaltyNextRound`] = null;
            } else {
                // ペナルティ維持 / 自動再開などの場合
                // LOCKED_PENALTY_THIS 以外の、回答済み(PRESSED)や先着落ち(LOCKED_LOST)をREADYに戻す
                if (p.playerState === 'PRESSED' || p.playerState === 'LOCKED_LOST') {
                    updates[`players/${token}/playerState`] = 'READY';
                }
            }
        }

        if (Object.keys(updates).length > 0) {
            await this.roomRef.update(updates);
        }
    }

    // 早押し
    async buzz(playerToken) {
        const roomSnapshot = await this.roomRef.once('value');
        const room = roomSnapshot.val();

        if (room.roomState !== 'OPEN') {
            return { success: false, error: 'NOT_OPEN' };
        }

        const player = room.players[playerToken];
        if (!player || player.playerState !== 'READY') {
            return { success: false, error: 'CANNOT_BUZZ' };
        }

        // トランザクションで先着判定
        const result = await this.roomRef.transaction((data) => {
            if (!data) return data;
            if (data.roomState !== 'OPEN') return data;
            if (data.winner) return data; // 既に先着者がいる

            const reactionTime = Date.now() - data.openTimestamp;

            data.roomState = 'LOCKED';
            data.winner = {
                playerToken,
                displayName: player.displayName,
                reactionTime
            };

            // 押したプレイヤーをPRESSEDに
            if (data.players[playerToken]) {
                data.players[playerToken].playerState = 'PRESSED';
            }

            // 他のREADYプレイヤーをLOCKED_LOSTに
            for (const t in data.players) {
                if (t !== playerToken && data.players[t].playerState === 'READY') {
                    data.players[t].playerState = 'LOCKED_LOST';
                }
            }

            return data;
        });

        if (result.committed) {
            const newRoom = result.snapshot.val();
            const isWinner = newRoom.winner && newRoom.winner.playerToken === playerToken;
            return { success: true, isWinner, winner: newRoom.winner };
        }

        return { success: false, error: 'TRANSACTION_FAILED' };
    }

    // 判定
    async judge(result) {
        const roomSnapshot = await this.roomRef.once('value');
        const room = roomSnapshot.val();

        // 判定前の状態をバックアップ（Undo用）
        const backup = {
            players: room.players,
            roomState: room.roomState,
            roundNumber: room.roundNumber,
            winner: room.winner,
            canAdvance: room.canAdvance || false
        };

        if (room.roomState !== 'LOCKED' || !room.winner) {
            return { success: false, error: 'INVALID_STATE' };
        }

        const winnerToken = room.winner.playerToken;
        const player = room.players[winnerToken];
        const rules = room.rules;

        const updates = {};

        if (result === 'correct') {
            updates[`players/${winnerToken}/score`] = (player.score || 0) + rules.correctPoints;
            updates['roomState'] = 'WAITING';
            updates['canAdvance'] = true;
            updates['winner'] = null;

            // 全員READYに
            for (const t in room.players) {
                updates[`players/${t}/playerState`] = 'READY';
            }
        } else {
            // 誤答
            let newScore = (player.score || 0) - rules.wrongPoints;
            if (!rules.allowNegative && newScore < rules.minScore) {
                newScore = rules.minScore;
            }
            updates[`players/${winnerToken}/score`] = newScore;
            updates['canAdvance'] = true;

            // ペナルティ設定
            if (rules.penaltyType === 'thisRound') {
                updates[`players/${winnerToken}/playerState`] = 'LOCKED_PENALTY_THIS';
            } else if (rules.penaltyType === 'nextRound') {
                updates[`players/${winnerToken}/playerState`] = 'LOCKED_PENALTY_THIS';
                updates[`players/${winnerToken}/penaltyNextRound`] = true;
            }

            // 誤答時は状態をLOCKED（回答者なし）にして、ホスト側の自動再開を待つ
            updates['roomState'] = 'LOCKED';
            updates['winner'] = null;
        }

        updates['backup'] = backup;
        await this.roomRef.update(updates);
        return { success: true };
    }

    // 判定を戻す (Undo)
    async restoreBackup() {
        const roomSnapshot = await this.roomRef.once('value');
        const room = roomSnapshot.val();

        if (!room.backup) {
            return { success: false, error: 'NO_BACKUP' };
        }

        const updates = {
            players: room.backup.players,
            roomState: room.backup.roomState,
            roundNumber: room.backup.roundNumber,
            winner: room.backup.winner,
            canAdvance: room.backup.canAdvance || false,
            backup: null // 使用後は消去
        };

        // 判定（LOCKEDでwinnerあり）のUndoなら、強制的にOPEN（受付中）に戻す
        if (room.backup.roomState === 'LOCKED' && room.backup.winner) {
            updates.roomState = 'OPEN';
            updates.winner = null;
            // 回答中だった人の状態をREADYに戻す
            const winnerToken = room.backup.winner.playerToken;
            if (updates.players && updates.players[winnerToken]) {
                // オブジェクトのディープコピーが必要な場合があるが、ここでは直接書き換え
                updates.players[winnerToken].playerState = 'READY';
                // ペナルティNextRoundも巻き戻す場合に備え既存のバックアップ値を尊重
            }
        }

        await this.roomRef.update(updates);
        return { success: true };
    }

    // 次のラウンド
    async nextRound() {
        const roomSnapshot = await this.roomRef.once('value');
        const room = roomSnapshot.val();

        // バックアップ（Undo用）
        const backup = {
            players: room.players,
            roomState: room.roomState,
            roundNumber: room.roundNumber,
            winner: room.winner,
            canAdvance: room.canAdvance || false
        };

        const updates = {
            roundNumber: (room.roundNumber || 1) + 1,
            roomState: 'OPEN', // 明示的にOPENに
            canAdvance: false,
            openTimestamp: firebase.database.ServerValue.TIMESTAMP,
            winner: null,
            backup: backup
        };

        // プレイヤー状態の更新（ペナルティ処理）
        for (const t in room.players) {
            const player = room.players[t];
            if (player.penaltyNextRound) {
                // 次のラウンドで休み
                updates[`players/${t}/playerState`] = 'LOCKED_PENALTY_THIS';
                updates[`players/${t}/penaltyNextRound`] = false;
            } else {
                updates[`players/${t}/playerState`] = 'READY';
            }
        }

        await this.roomRef.update(updates);
        return { success: true, roundNumber: updates.roundNumber };
    }

    // ルール更新
    async updateRules(newRules) {
        await this.roomRef.child('rules').update(newRules);
    }

    // ゲーム終了
    async finishGame() {
        await this.roomRef.update({
            roomState: 'FINISHED',
            canAdvance: false,
            winner: null
        });
    }

    // クリーンアップ
    cleanup() {
        this.listeners.forEach(({ ref, event, listener }) => {
            ref.off(event, listener);
        });
        this.listeners = [];
    }
}

// グローバルインスタンス
const roomManager = new RoomManager();
