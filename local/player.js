const socket = io();
const params = new URLSearchParams(location.search);
let roomCode = params.get('room')?.toUpperCase() || localStorage.getItem('buzzer_local_room') || '';
let token = localStorage.getItem('buzzer_local_token');
let displayName = localStorage.getItem('buzzer_local_name') || '';
let room;
let previousScore = 0;
let namesData;
let previousState;
let previousWinner;
let pingTimerId = null;
let openRefreshTimerId = null;
let clockOffset = null;
let clockSamples = [];
let lastRoomReceivedAt = null;
let rejoinCandidates = [];
let lastTrueFalseAnswer = null;

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
    localStorage.setItem('buzzer_local_room', roomCode);
    loadRejoinCandidates(showNameSelection);
};

function showNameSelection() {
    el('roomCodeSection').classList.add('hidden');
    el('nameSection').classList.remove('hidden');
    const savedCandidate = token && displayName
        ? [{ playerToken: token, displayName, saved: true }]
        : [];
    const candidatesByToken = new Map([...savedCandidate, ...rejoinCandidates].map(player => [player.playerToken, player]));
    const candidates = Array.from(candidatesByToken.values());
    if (candidates.length) {
        el('reconnectHint').className = 'mb-md';
        el('reconnectHint').innerHTML = `
            <p class="text-secondary mb-sm">復帰する名前を選ぶか、新しい名前で参加してください。</p>
            <div class="name-options mb-md">
                ${candidates.map(player => `
                    <button class="name-option" data-rejoin-token="${escapeHtml(player.playerToken)}" data-rejoin-name="${escapeHtml(player.displayName)}">
                        ${escapeHtml(player.displayName)}で復帰${player.saved ? '（この端末）' : ''}
                    </button>
                `).join('')}
            </div>
            <button class="btn btn-secondary" id="newPlayerButton" style="width:100%;">別の名前で新しく参加</button>
        `;
        el('reconnectHint').querySelectorAll('[data-rejoin-token]').forEach(button => {
            button.onclick = () => {
                token = button.dataset.rejoinToken;
                joinAs(button.dataset.rejoinName, { reconnect: true, fallbackToNameSelection: true });
            };
        });
        el('newPlayerButton').onclick = () => {
            token = null;
            generateNameOptions();
        };
    } else {
        el('reconnectHint').classList.add('hidden');
        el('reconnectHint').innerHTML = '';
    }
    generateNameOptions();
}

function loadRejoinCandidates(callback) {
    socket.emit('rejoinCandidates', { roomCode }, result => {
        if (!result?.success) {
            alert('ルームが見つかりません');
            return;
        }
        rejoinCandidates = result.players || [];
        callback();
    });
}

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

function joinAs(name, options = {}) {
    displayName = name;
    const eventName = options.reconnect ? 'rejoinRoom' : 'joinRoom';
    const payload = options.reconnect ? { roomCode, token } : { roomCode, token: null, displayName };
    socket.emit(eventName, payload, result => {
        if (!result.success) {
            if (options.fallbackToNameSelection) {
                token = null;
                localStorage.removeItem('buzzer_local_token');
                localStorage.removeItem('buzzer_local_name');
                showNameSelection();
                return;
            }
            alert('ルームが見つかりません');
            return;
        }
        token = result.token;
        roomCode = result.room.roomCode || roomCode;
        localStorage.setItem('buzzer_local_token', token);
        localStorage.setItem('buzzer_local_name', result.player.displayName);
        localStorage.setItem('buzzer_local_room', roomCode);
        displayName = result.player.displayName;
        el('join').classList.add('hidden');
        el('play').classList.remove('hidden');
        el('me').textContent = displayName;
        render(result.room);
        startPing();
    });
}

function startPing() {
    if (pingTimerId) return;
    syncClock();
    pingTimerId = setInterval(() => {
        syncClock();
    }, 2000);
}

