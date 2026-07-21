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
        el('joinUrl').textContent = `${result.lanUrl}player.html?room=${roomCode}`;
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
    el('winner').textContent = room.winner ? `先着: ${room.winner.displayName}` : (room.pending ? '早押し判定中…' : '待機中');
    const votes = Object.values(room.supportVotes || {});
    el('voteCount').textContent = room.rules.answerRule === 'support' && room.winner
        ? `支持投票: ○ ${votes.filter(v => v.choice === 'support').length}人 / 回答済み ${votes.length}人`
        : '';
    el('players').innerHTML = [...room.players].sort((a, b) => b.score - a.score).map(player =>
        `<li><span>${escapeHtml(player.displayName)} ${player.playerState === 'LOCKED_PENALTY_THIS' ? '🚫' : ''}</span><strong>${player.score}pt</strong></li>`).join('');
}
function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }
