const rooms = require('./roomManager');

const FAIRNESS_WINDOW_MS = 180;

function snapshot(room) {
    return JSON.parse(JSON.stringify({
        roundNumber: room.roundNumber,
        roomState: room.roomState,
        openTimestamp: room.openTimestamp,
        lastJudgement: room.lastJudgement,
        winner: room.winner,
        supportVotes: room.supportVotes,
        rules: room.rules,
        players: Array.from(room.players.entries()).map(([token, player]) => [token, { ...player }])
    }));
}

function save(room) {
    room.history.push(snapshot(room));
    if (room.history.length > 10) room.history.shift();
}

function resetForOpen(room, clearPenalties) {
    room.roomState = 'OPEN';
    room.openTimestamp = Date.now();
    room.lastJudgement = null;
    room.winner = null;
    room.pendingBuzzes = [];
    room.supportVotes = {};
    for (const player of room.players.values()) {
        if (clearPenalties) {
            player.playerState = 'READY';
            player.penaltyNextRound = false;
        } else if (player.playerState === 'PRESSED' || player.playerState === 'LOCKED_LOST') {
            player.playerState = 'READY';
        }
    }
}

function openBuzz(roomCode, clearPenalties = true) {
    const room = rooms.getRoom(roomCode);
    if (!room || !['WAITING', 'LOCKED', 'OPEN'].includes(room.roomState)) return false;
    save(room);
    resetForOpen(room, clearPenalties);
    return true;
}

function queueBuzz(roomCode, token) {
    const room = rooms.getRoom(roomCode);
    const player = rooms.getPlayer(roomCode, token);
    if (!room || !player || room.roomState !== 'OPEN' || player.playerState !== 'READY') {
        return { success: false };
    }
    player.playerState = 'PRESSED';
    const receivedAt = Date.now();
    const adjustedAt = receivedAt - rooms.medianRtt(player) / 2;
    room.pendingBuzzes.push({ token, receivedAt, adjustedAt });
    return { success: true, shouldSchedule: room.pendingBuzzes.length === 1 };
}

function finalizeBuzz(roomCode) {
    const room = rooms.getRoom(roomCode);
    if (!room || room.roomState !== 'OPEN' || !room.pendingBuzzes.length) return null;
    room.pendingBuzzes.sort((a, b) => a.adjustedAt - b.adjustedAt || a.receivedAt - b.receivedAt);
    const winningBuzz = room.pendingBuzzes[0];
    const player = room.players.get(winningBuzz.token);
    room.roomState = 'LOCKED';
    room.winner = {
        playerToken: player.playerToken,
        displayName: player.displayName,
        reactionTime: Math.round(winningBuzz.adjustedAt - room.openTimestamp)
    };
    room.supportVotes = {};
    for (const [token, target] of room.players) {
        if (token !== player.playerToken && target.playerState === 'READY') target.playerState = 'LOCKED_LOST';
    }
    room.pendingBuzzes = [];
    return room.winner;
}

function castSupportVote(roomCode, token, choice) {
    const room = rooms.getRoom(roomCode);
    const player = rooms.getPlayer(roomCode, token);
    if (!room || room.rules.answerRule !== 'support' || room.roomState !== 'LOCKED' || !room.winner) return false;
    if (!player || token === room.winner.playerToken || room.supportVotes[token]) return false;
    if (player.playerState === 'LOCKED_PENALTY_THIS' || player.playerState === 'LOCKED_PENALTY_NEXT') return false;
    if (choice !== 'support' && choice !== 'oppose') return false;
    room.supportVotes[token] = { choice };
    return true;
}

function judge(roomCode, result) {
    const room = rooms.getRoom(roomCode);
    if (!room || room.roomState !== 'LOCKED' || !room.winner || !['correct', 'wrong'].includes(result)) return false;
    save(room);
    const winner = room.players.get(room.winner.playerToken);
    const supportRule = room.rules.answerRule === 'support';
    if (result === 'correct') {
        room.lastJudgement = 'correct';
        winner.score += supportRule ? 2 : room.rules.correctPoints;
        if (supportRule) {
            for (const [token, vote] of Object.entries(room.supportVotes)) {
                if (vote.choice === 'support') room.players.get(token).score += 1;
            }
        }
        room.roomState = 'WAITING';
        for (const player of room.players.values()) player.playerState = 'READY';
    } else {
        room.lastJudgement = 'wrong';
        winner.score = Math.max(room.rules.allowNegative ? -Infinity : room.rules.minScore, winner.score - room.rules.wrongPoints);
        if (room.rules.penaltyType === 'thisRound') winner.playerState = 'LOCKED_PENALTY_THIS';
        if (room.rules.penaltyType === 'nextRound') {
            winner.playerState = 'LOCKED_PENALTY_THIS';
            winner.penaltyNextRound = true;
        }
        if (supportRule) {
            for (const [token, vote] of Object.entries(room.supportVotes)) {
                if (vote.choice === 'support') room.players.get(token).playerState = 'LOCKED_PENALTY_THIS';
            }
        }
        room.roomState = 'LOCKED';
        room.winner = null;
    }
    room.supportVotes = {};
    return true;
}

function nextRound(roomCode) {
    const room = rooms.getRoom(roomCode);
    if (!room || room.roomState === 'FINISHED') return false;
    save(room);
    room.roundNumber += 1;
    resetForOpen(room, false);
    room.lastJudgement = null;
    for (const player of room.players.values()) {
        if (player.penaltyNextRound) {
            player.playerState = 'LOCKED_PENALTY_THIS';
            player.penaltyNextRound = false;
        } else {
            player.playerState = 'READY';
        }
    }
    return true;
}

function undo(roomCode) {
    const room = rooms.getRoom(roomCode);
    const previous = room?.history.pop();
    if (!room || !previous) return false;
    if (room.buzzTimer) clearTimeout(room.buzzTimer);
    room.roundNumber = previous.roundNumber;
    room.roomState = previous.roomState;
    room.openTimestamp = previous.openTimestamp;
    room.lastJudgement = previous.lastJudgement || null;
    room.winner = previous.winner;
    room.supportVotes = previous.supportVotes || {};
    room.rules = previous.rules || room.rules;
    room.players = new Map(previous.players);
    room.pendingBuzzes = [];
    room.buzzTimer = null;
    return true;
}

function finishGame(roomCode) {
    const room = rooms.getRoom(roomCode);
    if (!room) return false;
    if (room.buzzTimer) clearTimeout(room.buzzTimer);
    save(room);
    room.roomState = 'FINISHED';
    room.lastJudgement = null;
    room.winner = null;
    room.pendingBuzzes = [];
    room.supportVotes = {};
    return true;
}

module.exports = { FAIRNESS_WINDOW_MS, openBuzz, queueBuzz, finalizeBuzz, castSupportVote, judge, nextRound, undo, finishGame };
