const socket = io();
const params = new URLSearchParams(location.search);
let roomCode = params.get('room')?.toUpperCase() || '';
let token = localStorage.getItem('buzzer_local_token');
let displayName;
let room;
const el = id => document.getElementById(id);
el('room').value = roomCode;

el('joinButton').onclick = () => {
    roomCode = el('room').value.trim().toUpperCase();
    displayName = el('name').value.trim();
    if (!/^[A-Z0-9]{6}$/.test(roomCode) || !displayName) return alert('ルームコードと名前を入力してください');
    socket.emit('joinRoom', { roomCode, token, displayName }, result => {
        if (!result.success) return alert('ルームが見つかりません');
        token = result.token;
        localStorage.setItem('buzzer_local_token', token);
        displayName = result.player.displayName;
        el('join').classList.add('hidden');
        el('play').classList.remove('hidden');
        el('me').textContent = displayName;
        render(result.room);
        setInterval(() => socket.emit('ping', { roomCode, token, sentAt: Date.now() }, () => {}), 3000);
    });
};

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
    const winner = room.winner;
    const canBuzz = room.roomState === 'OPEN' && me.playerState === 'READY';
    el('buzzer').disabled = !canBuzz;
    el('buzzer').textContent = canBuzz ? 'PUSH!' : (me.playerState === 'LOCKED_PENALTY_THIS' ? '🚫' : 'WAIT');
    el('status').textContent = room.roomState === 'OPEN' ? (canBuzz ? '早押しスタート！' : '回答できません') :
        winner ? (winner.playerToken === token ? '先着！判定を待っています' : '他の人が先着しました') :
        (room.pending ? '早押し判定中…' : '待機中');
    const vote = room.supportVotes?.[token];
    const canVote = room.rules.answerRule === 'support' && winner && winner.playerToken !== token;
    el('vote').classList.toggle('hidden', !canVote);
    if (canVote) {
        el('answerer').textContent = winner.displayName;
        el('voteStatus').textContent = vote ? (vote.choice === 'support' ? '○を選びました' : '×を選びました') : '正解なら○に+1pt。不正解なら○を選んだ人は当問ロックです。';
        document.querySelectorAll('[data-vote]').forEach(button => button.disabled = Boolean(vote));
    }
    el('ranking').innerHTML = [...room.players].sort((a, b) => b.score - a.score).map((player, index) =>
        `<li><span>${index + 1}. ${escapeHtml(player.displayName)}</span><strong>${player.score}pt</strong></li>`).join('');
}
function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }
