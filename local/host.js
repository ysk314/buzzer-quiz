const socket = io();
let roomCode;
let pin;
let room;
let previousState;

const sounds = {};
function playSound(name) {
    sounds[name] ||= new Audio(`/assets/sounds/${name}.mp3`);
    sounds[name].currentTime = 0;
    sounds[name].play().catch(() => {});
}

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
el('open').onclick = () => { playSound('open'); emit('openBuzz', { clearPenalties: room.roomState === 'OPEN' }); };
el('correct').onclick = () => { playSound('correct'); emit('judge', { result: 'correct' }); };
el('wrong').onclick = () => {
    playSound('wrong');
    emit('judge', { result: 'wrong' });
    setTimeout(() => emit('openBuzz', { clearPenalties: false }), 250);
};
el('next').onclick = () => emit('nextRound');
el('undo').onclick = () => emit('undo');
el('finish').onclick = () => {
    if (confirm('クイズを終了して結果発表にしますか？')) {
        playSound('end');
        emit('finishGame');
    }
};
document.querySelectorAll('[data-rule]').forEach(button => button.onclick = () => emit('updateRules', { rules: { answerRule: button.dataset.rule } }));
document.querySelectorAll('[data-setting]').forEach(button => button.onclick = () => {
    const value = /^\d+$/.test(button.dataset.value) ? Number(button.dataset.value) : button.dataset.value;
    emit('updateRules', { rules: { [button.dataset.setting]: value } });
});
socket.on('roomUpdate', render);

function render(nextRoom) {
    room = nextRoom;
    if (previousState === 'OPEN' && room.roomState === 'LOCKED' && room.winner) playSound('buzz');
    previousState = room.roomState;
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
    const hasPenalty = room.players.some(player => player.playerState === 'LOCKED_PENALTY_THIS');
    el('correct').classList.toggle('hidden', !canJudge);
    el('wrong').classList.toggle('hidden', !canJudge);
    const showOpen = !canJudge && (room.roomState === 'WAITING' || room.roomState === 'LOCKED' || (room.roomState === 'OPEN' && hasPenalty));
    el('open').classList.toggle('hidden', !showOpen);
    el('open').textContent = room.roomState === 'OPEN' && hasPenalty ? '🔓 全員ペナルティ解除' : (room.roundNumber === 1 && room.roomState === 'WAITING' ? '🚀 クイズスタート！' : '🔓 回答再開');
    el('next').classList.toggle('hidden', room.roomState !== 'WAITING' || room.roundNumber === 1 && !room.canUndo);
    el('undo').classList.toggle('hidden', !room.canUndo);
    el('finish').classList.toggle('hidden', room.roomState === 'FINISHED');
    document.querySelectorAll('[data-rule]').forEach(button => button.classList.toggle('active', button.dataset.rule === room.rules.answerRule));
    document.querySelectorAll('[data-setting]').forEach(button => {
        const value = /^\d+$/.test(button.dataset.value) ? Number(button.dataset.value) : button.dataset.value;
        button.classList.toggle('active', room.rules[button.dataset.setting] === value);
    });
}
function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }
