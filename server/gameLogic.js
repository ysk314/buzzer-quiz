const roomManager = require('./roomManager');

// 状態スナップショット作成（Undo用）
function createSnapshot(room) {
    return {
        roundNumber: room.roundNumber,
        roomState: room.roomState,
        openTimestamp: room.openTimestamp,
        buzzQueue: [...room.buzzQueue],
        winner: room.winner,
        players: new Map(
            Array.from(room.players.entries()).map(([token, player]) => [
                token,
                { ...player, rttStats: { ...player.rttStats, samples: [...player.rttStats.samples] } }
            ])
        )
    };
}

// スナップショットを復元
function restoreSnapshot(room, snapshot) {
    room.roundNumber = snapshot.roundNumber;
    room.roomState = snapshot.roomState;
    room.openTimestamp = snapshot.openTimestamp;
    room.buzzQueue = [...snapshot.buzzQueue];
    room.winner = snapshot.winner;
    room.players = new Map(
        Array.from(snapshot.players.entries()).map(([token, player]) => [
            token,
            { ...player, rttStats: { ...player.rttStats, samples: [...player.rttStats.samples] } }
        ])
    );
}

// 履歴にスナップショット追加
function saveHistory(room) {
    room.history.push(createSnapshot(room));
    // 最大10履歴保持
    if (room.history.length > 10) {
        room.history.shift();
    }
}

// OPEN状態への共通処理
function applyOpenState(room) {
    room.roomState = 'OPEN';
    room.openTimestamp = Date.now();
    room.buzzQueue = [];
    room.winner = null;

    // 全プレイヤーの状態をリセット（ペナルティ持ち越し考慮）
    for (const [token, player] of room.players) {
        if (player.penaltyNextRound) {
            player.playerState = 'LOCKED_PENALTY_THIS';
            player.penaltyNextRound = false;
        } else if (player.playerState !== 'LOCKED_PENALTY_THIS') {
            player.playerState = 'READY';
        }
    }
}

// 早押し解放
function openBuzz(roomCode) {
    const room = roomManager.getRoom(roomCode);
    if (!room) return { success: false, error: 'ROOM_NOT_FOUND' };
    if (room.roomState !== 'WAITING') return { success: false, error: 'INVALID_STATE' };

    saveHistory(room);

    applyOpenState(room);

    return { success: true, openTimestamp: room.openTimestamp };
}

// 早押し受付
function buzz(roomCode, playerToken) {
    const room = roomManager.getRoom(roomCode);
    if (!room) return { success: false, error: 'ROOM_NOT_FOUND' };
    if (room.roomState !== 'OPEN') return { success: false, error: 'NOT_OPEN' };

    const player = room.players.get(playerToken);
    if (!player) return { success: false, error: 'PLAYER_NOT_FOUND' };
    if (player.playerState !== 'READY') return { success: false, error: 'CANNOT_BUZZ' };

    const buzzTime = Date.now();
    const reactionTime = buzzTime - room.openTimestamp;

    player.playerState = 'PRESSED';
    room.buzzQueue.push({ playerToken, buzzTime, reactionTime });

    // 最初の押下で先着確定
    if (room.buzzQueue.length === 1) {
        room.roomState = 'LOCKED';
        room.winner = {
            playerToken,
            displayName: player.displayName,
            reactionTime
        };

        // 他のプレイヤーをLOCKED_LOSTに
        for (const [t, p] of room.players) {
            if (t !== playerToken && p.playerState === 'READY') {
                p.playerState = 'LOCKED_LOST';
            }
        }

        return {
            success: true,
            isWinner: true,
            winner: room.winner,
            reactionTime
        };
    }

    return { success: true, isWinner: false, reactionTime };
}

