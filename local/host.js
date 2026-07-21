const socket = io();
let roomCode;
let pin;
let room;

const el = id => document.getElementById(id);
el('create').onclick = () => socket.emit('createRoom', result => {
    roomCode = result.roomCode;
    pin = result.pin;
    socket.emit('hostAuth', { roomCode, pin }, auth => {
        if (!auth.success) return alert('ホスト認証に失敗しました');
        el('setup').classList.add('hidden');
        el('game').classList.remove('hidden');
        el('code').textContent = roomCode;
        const joinUrl = `${result.lanUrl}player.html?room=${roomCode}`;
        el('joinUrl').textContent = joinUrl;
        el('qrCode').src = `qr.svg?url=${encodeURIComponent(joinUrl)}`;
        render(auth.room);
    });
});

function emit(event, payload = {}) {
    socket.emit(event, { roomCode, ...payload }, result => {
        if (!result.success) alert('操作を受け付けられませんでした');
    });
}
el('open').onclick = () => emit('openBuzz');
el('correct').onclick = () => emit('judge', { result: 'correct' });
el('wrong').onclick = () => {
    emit('judge', { result: 'wrong' });
    setTimeout(() => emit('openBuzz', { clearPenalties: false }), 250);
};
el('next').onclick = () => emit('nextRound');
document.querySelectorAll('[data-rule]').forEach(button => button.onclick = () => emit('updateRules', { rules: { answerRule: button.dataset.rule } }));
socket.on('roomUpdate', render);

function render(nextRoom) {
    room = nextRoom;
    el('state').textContent = `第${room.roundNumber}問 / ${room.roomState}`;
    el('winner').textContent = room.winner ? `🎉 ${room.winner.displayName}` : (room.pending ? '早押し判定中…' : '参加者を待っています');
    const votes = Object.values(room.supportVotes || {});
    el('voteCount').textContent = room.rules.answerRule === 'support' && room.winner
        ? `支持投票: ○ ${votes.filter(v => v.choice === 'support').length}人 / 回答済み ${votes.length}人`
        : '';
    el('playerCount').textContent = `${room.players.length}人`;
    el('players').innerHTML = room.players.length ? [...room.players].sort((a, b) => b.score - a.score).map(player =>
        `<div class="local-player ${player.playerState === 'LOCKED_PENALTY_THIS' ? 'locked' : ''}"><span>${escapeHtml(player.displayName)} ${player.playerState === 'LOCKED_PENALTY_THIS' ? '🚫' : ''}</span><span class="local-player-score">${player.score}pt</span></div>`).join('')
        : '<p class="text-muted">参加者を待っています...</p>';
    const canJudge = room.roomState === 'LOCKED' && room.winner;
    el('correct').classList.toggle('hidden', !canJudge);
    el('wrong').classList.toggle('hidden', !canJudge);
    el('open').classList.toggle('hidden', room.roomState === 'OPEN' || canJudge);
    el('next').classList.toggle('hidden', room.roomState !== 'WAITING' || !room.roundNumber || room.roundNumber < 1);
    document.querySelectorAll('[data-rule]').forEach(button => button.classList.toggle('active', button.dataset.rule === room.rules.answerRule));
}
function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }
