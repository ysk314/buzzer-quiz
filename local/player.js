const socket = io();
const params = new URLSearchParams(location.search);
let roomCode = params.get('room')?.toUpperCase() || '';
let token = localStorage.getItem('buzzer_local_token');
let displayName;
let room;
let previousScore = 0;
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
    el('round').textContent = `第${room.roundNumber}問`;
    const winner = room.winner;
    const canBuzz = room.roomState === 'OPEN' && me.playerState === 'READY';
    el('buzzer').disabled = !canBuzz;
    el('buzzer').textContent = canBuzz ? 'PUSH!' : (me.playerState === 'LOCKED_PENALTY_THIS' ? '🚫' : 'WAIT');
    el('status').className = 'local-status';
    el('status').textContent = room.roomState === 'OPEN' ? (canBuzz ? '🔥 早押しスタート！' : '回答できません') :
        winner ? (winner.playerToken === token ? '先着！判定を待っています' : '他の人が先着しました') :
        (room.pending ? '早押し判定中…' : '待機中');
    if (canBuzz) el('status').classList.add('open');
    if (winner?.playerToken === token) el('status').classList.add('winner');
    if (me.playerState === 'LOCKED_PENALTY_THIS') el('status').classList.add('locked');
    el('buzzer').classList.toggle('pressed', me.playerState === 'PRESSED');
    el('buzzer').classList.toggle('winner', winner?.playerToken === token);
    el('buzzer').classList.toggle('locked', !canBuzz && !winner);
    const vote = room.supportVotes?.[token];
    const canVote = room.rules.answerRule === 'support' && room.roomState === 'LOCKED' && winner && winner.playerToken !== token;
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
}
function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }
