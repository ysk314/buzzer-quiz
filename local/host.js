const socket = io();
let roomCode;
let pin;
let room;
let previousState;
let judgementTimeoutId = null;
let pendingRules = {
    answerRule: 'classic',
    wrongPoints: 0,
    allowNegative: false,
    penaltyType: 'thisRound'
};

const sounds = {};
function playSound(name) {
    sounds[name] ||= new Audio(`/assets/sounds/${name}.mp3`);
    sounds[name].currentTime = 0;
    sounds[name].play().catch(() => {});
}

const el = id => document.getElementById(id);

el('createRoomBtn').onclick = () => socket.emit('createRoom', result => {
    roomCode = result.roomCode;
    pin = result.pin;
    room = null;
    previousState = null;
    const joinUrl = `${result.lanUrl}player.html?room=${roomCode}`;
    el('displayRoomCode').textContent = roomCode;
    el('displayPin').textContent = pin;
    el('shareUrl').value = joinUrl;
    el('qrCode').src = `qr.svg?url=${encodeURIComponent(joinUrl)}`;
    el('choiceSection').classList.add('hidden');
    el('roomCreatedSection').classList.remove('hidden');
    renderSettings(pendingRules);
});

el('autoJoinBtn').onclick = enterHostMode;
el('backToChoiceFromCreated').onclick = () => {
    el('roomCreatedSection').classList.add('hidden');
    el('choiceSection').classList.remove('hidden');
};
el('backToSetupBtn').onclick = () => {
    el('mainScreen').classList.add('hidden');
    el('setupScreen').classList.remove('hidden');
};
el('copyUrlBtn').onclick = async () => {
    await navigator.clipboard?.writeText(el('shareUrl').value);
};

el('settingsToggle').onclick = openSettings;
el('settingsTogglePre').onclick = openSettings;
el('closeSettings').onclick = closeSettings;
el('settingsOverlay').onclick = event => {
    if (event.target === el('settingsOverlay')) closeSettings();
};

function enterHostMode() {
    const rulesToApply = { ...pendingRules };
    socket.emit('hostAuth', { roomCode, pin }, auth => {
        if (!auth.success) return alert('ホスト認証に失敗しました');
        el('setupScreen').classList.add('hidden');
        el('mainScreen').classList.remove('hidden');
        el('headerRoomCode').textContent = roomCode;
        el('headerPin').textContent = pin;
        render(auth.room);
        socket.emit('updateRules', { roomCode, rules: rulesToApply }, result => {
            if (!result.success) alert('ルール設定を反映できませんでした');
        });
    });
}

function openSettings() {
    el('settingsOverlay').classList.add('active');
}

function closeSettings() {
    el('settingsOverlay').classList.remove('active');
}

function emit(event, payload = {}) {
    socket.emit(event, { roomCode, ...payload }, result => {
        if (!result.success) alert('操作を受け付けられませんでした');
    });
}

el('openBtn').onclick = () => {
    playSound('open');
    emit('openBuzz', { clearPenalties: room.roomState === 'OPEN' });
};
el('correctBtn').onclick = () => {
    showJudgement('correct');
    playSound('correct');
    emit('judge', { result: 'correct' });
};
el('wrongBtn').onclick = () => {
    showJudgement('wrong');
    playSound('wrong');
    emit('judge', { result: 'wrong' });
    setTimeout(() => emit('openBuzz', { clearPenalties: false }), 250);
};
el('nextBtn').onclick = () => emit('nextRound');
el('undoBtn').onclick = () => emit('undo');
el('finishGameBtn').onclick = () => {
    if (confirm('クイズを終了して結果発表にしますか？')) {
        playSound('end');
        emit('finishGame');
    }
};

document.querySelectorAll('.setting-option').forEach(button => {
    button.onclick = () => {
        const value = parseSettingValue(button.dataset.value);
        pendingRules = { ...pendingRules, [button.dataset.setting]: value };
        renderSettings(pendingRules);
        if (room) emit('updateRules', { rules: { [button.dataset.setting]: value } });
    };
});

socket.on('roomUpdate', render);

function render(nextRoom) {
    room = nextRoom;
    const players = room.players || [];
    const hasWinner = Boolean(room.winner);
    const hasPenalty = players.some(player =>
        player.playerState === 'LOCKED_PENALTY_THIS' || player.playerState === 'LOCKED_PENALTY_NEXT'
    );

    if (previousState === 'OPEN' && room.roomState === 'LOCKED' && hasWinner) playSound('buzz');
    if (previousState !== 'FINISHED' && room.roomState === 'FINISHED') playSound('end');
    previousState = room.roomState;
    pendingRules = { ...pendingRules, ...(room.rules || {}) };

    el('roundNumber').textContent = room.roundNumber;
    el('roundNumberDisplay').textContent = room.roundNumber;
    el('playerCount').textContent = players.length;
    el('playerListCount').textContent = players.length;

    renderBadge(room.roomState);
    renderMainState(players, hasWinner, hasPenalty);
    renderPlayers(players);
    renderSettings(room.rules || {});
}

function renderBadge(state) {
    const badge = el('roomStateBadge');
    badge.className = 'badge';
    if (state === 'OPEN') badge.classList.add('badge-open');
    else if (state === 'LOCKED' || state === 'FINISHED') badge.classList.add('badge-locked');
    else badge.classList.add('badge-waiting');
    badge.textContent = state;
}

function renderMainState(players, hasWinner, hasPenalty) {
    const finished = room.roomState === 'FINISHED';
    el('controlSection').classList.toggle('hidden', finished);
    el('finalRankingSection').classList.toggle('hidden', !finished);
    if (finished) {
        renderFinalRanking(players);
        return;
    }

    const waitingDisplay = el('waitingDisplay');
    const winnerDisplay = el('winnerDisplay');
    const judgeButtons = el('judgeButtons');
    const voteCount = el('supportVoteCount');
    const judgementDisplay = el('judgementDisplay');
    const openBtn = el('openBtn');
    const nextBtn = el('nextBtn');

    const isFirstWait = room.roundNumber === 1 && room.roomState === 'WAITING' && !room.canUndo;
    const afterCorrect = room.roomState === 'WAITING' && room.canUndo && !hasWinner;
    const afterWrong = room.roomState === 'LOCKED' && room.canUndo && !hasWinner;
    const showJudge = room.roomState === 'LOCKED' && hasWinner;
    const showOpen = !showJudge && (room.roomState === 'WAITING' || room.roomState === 'LOCKED' || (room.roomState === 'OPEN' && hasPenalty)) && !afterCorrect;
    const showNext = afterCorrect || afterWrong;

    winnerDisplay.classList.toggle('hidden', !showJudge);
    judgeButtons.classList.toggle('hidden', !showJudge);
    openBtn.classList.toggle('hidden', !showOpen);
    nextBtn.classList.toggle('hidden', !showNext);
    voteCount.classList.toggle('hidden', !(room.rules?.answerRule === 'support' && showJudge));

    if (!judgementTimeoutId && !afterCorrect && !afterWrong) {
        judgementDisplay.classList.add('hidden');
    }

    if (showJudge) {
        el('winnerName').textContent = room.winner.displayName;
        el('reactionTime').textContent = room.winner.reactionTime || 0;
        const votes = Object.values(room.supportVotes || {});
        const supported = votes.filter(vote => vote.choice === 'support').length;
        voteCount.textContent = `支持投票: ○ ${supported}人 / 回答済み ${votes.length}人`;
    }

    if (isFirstWait) {
        openBtn.textContent = '🚀 クイズスタート！';
        waitingDisplay.innerHTML = '<p class="text-secondary" style="font-size: 1.2rem;">参加者が揃ったら、「クイズスタート」をタップ！</p>';
        waitingDisplay.classList.remove('hidden');
    } else if (room.roomState === 'OPEN') {
        openBtn.textContent = hasPenalty ? '🔓 全員ペナルティ解除' : '🔓 回答再開';
        waitingDisplay.innerHTML = '<p class="text-success" style="font-size: 1.2rem;">🔹 回答受付中... （ボタンを連打できます！）</p>';
        waitingDisplay.classList.toggle('hidden', !hasPenalty);
    } else if (afterCorrect) {
        waitingDisplay.innerHTML = '<p class="text-accent" style="font-size: 1.2rem;">正解！「次の問題へ」を押してください</p>';
        waitingDisplay.classList.remove('hidden');
    } else if (afterWrong) {
        openBtn.textContent = hasPenalty ? '🔓 全員ペナルティ解除' : '🔓 回答再開';
        waitingDisplay.innerHTML = hasPenalty
            ? '<p class="text-secondary" style="font-size: 1.2rem;">「回答再開」でロック対象以外の回答を再開します</p>'
            : '<p class="text-secondary" style="font-size: 1.2rem;">「回答再開」または「次の問題へ」を選んでください</p>';
        waitingDisplay.classList.remove('hidden');
    } else {
        openBtn.textContent = hasPenalty ? '🔓 全員ペナルティ解除' : '🔓 回答再開';
        waitingDisplay.classList.toggle('hidden', showJudge);
    }

    el('undoBtn').classList.toggle('hidden', !room.canUndo);
    el('finishGameBtn').classList.remove('hidden');
}