function syncClock() {
    if (!roomCode || !token) return;
    const clientSentAt = performance.now();
    socket.emit('timeSync', { roomCode, token, clientSentAt }, response => {
        if (!response?.success) return;
        const clientReceivedAt = performance.now();
        const rtt = clientReceivedAt - clientSentAt;
        const clientMidpoint = (clientSentAt + clientReceivedAt) / 2;
        const serverMidpoint = (response.serverReceivedAt + response.serverSentAt) / 2;
        const offset = serverMidpoint - clientMidpoint;
        if (!Number.isFinite(rtt) || !Number.isFinite(offset)) return;
        clockSamples.push({ rtt, offset });
        if (clockSamples.length > 8) clockSamples.shift();
        const sortedByRtt = [...clockSamples].sort((a, b) => a.rtt - b.rtt);
        const bestSamples = sortedByRtt.slice(0, Math.min(4, sortedByRtt.length));
        const sortedOffsets = bestSamples.map(sample => sample.offset).sort((a, b) => a - b);
        clockOffset = sortedOffsets[Math.floor(sortedOffsets.length / 2)];
        socket.emit('clockSync', { roomCode, token, rtt, offset: clockOffset }, () => {});
        if (room?.roomState === 'OPEN') render(room);
    });
}

function estimatedServerNow() {
    if (clockOffset !== null) return performance.now() + clockOffset;
    if (room?.serverTime && lastRoomReceivedAt !== null) return room.serverTime + (performance.now() - lastRoomReceivedAt);
    return Date.now();
}

socket.on('connect', () => {
    const savedName = localStorage.getItem('buzzer_local_name');
    const savedRoom = localStorage.getItem('buzzer_local_room');
    if (!token || !savedName || !savedRoom) return;
    if (el('play').classList.contains('hidden')) return;
    roomCode = params.get('room')?.toUpperCase() || savedRoom;
    displayName = savedName;
    el('room').value = roomCode;
    joinAs(displayName, { reconnect: true, fallbackToNameSelection: false });
});

socket.on('disconnect', () => {
    if (!el('play').classList.contains('hidden')) el('status').textContent = '接続が切れました。再接続中...';
});

