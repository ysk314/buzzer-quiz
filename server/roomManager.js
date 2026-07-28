const crypto = require('crypto');

const rooms = new Map();

const DEFAULT_RULES = {
    answerRule: 'classic',
    correctPoints: 1,
    wrongPoints: 0,
    minScore: 0,
    allowNegative: false,
    penaltyType: 'thisRound',
    teamMode: false,
    numTeams: 2
};

const TEAM_NAMES = [
    'サンダー', 'フェニックス', 'オーロラ', 'テンペスト', 'ノヴァ', 'コスモス',
    'アトラス', 'ブレイズ', 'シリウス', 'ベガ', 'ルビー', 'アクア'
];

const TEAM_COLORS = [
    '#00d9ff', '#ff6b6b', '#4ecdc4', '#ffd93d', '#b197fc', '#51cf66',
    '#ff922b', '#f06595'
];

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
        lastJudgement: null,
        winner: null,
        pendingBuzzes: [],
        buzzTimer: null,
        supportVotes: {},
        teams: {},
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
        individualScore: 0,
        teamId: null,
        playerState: 'READY',
        penaltyNextRound: false,
        socketId,
        connectionStatus: 'online',
        rttSamples: [],
        clockOffsetSamples: []
    };
    room.players.set(playerToken, player);
    return player;
}

function rejoinPlayer(roomCode, playerToken, socketId) {
    const player = getPlayer(roomCode, playerToken);
    if (!player) return null;
    player.socketId = socketId;
    player.connectionStatus = 'online';
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

function getRejoinCandidates(roomCode) {
    const room = getRoom(roomCode);
    if (!room) return [];
    return Array.from(room.players.values())
        .filter(player => player.connectionStatus === 'offline')
        .map(player => ({
            playerToken: player.playerToken,
            displayName: player.displayName,
            score: player.score,
            individualScore: player.individualScore,
            teamId: player.teamId
        }));
}

function recordRtt(roomCode, token, rtt) {
    const player = getPlayer(roomCode, token);
    if (!player || !Number.isFinite(rtt) || rtt < 0 || rtt > 5000) return;
    player.rttSamples.push(rtt);
    if (player.rttSamples.length > 9) player.rttSamples.shift();
}

function recordClockSync(roomCode, token, { rtt, offset }) {
    const player = getPlayer(roomCode, token);
    if (!player) return;
    if (Number.isFinite(rtt) && rtt >= 0 && rtt <= 5000) {
        player.rttSamples.push(rtt);
        if (player.rttSamples.length > 12) player.rttSamples.shift();
    }
    if (Number.isFinite(offset) && Math.abs(offset) < 10_000_000_000_000) {
        player.clockOffsetSamples.push(offset);
        if (player.clockOffsetSamples.length > 12) player.clockOffsetSamples.shift();
    }
}

function medianRtt(player) {
    const samples = [...(player.rttSamples || [])].sort((a, b) => a - b);
    return samples.length ? samples[Math.floor(samples.length / 2)] : 0;
}

function bestRtt(player) {
    const samples = (player.rttSamples || []).filter(Number.isFinite);
    return samples.length ? Math.min(...samples) : 0;
}

function clockOffset(player) {
    const samples = [...(player.clockOffsetSamples || [])].sort((a, b) => a - b);
    return samples.length ? samples[Math.floor(samples.length / 2)] : null;
}

function connectionQuality(player) {
    const samples = (player.rttSamples || []).filter(Number.isFinite);
    if (samples.length < 3) return 'measuring';
    const sorted = [...samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const jitter = Math.max(...samples) - Math.min(...samples);
    if (median <= 80 && jitter <= 70) return 'good';
    if (median <= 160 && jitter <= 140) return 'fair';
    return 'unstable';
}

function getPlayers(room) {
    return Array.from(room.players.values()).map(player => ({
        playerToken: player.playerToken,
        displayName: player.displayName,
        score: player.score,
        individualScore: player.individualScore,
        teamId: player.teamId,
        playerState: player.playerState,
        connectionStatus: player.connectionStatus,
        rtt: Math.round(medianRtt(player)),
        bestRtt: Math.round(bestRtt(player)),
        clockSynced: clockOffset(player) !== null,
        connectionQuality: connectionQuality(player)
    }));
}

function serialize(room) {
    return {
        roomCode: room.roomCode,
        roundNumber: room.roundNumber,
        roomState: room.roomState,
        serverTime: Date.now(),
        openTimestamp: room.openTimestamp,
        lastJudgement: room.lastJudgement,
        winner: room.winner,
        rules: room.rules,
        supportVotes: room.supportVotes,
        teams: room.teams || {},
        pending: room.pendingBuzzes.length > 0,
        canUndo: room.history.length > 0,
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

function shuffleArray(items) {
    const arr = items.slice();
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function createTeams(roomCode, requestedTeams) {
    const room = getRoom(roomCode);
    if (!room) return { success: false, error: 'ROOM_NOT_FOUND' };

    const players = Array.from(room.players.values());
    const maxTeams = Math.floor(players.length / 2);
    if (players.length < 4 || maxTeams < 2) {
        return { success: false, error: 'NOT_ENOUGH_PLAYERS' };
    }

    let teamCount = parseInt(requestedTeams, 10);
    if (!teamCount || Number.isNaN(teamCount)) teamCount = room.rules.numTeams || 2;
    teamCount = Math.max(2, Math.min(teamCount, maxTeams));

    const teams = {};
    for (let i = 0; i < teamCount; i++) {
        const teamId = `team_${i + 1}`;
        teams[teamId] = {
            teamId,
            teamName: TEAM_NAMES[i % TEAM_NAMES.length],
            score: 0,
            members: [],
            color: TEAM_COLORS[i % TEAM_COLORS.length]
        };
    }

    const teamIds = Object.keys(teams);
    shuffleArray(players).forEach((player, index) => {
        const teamId = teamIds[index % teamIds.length];
        const individualScore = player.individualScore !== undefined ? player.individualScore : (player.score || 0);
        player.teamId = teamId;
        player.individualScore = individualScore;
        player.score = individualScore;
        teams[teamId].members.push(player.playerToken);
        teams[teamId].score += individualScore;
    });

    room.teams = teams;
    room.rules.teamMode = true;
    room.rules.numTeams = teamCount;
    return { success: true, teamCount };
}

module.exports = {
    DEFAULT_RULES, createRoom, getRoom, verifyHostPin, setHostSocket, isHost,
    joinPlayer, rejoinPlayer, disconnectPlayer, getPlayer, getRejoinCandidates, recordRtt, recordClockSync, medianRtt, bestRtt, clockOffset, getPlayers,
    serialize, cleanupOldRooms, createTeams
};
