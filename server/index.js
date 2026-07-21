const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const roomManager = require('./roomManager');
const gameLogic = require('./gameLogic');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = Number(process.env.PORT || 3000);

app.use('/local', express.static(path.join(__dirname, '../local')));
app.use('/assets', express.static(path.join(__dirname, '../docs')));
app.get('/', (req, res) => res.redirect('/local/'));
app.get('/join/:roomCode', (req, res) => res.redirect(`/local/player.html?room=${req.params.roomCode}`));

function lanAddress() {
    for (const network of Object.values(os.networkInterfaces())) {
        for (const address of network || []) {
            if (address.family === 'IPv4' && !address.internal) return address.address;
        }
    }
    return 'localhost';
}

function emitRoom(roomCode) {
    const room = roomManager.getRoom(roomCode);
    if (room) io.to(roomCode).emit('roomUpdate', roomManager.serialize(room));
}

io.on('connection', socket => {
    let joinedRoom = null;
    let playerToken = null;
    let host = false;

    socket.on('createRoom', callback => {
        const created = roomManager.createRoom();
        callback({ success: true, ...created, lanUrl: `http://${lanAddress()}:${PORT}/local/` });
    });

    socket.on('hostAuth', ({ roomCode, pin }, callback) => {
        if (!roomManager.verifyHostPin(roomCode, pin)) return callback({ success: false, error: 'INVALID_PIN' });
        roomManager.setHostSocket(roomCode, socket.id);
        joinedRoom = roomCode;
        host = true;
        socket.join(roomCode);
        callback({ success: true, room: roomManager.serialize(roomManager.getRoom(roomCode)) });
        emitRoom(roomCode);
    });

    socket.on('joinRoom', ({ roomCode, token, displayName }, callback) => {
        const id = token || uuidv4();
        const player = roomManager.joinPlayer(roomCode, id, displayName, socket.id);
        if (!player) return callback({ success: false, error: 'ROOM_NOT_FOUND' });
        joinedRoom = roomCode;
        playerToken = id;
        socket.join(roomCode);
        callback({ success: true, token: id, player, room: roomManager.serialize(roomManager.getRoom(roomCode)) });
        emitRoom(roomCode);
    });

    socket.on('ping', ({ roomCode, token, sentAt }, callback) => {
        if (joinedRoom === roomCode && playerToken === token) roomManager.recordRtt(roomCode, token, Date.now() - sentAt);
        callback({ serverTime: Date.now() });
    });

    socket.on('openBuzz', ({ roomCode, clearPenalties = true }, callback) => {
        if (!host || joinedRoom !== roomCode || !roomManager.isHost(roomCode, socket.id)) return callback({ success: false });
        callback({ success: gameLogic.openBuzz(roomCode, clearPenalties) });
        emitRoom(roomCode);
    });

    socket.on('buzz', ({ roomCode, token }, callback) => {
        if (joinedRoom !== roomCode || playerToken !== token) return callback({ success: false });
        const result = gameLogic.queueBuzz(roomCode, token);
        callback(result);
        if (result.shouldSchedule) {
            const room = roomManager.getRoom(roomCode);
            room.buzzTimer = setTimeout(() => {
                room.buzzTimer = null;
                gameLogic.finalizeBuzz(roomCode);
                emitRoom(roomCode);
            }, gameLogic.FAIRNESS_WINDOW_MS);
        }
        emitRoom(roomCode);
    });

    socket.on('supportVote', ({ roomCode, token, choice }, callback) => {
        if (joinedRoom !== roomCode || playerToken !== token) return callback({ success: false });
        callback({ success: gameLogic.castSupportVote(roomCode, token, choice) });
        emitRoom(roomCode);
    });

    socket.on('judge', ({ roomCode, result }, callback) => {
        if (!host || joinedRoom !== roomCode || !roomManager.isHost(roomCode, socket.id)) return callback({ success: false });
        callback({ success: gameLogic.judge(roomCode, result) });
        emitRoom(roomCode);
    });

    socket.on('nextRound', ({ roomCode }, callback) => {
        if (!host || joinedRoom !== roomCode || !roomManager.isHost(roomCode, socket.id)) return callback({ success: false });
        callback({ success: gameLogic.nextRound(roomCode) });
        emitRoom(roomCode);
    });

    socket.on('updateRules', ({ roomCode, rules }, callback) => {
        const room = roomManager.getRoom(roomCode);
        if (!host || !room || !roomManager.isHost(roomCode, socket.id)) return callback({ success: false });
        room.rules = { ...room.rules, ...rules };
        callback({ success: true });
        emitRoom(roomCode);
    });

    socket.on('disconnect', () => {
        if (!host && joinedRoom) {
            roomManager.disconnectPlayer(joinedRoom, socket.id);
            emitRoom(joinedRoom);
        }
    });
});

setInterval(roomManager.cleanupOldRooms, 60 * 60 * 1000);
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Buzzer Quiz Local: http://localhost:${PORT}/local/`);
    console.log(`iPad join URL: http://${lanAddress()}:${PORT}/local/`);
});