// 判定（正解/誤答）
function judge(roomCode, result) {
    const room = roomManager.getRoom(roomCode);
    if (!room) return { success: false, error: 'ROOM_NOT_FOUND' };
    if (room.roomState !== 'LOCKED') return { success: false, error: 'NOT_LOCKED' };
    if (!room.winner) return { success: false, error: 'NO_WINNER' };

    saveHistory(room);

    const player = room.players.get(room.winner.playerToken);
    if (!player) return { success: false, error: 'PLAYER_NOT_FOUND' };

    const rules = room.rules;

    if (result === 'correct') {
        // 正解処理
        let points = rules.correctPoints;

        // 早押しボーナス
        if (rules.speedBonus.enabled && room.winner.reactionTime <= rules.speedBonus.timeMs) {
            points += rules.speedBonus.bonus;
        }

        // 連勝ボーナス
        player.streak++;
        if (rules.streakBonus.enabled && player.streak > 1) {
            points += rules.streakBonus.bonus;
        }

        player.score += points;

        // 状態をWAITINGに
        room.roomState = 'WAITING';
        room.winner = null;
        room.buzzQueue = [];

        // 全員READY解除
        for (const [t, p] of room.players) {
            p.playerState = 'READY';
        }

        return { success: true, result: 'correct', points, player: player.displayName };

    } else if (result === 'wrong') {
        // 誤答処理
        let penalty = rules.wrongPoints;
        player.score -= penalty;
        player.streak = 0;

        // 得点下限チェック
        if (!rules.allowNegative && player.score < rules.minScore) {
            player.score = rules.minScore;
        }

        // ペナルティ適用
        switch (rules.penaltyType) {
            case 'thisRound':
                player.playerState = 'LOCKED_PENALTY_THIS';
                break;
            case 'nextRound':
                player.playerState = 'LOCKED_PENALTY_THIS';
                player.penaltyNextRound = true;
                break;
            default:
                player.playerState = 'LOCKED_LOST';
        }

        // 次の処理（再解放 or 繰り上げ）
        if (rules.wrongAction === 'reopen') {
            // 再解放
            room.roomState = 'OPEN';
            room.openTimestamp = Date.now();
            room.winner = null;

            // LOCKED_LOSTの人をREADYに戻す（ペナルティ持ちは除く）
            for (const [t, p] of room.players) {
                if (p.playerState === 'LOCKED_LOST') {
                    p.playerState = 'READY';
                } else if (p.playerState === 'PRESSED' && t !== room.winner?.playerToken) {
                    p.playerState = 'READY';
                }
            }

            return { success: true, result: 'wrong', penalty, player: player.displayName, action: 'reopened' };

        } else if (rules.wrongAction === 'nextInQueue') {
            // 繰り上げ
            room.buzzQueue.shift();

            if (room.buzzQueue.length > 0) {
                const next = room.buzzQueue[0];
                const nextPlayer = room.players.get(next.playerToken);
                if (nextPlayer) {
                    room.winner = {
                        playerToken: next.playerToken,
                        displayName: nextPlayer.displayName,
                        reactionTime: next.reactionTime
                    };
                    return {
                        success: true,
                        result: 'wrong',
                        penalty,
                        player: player.displayName,
                        action: 'nextInQueue',
                        newWinner: room.winner
                    };
                }
            }

            // 繰り上げ対象がいない場合はWAITINGへ
            room.roomState = 'WAITING';
            room.winner = null;
            for (const [t, p] of room.players) {
                if (p.playerState === 'LOCKED_LOST' || p.playerState === 'PRESSED') {
                    p.playerState = 'READY';
                }
            }
            return { success: true, result: 'wrong', penalty, player: player.displayName, action: 'noMorePlayers' };
        }
    }

    return { success: false, error: 'INVALID_RESULT' };
}

// 次のラウンドへ
function nextRound(roomCode) {
    const room = roomManager.getRoom(roomCode);
    if (!room) return { success: false, error: 'ROOM_NOT_FOUND' };

    saveHistory(room);

    room.roundNumber++;
    // 次のラウンドはWAITING状態で開始（早押しの解放はホストが明示的に指示）
    room.roomState = 'WAITING';
    room.openTimestamp = null;
    room.buzzQueue = [];
    room.winner = null;

    // 全プレイヤーの状態をリセット
    for (const [token, player] of room.players) {
        if (player.penaltyNextRound) {
            player.playerState = 'LOCKED_PENALTY_THIS';
            player.penaltyNextRound = false;
        } else {
            player.playerState = 'READY';
        }
    }

    return { success: true, roundNumber: room.roundNumber };
}

// Undo
function undo(roomCode) {
    const room = roomManager.getRoom(roomCode);
    if (!room) return { success: false, error: 'ROOM_NOT_FOUND' };
    if (room.history.length === 0) return { success: false, error: 'NO_HISTORY' };

    const snapshot = room.history.pop();
    restoreSnapshot(room, snapshot);

    return { success: true, roundNumber: room.roundNumber, roomState: room.roomState };
}

// 現在の状態取得
function getGameState(roomCode) {
    const room = roomManager.getRoom(roomCode);
    if (!room) return null;

    return {
        roomCode: room.roomCode,
        roundNumber: room.roundNumber,
        roomState: room.roomState,
        winner: room.winner,
        rules: room.rules,
        playerCount: room.players.size
    };
}

module.exports = {
    openBuzz,
    buzz,
    judge,
    nextRound,
    undo,
    getGameState
};
