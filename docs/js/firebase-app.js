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
const APP_VERSION = 'v1.2.0'; // 1.2.0に更新
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
    async openBuzz() {
        await this.roomRef.update({
            roomState: 'OPEN',
            canAdvance: false,
            openTimestamp: firebase.database.ServerValue.TIMESTAMP,
            winner: null,
            buzzQueue: null
        });

        // 全プレイヤーをREADYに
        const playersSnapshot = await this.roomRef.child('players').once('value');
        const players = playersSnapshot.val() || {};
        const updates = {};

        for (const token in players) {
            // ペナルティ解除ロジック修正: 全員解除なら、LOCKED_PENALTY_THISも含めてREADYにする
            // ユーザー要望「全員ペナルティ解除で解除されない」-> 強制解除に変更
            updates[`players/${token}/playerState`] = 'READY';
            updates[`players/${token}/penaltyNextRound`] = null; // 次問ペナルティもなくす
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

            // 誤答時は自動的に回答可能状態へ
            updates['roomState'] = 'OPEN';
            updates['openTimestamp'] = firebase.database.ServerValue.TIMESTAMP;
            updates['winner'] = null;

            for (const t in room.players) {
                if (t !== winnerToken) {
                    const p = room.players[t];
                    if (p.playerState === 'LOCKED_LOST' || p.playerState === 'PRESSED') {
                        updates[`players/${t}/playerState`] = 'READY';
                    }
                }
            }
        }

        await this.roomRef.update(updates);
        return { success: true, result };
    }

    // 次のラウンド
    async nextRound() {
        const roomSnapshot = await this.roomRef.once('value');
        const room = roomSnapshot.val();

        const updates = {
            roundNumber: (room.roundNumber || 1) + 1,
            roomState: 'OPEN',
            canAdvance: false,
            openTimestamp: firebase.database.ServerValue.TIMESTAMP,
            winner: null
        };

        for (const t in room.players) {
            updates[`players/${t}/playerState`] = 'READY';
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