el('exit').onclick = () => {
    if (confirm('退出しますか？')) {
        localStorage.removeItem('buzzer_local_token');
        localStorage.removeItem('buzzer_local_name');
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

el('buzzer').onclick = () => socket.emit('buzz', { roomCode, token, clientPressedAt: performance.now() }, result => {
    if (!result?.success && result?.error === 'NOT_OPEN_YET') el('status').textContent = '開始時刻を同期中です';
});
document.querySelectorAll('[data-answer]').forEach(button => button.onclick = () => socket.emit('trueFalseAnswer', {
    roomCode, token, answer: button.dataset.answer
}, result => {
    if (result?.success) {
        lastTrueFalseAnswer = button.dataset.answer;
        el('trueFalseStatus').textContent = `${button.dataset.answer === 'circle' ? '○' : '×'}で回答しました`;
        document.querySelectorAll('[data-answer]').forEach(answerButton => answerButton.disabled = true);
    } else {
        el('trueFalseStatus').textContent = '回答を受け付けられませんでした';
    }
}));
document.querySelectorAll('[data-vote]').forEach(button => button.onclick = () => socket.emit('supportVote', {
    roomCode, token, choice: button.dataset.vote
}, result => {
    if (!result?.success) el('voteStatus').textContent = '投票を受け付けられませんでした';
}));
socket.on('roomUpdate', render);

function render(nextRoom) {
    if (!nextRoom || !token) return;
    const freshServerUpdate = nextRoom !== room;
    room = nextRoom;
    if (freshServerUpdate || lastRoomReceivedAt === null) lastRoomReceivedAt = performance.now();
    const me = room.players.find(player => player.playerToken === token);
    if (!me) return;
    const myScore = scoreOf(me);
    el('score').textContent = myScore;
    el('individualScore').textContent = myScore;
    renderTeamStatus(me);
    const trueFalseMode = room.rules?.answerRule === 'trueFalse';
    const myTrueFalseAnswerBeforeJudgement = room.trueFalseAnswers?.[token]?.answer;
    if (myTrueFalseAnswerBeforeJudgement) lastTrueFalseAnswer = myTrueFalseAnswerBeforeJudgement;
    if (previousState === 'OPEN' && room.roomState === 'WAITING' && (room.lastJudgement === 'circle' || room.lastJudgement === 'cross')) {
        const correct = lastTrueFalseAnswer === room.lastJudgement;
        showResult(correct);
        playSound(correct ? 'correct' : 'wrong');
        lastTrueFalseAnswer = null;
    }
    if (previousState === 'LOCKED' && previousWinner === token && !room.winner) {
        const correct = myScore > previousScore;
        showResult(correct);
        playSound(correct ? 'correct' : 'wrong');
    }
    if (previousState === 'OPEN' && room.roomState === 'LOCKED' && room.winner) playSound('buzz');
    el('round').textContent = `第${room.roundNumber}問`;
    const winner = room.winner;
    const msUntilOpen = room.openTimestamp ? room.openTimestamp - estimatedServerNow() : 0;
    const scheduledOpenReady = room.roomState === 'OPEN' && msUntilOpen <= 0;
    const canBuzz = !trueFalseMode && scheduledOpenReady && me.playerState === 'READY';
    const canAnswerTrueFalse = trueFalseMode && scheduledOpenReady && me.playerState === 'READY';
    el('buzzer').disabled = !canBuzz;
    el('buzzer').textContent = canBuzz ? 'PUSH!' : (me.playerState === 'LOCKED_PENALTY_THIS' ? '🚫' : 'WAIT');
    el('status').className = 'local-status';
    el('status').textContent = room.roomState === 'FINISHED' ? 'お疲れ様でした！' : room.roomState === 'OPEN' ? (msUntilOpen > 0 ? '開始準備中…' : (trueFalseMode ? (canAnswerTrueFalse ? '○か×を選んでください' : '回答済みです') : (canBuzz ? '🔥 早押しスタート！' : '回答できません'))) :
        winner ? (winner.playerToken === token ? '先着！判定を待っています' : '他の人が先着しました') :
        (room.pending ? '早押し判定中…' : '待機中');
    scheduleOpenRefresh(msUntilOpen);
    if (canBuzz) el('status').classList.add('open');
    if (winner?.playerToken === token) el('status').classList.add('winner');
    if (me.playerState === 'LOCKED_PENALTY_THIS') el('status').classList.add('locked');
    el('buzzer').classList.toggle('pressed', me.playerState === 'PRESSED');
    el('buzzer').classList.toggle('winner', winner?.playerToken === token);
    el('buzzer').classList.toggle('locked', !canBuzz && !winner);
    el('buzzer').classList.toggle('hidden', room.roomState === 'FINISHED');
    el('buzzer').classList.toggle('hidden', trueFalseMode || room.roomState === 'FINISHED');
    el('trueFalsePanel').classList.toggle('hidden', !trueFalseMode || room.roomState !== 'OPEN' || msUntilOpen > 0 || me.playerState === 'LOCKED_PENALTY_THIS' || me.playerState === 'LOCKED_PENALTY_NEXT');
    const myTrueFalseAnswer = room.trueFalseAnswers?.[token]?.answer;
    if (trueFalseMode && room.roomState === 'OPEN') {
        el('trueFalseStatus').textContent = myTrueFalseAnswer ? `${myTrueFalseAnswer === 'circle' ? '○' : '×'}で回答しました` : 'ホストの判定を待ちます';
        document.querySelectorAll('[data-answer]').forEach(button => {
            button.disabled = Boolean(myTrueFalseAnswer) || me.playerState !== 'READY';
        });
    }
    el('finishText').classList.toggle('hidden', room.roomState !== 'FINISHED');
    const vote = room.supportVotes?.[token];
    const isPenaltyLocked = me.playerState === 'LOCKED_PENALTY_THIS' || me.playerState === 'LOCKED_PENALTY_NEXT';
    const canVote = room.rules.answerRule === 'support' && room.roomState === 'LOCKED' && winner && winner.playerToken !== token && !isPenaltyLocked;
    el('vote').classList.toggle('hidden', !canVote);
    if (canVote) {
        el('answerer').textContent = winner.displayName;
        el('voteStatus').textContent = vote ? (vote.choice === 'support' ? '○を選びました' : '×を選びました') : '正解なら○に+1pt。不正解なら○を選んだ人は当問ロックです。';
        document.querySelectorAll('[data-vote]').forEach(button => button.disabled = Boolean(vote));
    }
    renderRanking();
    previousScore = myScore;
    previousState = room.roomState;
    previousWinner = winner?.playerToken;
}

function scheduleOpenRefresh(msUntilOpen) {
    if (openRefreshTimerId) {
        clearTimeout(openRefreshTimerId);
        openRefreshTimerId = null;
    }
    if (room?.roomState !== 'OPEN' || msUntilOpen <= 0) return;
    openRefreshTimerId = setTimeout(() => {
        openRefreshTimerId = null;
        if (room?.roomState === 'OPEN') render(room);
    }, Math.min(1000, Math.max(10, msUntilOpen + 5)));
}

function renderTeamStatus(me) {
    const team = room.rules?.teamMode && me.teamId ? room.teams?.[me.teamId] : null;
    el('soloScoreBlock').classList.toggle('hidden', Boolean(team));
    el('teamScoreBlock').classList.toggle('hidden', !team);
    el('myTeamBadge').classList.toggle('hidden', !team);
    if (!team) return;
    el('myTeamName').textContent = team.teamName || 'チーム';
    el('myTeamName').style.color = team.color || 'var(--accent-cyan)';
    el('teamScore').textContent = team.score || 0;
    el('teamScoreBlock').style.border = `1px solid ${team.color || 'var(--accent-cyan)'}`;
    el('myTeamBadge').textContent = team.teamName || 'チーム';
    el('myTeamBadge').style.background = team.color || 'var(--accent-cyan)';
}

function renderRanking() {
    el('ranking').innerHTML = [...room.players].sort((a, b) => scoreOf(b) - scoreOf(a)).slice(0, 5).map((player, index) => {
        const medal = index === 0 ? 'gold' : index === 1 ? 'silver' : index === 2 ? 'bronze' : '';
        return `<div class="ranking-item ${player.playerToken === token ? 'highlight' : ''}"><span class="ranking-rank ${medal}">${index + 1}</span><span class="ranking-name">${escapeHtml(player.displayName)}</span><span class="ranking-score">${scoreOf(player)}pt</span></div>`;
    }).join('');

    const teams = Object.values(room.teams || {});
    if (!room.rules?.teamMode) {
        el('teamRanking').innerHTML = '<p class="text-muted">チーム戦なし</p>';
        return;
    }
    if (!teams.length) {
        el('teamRanking').innerHTML = '<p class="text-muted">チーム未作成です</p>';
        return;
    }
    const playersByToken = Object.fromEntries(room.players.map(player => [player.playerToken, player]));
    el('teamRanking').innerHTML = teams.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 5).map((team, index) => {
        const members = (team.members || []).map(memberToken => playersByToken[memberToken]).filter(Boolean);
        const memberList = members.map(player => `<span class="team-member-chip">${escapeHtml(player.displayName)} ${scoreOf(player)}pt</span>`).join('');
        return `
            <div class="ranking-item team-ranking-item">
                <div class="team-ranking-header" style="--team-color:${team.color || 'var(--accent-cyan)'};">
                    <span class="ranking-rank">${index + 1}</span>
                    <span class="team-name">${escapeHtml(team.teamName || 'チーム')}</span>
                    <span class="team-score">${team.score || 0}pt</span>
                </div>
                <div class="team-member-chips">${memberList || '<span class="text-muted">メンバーなし</span>'}</div>
            </div>
        `;
    }).join('');
}

function scoreOf(player) {
    return player?.individualScore !== undefined ? player.individualScore : (player?.score || 0);
}

function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value;
    return div.innerHTML;
}
