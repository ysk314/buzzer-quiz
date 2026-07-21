const crypto = require('crypto');

const rooms = new Map();

const DEFAULT_RULES = {
    answerRule: 'classic',
    correctPoints: 1,
    wrongPoints: 0,
    minScore: 0,
    allowNegative: false,
    penaltyType: 'thisRound'
};

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function hashPin(pin) {
    return crypto.createHash('sha256').update(pin).digest('hex');
}

function createRoom() {
    let roomCode;
    do {
        roomCode = generateRoomCode();
    } while (rooms.has(roomCode));

    const pin = String(Math.floor(1000 + Math.random() * 9000));
    rooms.set(roomCode, {
        roomCode,
        hostPinHash: hashPin(pin),
        hostSocketId: null,
        rules: { ...DEFAULT_RULES },
        roundNumber: 1,
        roomState: 'WAITING',
        openTimestamp: null,
        winner: null,
        pendingBuzzes: [],
        buzzTimer: null,
        supportVotes: {},
        players: new Map(),
        history: [],
        createdAt: Date.now()
    });
    return { roomCode, pin };
}

function getRoom(roomCode) {
    return rooms.get(roomCode?.toUpperCase());
}

function verifyHostPin(roomCode, pin) {
    const room = getRoom(roomCode);
    return Boolean(room && room.hostPinHash === hashPin(pin));
}

function setHostSocket(roomCode, socketId) {
    const room = getRoom(roomCode);
    if (room) room.hostSocketId = socketId;
}

function isHost(roomCode, socketId) {
    return getRoom(roomCode)?.hostSocketId === socketId;
}

function joinPlayer(roomCode, playerToken, displayName, socketId) {
    const room = getRoom(roomCode);
    if (!room) return null;
    let player = room.players.get(playerToken);
    if (player) {
        player.socketId = socketId;
        player.connectionStatus = 'online';
        return player;
    }

    const names = new Set(Array.from(room.players.values()).map(item => item.displayName));
    let finalName = (displayName || 'Player').trim().slice(0, 30) || 'Player';
    let suffix = 2;
    while (names.has(finalName)) finalName = `${displayName}#${suffix++}`;

    player = {
        playerToken,
        displayName: finalName,
        score: 0,
        playerState: 'READY',
        penaltyNextRound: false,
        socketId,
        connectionStatus: 'online',
        rttSamples: []
    };
    room.players.set(playerToken, player);
    return player;
}

function disconnectPlayer(roomCode, socketId) {
    const room = getRoom(roomCode);
    if (!room) return;
    for (const player of room.players.values()) {
        if (player.socketId === socketId) player.connectionStatus = 'offline';
    }
}

function getPlayer(roomCode, token) {
    return getRoom(roomCode)?.players.get(token);
}

function recordRtt(roomCode, token, rtt) {
    const player = getPlayer(roomCode, token);
    if (!player || !Number.isFinite(rtt) || rtt < 0 || rtt > 5000) return;
    player.rttSamples.push(rtt);
    if (player.rttSamples.length > 9) player.rttSamples.shift();
}

function medianRtt(player) {
    const samples = [...(player.rttSamples || [])].sort((a, b) => a - b);
    return samples.length ? samples[Math.floor(samples.length / 2)] : 0;
}

function getPlayers(room) {
    return Array.from(room.players.values()).map(player => ({
        playerToken: player.playerToken,
        displayName: player.displayName,
        score: player.score,
        playerState: player.playerState,
        connectionStatus: player.connectionStatus,
        rtt: Math.round(medianRtt(player))
    }));
}

function serialize(room) {
    return {
        roomCode: room.roomCode,
        roundNumber: room.roundNumber,
        roomState: room.roomState,
        winner: room.winner,
        rules: room.rules,
        supportVotes: room.supportVotes,
        pending: room.pendingBuzzes.length > 0,
        players: getPlayers(room)
    };
}

function cleanupOldRooms() {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [code, room] of rooms) {
        if (room.createdAt < cutoff) {
            if (room.buzzTimer) clearTimeout(room.buzzTimer);
            rooms.delete(code);
        }
    }
}

module.exports = {
    DEFAULT_RULES, createRoom, getRoom, verifyHostPin, setHostSocket, isHost,
    joinPlayer, disconnectPlayer, getPlayer, recordRtt, medianRtt, getPlayers,
    serialize, cleanupOldRooms
};
