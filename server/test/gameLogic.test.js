const assert = require('node:assert/strict');
const test = require('node:test');

const roomManager = require('../roomManager');
const gameLogic = require('../gameLogic');

function createOpenRoom() {
    const { roomCode } = roomManager.createRoom();
    const first = roomManager.joinPlayer(roomCode, 'first-token', 'First', 'socket-1');
    const second = roomManager.joinPlayer(roomCode, 'second-token', 'Second', 'socket-2');
    roomManager.recordClockSync(roomCode, first.playerToken, { rtt: 12, offset: 100000 });
    roomManager.recordClockSync(roomCode, second.playerToken, { rtt: 12, offset: 100000 });
    assert.equal(gameLogic.openBuzz(roomCode), true);
    const room = roomManager.getRoom(roomCode);
    room.openTimestamp = Date.now() - 1000;
    return { roomCode, room, offset: 100000 };
}

test('client press time decides the winner even when packets arrive in the opposite order', () => {
    const { roomCode, room, offset } = createOpenRoom();
    const openOnClientClock = room.openTimestamp - offset;

    const firstResult = gameLogic.queueBuzz(roomCode, 'first-token', openOnClientClock + 120);
    const secondResult = gameLogic.queueBuzz(roomCode, 'second-token', openOnClientClock + 40);
    const winner = gameLogic.finalizeBuzz(roomCode);

    assert.equal(firstResult.success, true);
    assert.equal(secondResult.success, true);
    assert.equal(winner.playerToken, 'second-token');
    assert.equal(winner.timingSource, 'client');
    assert.equal(winner.reactionTime, 40);
});

test('presses before the scheduled open time are rejected', () => {
    const { roomCode, room, offset } = createOpenRoom();
    const openOnClientClock = room.openTimestamp - offset;

    const result = gameLogic.queueBuzz(roomCode, 'first-token', openOnClientClock - 120);

    assert.equal(result.success, false);
    assert.equal(result.error, 'EARLY_PRESS');
});

test('rejoin candidates only include offline players', () => {
    const { roomCode } = roomManager.createRoom();
    roomManager.joinPlayer(roomCode, 'online-token', 'Online', 'socket-online');
    roomManager.joinPlayer(roomCode, 'offline-token', 'Offline', 'socket-offline');
    roomManager.disconnectPlayer(roomCode, 'socket-offline');

    const candidates = roomManager.getRejoinCandidates(roomCode);

    assert.deepEqual(candidates.map(player => player.playerToken), ['offline-token']);
    assert.equal(candidates[0].displayName, 'Offline');
});

test('true/false mode scores all answers and disables normal buzzes', () => {
    const { roomCode } = roomManager.createRoom();
    const room = roomManager.getRoom(roomCode);
    room.rules.answerRule = 'trueFalse';
    room.rules.correctPoints = 1;
    room.rules.wrongPoints = 1;
    room.rules.penaltyType = 'thisRound';
    roomManager.joinPlayer(roomCode, 'circle-token', 'Circle', 'socket-circle');
    roomManager.joinPlayer(roomCode, 'cross-token', 'Cross', 'socket-cross');

    assert.equal(gameLogic.openBuzz(roomCode), true);
    assert.equal(gameLogic.queueBuzz(roomCode, 'circle-token').success, false);
    assert.equal(gameLogic.submitTrueFalseAnswer(roomCode, 'circle-token', 'circle').success, true);
    assert.equal(gameLogic.submitTrueFalseAnswer(roomCode, 'cross-token', 'cross').success, true);
    assert.equal(gameLogic.judgeTrueFalse(roomCode, 'circle'), true);

    const circle = roomManager.getPlayer(roomCode, 'circle-token');
    const cross = roomManager.getPlayer(roomCode, 'cross-token');
    assert.equal(circle.score, 1);
    assert.equal(circle.playerState, 'READY');
    assert.equal(cross.score, 0);
    assert.equal(cross.playerState, 'LOCKED_PENALTY_THIS');
    assert.equal(room.roomState, 'WAITING');
    assert.equal(room.lastJudgement, 'circle');
});