function showJudgement(result) {
    const judgementDisplay = el('judgementDisplay');
    const judgementIcon = el('judgementIcon');
    judgementIcon.textContent = result === 'correct' ? '◯' : '×';
    judgementIcon.style.color = result === 'correct' ? 'var(--accent-green)' : 'var(--accent-red)';
    judgementDisplay.classList.remove('hidden');
    el('winnerDisplay').classList.add('hidden');
    el('judgeButtons').classList.add('hidden');
    el('openBtn').classList.add('hidden');
    el('nextBtn').classList.add('hidden');
    if (judgementTimeoutId) clearTimeout(judgementTimeoutId);
    judgementTimeoutId = setTimeout(() => {
        judgementTimeoutId = null;
        judgementDisplay.classList.add('hidden');
        render(room);
    }, result === 'correct' ? 2000 : 1500);
}

function renderPlayers(players) {
    el('playerList').innerHTML = players.length ? [...players].sort((a, b) => b.score - a.score).map(player => {
        const locked = player.playerState === 'LOCKED_PENALTY_THIS' || player.playerState === 'LOCKED_PENALTY_NEXT';
        const offline = player.connectionStatus === 'offline';
        return `
            <div class="player-item ${locked ? 'locked' : ''} ${offline ? 'offline' : ''}">
                <span class="player-name">${escapeHtml(player.displayName)}${locked ? ' 🚫' : ''}</span>
                <span class="player-score">${player.score || 0}pt</span>
            </div>
        `;
    }).join('') : '<p class="text-muted">参加者を待っています...</p>';
}

function renderFinalRanking(players) {
    const sorted = [...players].sort((a, b) => (b.score || 0) - (a.score || 0));
    el('hostIndividualRankingList').innerHTML = sorted.length ? sorted.map((player, index) => `
        <li class="ranking-item ${index === 0 ? 'highlight' : ''}" style="margin-bottom: 8px;">
            <span class="ranking-rank">${index + 1}.</span>
            <span class="ranking-name">${escapeHtml(player.displayName)}</span>
            <span class="ranking-score">${player.score || 0}pt</span>
        </li>
    `).join('') : '<li class="text-muted">参加者がいません</li>';
}

function renderSettings(rules) {
    document.querySelectorAll('.setting-option').forEach(button => {
        const value = parseSettingValue(button.dataset.value);
        const currentValue = button.dataset.setting === 'answerRule'
            ? (rules.answerRule || 'classic')
            : rules[button.dataset.setting];
        button.classList.toggle('active', currentValue === value);
    });
}

function parseSettingValue(value) {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return /^\d+$/.test(value) ? Number(value) : value;
}

function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value;
    return div.innerHTML;
}
