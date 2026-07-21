const socket = io();
const params = new URLSearchParams(location.search);
let roomCode = params.get('room')?.toUpperCase() || '';
let token = localStorage.getItem('buzzer_local_token');
let displayName;
let room;
let previousScore = 0;
let namesData;
let previousState;
let previousWinner;
const el = id => document.getElementById(id);
el('room').value = roomCode;

fetch('/assets/data/names.json')
    .then(response => response.json())
    .then(data => { namesData = data; })
    .catch(() => { namesData = { modifiers: [''], characters: ['Player'] }; });

el('room').addEventListener('input', event => {
    event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

el('checkRoomButton').onclick = () => {
    roomCode = el('room').value.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(roomCode)) return alert('ルームコードは6文字です');
    el('roomCodeSection').classList.add('hidden');
    el('nameSection').classList.remove('hidden');
    generateNameOptions();
};

function generateNameOptions() {
    if (!namesData) {
        setTimeout(generateNameOptions, 100);
        return;
    }
    const names = Array.from({ length: 5 }, () => {
        const modifier = namesData.modifiers[Math.floor(Math.random() * namesData.modifiers.length)];
        const character = namesData.characters[Math.floor(Math.random() * namesData.characters.length)];
        return `${modifier}${character}`;
    });
    el('nameOptions').innerHTML = names.map(name =>
        `<button class="name-option" data-name="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join('');
    el('nameOptions').querySelectorAll('.name-option').forEach(button => {
        button.onclick = () => joinAs(button.dataset.name);
    });
}

el('shuffleNamesButton').onclick = generateNameOptions;

function joinAs(name) {
    displayName = name;
    socket.emit('joinRoom', { roomCode, token, displayName }, result => {
        if (!result.success) return alert('ルームが見つかりません');
        token = result.token;
        localStorage.setItem('buzzer_local_token', token);
        localStorage.setItem('buzzer_local_name', result.player.displayName);
        localStorage.setItem('buzzer_local_room', roomCode);
        displayName = result.player.displayName;
        el('join').classList.add('hidden');
        el('play').classList.remove('hidden');
        el('me').textContent = displayName;
        render(result.room);
        setInterval(() => socket.emit('ping', { roomCode, token, sentAt: Date.now() }, () => {}), 3000);
    });
}

socket.on('connect', () => {
    const savedName = localStorage.getItem('buzzer_local_name');
    const savedRoom = localStorage.getItem('buzzer_local_room');
    if (!token || !savedName || !savedRoom || el('play').classList.contains('hidden')) return;
    roomCode = savedRoom;
    displayName = savedName;
    socket.emit('joinRoom', { roomCode, token, displayName }, result => {
        if (result.success) {
            el('me').textContent = result.player.displayName;
            render(result.room);
        }
    });
});

socket.on('disconnect', () => {
    if (!el('play').classList.contains('hidden')) el('status').textContent = '接続が切れました。再接続中...';
});

el('exit').onclick = () => {
    if (confirm('退出しますか？')) {
        socket.disconnect();
        location.href = 'index.html';
    }
};

function playSound(name) {
    const sound = new Audio(`/assets/sounds/${name}.mp3`);
    sound.play().catch(() => {});
}

function showResult(correct) {
    el('resultIcon').textContent = correct ? '⭕' : '❌';
    el('resultText').textContent = correct ? '正解！' : '不正解...';
    el('resultText').style.color = correct ? 'var(--accent-green)' : 'var(--accent-red)';
    el('resultOverlay').classList.remove('hidden');
    setTimeout(() => el('resultOverlay').classList.add('hidden'), 1500);
}

el('buzzer').onclick = () => socket.emit('buzz', { roomCode, token }, () => {});
document.querySelectorAll('[data-vote]').forEach(button => button.onclick = () => socket.emit('supportVote', {
    roomCode, token, choice: button.dataset.vote
}, () => {}));
socket.on('roomUpdate', render);

function render(nextRoom) {
    if (!nextRoom || !token) return;
    room = nextRoom;
    const me = room.players.find(player => player.playerToken === token);
    if (!me) return;
    el('score').textContent = me.score;
    if (previousState === 'LOCKED' && previousWinner === token && !room.winner) {
        const correct = me.score > previousScore;
        showResult(correct);
        playSound(correct ? 'correct' : 'wrong');
    }
    if (previousState === 'OPEN' && room.roomState === 'LOCKED' && room.winner) playSound('buzz');
    el('round').textContent = `第${room.roundNumber}問`;
    const winner = room.winner;
    const canBuzz = room.roomState === 'OPEN' && me.playerState === 'READY';
    el('buzzer').disabled = !canBuzz;
    el('buzzer').textContent = canBuzz ? 'PUSH!' : (me.playerState === 'LOCKED_PENALTY_THIS' ? '🚫' : 'WAIT');
    el('status').className = 'local-status';
    el('status').textContent = room.roomState === 'FINISHED' ? 'お疲れ様でした！' : room.roomState === 'OPEN' ? (canBuzz ? '🔥 早押しスタート！' : '回答できません') :
        winner ? (winner.playerToken === token ? '先着！判定を待っています' : '他の人が先着しました') :
        (room.pending ? '早押し判定中…' : '待機中');
    if (canBuzz) el('status').classList.add('open');
    if (winner?.playerToken === token) el('status').classList.add('winner');
    if (me.playerState === 'LOCKED_PENALTY_THIS') el('status').classList.add('locked');
    el('buzzer').classList.toggle('pressed', me.playerState === 'PRESSED');
    el('buzzer').classList.toggle('winner', winner?.playerToken === token);
    el('buzzer').classList.toggle('locked', !canBuzz && !winner);
    el('buzzer').classList.toggle('hidden', room.roomState === 'FINISHED');
    const vote = room.supportVotes?.[token];
    const isPenaltyLocked = me.playerState === 'LOCKED_PENALTY_THIS' || me.playerState === 'LOCKED_PENALTY_NEXT';
    const canVote = room.rules.answerRule === 'support' && room.roomState === 'LOCKED' && winner && winner.playerToken !== token && !isPenaltyLocked;
    el('vote').classList.toggle('hidden', !canVote);
    if (canVote) {
        el('answerer').textContent = winner.displayName;
        el('voteStatus').textContent = vote ? (vote.choice === 'support' ? '○を選びました' : '×を選びました') : '正解なら○に+1pt。不正解なら○を選んだ人は当問ロックです。';
        document.querySelectorAll('[data-vote]').forEach(button => button.disabled = Boolean(vote));
    }
    el('ranking').innerHTML = [...room.players].sort((a, b) => b.score - a.score).slice(0, 5).map((player, index) => {
        const medal = index === 0 ? 'gold' : index === 1 ? 'silver' : index === 2 ? 'bronze' : '';
        return `<div class="ranking-item ${player.playerToken === token ? 'highlight' : ''}"><span class="ranking-rank ${medal}">${index + 1}</span><span class="ranking-name">${escapeHtml(player.displayName)}</span><span class="ranking-score">${player.score}pt</span></div>`;
    }).join('');
    previousScore = me.score;
    previousState = room.roomState;
    previousWinner = winner?.playerToken;
}
function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }
