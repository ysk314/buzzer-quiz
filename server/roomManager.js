const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

// ルーム保管
const rooms = new Map();

// デフォルトルール
const DEFAULT_RULES = {
    penaltyType: 'thisRound',  // 'none' | 'thisRound' | 'nextRound'
    correctPoints: 1,
    wrongPoints: 0,
    minScore: 0,
    allowNegative: false,
    wrongAction: 'reopen',  // 'reopen' | 'nextInQueue'
    speedBonus: { enabled: false, timeMs: 1000, bonus: 1 },
    streakBonus: { enabled: false, bonus: 1 }
};

// 6桁ルームコード生成
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// PINハッシュ化
function hashPin(pin) {
    return crypto.createHash('sha256').update(pin).digest('hex');
}

// ルーム作成
function createRoom() {
    let code;
    do {
        code = generateRoomCode();
    } while (rooms.has(code));

    const pin = Math.floor(1000 + Math.random() * 9000).toString(); // 4桁PIN

    const room = {
        roomCode: code,
        hostPinHash: hashPin(pin),
        hostSocketId: null,
        rules: { ...DEFAULT_RULES },
        roundNumber: 1,
        roomState: 'WAITING',
        openTimestamp: null,
        buzzQueue: [],
        winner: null,
        players: new Map(),
        history: [],      // Undo用履歴
        createdAt: Date.now()
    };

    rooms.set(code, room);
    return { roomCode: code, pin };
}

// ルーム取得
function getRoom(roomCode) {
    return rooms.get(roomCode?.toUpperCase());
}

// ホストPIN検証
function verifyHostPin(roomCode, pin) {
    const room = getRoom(roomCode);
    if (!room) return false;
    return room.hostPinHash === hashPin(pin);
}

// ホストSocketId設定
function setHostSocket(roomCode, socketId) {
    const room = getRoom(roomCode);
    if (room) {
        room.hostSocketId = socketId;
    }
}

// プレイヤー参加
function joinPlayer(roomCode, playerToken, displayName, socketId) {
    const room = getRoom(roomCode);
    if (!room) return null;

    let player = room.players.get(playerToken);

    if (player) {
        // 再接続
        player.socketId = socketId;
        player.connectionStatus = 'online';
        player.lastSeen = Date.now();
    } else {
        // 新規参加
        // 同名チェック・調整
        let finalName = displayName;
        let counter = 2;
        const existingNames = Array.from(room.players.values()).map(p => p.displayName);
        while (existingNames.includes(finalName)) {
            finalName = `${displayName}#${counter}`;
            counter++;
        }

        player = {
            playerToken,
            displayName: finalName,
            score: 0,
            playerState: 'READY',
            penaltyNextRound: false,
            connectionStatus: 'online',
            socketId,
            rttStats: { avg: 0, samples: [] },
            lastSeen: Date.now(),
            streak: 0
        };
        room.players.set(playerToken, player);
    }

    return player;
}

// プレイヤー切断
function disconnectPlayer(roomCode, socketId) {
    const room = getRoom(roomCode);
    if (!room) return null;

    for (const [token, player] of room.players) {
        if (player.socketId === socketId) {
            player.connectionStatus = 'offline';
            player.lastSeen = Date.now();
            return player;
        }
    }
    return null;
}

// socketIdからプレイヤー取得
function getPlayerBySocket(roomCode, socketId) {
    const room = getRoom(roomCode);
    if (!room) return null;

    for (const [token, player] of room.players) {
        if (player.socketId === socketId) {
            return player;
        }
    }
    return null;
}

// tokenからプレイヤー取得
function getPlayerByToken(roomCode, playerToken) {
    const room = getRoom(roomCode);
    if (!room) return null;
    return room.players.get(playerToken);
}

// プレイヤー一覧取得
function getPlayersArray(roomCode) {
    const room = getRoom(roomCode);
    if (!room) return [];

    return Array.from(room.players.values()).map(p => ({
        displayName: p.displayName,
        score: p.score,
        playerState: p.playerState,
        connectionStatus: p.connectionStatus,
        connectionQuality: getConnectionQuality(p.rttStats.avg)
    }));
}

// 接続品質判定
function getConnectionQuality(avgRtt) {
    if (avgRtt < 150) return 'good';
    if (avgRtt < 400) return 'warning';
    return 'poor';
}

// RTT更新
function updateRtt(roomCode, playerToken, rtt) {
    const room = getRoom(roomCode);
    if (!room) return;

    const player = room.players.get(playerToken);
    if (!player) return;

    player.rttStats.samples.push(rtt);
    if (player.rttStats.samples.length > 10) {
        player.rttStats.samples.shift();
    }
    player.rttStats.avg = player.rttStats.samples.reduce((a, b) => a + b, 0) / player.rttStats.samples.length;
}

// ランキング取得（上位5人）
function getTop5(roomCode) {
    const room = getRoom(roomCode);
    if (!room) return [];

    return Array.from(room.players.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((p, i) => ({
            rank: i + 1,
            displayName: p.displayName,
            score: p.score
        }));
}

// ルール更新
function updateRules(roomCode, newRules) {
    const room = getRoom(roomCode);
    if (!room) return false;

    room.rules = { ...room.rules, ...newRules };
    return true;
}

// ルーム削除（古いルームのクリーンアップ用）
function deleteRoom(roomCode) {
    return rooms.delete(roomCode);
}

// 古いルームのクリーンアップ（24時間以上）
function cleanupOldRooms() {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000;

    for (const [code, room] of rooms) {
        if (now - room.createdAt > maxAge) {
            rooms.delete(code);
        }
    }
}

module.exports = {
    createRoom,
    getRoom,
    verifyHostPin,
    setHostSocket,
    joinPlayer,
    disconnectPlayer,
    getPlayerBySocket,
    getPlayerByToken,
    getPlayersArray,
    getConnectionQuality,
    updateRtt,
    getTop5,
    updateRules,
    deleteRoom,
    cleanupOldRooms,
    DEFAULT_RULES
};
