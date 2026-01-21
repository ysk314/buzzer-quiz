const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const roomManager = require('./roomManager');
const gameLogic = require('./gameLogic');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    pingTimeout: 60000,
    pingInterval: 25000
});

const PORT = process.env.PORT || 3000;

// 静的ファイル配信（docs フォルダと public フォルダの両方から提供）
app.use(express.static(path.join(__dirname, '../docs')));
app.use(express.static(path.join(__dirname, '../public')));

// ルートへのアクセス
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../docs/index.html'));
});

// ルームへの直接アクセス（QRコード用）
app.get('/join/:roomCode', (req, res) => {
    res.redirect(`/player.html?room=${req.params.roomCode}`);
});

// 定期クリーンアップ
setInterval(() => {
    roomManager.cleanupOldRooms();
}, 60 * 60 * 1000); // 1時間ごと

// Socket.io イベント処理
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    let currentRoom = null;
    let isHost = false;
    let playerToken = null;

    // ルーム作成
    socket.on('createRoom', (callback) => {
        const result = roomManager.createRoom();
        currentRoom = result.roomCode;
        callback(result);
    });

    // ホスト認証
    socket.on('hostAuth', ({ roomCode, pin }, callback) => {
        if (roomManager.verifyHostPin(roomCode, pin)) {
            roomManager.setHostSocket(roomCode, socket.id);
            currentRoom = roomCode;
            isHost = true;
            socket.join(roomCode);
            socket.join(`${roomCode}-host`);

            const gameState = gameLogic.getGameState(roomCode);
            const players = roomManager.getPlayersArray(roomCode);

            callback({
                success: true,
                gameState,
                players
            });

            // ホスト接続をブロードキャスト
            io.to(roomCode).emit('hostConnected');
        } else {
            callback({ success: false, error: 'INVALID_PIN' });
        }
    });

    // プレイヤー参加
    socket.on('joinRoom', ({ roomCode, token, displayName }, callback) => {
        const room = roomManager.getRoom(roomCode);
        if (!room) {
            callback({ success: false, error: 'ROOM_NOT_FOUND' });
            return;
        }

        // トークンがなければ新規発行
        const newToken = token || uuidv4();
        const player = roomManager.joinPlayer(roomCode, newToken, displayName, socket.id);

        if (!player) {
            callback({ success: false, error: 'JOIN_FAILED' });
            return;
        }

        currentRoom = roomCode;
        playerToken = newToken;
        socket.join(roomCode);

        const gameState = gameLogic.getGameState(roomCode);
        const top5 = roomManager.getTop5(roomCode);

        callback({
            success: true,
            playerToken: newToken,
            displayName: player.displayName,
            score: player.score,
            playerState: player.playerState,
            gameState,
            top5
        });

        // プレイヤー更新をブロードキャスト
        broadcastPlayersUpdate(roomCode);
    });

    // 早押しOpen
    socket.on('openBuzz', ({ roomCode }, callback) => {
        const result = gameLogic.openBuzz(roomCode);

        if (result.success) {
            io.to(roomCode).emit('roomStateUpdate', {
                roomState: 'OPEN',
                roundNumber: roomManager.getRoom(roomCode).roundNumber
            });
            broadcastPlayersUpdate(roomCode);
        }

        callback(result);
    });

    // 早押し
    socket.on('buzz', ({ roomCode, token }, callback) => {
        const result = gameLogic.buzz(roomCode, token);

        if (result.success && result.isWinner) {
            io.to(roomCode).emit('buzzLocked', {
                winner: result.winner,
                roomState: 'LOCKED'
            });
            broadcastPlayersUpdate(roomCode);
        }

        callback(result);
    });

    // 判定
    socket.on('judge', ({ roomCode, result }, callback) => {
        const judgeResult = gameLogic.judge(roomCode, result);

        if (judgeResult.success) {
            const room = roomManager.getRoom(roomCode);

            io.to(roomCode).emit('judgeResult', {
                result: judgeResult.result,
                player: judgeResult.player,
                points: judgeResult.points || judgeResult.penalty,
                action: judgeResult.action,
                newWinner: judgeResult.newWinner
            });

            io.to(roomCode).emit('roomStateUpdate', {
                roomState: room.roomState,
                roundNumber: room.roundNumber,
                winner: room.winner
            });

            broadcastPlayersUpdate(roomCode);
            broadcastRanking(roomCode);
        }

        callback(judgeResult);
    });

    // 次のラウンド
    socket.on('nextRound', ({ roomCode }, callback) => {
        const result = gameLogic.nextRound(roomCode);

        if (result.success) {
            const room = roomManager.getRoom(roomCode);
            io.to(roomCode).emit('roomStateUpdate', {
                roomState: room.roomState,
                roundNumber: result.roundNumber,
                winner: null
            });
            broadcastPlayersUpdate(roomCode);
        }

        callback(result);
    });

    // Undo
    socket.on('undo', ({ roomCode }, callback) => {
        const result = gameLogic.undo(roomCode);

        if (result.success) {
            const room = roomManager.getRoom(roomCode);

            io.to(roomCode).emit('roomStateUpdate', {
                roomState: room.roomState,
                roundNumber: room.roundNumber,
                winner: room.winner
            });

            broadcastPlayersUpdate(roomCode);
            broadcastRanking(roomCode);

            io.to(roomCode).emit('undoApplied');
        }

        callback(result);
    });

    // ルール更新
    socket.on('updateRules', ({ roomCode, rules }, callback) => {
        const success = roomManager.updateRules(roomCode, rules);

        if (success) {
            const room = roomManager.getRoom(roomCode);
            io.to(roomCode).emit('rulesUpdate', { rules: room.rules });
        }

        callback({ success });
    });

    // Ping（RTT計測用）
    socket.on('ping', ({ roomCode, token, timestamp }, callback) => {
        const rtt = Date.now() - timestamp;
        if (roomCode && token) {
            roomManager.updateRtt(roomCode, token, rtt);
            const player = roomManager.getPlayerByToken(roomCode, token);
            if (player) {
                callback({
                    rtt,
                    quality: roomManager.getConnectionQuality(player.rttStats.avg)
                });
            } else {
                callback({ rtt, quality: 'good' });
            }
        } else {
            callback({ rtt, quality: 'good' });
        }
    });

    // 切断
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);

        if (currentRoom) {
            if (isHost) {
                // ホスト切断の通知（ただしルームは維持）
                io.to(currentRoom).emit('hostDisconnected');
            } else if (playerToken) {
                roomManager.disconnectPlayer(currentRoom, socket.id);
                broadcastPlayersUpdate(currentRoom);
            }
        }
    });

    // プレイヤー一覧更新をブロードキャスト
    function broadcastPlayersUpdate(roomCode) {
        const players = roomManager.getPlayersArray(roomCode);
        io.to(roomCode).emit('playersUpdate', { players });
    }

    // ランキング更新をブロードキャスト
    function broadcastRanking(roomCode) {
        const top5 = roomManager.getTop5(roomCode);
        io.to(roomCode).emit('rankingUpdate', { top5 });
    }
});

server.listen(PORT, () => {
    console.log(`🎯 Buzzer Quiz Server running on http://localhost:${PORT}`);
});
